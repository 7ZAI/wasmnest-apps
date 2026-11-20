//! Native 测试替身：真实 SQLite、可编排出网、显式时钟与日志捕获。
//!
//! 只在 `cfg(test)` 下编译；`rusqlite` 是 dev-dependency，不进入 wasm 产物。

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{json, Map, Value};

use crate::domain::error_kind;
use crate::ports::{
    AssistantBridge, ClockPort, DbPort, EventPort, FetchPort, FetchRequest, FetchResponse, LogPort,
    PortError, Ports, SchedulePort,
};

fn storage_error(error: rusqlite::Error) -> PortError {
    PortError::with_detail(error_kind::STORAGE_FAILED, error.to_string())
}

fn to_sql_value(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(flag) => SqlValue::Integer(if *flag { 1 } else { 0 }),
        Value::Number(number) => match number.as_i64() {
            Some(integer) => SqlValue::Integer(integer),
            None => SqlValue::Real(number.as_f64().unwrap_or_default()),
        },
        Value::String(text) => SqlValue::Text(text.clone()),
        Value::Array(_) | Value::Object(_) => SqlValue::Text(value.to_string()),
    }
}

fn row_to_json(row: &rusqlite::Row<'_>) -> Result<Value, PortError> {
    let mut object = Map::new();
    let statement = row.as_ref();
    for index in 0..statement.column_count() {
        let name = statement
            .column_name(index)
            .map_err(storage_error)?
            .to_string();
        let value = match row.get_ref(index).map_err(storage_error)? {
            ValueRef::Null => Value::Null,
            ValueRef::Integer(integer) => json!(integer),
            ValueRef::Real(real) => json!(real),
            ValueRef::Text(bytes) => Value::String(String::from_utf8_lossy(bytes).into_owned()),
            ValueRef::Blob(bytes) => Value::String(format!("<blob {} bytes>", bytes.len())),
        };
        object.insert(name, value);
    }
    Ok(Value::Object(object))
}

/// 内存 SQLite 的 `DbPort` 实现：跑真实 SQL，而不是匹配 SQL 文本。
pub struct TestDb {
    connection: RefCell<Connection>,
    fail_fragment: RefCell<Option<String>>,
}

impl TestDb {
    /// 建一个空的内存库。
    pub fn new() -> Self {
        let connection = Connection::open_in_memory().expect("in-memory sqlite opens");
        Self {
            connection: RefCell::new(connection),
            fail_fragment: RefCell::new(None),
        }
    }

    /// 让包含指定片段的语句返回存储错误，用于验证写入顺序与中间失败。
    pub fn fail_on(&self, fragment: &str) {
        *self.fail_fragment.borrow_mut() = Some(fragment.to_string());
    }

    fn should_fail(&self, sql: &str) -> bool {
        self.fail_fragment
            .borrow()
            .as_deref()
            .map(|fragment| sql.contains(fragment))
            .unwrap_or(false)
    }
}

impl Default for TestDb {
    fn default() -> Self {
        Self::new()
    }
}

impl DbPort for TestDb {
    fn execute(&self, sql: &str) -> Result<i32, PortError> {
        if self.should_fail(sql) {
            return Err(PortError::with_detail(
                error_kind::STORAGE_FAILED,
                format!("injected failure for: {sql}"),
            ));
        }
        let connection = self.connection.borrow();
        connection
            .execute(sql, [])
            .map(|rows| rows as i32)
            .map_err(storage_error)
    }

    fn execute_params(&self, sql: &str, params: &[Value]) -> Result<i32, PortError> {
        if self.should_fail(sql) {
            return Err(PortError::with_detail(
                error_kind::STORAGE_FAILED,
                format!("injected failure for: {sql}"),
            ));
        }
        let connection = self.connection.borrow();
        let values: Vec<SqlValue> = params.iter().map(to_sql_value).collect();
        connection
            .execute(sql, params_from_iter(values))
            .map(|rows| rows as i32)
            .map_err(storage_error)
    }

    fn execute_batch(&self, sqls: &[String]) -> Result<i32, PortError> {
        let mut connection = self.connection.borrow_mut();
        let transaction = connection.transaction().map_err(storage_error)?;
        for sql in sqls {
            transaction.execute(sql, []).map_err(storage_error)?;
        }
        transaction.commit().map_err(storage_error)?;
        Ok(sqls.len() as i32)
    }

    fn query(&self, sql: &str) -> Result<Vec<Value>, PortError> {
        if self.should_fail(sql) {
            return Err(PortError::with_detail(
                error_kind::STORAGE_FAILED,
                format!("injected failure for: {sql}"),
            ));
        }
        let connection = self.connection.borrow();
        let mut statement = connection.prepare(sql).map_err(storage_error)?;
        let mut rows = statement.query([]).map_err(storage_error)?;
        let mut output = Vec::new();
        while let Some(row) = rows.next().map_err(storage_error)? {
            output.push(row_to_json(row)?);
        }
        Ok(output)
    }

    fn query_params(&self, sql: &str, params: &[Value]) -> Result<Vec<Value>, PortError> {
        if self.should_fail(sql) {
            return Err(PortError::with_detail(
                error_kind::STORAGE_FAILED,
                format!("injected failure for: {sql}"),
            ));
        }
        let connection = self.connection.borrow();
        let mut statement = connection.prepare(sql).map_err(storage_error)?;
        let values: Vec<SqlValue> = params.iter().map(to_sql_value).collect();
        let mut rows = statement
            .query(params_from_iter(values))
            .map_err(storage_error)?;
        let mut output = Vec::new();
        while let Some(row) = rows.next().map_err(storage_error)? {
            output.push(row_to_json(row)?);
        }
        Ok(output)
    }
}

/// 可编排响应并记录请求的出网替身。
pub struct FakeFetch {
    requests: RefCell<Vec<FetchRequest>>,
    responses: RefCell<VecDeque<Result<FetchResponse, PortError>>>,
}

impl FakeFetch {
    /// 空队列：未编排的请求显性失败。
    pub fn new() -> Self {
        Self {
            requests: RefCell::new(Vec::new()),
            responses: RefCell::new(VecDeque::new()),
        }
    }

    /// 追加一个成功响应。
    pub fn enqueue_ok(&self, response: FetchResponse) {
        self.responses.borrow_mut().push_back(Ok(response));
    }

    /// 追加一个失败响应。
    pub fn enqueue_err(&self, error: PortError) {
        self.responses.borrow_mut().push_back(Err(error));
    }

    /// 已发出的请求数量。
    pub fn calls(&self) -> usize {
        self.requests.borrow().len()
    }

    /// 已发出的请求快照。
    pub fn requests(&self) -> Vec<FetchRequest> {
        self.requests.borrow().clone()
    }
}

impl Default for FakeFetch {
    fn default() -> Self {
        Self::new()
    }
}

impl FetchPort for FakeFetch {
    fn fetch(&self, request: FetchRequest) -> Result<FetchResponse, PortError> {
        self.requests.borrow_mut().push(request);
        self.responses.borrow_mut().pop_front().unwrap_or_else(|| {
            Err(PortError::with_detail(
                error_kind::NET_FAILED,
                "no fake response queued",
            ))
        })
    }
}

/// 可设置的显式时钟。
pub struct FakeClock {
    now_ms: Cell<i64>,
}

impl FakeClock {
    /// 以指定时间初始化。
    pub fn new(now_ms: i64) -> Self {
        Self {
            now_ms: Cell::new(now_ms),
        }
    }

    /// 推进时钟。
    pub fn set(&self, now_ms: i64) {
        self.now_ms.set(now_ms);
    }
}

impl ClockPort for FakeClock {
    fn now_ms(&self) -> Result<i64, PortError> {
        Ok(self.now_ms.get())
    }
}

/// 捕获日志文本的替身。
#[derive(Default)]
pub struct FakeLog {
    infos: RefCell<Vec<String>>,
    warns: RefCell<Vec<String>>,
    errors: RefCell<Vec<String>>,
}

impl FakeLog {
    /// 全部 info 日志。
    pub fn infos(&self) -> Vec<String> {
        self.infos.borrow().clone()
    }

    /// 全部 warn 日志。
    pub fn warns(&self) -> Vec<String> {
        self.warns.borrow().clone()
    }

    /// 全部 error 日志。
    pub fn errors(&self) -> Vec<String> {
        self.errors.borrow().clone()
    }
}

impl LogPort for FakeLog {
    fn log_info(&self, message: &str) {
        self.infos.borrow_mut().push(message.to_string());
    }

    fn log_warn(&self, message: &str) {
        self.warns.borrow_mut().push(message.to_string());
    }

    fn log_error(&self, message: &str) {
        self.errors.borrow_mut().push(message.to_string());
    }
}

/// 捕获事件的替身。
#[derive(Default)]
pub struct FakeEvents {
    emitted: RefCell<Vec<(String, Value)>>,
}

impl FakeEvents {
    /// 已发出的事件快照。
    pub fn emitted(&self) -> Vec<(String, Value)> {
        self.emitted.borrow().clone()
    }
}

impl EventPort for FakeEvents {
    fn emit(&self, name: &str, payload: &Value) {
        self.emitted
            .borrow_mut()
            .push((name.to_string(), payload.clone()));
    }
}

/// 无定时器替身。
pub struct NoopSchedule;

impl SchedulePort for NoopSchedule {}

/// 无剪贴板替身。
pub struct NoopClipboard;

impl crate::ports::ClipboardPort for NoopClipboard {}

/// 助手代抓不可用替身。
pub struct NoAssistant;

impl AssistantBridge for NoAssistant {}

/// 一组完整端口，测试用。
pub struct TestPorts {
    pub db: TestDb,
    pub fetch: FakeFetch,
    pub clock: FakeClock,
    pub log: FakeLog,
    pub events: FakeEvents,
    pub schedule: NoopSchedule,
    pub clipboard: NoopClipboard,
    pub assistant: NoAssistant,
}

impl TestPorts {
    /// 以指定「现在」建一套端口。
    pub fn new(now_ms: i64) -> Self {
        Self {
            db: TestDb::new(),
            fetch: FakeFetch::new(),
            clock: FakeClock::new(now_ms),
            log: FakeLog::default(),
            events: FakeEvents::default(),
            schedule: NoopSchedule,
            clipboard: NoopClipboard,
            assistant: NoAssistant,
        }
    }

    /// 借用为核函数需要的端口集合。
    pub fn ports(&self) -> Ports<'_> {
        Ports {
            fetch: &self.fetch,
            db: &self.db,
            clock: &self.clock,
            schedule: &self.schedule,
            clipboard: &self.clipboard,
            log: &self.log,
            events: &self.events,
            assistant: &self.assistant,
        }
    }
}

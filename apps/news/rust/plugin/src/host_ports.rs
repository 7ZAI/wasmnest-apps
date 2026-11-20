//! 共享核端口的宿主实现（双端同一份实现，差异只由 [`crate::platform`] 决定）。
//!
//! 纪律：**1:1 委派、零判据**。这里只做类型转换与错误分类，不在这里决定
//! 「该不该抓」「该不该退避」——那些判据在核里，且有 native 单测。

use crate::platform;
use wasmnest_news_core::domain::error_kind;
use wasmnest_news_core::ports::{
    ClipboardPort, ClockPort, DbPort, EventPort, FetchPort, FetchRequest, FetchResponse, LogPort,
    PortError, SchedulePort,
};
use wasmnest_plugin_api::host::{
    ConfigKey, HostClipboard, HostConfig, HostError, HostEvents, HostHttp, HostLog,
    HostPluginDatabase, HostTimer,
};

/// 端口包：持一个宿主句柄，按需挑用它的能力。
///
/// 泛型而不是钉死 `&WasmHost`：native 单测用只实现某个面的假宿主，端口实现
/// 就能被逐面直测（与生产路径同一份代码）。
pub(crate) struct HostPorts<'a, H: ?Sized>(pub(crate) &'a H);

/// 库错误：分类码统一 `storage.failed`，消息逐字保留。
fn db_err(e: HostError) -> PortError {
    PortError::with_detail(error_kind::STORAGE_FAILED, e.to_string())
}

/// 出网错误分类：授权拒绝必须是独立分类（界面要给「未授权访问该域名」+ 重试）。
fn classify_http_error(e: HostError) -> PortError {
    let message = e.to_string();
    if message.contains("network authorization denied") || message.contains("permission denied") {
        PortError::with_detail(error_kind::NET_DENIED, message)
    } else {
        PortError::with_detail(error_kind::NET_FAILED, message)
    }
}

impl<H: HostHttp + ?Sized> FetchPort for HostPorts<'_, H> {
    fn fetch(&self, request: FetchRequest) -> Result<FetchResponse, PortError> {
        let mut headers = serde_json::Map::new();
        for (key, value) in &request.headers {
            headers.insert(key.clone(), serde_json::json!(value));
        }
        let payload = serde_json::json!({
            "method": request.method,
            "url": request.url,
            "headers": headers,
            "body": request.body,
        });
        let value = self
            .0
            .http_fetch(&payload)
            .map_err(classify_http_error)?
            .ok_or_else(|| {
                PortError::with_detail("net.failed", "http_fetch returned no result payload")
            })?;
        let status = value
            .get("status")
            .and_then(|v| {
                v.as_u64()
                    .or_else(|| v.as_f64().map(|raw| raw.max(0.0) as u64))
            })
            .unwrap_or(0)
            .min(u16::MAX as u64) as u16;
        let body = match value.get("body") {
            Some(serde_json::Value::String(text)) => text.clone(),
            Some(other) => other.to_string(),
            None => String::new(),
        };
        let mut response_headers = Vec::new();
        if let Some(map) = value.get("headers").and_then(|v| v.as_object()) {
            for (key, raw) in map {
                if let Some(text) = raw.as_str() {
                    response_headers.push((key.clone(), text.to_string()));
                }
            }
        }
        Ok(FetchResponse {
            status,
            body,
            headers: response_headers,
        })
    }
}

impl<H: HostPluginDatabase + ?Sized> DbPort for HostPorts<'_, H> {
    fn execute(&self, sql: &str) -> Result<i32, PortError> {
        self.0.plugin_db_execute(sql).map_err(db_err)
    }

    fn execute_params(&self, sql: &str, params: &[serde_json::Value]) -> Result<i32, PortError> {
        self.0.plugin_db_execute_params(sql, params).map_err(db_err)
    }

    fn execute_batch(&self, sqls: &[String]) -> Result<i32, PortError> {
        self.0.plugin_db_execute_batch(sqls).map_err(db_err)
    }

    fn query(&self, sql: &str) -> Result<Vec<serde_json::Value>, PortError> {
        Ok(self
            .0
            .plugin_db_query(sql)
            .map_err(db_err)?
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default())
    }

    fn query_params(
        &self,
        sql: &str,
        params: &[serde_json::Value],
    ) -> Result<Vec<serde_json::Value>, PortError> {
        Ok(self
            .0
            .plugin_db_query_params(sql, params)
            .map_err(db_err)?
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default())
    }
}

impl<H: HostConfig + ?Sized> ClockPort for HostPorts<'_, H> {
    fn now_ms(&self) -> Result<i64, PortError> {
        match self.0.config_get(ConfigKey::CurrentTimeMs) {
            Ok(Some(raw)) => raw
                .trim()
                .parse::<i64>()
                .map_err(|e| PortError::with_detail("clock.invalid", format!("{e}: {raw}"))),
            Ok(None) => Err(PortError::unsupported("clock.now_ms")),
            Err(e) => Err(PortError::with_detail("clock.unavailable", e.to_string())),
        }
    }
}

impl<H: HostTimer + ?Sized> SchedulePort for HostPorts<'_, H> {
    fn register_interval(&self, interval_secs: u64, command: &str) -> Result<(), PortError> {
        if !platform::current().has_timer() {
            return Err(PortError::unsupported("timer.register"));
        }
        self.0
            .timer_register(interval_secs, command)
            .map_err(|e| PortError::with_detail("timer.register", e.to_string()))
    }
}

impl<H: HostClipboard + ?Sized> ClipboardPort for HostPorts<'_, H> {
    fn write_text(&self, text: &str) -> Result<(), PortError> {
        if !platform::current().has_clipboard() {
            return Err(PortError::unsupported("clipboard.write"));
        }
        self.0
            .clipboard_write_text(text)
            .map_err(|e| PortError::with_detail("clipboard.write", e.to_string()))
    }
}

impl<H: HostLog + ?Sized> LogPort for HostPorts<'_, H> {
    fn log_info(&self, message: &str) {
        self.0.log_info(message);
    }

    fn log_warn(&self, message: &str) {
        self.0.log_warn(message);
    }

    fn log_error(&self, message: &str) {
        self.0.log_error(message);
    }
}

impl<H: HostEvents + ?Sized> EventPort for HostPorts<'_, H> {
    fn emit(&self, name: &str, payload: &serde_json::Value) {
        self.0.emit_event(name, payload);
    }
}

/// 助手代抓：宿主当前没有该能力，保留核内默认实现（固定显性不可用）。
pub(crate) struct NoAssistant;

impl wasmnest_news_core::ports::AssistantBridge for NoAssistant {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// 只实现出网面的宿主桩：其余方法调用即 panic（本模块只测出网映射）。
    #[derive(Default)]
    struct FakeHttp {
        response: RefCell<Option<serde_json::Value>>,
        error: RefCell<Option<String>>,
        last_request: RefCell<Option<serde_json::Value>>,
    }

    impl HostHttp for FakeHttp {
        fn http_fetch(
            &self,
            request: &serde_json::Value,
        ) -> Result<Option<serde_json::Value>, HostError> {
            *self.last_request.borrow_mut() = Some(request.clone());
            if let Some(message) = self.error.borrow().clone() {
                return Err(HostError::custom(-1, message));
            }
            Ok(self.response.borrow().clone())
        }

        fn http_register_endpoint(&self, _config_json: &str) -> Result<String, HostError> {
            unimplemented!()
        }

        fn http_unregister_endpoint(&self, _endpoint_id: &str) -> Result<bool, HostError> {
            unimplemented!()
        }

        fn request_egress_consent(&self, _request_json: &str) -> Result<String, HostError> {
            Err(HostError::custom(
                -1,
                "egress consent is not used in this test",
            ))
        }
    }

    #[test]
    fn maps_status_body_and_headers() {
        let host = FakeHttp::default();
        *host.response.borrow_mut() = Some(serde_json::json!({
            "status": 200.0,
            "body": "{\"ok\":true}",
            "headers": { "ETag": "\"abc\"" }
        }));
        let response = HostPorts(&host)
            .fetch(FetchRequest {
                method: "GET".into(),
                url: "https://example.com".into(),
                headers: vec![("Accept".into(), "application/json".into())],
                body: None,
            })
            .unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.body, "{\"ok\":true}");
        assert_eq!(response.header("etag"), Some("\"abc\""));
        let request = host.last_request.borrow().clone().unwrap();
        assert_eq!(request["method"], "GET");
        assert_eq!(request["headers"]["Accept"], "application/json");
    }

    #[test]
    fn authorization_denial_is_its_own_kind() {
        let host = FakeHttp::default();
        *host.error.borrow_mut() = Some(
            "http error: network authorization denied (origin not allowed): plugin 'x' -> https://e.com"
                .to_string(),
        );
        let err = HostPorts(&host)
            .fetch(FetchRequest {
                method: "GET".into(),
                url: "https://e.com".into(),
                headers: Vec::new(),
                body: None,
            })
            .unwrap_err();
        assert_eq!(err.code(), "net.denied");
    }

    #[test]
    fn other_transport_failures_are_net_failed() {
        let host = FakeHttp::default();
        *host.error.borrow_mut() = Some("http error: error sending request".to_string());
        let err = HostPorts(&host)
            .fetch(FetchRequest {
                method: "GET".into(),
                url: "https://e.com".into(),
                headers: Vec::new(),
                body: None,
            })
            .unwrap_err();
        assert_eq!(err.code(), "net.failed");
    }

    #[test]
    fn missing_payload_is_net_failed_not_success() {
        let host = FakeHttp::default();
        let err = HostPorts(&host)
            .fetch(FetchRequest {
                method: "GET".into(),
                url: "https://e.com".into(),
                headers: Vec::new(),
                body: None,
            })
            .unwrap_err();
        assert_eq!(err.code(), "net.failed");
    }

    #[test]
    fn non_ascii_body_is_preserved() {
        let host = FakeHttp::default();
        *host.response.borrow_mut() = Some(serde_json::json!({
            "status": 200,
            "body": "标题",
        }));
        let response = HostPorts(&host)
            .fetch(FetchRequest {
                method: "GET".into(),
                url: "https://e.com".into(),
                headers: Vec::new(),
                body: None,
            })
            .unwrap();
        assert_eq!(response.body, "标题");
    }
}

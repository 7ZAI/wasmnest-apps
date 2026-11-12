//! 插件 KV 访问面（宿主 `host-storage`）
//!
//! 与 auth-center 的口径一致：native（cargo test）没有宿主原语，所有存储入口返回
//! **显性错误**，绝不返回空值冒充「未配置」——那会让页面把「读不到」显示成
//! 「尚未配置」，用户会重新导入一份覆盖不了的值。
//!
//! 域逻辑（[`crate::ops`]）只依赖 [`NetConfigStore`]，故 native 单测用
//! [`MemoryStore`] 直测读写语义，不必模拟宿主。

use serde_json::Value;

/// 本插件私有 KV 的最小读写面
pub trait NetConfigStore {
    /// 读键；键不存在 = `None`
    fn read(&self, key: &str) -> Result<Option<Value>, String>;
    /// 写键（全量替换）
    fn write(&self, key: &str, value: &Value) -> Result<(), String>;
    /// 删键（幂等）
    fn delete(&self, key: &str) -> Result<(), String>;
}

/// 生产实现：宿主 `host-storage`（wasm 目标）
#[cfg(target_arch = "wasm32")]
pub struct HostStore;

#[cfg(target_arch = "wasm32")]
impl NetConfigStore for HostStore {
    fn read(&self, key: &str) -> Result<Option<Value>, String> {
        use wasmnest_plugin_api::host::HostStorage;
        use wasmnest_plugin_api::wasm_host::WasmHost;
        HostStorage::storage_get(&WasmHost, key).map_err(|e| e.message)
    }

    fn write(&self, key: &str, value: &Value) -> Result<(), String> {
        use wasmnest_plugin_api::host::HostStorage;
        use wasmnest_plugin_api::wasm_host::WasmHost;
        HostStorage::storage_set(&WasmHost, key, value).map_err(|e| e.message)
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        use wasmnest_plugin_api::host::HostStorage;
        use wasmnest_plugin_api::wasm_host::WasmHost;
        HostStorage::storage_delete(&WasmHost, key).map_err(|e| e.message)
    }
}

/// native 实现：无宿主原语 → 显性失败
#[cfg(not(target_arch = "wasm32"))]
pub struct HostStore;

#[cfg(not(target_arch = "wasm32"))]
impl NetConfigStore for HostStore {
    fn read(&self, _key: &str) -> Result<Option<Value>, String> {
        Err("net-config storage unavailable outside wasm runtime".to_string())
    }

    fn write(&self, _key: &str, _value: &Value) -> Result<(), String> {
        Err("net-config storage unavailable outside wasm runtime".to_string())
    }

    fn delete(&self, _key: &str) -> Result<(), String> {
        Err("net-config storage unavailable outside wasm runtime".to_string())
    }
}

/// native 单测替身（记录写入 / 删除，读回原值）
#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore {
    pub data: std::cell::RefCell<std::collections::BTreeMap<String, Value>>,
}

#[cfg(test)]
impl MemoryStore {
    pub fn with(key: &str, value: Value) -> Self {
        let store = Self::default();
        store.data.borrow_mut().insert(key.to_string(), value);
        store
    }

    pub fn get(&self, key: &str) -> Option<Value> {
        self.data.borrow().get(key).cloned()
    }
}

#[cfg(test)]
impl NetConfigStore for MemoryStore {
    fn read(&self, key: &str) -> Result<Option<Value>, String> {
        Ok(self.get(key))
    }

    fn write(&self, key: &str, value: &Value) -> Result<(), String> {
        self.data
            .borrow_mut()
            .insert(key.to_string(), value.clone());
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        self.data.borrow_mut().remove(key);
        Ok(())
    }
}

//! native 路径 — crate 内单元测试（自 wasmnest-desktop/wasm-apps/bedcode/rust/src/pairing/keys.rs 迁出）

use super::*;

/// native 路径显性失败（无宿主环境不得静默生成进程内密钥）
#[test]
fn native_paths_fail_without_host() {
    assert!(keyring_from_host_auth().is_err());
    assert!(rotate_from_host_auth().is_err());
}

//! 凭据红线 — `Debug` 输出不得携带密钥材料（AGENTS §4.1 / C-DEBUG）

use super::*;

/// 密钥环的 `{:?}` 只保留代次：私钥（内存态原始字节 / 落库 hex）一律不出现
///
/// 当前没有生产调用点打 `{:?}`（已 grep），这是零成本的预防性收紧：任意一行
/// 未来新增的 `log_debug(&format!("{:?}", ring))` 或断言失败信息都会把私钥
/// 明文打进宿主日志。
#[test]
fn debug_output_never_contains_key_material() {
    let ring = Keyring {
        active: 2,
        keys: BTreeMap::from([(1u64, vec![0xAB; 32]), (2u64, vec![0xCD; 32])]),
    };
    let debug = format!("{ring:?}");
    assert!(debug.contains("generations"), "{debug}");
    assert!(debug.contains("active"), "{debug}");
    assert!(
        !debug.contains("cd") && !debug.contains("CD"),
        "内存态私钥不得出现在 Debug 输出里: {debug}"
    );

    let file = KeyringFile {
        active: ring.active,
        keys: ring
            .keys
            .iter()
            .map(|(g, k)| (*g, hex::encode(k)))
            .collect(),
    };
    let debug = format!("{file:?}");
    assert!(debug.contains("generations"), "{debug}");
    let leaked = hex::encode([0xCDu8; 32]);
    assert!(
        !debug.contains(&leaked),
        "落库 hex 私钥不得出现在 Debug 输出里: {debug}"
    );
}

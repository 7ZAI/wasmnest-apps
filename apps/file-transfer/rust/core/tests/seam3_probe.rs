// [Seam 3 跑红探针] spec §11：故意必败，验证 ci.yml 的 rust-test 门禁真的会红、
// PR 会被阻断（证明门禁不空转）。验证后随探针 PR 一起关闭，不入 dev。
#[test]
fn seam3_probe_must_fail() {
    assert!(false, "Seam 3 probe: rust-test 门禁必须能红（验证后自动关闭）");
}

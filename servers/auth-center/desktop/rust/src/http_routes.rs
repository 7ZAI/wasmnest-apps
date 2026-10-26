//! HTTP 路由代码注册（ABI v29，自 bedcode `http_routes.rs` 随认证链路搬迁）
//!
//! 插件成为**在册认证中心**后，于 `activate` 期经 `host-http.register-endpoint` 注册
//! 自身全部 HTTP 路由（内部端点段 + 对外 URL 别名 + 方法 + 认证档位）。**本表 = 本插件
//! HTTP 面的单一事实源**（用户裁定：不通过 `contributes.httpEndpoints` 静态声明，插件
//! 代码运行时注册）。未成为在册中心时**一条都不登记**——判据与理由见 [`register_all`]。
//!
//! ## 本表只有认证链七端点
//!
//! 它们是**拿 token 之前**的公开入口（移动端配对 / QR / 生物认证），故档位一律
//! `none`；`/api/auth/*` 的编排实现见 [`crate::auth_http`]。bedcode 侧的会话 / 任务 /
//! 文件域路由留在 bedcode——**路由随归属走**：谁拥有该域的语义，谁注册它的入口。
//!
//! ## 为什么注册失败不阻断激活
//!
//! 单条注册失败 → 该端点 404（fail-visible，请求方立刻看得出来），但把整个中心打
//! 成激活失败会连带入站裁决（`auth-policy` 导出）一起失效——那是更大的故障面（D7
//! 故障隔离）。故 `register_one` 只 warn，`register_all` 汇总留痕。

use crate::WasmHost;
use wasmnest_plugin_api::host::{HostHttp, HostLog};

/// 一条路由注册声明（`_http_endpoint` 的 `path` 字段 = 内部端点段）
pub struct HttpRouteDecl {
    /// 内部端点段（宿主拼出 `/api/plugin/<plugin-id>/<path>`；`_http_endpoint`
    /// 收到的 `path` 字段逐字一致）
    pub path: &'static str,
    /// 对外 URL 别名（None = 仅内部路径可达；支持 `{id}` 模板段）
    pub host: Option<&'static str>,
    /// host 别名的允许方法（内部路径不受方法限制——插件自答 405）
    pub methods: &'static [&'static str],
    /// 认证档位（"jwt" | "none"；HTTP 面未声明即最严 jwt）
    pub auth: &'static str,
}

const NONE: &str = "none";

/// 插件 HTTP 路由注册表（单一事实源）
///
/// 分派按 path 全等（`auth_http::handle_http_endpoint`），本表顺序仅作登记序。
pub const ROUTES: &[HttpRouteDecl] = &[
    // ==================== 认证链别名（公开路由——拿 token 之前的入口） ====================
    HttpRouteDecl {
        path: "auth/pairing",
        host: Some("/api/auth/pairing"),
        methods: &["POST"],
        auth: NONE,
    },
    HttpRouteDecl {
        path: "auth/verify",
        host: Some("/api/auth/verify"),
        methods: &["POST"],
        auth: NONE,
    },
    HttpRouteDecl {
        path: "auth/qr-connect",
        host: Some("/api/auth/qr-connect"),
        methods: &["POST"],
        auth: NONE,
    },
    HttpRouteDecl {
        path: "auth/reauth",
        host: Some("/api/auth/reauth"),
        methods: &["POST"],
        auth: NONE,
    },
    HttpRouteDecl {
        path: "auth/biometric-challenge",
        host: Some("/api/auth/biometric-challenge"),
        methods: &["POST"],
        auth: NONE,
    },
    HttpRouteDecl {
        path: "auth/biometric-verify",
        host: Some("/api/auth/biometric-verify"),
        methods: &["POST"],
        auth: NONE,
    },
    HttpRouteDecl {
        path: "auth/biometric-bind",
        host: Some("/api/auth/biometric-bind"),
        methods: &["POST"],
        auth: NONE,
    },
];

/// 单条注册（失败只 warn，见文件头）
fn register_one(host: &WasmHost, decl: &HttpRouteDecl) {
    let config = serde_json::json!({
        "path": decl.path,
        "host": decl.host,
        "methods": decl.methods,
        "auth": decl.auth,
    });
    match host.http_register_endpoint(&config.to_string()) {
        Ok(id) => host.log_debug(&format!(
            "http route registered: {} -> {} ({})",
            decl.path,
            decl.host.unwrap_or("(internal)"),
            id
        )),
        Err(e) => host.log_warn(&format!(
            "http route registration failed: {} ({})",
            decl.path, e
        )),
    }
}

/// 激活期全量注册（幂等：停用回收后重复激活重新登记）
///
/// **只有成为在册认证中心后才登记**（`as_center` = `activate` 末尾注册成功）。
/// 两条理由都不是风格问题：
///
/// 1. **别名是宿主的全局唯一资源**：`/api/auth/*` 重复登记会被注册表以
///    「host path '…' already registered by plugin '<属主>'」拒绝。切换后 BedCode
///    已同批删除这七条别名，本插件是唯一登记方；若本插件注册失败（`as_center=false`）
///    仍去登记，只会把失败刷成一条条警告，并给出「中心未就位但入口已换人」的假象。
/// 2. **未注册时连内部端点也不能开**：`/api/plugin/<owner>/auth/pairing` 是**自助配对**
///    入口（生成码并返回），紧接着 `auth/verify` 会用**本插件的密钥环**签发 JWT 并落
///    配对记录。注册失败 = 宿主不会把入站裁决交给本插件，但这里签发的 token 仍用
///    同一把密钥——暴露它就是留下无效却看似可用的入场凭证。
///
/// 故注册失败时**一个都不登记**：暴露面为零，页面照常能看（页面走命令面，不经 HTTP）。
pub fn register_all(host: &WasmHost, as_center: bool) {
    if !as_center {
        host.log_info(
            "http routes not registered: not the registered auth center yet \
             (self-service pairing surface stays closed until the switch)",
        );
        return;
    }
    let total = ROUTES.len();
    for decl in ROUTES {
        register_one(host, decl);
    }
    host.log_info(&format!(
        "http routes registered: {total} auth endpoints (ABI v29 dynamic surface)"
    ));
}

/// 停用期留痕（宿主侧停用回收 purge 全部注册路由，同 bedcode 先例）
pub fn unregister_all(host: &WasmHost) {
    host.log_info("http routes rely on host purge on deactivate (ABI v29)");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth_http::AUTH_HTTP_ENDPOINTS;

    /// 路由表与 `auth_http::AUTH_HTTP_ENDPOINTS` 逐条一致（两份清单一处漂移即红）
    #[test]
    fn routes_match_auth_endpoint_const() {
        let paths: Vec<&str> = ROUTES.iter().map(|r| r.path).collect();
        assert_eq!(paths, AUTH_HTTP_ENDPOINTS);
    }

    /// 每条都有 `/api/auth/*` 别名、只收 POST——移动端 URL 与方法是外部契约
    #[test]
    fn every_auth_route_is_post_alias() {
        for decl in ROUTES {
            let host = decl.host.expect("认证端点必须有对外别名");
            assert!(
                host.starts_with("/api/auth/"),
                "别名前缀必须是 /api/auth/：{host}"
            );
            assert_eq!(decl.methods, &["POST"], "认证端点只收 POST：{host}");
        }
    }

    /// 认证链是「拿 token 之前」的入口：任何一条被标成 jwt 档位都会让配对直接 401
    #[test]
    fn all_auth_routes_are_public() {
        for decl in ROUTES {
            assert_eq!(decl.auth, NONE, "{} 必须是公开档位", decl.path);
        }
    }
}

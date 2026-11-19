/**
 * 应用版本（显示用）。
 *
 * 真源是 `package.json` / `plugin.json` 的 `version`；发布脚本
 * `scripts/ci/set-app-version.mjs` 同时写这两处，因此这里从 package.json 读，
 * 避免第三份手改副本漂移。
 */
import pkg from '../package.json'

/** 当前应用版本。 */
export const APP_VERSION: string = pkg.version

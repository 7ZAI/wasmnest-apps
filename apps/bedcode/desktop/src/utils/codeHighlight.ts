/**
 * 只读源码查看器的语法高亮（shiki）
 *
 * 语言/主题表与移动端 `mobile/src/fileExplorer/composables/useCodeHighlight.ts` 同源：
 * 两端看同一个文件的着色结果一致。差异只在消费方式——桌面端已有独立行号列，
 * 这里只产出 shiki 的 `<pre class="shiki">` 片段，行号仍由查看器自己渲染。
 *
 * 构建约束（桌面挂载包 = 单文件 `dist/index.js`）：
 * - oniguruma 引擎用 `shiki/wasm` 的**内联**变体（base64 wasm 编进 bundle），
 *   不产出额外资产文件，符合 `inlineDynamicImports` 单产物契约；
 * - 高亮器惰性初始化：只有真正打开文件时才付出 wasm 编译与语言注册的成本，
 *   不拖慢 app 启动。
 *
 * 双主题（`defaultColor: false`）：HTML 里每个 token 同时带 `--shiki-light` /
 * `--shiki-dark`，由查看器的 CSS 按宿主 `<html class="dark">` 切换，无需 JS 观
 * 察主题变化。浅色用 vitesse-light、深色用 vitesse-dark（与移动端默认主题一致）。
 *
 * 版本钉死 4.5.0（package.json 精确版本）：4.6 起 `wasm-inlined` 改为
 * `Blob.stream() + DecompressionStream + Response.bytes()` 加载 wasm，这些 API
 * 在较旧 WebKitGTK 上缺失（实测 happy-dom / 老引擎直接抛 `.stream is not a
 * function`）。4.5.0 是 `atob` + `WebAssembly.instantiate`，兼容面与移动端一致。
 * 升级 shiki 前先确认目标宿主 WebView 支持上述 API。
 */
import { createHighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import type { HighlighterCore } from 'shiki/core'

// ==================== 语言映射 ====================

/** 扩展名 → shiki 语言 id（与移动端同一张表） */
const EXT_LANG_MAP: Record<string, string> = {
  // Top 20 programming languages
  rs: 'rust', ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', java: 'java', go: 'go', c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', rb: 'ruby', php: 'php', swift: 'swift',
  kt: 'kotlin', kts: 'kotlin', scala: 'scala', dart: 'dart',
  lua: 'lua', r: 'r',
  // Web & Frontend
  vue: 'vue', svelte: 'svelte', css: 'css', scss: 'scss',
  less: 'less', html: 'html',
  // Data & Config
  json: 'json', toml: 'toml', yaml: 'yaml', yml: 'yaml',
  xml: 'xml', ini: 'ini', env: 'ini',
  // Shell & Scripting
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript',
  fish: 'shellscript', ps1: 'powershell',
  // Markup & Docs
  md: 'markdown', mdx: 'mdx',
  // Database
  sql: 'sql',
  // Other common formats
  graphql: 'graphql', gql: 'graphql', dockerfile: 'dockerfile',
  makefile: 'makefile', cmake: 'cmake', nix: 'nix', zig: 'zig',
  asm: 'asm', elixir: 'elixir', ex: 'elixir', exs: 'elixir',
  haskell: 'haskell', hs: 'haskell', erlang: 'erlang', erl: 'erlang',
  clojure: 'clojure', clj: 'clojure',
}

/** 根据文件名取 shiki 语言 id；未知扩展名返回 null（调用方按纯文本渲染） */
export function getLangByFilename(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return EXT_LANG_MAP[ext] ?? null
}

// ==================== 静态语言 / 主题模块 ====================
// 用静态 import 而不是动态拼路径：Vite 需要在构建期就能解析到模块
// （移动端同款约束：Tauri WebView 里没有 node 解析器）。

import langRust from '@shikijs/langs/rust'
import langTypescript from '@shikijs/langs/typescript'
import langTsx from '@shikijs/langs/tsx'
import langJavascript from '@shikijs/langs/javascript'
import langJsx from '@shikijs/langs/jsx'
import langPython from '@shikijs/langs/python'
import langJava from '@shikijs/langs/java'
import langGo from '@shikijs/langs/go'
import langC from '@shikijs/langs/c'
import langCpp from '@shikijs/langs/cpp'
import langCsharp from '@shikijs/langs/csharp'
import langRuby from '@shikijs/langs/ruby'
import langPhp from '@shikijs/langs/php'
import langSwift from '@shikijs/langs/swift'
import langKotlin from '@shikijs/langs/kotlin'
import langScala from '@shikijs/langs/scala'
import langDart from '@shikijs/langs/dart'
import langLua from '@shikijs/langs/lua'
import langR from '@shikijs/langs/r'
import langVue from '@shikijs/langs/vue'
import langCss from '@shikijs/langs/css'
import langScss from '@shikijs/langs/scss'
import langHtml from '@shikijs/langs/html'
import langJson from '@shikijs/langs/json'
import langToml from '@shikijs/langs/toml'
import langYaml from '@shikijs/langs/yaml'
import langXml from '@shikijs/langs/xml'
import langIni from '@shikijs/langs/ini'
import langShellscript from '@shikijs/langs/shellscript'
import langPowershell from '@shikijs/langs/powershell'
import langMarkdown from '@shikijs/langs/markdown'
import langMdx from '@shikijs/langs/mdx'
import langSql from '@shikijs/langs/sql'
import langGraphql from '@shikijs/langs/graphql'
import langDockerfile from '@shikijs/langs/dockerfile'
import langMakefile from '@shikijs/langs/makefile'
import langCmake from '@shikijs/langs/cmake'
import langNix from '@shikijs/langs/nix'
import langZig from '@shikijs/langs/zig'
import langAsm from '@shikijs/langs/asm'
import langElixir from '@shikijs/langs/elixir'
import langHaskell from '@shikijs/langs/haskell'
import langErlang from '@shikijs/langs/erlang'
import langClojure from '@shikijs/langs/clojure'
import langSvelte from '@shikijs/langs/svelte'
import langLess from '@shikijs/langs/less'
import themeVitesseDark from '@shikijs/themes/vitesse-dark'
import themeVitesseLight from '@shikijs/themes/vitesse-light'

/** shiki 语言模块（`{ default: LanguageRegistration[] }`，展开后交给 core） */
const LANG_MODULES = [
  langRust, langTypescript, langTsx, langJavascript, langJsx,
  langPython, langJava, langGo, langC, langCpp,
  langCsharp, langRuby, langPhp, langSwift, langKotlin,
  langScala, langDart, langLua, langR,
  langVue, langCss, langScss, langHtml, langSvelte, langLess,
  langJson, langToml, langYaml, langXml, langIni,
  langShellscript, langPowershell,
  langMarkdown, langMdx, langSql,
  langGraphql, langDockerfile, langMakefile, langCmake, langNix,
  langZig, langAsm, langElixir, langHaskell, langErlang, langClojure,
]

const THEMES = { light: 'vitesse-light', dark: 'vitesse-dark' }

// ==================== 高亮器单例 ====================

let highlighterPromise: Promise<HighlighterCore> | null = null

function ensureHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [themeVitesseLight, themeVitesseDark],
      langs: LANG_MODULES.map((mod: any) => mod.default ?? mod),
      engine: createOnigurumaEngine(import('shiki/wasm')),
    })
  }
  return highlighterPromise
}

// ==================== 对外接口 ====================

/**
 * 高亮上限（字符数）。后端读取上限是 2MB，但 shiki 对这种量级的文件要
 * 编译语法 + 逐行 tokenize，会让弹窗卡住数秒；超过阈值直接纯文本降级，
 * 由查看器显性提示（不静默假装已高亮）。
 */
export const MAX_HIGHLIGHT_CHARS = 200_000

export type HighlightResult =
  | { status: 'highlighted'; html: string }
  | { status: 'too-large' }
  | { status: 'unsupported' }

/**
 * 把文件内容渲染成 shiki HTML（双主题 token）。
 *
 * 失败一律上抛给调用方降级纯文本——高亮是增强项，不能因为着色失败让文件
 * 变得不可读。
 */
export async function highlightFileContent(
  content: string,
  filename: string,
): Promise<HighlightResult> {
  const lang = getLangByFilename(filename)
  if (!lang) return { status: 'unsupported' }
  if (content.length > MAX_HIGHLIGHT_CHARS) return { status: 'too-large' }

  const highlighter = await ensureHighlighter()
  const html = highlighter.codeToHtml(content, {
    lang,
    themes: THEMES,
    // 输出 --shiki-light / --shiki-dark 两套 CSS 变量，深浅色由 CSS 切换
    defaultColor: false,
  })
  return { status: 'highlighted', html }
}

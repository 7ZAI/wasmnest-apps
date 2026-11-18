/** @type {import('tailwindcss').Config} */
export default {
  // 桌面 UI 宿主修正：app 前端是独立挂载包，Tailwind 由本工程自编译（宿主不再扫描
  // wasm-apps 树）。content = 本 app src + 共享 SDK 组件（Select 等用同源工具类）。
  // 设计 token（var(--bg-page) 等）由宿主文档根提供（app 只在宿主窗口内运行）。
  //
  // **SDK 路径必须同时写 node_modules 那条**：app 默认吃发布物
  // （`@binblink/wasmnest-plugin-sdk-desktop`），源码在 node_modules 里；只写
  // `../../packages/...`（平台仓 monorepo 布局）在本仓是空路径，SDK 组件独有的
  // 类不会被生成——实测漏掉的是 Select 面板的 `z-[60]`，面板被弹窗的 `z-50`
  // 压在下面（下拉看不见，但 DOM 与状态都正常）。
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
    './node_modules/@binblink/wasmnest-plugin-sdk-desktop/src/**/*.{vue,js,ts,jsx,tsx}',
    '../../packages/plugin-sdk-desktop/src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      // 设计 token → 语义工具类。
      //
      // **必须由本工程生成**：宿主已不扫描 wasm-apps 树，`rounded-input` /
      // `shadow-input-focus` / `border-brand` / `bg-card` 这类 token 别名没人代生——
      // 早期留空 `extend` 时它们全是死类（实测输入框无圆角、无品牌焦点环、卡面无底色，
      // 表现为「原生控件一样难看」）。名字以宿主 token 真源为准，未用到的类不产 CSS。
      colors: {
        page: 'var(--bg-page)',
        card: 'var(--bg-card)',
        sidebar: 'var(--bg-sidebar)',
        hover: 'var(--bg-hover)',
        input: 'var(--bg-input)',
        brand: {
          DEFAULT: 'var(--color-primary)',
          light: 'var(--color-primary-light)',
        },
      },
      borderRadius: {
        card: 'var(--radius-card)',
        btn: 'var(--radius-button)',
        input: 'var(--radius-input)',
        tag: 'var(--radius-tag)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        'input-focus': 'var(--shadow-input-focus)',
      },
    },
  },
  plugins: [],
}

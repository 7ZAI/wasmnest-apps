/** @type {import('tailwindcss').Config} */
export default {
  // 桌面挂载包自带依赖，Tailwind 类名自编译（宿主不扫描本仓）。
  // node_modules 那条必须保留：app 吃发布物时 SDK 源码在 node_modules 里。
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
    './node_modules/@binblink/wasmnest-plugin-sdk-desktop/src/**/*.{vue,js,ts,jsx,tsx}',
    '../../packages/plugin-sdk-desktop/src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  // 设计 token → 语义工具类。
  //
  // 这些别名必须由本工程生成：宿主已不扫描 wasm-apps 树，`rounded-input` /
  // `shadow-input-focus` / `border-brand` 这类 token 别名没人代生——留空 `extend`
  // 时它们全是死类（宿主共享 Select 面板因此没有圆角、没有品牌焦点环，表现为
  // 「原生控件一样难看」）。名字以宿主 token 真源为准，未用到的类不产 CSS。
  theme: {
    extend: {
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

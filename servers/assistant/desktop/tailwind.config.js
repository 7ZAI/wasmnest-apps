/** @type {import('tailwindcss').Config} */
export default {
  // 桌面 UI 宿主修正：app 前端独立挂载包，Tailwind 自编译（宿主不再扫描 wasm-apps 树）
  content: ['./src/**/*.{vue,js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontSize: {
        /* 与宿主同口径：字号随 --ui-scale 等比缩放 */
        xs: 'calc(11px * var(--ui-scale))',
        sm: 'calc(12px * var(--ui-scale))',
        base: 'calc(13px * var(--ui-scale))',
        lg: 'calc(15px * var(--ui-scale))',
        xl: 'calc(18px * var(--ui-scale))',
      },
      borderRadius: {
        card: 'var(--radius-card)',
        btn: 'var(--radius-button)',
        tag: 'var(--radius-tag)',
      },
    },
  },
  plugins: [],
}

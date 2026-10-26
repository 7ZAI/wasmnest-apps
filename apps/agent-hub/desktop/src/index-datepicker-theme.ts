/** 日期选择器主题覆盖（自 index.ts 抽出，entry.ts 复用；语义见原文件注释） */
export const DATEPICKER_THEME_OVERRIDES = `
/* 输入框与插件内其它表单控件保持同一规格（票 12；2026-09-28 改走 --ah-ctl-* 族） */
.dp__main {
  width: 100%;
}
.dp__input_wrap {
  width: 100%;
}
.dp__input {
  height: var(--ah-ctl-height);
  min-height: var(--ah-ctl-height);
  box-sizing: border-box;
  font-family: inherit;
  font-size: var(--ah-ctl-font-size);
  /* 行高回到宿主继承值（vendor 按 --dp-font-size=12px 算 18px，与输入框实际
     字号 14px 脱钩，文字会比同排控件偏上） */
  line-height: 1.5;
  padding: 0 30px 0 var(--ah-ctl-padding-x);
  border-radius: var(--ah-ctl-radius);
  border-color: var(--ah-ctl-border-color);
  background: var(--ah-ctl-bg);
  color: var(--ah-ctl-fg);
  box-shadow: var(--ah-ctl-shadow);
  transition:
    border-color 0.2s,
    background-color 0.2s,
    box-shadow 0.2s;
}
/* vendor 把自带字体栈（Linux 上是 -apple-system/sans-serif，与宿主
   'Segoe UI'/system-ui 栈不同字形）设在 .dp__main 上，.dp__input 的
   font-family: inherit 只会继承到这个栈——所以外层也必须显式 inherit。
   弹层（Teleport 到 body）的三处消费方同理。 */
.dp__main,
.dp__menu,
.dp__time_input,
.dp__action_button,
.dp__overlay {
  font-family: inherit;
}
:root.dark .dp__input {
  box-shadow: none;
}
.dp__input:hover {
  border-color: var(--ah-ctl-border-color);
}
.dp__input:focus {
  border-color: var(--ah-ctl-focus-border);
  box-shadow: var(--ah-ctl-focus-shadow);
}
.dp__input::placeholder {
  color: var(--ah-ctl-placeholder);
  opacity: 1;
}
.dp__theme_light,
.dp__theme_dark {
  --dp-background-color: var(--bg-card);
  --dp-text-color: var(--text-primary);
  --dp-hover-color: var(--bg-hover);
  --dp-hover-text-color: var(--text-primary);
  --dp-hover-icon-color: var(--text-primary);
  --dp-border-color: var(--border);
  --dp-border-color-hover: var(--border-input);
  --dp-primary-color: var(--color-primary);
  --dp-primary-disabled-color: var(--color-primary);
  /* 底部操作按钮（确认/取消/现在）：文字色跟随主题对比色（深色下为深色文字），
     避免浅色 primary 背景 + 白字导致按钮不可见 */
  --dp-primary-text-color: var(--color-primary-contrast);
  --dp-secondary-color: var(--ah-text-data);
  --dp-success-color: var(--color-primary);
  --dp-icon-color: var(--ah-text-data);
  --dp-disabled-color: var(--text-tertiary);
  --dp-disabled-border-color: var(--border);
  /* 字体不再靠 token：--dp-font-family 的每个消费方都在本文件里显式写
     font-family: inherit（自定义属性写 inherit 只是取父级的同名 token，
     等于没改——这是自定义属性与真实属性的关键差别） */
  --dp-border-radius: 6px;
  --dp-font-size: var(--font-size-label);
  --dp-preview-font-size: var(--font-size-label);
  --dp-time-picker-height: 170px;
}
.dp__menu {
  font-size: var(--font-size-label);
}
`

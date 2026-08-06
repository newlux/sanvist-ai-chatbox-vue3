import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetUno,
  transformerDirectives,
  transformerVariantGroup,
} from "unocss";

export default defineConfig({
  /* ========== 1. 主题（与 uni.scss 语义对齐） ========== */
  theme: {
    colors: {
      primary: "#1677ff",
      text: "#333333",
      muted: "#999999",
      border: "#e5e5e5",
      bg: "#f5f5f5",
    },
    fontSize: {
      xs: "20rpx",
      sm: "24rpx",
      base: "28rpx",
      lg: "32rpx",
      xl: "36rpx",
      xxl: "40rpx",
    },
    spacing: {
      xs: "8rpx",
      sm: "16rpx",
      md: "24rpx",
      lg: "32rpx",
      xl: "48rpx",
      xxl: "64rpx",
    },
    borderRadius: {
      sm: "8rpx",
      md: "16rpx",
      lg: "24rpx",
      xl: "32rpx",
    },
  },

  /* ========== 2. 预设（纯 H5，不碰 rpx） ========== */
  presets: [
    presetUno(), // 标准原子类（flex / grid / spacing）
    presetAttributify(), // class / attribute 双模式
    presetIcons({
      scale: 1.2, // 图标略微放大，视觉更协调
      warn: true, // 图标名写错时终端报警
    }),
  ],

  /* ========== 3. Transformers（语法增强） ========== */
  transformers: [
    transformerDirectives(), // 支持 @apply bg-primary text-base
    transformerVariantGroup(), // 支持 hover:(...) focus:(...)
  ],

  /* ========== 4. 快捷类（语义桥梁，非真理源） ========== */
  shortcuts: {
    /* 布局 */
    "m-0-auto": "m-0 ma", // margin: 0 auto
    "flex-center": "flex justify-center items-center",
    "flex-bc": "flex justify-between items-center",
    "flex-col-center": "flex flex-col justify-center items-center",
    "full-wh": "w-full h-full",

    /* 安全区（快捷写法） */
    "safe-b": "pb-safe",
    "safe-t": "pt-safe",

    /* 1px 边框（原子类补充，非替代 mixin） */
    "hair-b": "border-b border-solid border-border",
    "hair-t": "border-t border-solid border-border",
    "hair-all": "border border-solid border-border",

    /* 间距别名（弱绑定，方便页面级使用） */
    "gap-xs": "p-4",
    "gap-sm": "p-8",
    "gap-md": "p-12",
    "gap-lg": "p-16",
    "gap-xl": "p-24",

    /* 处理文本溢出 */
    "text-overflow": "overflow-hidden whitespace-nowrap text-ellipsis", // 文本溢出显示省略号
    "text-break": "whitespace-normal break-all break-words", // 文本溢出换行
  },

  /* ========== 5. 自定义规则（设计稿直写能力） ========== */
  rules: [
    /* 安全区（纯 CSS，原子类可用） */
    ["pt-safe", { "padding-top": "env(safe-area-inset-top)" }],
    ["pb-safe", { "padding-bottom": "env(safe-area-inset-bottom)" }],
    [
      "p-safe",
      {
        padding:
          "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
      },
    ],

    /**
     * 375 设计稿直写规则
     * 标注值 ×2 → rpx
     * 仅用于页面级快速布局，不作为设计规范源
     */
    [/^m-(\d+)$/, ([_, n]) => ({ margin: `${Number(n) * 2}rpx` })],
    [/^p-(\d+)$/, ([_, n]) => ({ padding: `${Number(n) * 2}rpx` })],
    [/^w-(\d+)$/, ([_, n]) => ({ width: `${Number(n) * 2}rpx` })],
    [/^h-(\d+)$/, ([_, n]) => ({ height: `${Number(n) * 2}rpx` })],
  ],

  /* ========== 6. 扫描范围 ========== */
  content: {
    filesystem: ["src/**/*.{vue,ts,js}"],
  },
});

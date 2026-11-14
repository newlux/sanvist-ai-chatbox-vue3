/**
 * 大屏电脑（≥ 19 寸）字体放大开关：调度视图 / 甘特图专用。
 *
 * 设计稿按横屏手机 812×375 出图，正文 11px（=22rpx）、刻度 12px（=24rpx），
 * 放到 19 寸以上的电脑显示器上明显偏小；这类屏幕把基准字号等比放大到 17px（=34rpx）。
 *
 * 为什么用 JS 而不是媒体查询：CSS 拿不到屏幕物理尺寸，只能用 screen 的 CSS 像素分辨率
 * 按 96 PPI 估算对角线英寸。高分屏（dpr ≥ 2）的 CSS 分辨率是系统整体缩小过的逻辑分辨率，
 * 再乘 dpr 会把 13 寸笔记本算成 35 寸，所以 dpr ≥ 2 时按 1 倍算。
 *
 * 只在桌面环境生效：APP 容器 / 手机浏览器一律返回 false，端上字号保持设计稿不变。
 */

import { onBeforeUnmount, onMounted, ref } from "vue";
import { usePcMode } from "@/hooks/usePcMode";

/** 触发放大的最小屏幕对角线（英寸） */
export const LARGE_SCREEN_MIN_INCH = 19;

/** 基准字号 11px（=22rpx）放大到 34rpx（=17px）的倍率，其余字号等比跟随 */
export const LARGE_SCREEN_FONT_SCALE = 17 / 11;

/** 屏幕对角线英寸（估算）：拿不到 screen 尺寸时返回 0 */
export function getScreenDiagonalInch() {
  if (typeof window === "undefined") return 0;
  const screenSize = window.screen;
  const width = Number(screenSize?.width) || 0;
  const height = Number(screenSize?.height) || 0;
  if (width <= 0 || height <= 0) return 0;
  const dpr = Number(window.devicePixelRatio) || 1;
  // 96 CSS px ≈ 1 英寸；dpr ≥ 2 的屏给的是「逻辑分辨率」，按 1 倍算才接近真实尺寸
  const factor = dpr >= 2 ? 1 : dpr;
  return (Math.hypot(width, height) * factor) / 96;
}

export function useLargeScreenFont() {
  const { isPc } = usePcMode();
  const isLargeScreen = ref(false);

  function refresh() {
    if (!isPc.value) {
      isLargeScreen.value = false;
      return;
    }
    const inch = getScreenDiagonalInch();
    // 个别 WebView 给不出 screen 尺寸（返回 0），退回视口宽度判断
    isLargeScreen.value = inch > 0
      ? inch >= LARGE_SCREEN_MIN_INCH
      : window.innerWidth >= 1440;
  }

  // 首帧就定下来：等 onMounted 再改会看到一次字号跳变
  refresh();

  onMounted(() => {
    refresh();
    window.addEventListener("resize", refresh);
  });

  onBeforeUnmount(() => {
    window.removeEventListener("resize", refresh);
  });

  return { isLargeScreen };
}

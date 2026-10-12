/**
 * 「PC 端」判定：用于只在 PC 端渲染的鼠标交互控件（如导航左右滑动箭头）。
 *
 * 判为 PC 端有两种进入方式：
 *  1) 由主应用以内嵌 iframe 打开（from=sanvist_pc）—— 产品形态上的 PC 端，
 *     与 useIframeMinimize / 请求头 X-Channel 用的是同一套来源标识；
 *  2) 桌面浏览器直接打开 —— 本地调试与后续独立 PC 站点用。
 *
 * APP（mPaaS 容器）与手机浏览器的 UA 都是移动端 UA，一律判为 false，
 * 交互保持现在的触摸滑动，不渲染任何 PC 专用控件。
 */

import { computed } from "vue";
import { useSystemStore } from "@/stores/modules/system";
import { FROM_SANVIST_PC, isSanvistPcEmbedded } from "@/utils/iframe";

/** 移动端 UA 关键字：命中即认为不是 PC（APP 容器 / 手机浏览器 / 平板）。 */
const MOBILE_UA_PATTERN = /android|iphone|ipod|ipad|mobile|windows phone|blackberry|symbianos|harmonyos/i;

/**
 * 桌面浏览器：UA 不是移动端，且主指针是鼠标（hover + fine pointer）。
 * 折叠屏 / 触屏平板的 UA 里带 Android/iPad 已被上一步拦掉，
 * 这里再用指针能力兜住「触摸大屏」，避免把平板当成 PC。
 */
function isDesktopBrowser() {
  if (typeof navigator !== "undefined" && MOBILE_UA_PATTERN.test(navigator.userAgent || "")) return false;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch (error) {
    return false;
  }
}

export function usePcMode() {
  const systemStore = useSystemStore();

  const isPc = computed(() => (
    systemStore.from === FROM_SANVIST_PC
    || isSanvistPcEmbedded()
    || isDesktopBrowser()
  ));

  return { isPc };
}

import type { NativePhoneInfo } from "@/utils/platform/mpaas";

import { getPhoneInfo } from "@/utils/platform/mpaas";

/**
 * 「本来就是横屏画布」的大屏设备（智慧屏 / 电视 / 大屏一体机）。
 *
 * 这类设备没有竖屏形态：可视区天生就是横的，页面按竖屏铺反而错位。
 * 所以对它们：
 * - 不调 `landscapeFullscreen`（既不开也不关，方向完全交给设备）；
 * - 不做 useLandscape 的 CSS 旋转兜底（转一次反而把版面拧歪）。
 * 直接按当前可视区渲染调度视图即可。
 *
 * 命中规则：brand / manufacturer / model / device / product 任一字段
 * （小写、去空格后）与下表精确相等。加新机型时照抄真机日志里的值，即
 * `[schedule-gantt][getPhoneInfo] 设备信息` 打出来的那几个字段。
 */
const NO_LANDSCAPE_TOKENS = new Set([
  // 天猫精灵智慧屏（model AILABS_FG01SE_L / Android 13）
  "tmallgenie",
  "ailabs_fg01se",
  "ailabs_fg01se_l",
  "vnd_ailabs_fg01se",
  // 酷开大屏（device ik3576s_u / Android 14）
  "coocaa",
  "ik3576s_u",
]);

/** 参与比对的字段：品牌 / 厂商 / 机型 / 设备代号 / 产品名 */
const MATCH_FIELDS = ["brand", "manufacturer", "model", "device", "product"] as const;

/** 该机型是否本身就是横屏画布（不需要转屏、也不需要旋转兜底） */
export function isNativeLandscapeDevice(info: NativePhoneInfo | null | undefined) {
  if (!info) return false;
  return MATCH_FIELDS.some((field) => {
    const value = String(info[field] ?? "").trim().toLowerCase();
    return value ? NO_LANDSCAPE_TOKENS.has(value) : false;
  });
}

/** 设备信息只取一次：横屏判定、页面日志共用同一份（getPhoneInfo 是原生调用，别反复打） */
let phoneInfoTask: Promise<NativePhoneInfo | null> | null = null;
/** 已经拿到的设备信息；还没回来（未开始 / 请求中）是 undefined，取不到是 null */
let phoneInfoValue: NativePhoneInfo | null | undefined;

/** 预热设备信息（App 启动时调一次，调度视图判定就不用再等原生调用） */
export function warmPhoneInfo() {
  if (!phoneInfoTask) {
    phoneInfoTask = getPhoneInfo().then((info) => {
      phoneInfoValue = info;
      return info;
    });
  }
  return phoneInfoTask;
}

/** 同步读已缓存的设备信息：undefined = 还没回来（不要据此判定为「普通手机」） */
export function peekPhoneInfo() {
  return phoneInfoValue;
}

/**
 * 设备信息可能比页面晚到：最多等这么久，等不到就按「需要横屏」处理（维持原来的行为，
 * 普通手机不会因为拿不到 getPhoneInfo 就丢掉横屏）。
 */
const DEVICE_DECISION_TIMEOUT_MS = 600;

/**
 * 当前设备进入调度视图时是否还需要做横屏处理。
 *
 * - 大屏横屏设备 → false（不申请原生横屏、不旋转）
 * - 普通手机 / 拿不到设备信息 → true（原生转屏 + CSS 旋转兜底，保持原逻辑）
 */
export async function shouldEnterLandscape(timeoutMs = DEVICE_DECISION_TIMEOUT_MS) {
  const info = await Promise.race([
    warmPhoneInfo(),
    new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  return !isNativeLandscapeDevice(info);
}

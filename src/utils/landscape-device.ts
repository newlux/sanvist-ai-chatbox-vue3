import type { NativePhoneInfo } from "@/utils/platform/mpaas";

import { createLogger } from "@/utils/logger";
import { getPhoneInfo, isMpaasReady, waitForMpaas } from "@/utils/platform/mpaas";

const logger = createLogger("landscape-device");

/**
 * 是否「网页环境」：不在宿主 App 的 mPaaS 容器里打开（PC / 手机浏览器直接访问、
 * PC 端以内嵌 iframe 打开等）。
 *
 * 网页里没有宿主容器给的全屏横屏，横屏只能靠把 body 整体 CSS 旋转 90°，
 * 在浏览器上会把版面拧歪、鼠标坐标也跟着错位，所以网页环境一律不做横屏转换。
 *
 * 判据（任一命中即认为仍在容器内，宁可多转一次也别把真机误判成网页）：
 * - 已经拿到 AlipayJSBridge；
 * - UA 带容器标识（AlipayClient / Nebula / mPaaS）—— bridge 是异步注入的，
 *   页面刚起来那一下可能还没到，这条兜底不能省。
 */
export function isWebEnvironment() {
  if (isMpaasReady()) return false;
  const ua = typeof navigator === "undefined" ? "" : String(navigator.userAgent || "");
  return !/alipayclient|nebula|mpaas/i.test(ua);
}

/**
 * 「本来就是横屏画布」的大屏设备（智慧屏 / 电视 / 大屏一体机）。
 *
 * 这类设备没有竖屏形态：可视区天生就是横的，页面按竖屏铺反而错位。
 * 所以对它们：
 * - 不做 useLandscape 的 CSS 旋转兜底（转一次反而把版面拧歪）；
 * - 方向完全交给设备 / 宿主容器。
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
  // 竖屏一体机（model ZC-H358S / device·product rk3588s_t / Android 13）
  "zc-h358s",
  "rk3588s_t",
  // brand rockchip：RK3588 系板子的芯片厂标识。机型 / 设备代号没对齐的批次靠它兜底，
  // 代价是会连带命中其它 RK3588 板子 —— 业务确认这批机器统一按横屏画布处理，故一并纳入
  "rockchip",
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

/** 预热时最多等 bridge 注入多久（App 启动那一拍桥常常还没到） */
const PHONE_INFO_BRIDGE_WAIT_MS = 600;

/**
 * 预热设备信息（App 启动时调一次，调度视图判定就不用再等原生调用）。
 *
 * 两个坑都在这：
 * 1. bridge 是异步注入的，App 启动那一刻直接调 getPhoneInfo 会失败（返回 null），
 *    所以先等 bridge 就绪再取；
 * 2. **拿到 null 不能缓存**。之前这里把 null 也当结果永久缓存下来，之后横屏判定
 *    永远认为「这是普通手机」—— 表现就是智慧屏 / 一体机明明在机型表里，
 *    甘特图还是按横屏容器打开。取不到就把任务清掉，下次进调度视图重新取一次。
 */
export function warmPhoneInfo() {
  if (!phoneInfoTask) {
    phoneInfoTask = (async () => {
      if (!isMpaasReady()) await waitForMpaas(PHONE_INFO_BRIDGE_WAIT_MS);
      const info = await getPhoneInfo();
      phoneInfoValue = info;
      if (!info) phoneInfoTask = null;
      return info;
    })();
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
 * 当前设备是否「本身就是横屏画布」（智慧屏 / 电视 / 大屏一体机）。
 *
 * 与 shouldEnterLandscape 共用同一份设备信息缓存，区别是只看设备、不看环境：
 * 离线包方向（openH5Container 的 landscape 参数）用它决定「按竖屏容器打开」。
 * 拿不到设备信息时按「不是」处理，维持横屏容器的原行为。
 */
export async function resolveNativeLandscapeDevice(timeoutMs = DEVICE_DECISION_TIMEOUT_MS) {
  const info = await Promise.race([
    warmPhoneInfo(),
    new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  const nativeLandscape = isNativeLandscapeDevice(info);
  /**
   * 真机排查专用：方向判定是在**主工程**做的，离线包容器内部看不到，
   * 用户只看得到「甘特图还是横的」。这条日志把三个关键字段一起打出来，
   * 配合 `[gantt-offline] 离线包：开始打开甘特图` 里的 landscape 值就能定位是
   * 「机型没命中」还是「宿主没按 landscape 参数转屏」。用 console.log 而不是 logger，
   * 生产产物里 logger.info 会被日志级别过滤掉。
   */
  console.log("[landscape-device] 原生机型判定", {
    nativeLandscape,
    model: info?.model,
    device: info?.device,
    product: info?.product,
    brand: info?.brand,
    hasInfo: Boolean(info),
    // 当前 WebView 的宽高比：宽度 > 高度说明容器本身就是横的（设备物理横屏 / 宿主没转）
    viewport: typeof window === "undefined" ? "" : `${window.innerWidth}x${window.innerHeight}`,
  });
  return nativeLandscape;
}

/**
 * 当前环境 / 设备进入调度视图时，是否还允许 useLandscape 用 CSS 旋转模拟横屏。
 *
 * 方向本身由宿主决定（openH5Container 打开甘特图应用时按 landscape 参数定方向），这里只决定
 * 「可视区不是横屏时要不要把 body 转 90° 兜底」：
 * - 网页环境 → false（先判，页面不旋转，其余机型判断不再执行）
 * - 大屏横屏设备 → false（方向已按竖屏容器给到，再转反而拧歪）
 * - 普通手机 / 拿不到设备信息 → true（宿主没给横屏时用 CSS 旋转兜底）
 */
export async function shouldEnterLandscape(timeoutMs = DEVICE_DECISION_TIMEOUT_MS) {
  if (isWebEnvironment()) {
    logger.info("网页环境：跳过横屏转换（不调原生转屏，也不做 CSS 旋转）");
    return false;
  }
  return !(await resolveNativeLandscapeDevice(timeoutMs));
}

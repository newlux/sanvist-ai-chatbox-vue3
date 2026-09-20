/**
 * iframe 内嵌场景下的麦克风权限预申请。
 *
 * 之所以要在启动时就申请，而不是等用户按住说话：
 * 主应用把本页嵌在悬浮窗里，用户第一次点录音时会同时收到浏览器权限弹窗，
 * 授权与否的反馈被弹窗盖住，体验很割裂。提前问一次，后续录音就是即时的。
 *
 * 另一个必须提前问的原因：Chrome 一旦被用户「拒绝」，后续 getUserMedia
 * 不会再弹窗，只会静默失败 —— 必须在用户点录音时把话说明白（见 micPermissionHint）。
 */

import { createLogger } from "@/utils/logger";

const logger = createLogger("mic-permission");

/** 权限状态：unknown 尚未询问过，granted/denied 为已定论 */
export type MicPermissionState = "unknown" | "granted" | "denied" | "unsupported";

let state: MicPermissionState = "unknown";
let pending: Promise<MicPermissionState> | null = null;

export function getMicPermissionState(): MicPermissionState {
  return state;
}

/** 是否已经明确被拒 —— 录音前据此决定要不要先给提示而不是直接试 */
export function isMicPermissionDenied(): boolean {
  return state === "denied";
}

/**
 * 由录音链路回填「被拒」状态。
 *
 * 启动时的预申请可能已经拿到过拒绝结果；但也存在用户先放开权限、
 * 之后在浏览器里改回拒绝的情况，那时只有实际录音失败才能发现。
 */
export function markMicPermissionDenied() {
  state = "denied";
  logger.warn("已标记麦克风权限为被拒绝");
}

/** 录音成功时回填授权状态，避免早先的拒绝记录一直挡住后续录音 */
export function markMicPermissionGranted() {
  state = "granted";
}

function readErrorName(error: unknown): string {
  return String((error as { name?: string })?.name || "");
}

/**
 * 申请麦克风权限。多次调用共享同一个在途 Promise，避免连点弹出多个系统弹窗。
 *
 * 注意：浏览器侧的「已拒绝」会被缓存到本模块（同一个页面会话内），
 * 因为 Chrome 拒绝后不会再弹窗，反复尝试只会拿到同样的 NotAllowedError。
 */
export function requestMicPermission(): Promise<MicPermissionState> {
  if (state === "granted" || state === "unsupported") return Promise.resolve(state);
  if (pending) return pending;

  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    // http 打开的页面拿不到 mediaDevices（浏览器安全限制），不是「被拒绝」
    state = "unsupported";
    logger.warn("getUserMedia 不可用，需要在 HTTPS 或 localhost 下访问");
    return Promise.resolve(state);
  }

  pending = navigator.mediaDevices.getUserMedia({ audio: true })
    .then((stream) => {
      // 只为拿权限，立刻释放轨道，避免长期占用麦克风指示灯
      stream.getTracks().forEach(track => track.stop());
      state = "granted";
      logger.info("麦克风权限已授权");
      return state;
    })
    .catch((error) => {
      const name = readErrorName(error);
      if (/NotFound|DevicesNotFound/i.test(name)) {
        // 设备缺失不算「被拒绝」，用户插上麦克风还能用
        state = "unsupported";
      }
      else {
        state = "denied";
      }
      logger.warn("麦克风权限申请失败", { name, state });
      return state;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

/**
 * 录音被拒后的提示文案。
 *
 * Chrome 的机制决定了一旦用户点过「拒绝」，之后不会再弹窗，
 * 必须引导用户去地址栏的权限设置里手动改回来，所以文案要指路而不是只说「失败」。
 */
export function micPermissionHint(): string {
    // （点击地址栏左侧图标 → 网站设置 → 麦克风 → 允许）
  return "请允许浏览器使用麦克风";
}

import type { GanttViewPayload } from "@/api/chat/types";

import { useSystemStore } from "@/stores";
import { isWebEnvironment, resolveNativeLandscapeDevice } from "@/utils/landscape-device";
import { createLogger } from "@/utils/logger";
import { getDemoModeData, isMpaasReady, openH5Container, saveDemoModeData, waitForMpaas } from "@/utils/platform/mpaas";

const logger = createLogger("gantt-offline");

/**
 * 甘特图离线包接入。
 *
 * 链路（原生容器内）：
 *   1. 宿主判定 landscape / fullscreen（本文件 resolveGanttContainerMode）；
 *   2. `saveDemoModeData("gantt_view", 整包 data)`——必须先写成功；
 *   3. `openH5Container({ appid, path, landscape, fullscreen })` 打开离线包；
 *   4. 离线包 boot 页 `getDemoModeData("gantt_view")` 读回并渲染。
 *
 * **H5 / 浏览器环境不接离线包**：没有 mPaaS 容器就没有 openH5Container，
 * 仍走主工程站内的甘特页（见 utils/gantt-navigation）。离线包代码保留在
 * 主工程里，可随时通过开关回退，不要删除。
 */

/**
 * 离线包 appid：以 mPaaS 离线包中心分配的为准，可用环境变量覆盖。
 *
 * 必须 `String()` 一次：`.env` 里写的是 `'20261103'` 这种纯数字，uni 的 env 类型声明会把它
 * 推断成 number，直接透传给 bridge 就变成数字参数，原生按字符串查离线包会查不到
 * （表现成 openH5Container 打开失败 / 容器白屏）。
 */
export const GANTT_OFFLINE_APPID = String(import.meta.env.VITE_GANTT_OFFLINE_APPID || "gantt-offline");

/**
 * 离线包入口页（引导页负责读数据再 redirect）。
 *
 * 必须带 `/index.html#/` 前缀：宿主按这个前缀拼离线包内的 hash 路由，
 * 只传 `pages/boot/index` 会落到离线包根目录（白屏）。
 * 与其它已接入页面保持一致，参考 `/index.html#/pages/audit/auditList/index`。
 */
export const GANTT_OFFLINE_ENTRY = "/index.html#/pages/boot/index";

/** 甘特整包数据的 key（与离线包 utils/platform/mpaas.ts 常量一致） */
export const GANTT_DEMO_KEY = "gantt_view";
/** 甘特图里提问的回传 key */
export const GANTT_ASK_DEMO_KEY = "gantt_ask";

export interface GanttContainerMode {
  landscape: boolean;
  fullscreen: boolean;
}

/**
 * 宿主侧的「是否横屏 / 全屏」判定（按要求只放在 chatbox 这一侧）。
 *
 * - `schedule` / `pre` / `replan` 三个调度视图在普通手机上横屏 + 全屏；
 * - 智慧屏 / 电视这类本身就是横屏画布的机型按**竖屏容器**打开：设备没有竖屏形态，
 *   再给横屏容器只会把版面拉成一条扁的，产品的诉求是竖版甘特（见 resolveNativeLandscapeDevice）；
 * - `personal`（个人任务详情）已改为**固定走站内 pages/task-detail，不再进离线包**
 *   （见 utils/gantt-navigation），这里保留竖屏判定只作兜底 —— 万一有人直接调本文件，
 *   也不会给它开成横屏容器。
 */
export function resolveGanttContainerMode(
  viewType: string,
  options: { nativeLandscapeDevice?: boolean } = {},
): GanttContainerMode {
  if (viewType === "personal") return { landscape: false, fullscreen: false };
  // 本身就是横屏画布的机型：竖屏容器（不全屏），页面自己按竖版铺
  if (options.nativeLandscapeDevice) return { landscape: false, fullscreen: false };
  return { landscape: true, fullscreen: true };
}

/** 点击卡片时最多等 bridge 注入多久：App 刚启动那一下桥是异步注入的，等一会儿比误判成网页好 */
const BRIDGE_WAIT_MS = 600;

/**
 * 数据写失败时是否仍然打开离线包容器。
 *
 * - `false`（默认）：抛错回退站内甘特页 —— 站内页的数据在 uni.setStorage 里，一定能渲染；
 * - `true`：照样开容器（离线包 boot 页读不到数据、显示空甘特），只用于单独验证
 *   `openH5Container` 是否可用。
 */
const OPEN_CONTAINER_WITHOUT_DATA = false;

/** 走离线包还是站内页的判定结果（同时给日志用，出错时能一眼看出卡在哪一项） */
export interface OfflineGanttDecision {
  /** 最终结论：true 走 openH5Container 离线包 */
  useOffline: boolean;
  /** 是否网页环境（浏览器 / PC 内嵌 iframe，没有 mPaaS 容器） */
  webEnvironment: boolean;
  /** AlipayJSBridge 是否可用（必要时是等过之后的结论） */
  bridgeReady: boolean;
  /** 为了等 bridge 花掉的毫秒数（0 = 点下去时就已经就绪） */
  waitedMs: number;
}

/**
 * 计算「这次跳转走不走离线包」，必要时等 bridge 注入。
 *
 * 网页环境直接判否（不会白等）；原生容器里 bridge 可能比页面脚本晚注入几十毫秒，
 * 这里最多等 BRIDGE_WAIT_MS，避免「刚启动点卡片 → 误判成网页 → 落到 CSS 旋转兜底」。
 */
export async function resolveOfflineGanttDecision(): Promise<OfflineGanttDecision> {
  const webEnvironment = isWebEnvironment();
  if (webEnvironment) {
    return { useOffline: false, webEnvironment, bridgeReady: false, waitedMs: 0 };
  }

  if (isMpaasReady()) {
    return { useOffline: true, webEnvironment, bridgeReady: true, waitedMs: 0 };
  }

  const startedAt = Date.now();
  const bridge = await waitForMpaas(BRIDGE_WAIT_MS);
  const waitedMs = Date.now() - startedAt;
  const bridgeReady = Boolean(bridge);
  if (bridgeReady) {
    logger.info("离线包：等待 bridge 注入后已就绪", { waitedMs, timeoutMs: BRIDGE_WAIT_MS });
  }
  else {
    logger.warn("离线包：等待 bridge 超时，按不可用处理", { waitedMs, timeoutMs: BRIDGE_WAIT_MS });
  }
  return { useOffline: bridgeReady, webEnvironment, bridgeReady, waitedMs };
}

/**
 * 当前环境是否走离线包（**同步**，不等 bridge）。
 *
 * 只用于 onShow / 原生 resume 里判断「要不要去取离线包回传的问题」，
 * 不参与卡片跳转分流（分流见 resolveOfflineGanttDecision）。
 */
export function shouldUseOfflineGantt() {
  return !isWebEnvironment() && isMpaasReady();
}

/** 离线包渲染甘特真正需要的字段；其余是后端透传的明细，体积大且离线包不读 */
const SLIM_VIEW_KEYS = [
  "viewType",
  "viewId",
  "entry",
  "card",
  "rows",
  "stage",
  "statusText",
  "status_text",
  "businessDate",
  "payload",
  "isDark",
] as const;

/** 去掉后端透传的其余字段，只保留离线包要用的 */
export function pickGanttViewForOffline(view: GanttViewPayload): GanttViewPayload {
  const source = view as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of SLIM_VIEW_KEYS) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out as GanttViewPayload;
}

/** 报文字节数（JSON 长度）；循环引用等异常返回 -1，只用于日志 */
function measureBytes(data: unknown) {
  try {
    return JSON.stringify(data ?? {}).length;
  }
  catch {
    return -1;
  }
}

/** 调用超时（而不是拿到错误码）：说明宿主压根没回调，通常是 JSAPI 未实现 */
function isTimeoutError(error: unknown) {
  return error instanceof Error && error.message.includes("超时");
}

/**
 * 本轮会话里 demo 数据桥是否已被判定不可用。
 *
 * 宿主没注册 `saveDemoModeData` 时调用**不会回调**，只能等 5s 超时；不做记忆的话
 * 用户每点一次甘特卡都要白等 5 秒。命中后直接回退站内页（刷新页面即重置）。
 */
let demoBridgeUnavailable = false;

/** 当前会话是否已判定 demo 数据桥不可用（供上层提前分流 / 打日志） */
export function isDemoDataBridgeUnavailable() {
  return demoBridgeUnavailable;
}

/**
 * 写整包；失败后自动用精简包再试一次。
 *
 * 为什么要有精简兜底：桥对单次参数大小有上限，同一个 JSAPI「写 `{}`」能成功、
 * 「写几百 KB 整包」会超时或报错（真机上就是初始化清 key 成功、点卡片写整包失败）。
 * 返回实际写入的字节数与是否走了精简包。
 */
async function writeGanttView(
  key: string,
  view: GanttViewPayload,
  rawBytes: number,
): Promise<{ bytes: number; slimmed: boolean }> {
  try {
    await saveDemoModeData(key, view);
    return { bytes: rawBytes, slimmed: false };
  }
  catch (error) {
    logger.error("离线包：整包数据写入失败", {
      key,
      rawBytes,
      message: error instanceof Error ? error.message : String(error),
    }, error);

    const slim = pickGanttViewForOffline(view);
    const slimBytes = measureBytes(slim);
    logger.warn("离线包：改用精简包重试", { key, rawBytes, slimBytes });
    // 这里再抛就是「整包 + 精简包都失败」，交给上层回退站内页
    await saveDemoModeData(key, slim);
    return { bytes: slimBytes, slimmed: true };
  }
}

/**
 * 打开甘特离线包。
 *
 * 分两步，每步都打日志（排查「为什么没进离线包」就对着 `[gantt-offline]` 看）：
 * 1. `saveDemoModeData` 写整包数据 —— 失败先自动用精简包重试一次（见 writeGanttView），
 *    仍然失败就抛错回退站内页（数据没写进去，容器只会显示空甘特）；
 *    仅当 OPEN_CONTAINER_WITHOUT_DATA=true 时才带空数据继续开容器；
 * 2. `openH5Container` 开容器 —— 失败同样抛给调用方，由 gantt-navigation 回退站内甘特页。
 */
export async function openOfflineGantt(viewType: string, view: GanttViewPayload): Promise<void> {
  // 已经确认过桥不可用：不再白等 5s，直接抛给上层回退站内页
  if (demoBridgeUnavailable) {
    logger.warn("离线包：demo 数据桥本轮已判定不可用（saveDemoModeData 无回调），直接走站内甘特页");
    throw new Error("demo 数据桥不可用：saveDemoModeData 调用超时（宿主未实现该 JSAPI）");
  }

  // 深浅色随整包带给离线包：离线包 getDemoModeData 读回后据此初始化自己的 systemStore
  const systemStore = useSystemStore();
  const payload = { ...view, isDark: systemStore.isDark } as GanttViewPayload;

  // 方向按机型定：本身就是横屏画布的机型（智慧屏 / 电视 / 大屏一体机）走竖屏容器，
  // 其余（普通手机）仍是横屏 + 全屏。设备信息在 App 启动时预热过，这里基本不耗时。
  const nativeLandscapeDevice = await resolveNativeLandscapeDevice();
  const mode = resolveGanttContainerMode(viewType, { nativeLandscapeDevice });
  // 入口 path 带上宿主鉴权串：离线包语音识别（/speech/asr/*）请求头要用；
  // 没有 token 就不带（离线包请求层空 Authorization 时自动省略该头）
  const auth = String(systemStore.header.Authorization || "");
  const authQuery = auth ? `&Authorization=${encodeURIComponent(auth)}` : "";
  const path = `${GANTT_OFFLINE_ENTRY}?target=${encodeURIComponent(viewType)}${authQuery}`;
  const startedAt = Date.now();
  const payloadBytes = measureBytes(payload);
  const slimBytes = measureBytes(pickGanttViewForOffline(payload));

  logger.info("离线包：开始打开甘特图", {
    viewType,
    appid: GANTT_OFFLINE_APPID,
    path,
    landscape: mode.landscape,
    fullscreen: mode.fullscreen,
    payloadBytes,
    slimBytes,
  });

  // 1) 先写数据：离线包 boot 页用 getDemoModeData 读回并渲染
  let dataWritten = false;
  let savedBytes = payloadBytes;
  const savedAt = Date.now();
  try {
    const written = await writeGanttView(GANTT_DEMO_KEY, payload, payloadBytes);
    dataWritten = true;
    savedBytes = written.bytes;
    logger.info("离线包：数据已写入", {
      key: GANTT_DEMO_KEY,
      costMs: Date.now() - savedAt,
      bytes: written.bytes,
      slimmed: written.slimmed,
    });
  }
  catch (error) {
    logger.error("离线包：数据写入失败（整包与精简包都失败）", {
      key: GANTT_DEMO_KEY,
      payloadBytes,
      slimBytes,
      message: error instanceof Error ? error.message : String(error),
    }, error);
    if (!OPEN_CONTAINER_WITHOUT_DATA) {
      // 数据没写进去就开容器，只会得到一个空甘特：抛给上层回退站内页（站内页有数据可渲染）
      // 超时（无回调）基本等于宿主未实现该 JSAPI，记住结论，后续点击不再白等 5s
      if (isTimeoutError(error)) {
        demoBridgeUnavailable = true;
        logger.warn("离线包：saveDemoModeData 无回调（超时），本轮不再尝试离线包", {
          key: GANTT_DEMO_KEY,
        });
      }
      logger.warn("离线包：放弃打开容器，回退站内甘特页", { key: GANTT_DEMO_KEY });
      throw error;
    }
    logger.warn("离线包：OPEN_CONTAINER_WITHOUT_DATA=true，继续打开容器（离线包会读到空数据）", {
      key: GANTT_DEMO_KEY,
    });
  }

  // 2) 开容器：方向（横屏 + 全屏）由容器参数决定，不再调 landscapeFullscreen
  const openedAt = Date.now();
  logger.info("离线包：调用 openH5Container", {
    appid: GANTT_OFFLINE_APPID,
    path,
    landscape: mode.landscape,
    fullscreen: mode.fullscreen,
  });
  await openH5Container({
    appid: GANTT_OFFLINE_APPID,
    path,
    landscape: mode.landscape,
    fullscreen: mode.fullscreen,
  });

  logger.info("离线包：已打开甘特图", {
    viewType,
    path,
    dataWritten,
    savedBytes,
    openCostMs: Date.now() - openedAt,
    totalCostMs: Date.now() - startedAt,
  });
}

/** 防止 onShow / 原生 resume 同时触发时重复发送同一条问题 */
let consumingAsk = false;

/**
 * 取走离线包里问的问题（宿主对话页 onShow 调用）。
 *
 * 离线包关闭前会 `saveDemoModeData("gantt_ask", { text })`，
 * 这里读出后立即清空，返回空串表示没有待发问题。
 */
export async function consumeOfflineGanttAsk(): Promise<string> {
  if (consumingAsk) return "";
  consumingAsk = true;
  try {
    const data = await getDemoModeData<{ text?: string }>(GANTT_ASK_DEMO_KEY);
    const text = String(data?.text || "").trim();
    if (!text) return "";
    // 取完即清，避免下次返回重复发送
    await saveDemoModeData(GANTT_ASK_DEMO_KEY, {});
    return text;
  }
  finally {
    consumingAsk = false;
  }
}

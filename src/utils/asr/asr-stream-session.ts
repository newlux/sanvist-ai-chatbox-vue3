import { createLogger } from "@/utils/logger";
import { describeRequestAuth, getRequestBaseURL, getRequestHeaders } from "@/utils/request";
import { setVoiceInputLanguage } from "./voice-language";

const logger = createLogger("asr-stream");

/** 建连后多久没收到 ready 就判失败（文档实测约 1.4s，留足余量） */
const READY_TIMEOUT_MS = 10_000;
/** 推流结束后等 final 的兜底（文档实测约 0.8s） */
const FINAL_TIMEOUT_MS = 8_000;
/** 服务端单次会话上限 120s，前端提前主动收尾 */
const MAX_SESSION_MS = 118_000;
/** ready 之前的音频先攒着：网关自己也会缓存 3s，前端再兜一层，避免「刚连上就说」丢字 */
const MAX_PRESTART_FRAMES = 30;

export interface AsrStreamHandlers {
  onReady?: () => void;
  /** 半成品文本：是「完整文本的当前版本」，前端直接整体替换，不要自己拼接 */
  onPartial?: (text: string) => void;
  /** 定稿文本：空串表示没听清（静音 / 误触），不要提交 */
  onFinal?: (text: string) => void;
  /**
   * 服务端回传的识别语言（`language` 字段，如 zh / en），变化时才回调。
   * 调用方一般不用管：模块内已经记到 voice-language 里，回答播报会优先按它合成。
   */
  onLanguage?: (language: string) => void;
  onError?: (message: string) => void;
}

export interface AsrStreamSession {
  /** 推一帧 16k/16bit/单声道裸 PCM（3200 字节 ≈ 100ms） */
  pushFrame: (frame: ArrayBuffer) => void;
  /** 录音结束：通知服务端收尾，结果由 onFinal 回传 */
  finish: () => void;
  /** 直接断开（取消 / 组件卸载），不会回调 onFinal / onError */
  close: () => void;
}

export function isAsrStreamSupported() {
  return typeof WebSocket !== "undefined";
}

/**
 * 拼流式 ASR 的连接地址。
 *
 * 浏览器的 WebSocket API 设不了请求头，所以凭证只能走 query：
 * 有登录 token 传 token，没有就用文档里开发用的 guestRole。
 */
export function buildAsrStreamUrl(language = "zh") {
  const base = new URL(getRequestBaseURL());
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/speech/asr/stream`;
  base.search = "";
  base.searchParams.set("language", language);

  const { Authorization } = getRequestHeaders();
  if (Authorization) base.searchParams.set("token", Authorization.replace(/^Bearer\s+/i, ""));
  else base.searchParams.set("guestRole", "OWNER");

  /**
   * 建链凭证日志：语音「没反应 / 连上就断」时，先看有没有 token。
   * 只打长度与前缀，不打明文（token 是 query 参数，日志外泄风险比请求头高）。
   */
  logger.warn("[asr-stream] 建链凭证", {
    language,
    hasToken: Boolean(Authorization),
    fallbackGuestRole: !Authorization,
    token: describeRequestAuth(),
    endpoint: `${base.protocol}//${base.host}${base.pathname}`,
  });

  return base.toString();
}

interface AsrStreamPayload {
  type?: string;
  text?: string;
  message?: string;
  /** 识别语言（如 zh / en）：服务端每条消息都可能带，也可能只有部分消息带 */
  language?: string;
}

/**
 * 打开一条流式识别会话：连上 → 发 start → 推音频 → 发 finish → 收 final。
 *
 * 生命周期与 SSE 那套一致：所有出口都收敛到 settled / closed 两个标记，
 * 保证 final、error、close 三者只会有一个真正生效，调用方不用自己防重。
 */
export function openAsrStreamSession(
  handlers: AsrStreamHandlers,
  options: { language?: string } = {},
): AsrStreamSession {
  const language = options.language ?? "zh";
  const backlog: ArrayBuffer[] = [];

  let socket: WebSocket | null = null;
  let ready = false;
  /** 已经出结果（final）或已报错，后续事件一律忽略 */
  let settled = false;
  let closed = false;
  let readyTimer: ReturnType<typeof setTimeout> | null = null;
  let finalTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;

  /** 推流统计：整轮推了多少帧 / 多少字节，收尾时一条日志交代清楚 */
  let sentFrames = 0;
  let sentBytes = 0;
  /** 服务端事件计数（partial 也计在内）：判断「连上了但服务端不说话」 */
  let eventCount = 0;
  /** 已经记过的识别语言：服务端每条消息都可能带，只在变化时记一次 + 打一条日志 */
  let lastLanguage = "";
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  const clearTimers = () => {
    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    if (finalTimer) {
      clearTimeout(finalTimer);
      finalTimer = null;
    }
    if (maxTimer) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
  };

  const closeSocket = () => {
    if (closed) return;
    closed = true;
    clearTimers();
    logger.info("[asr-stream] 关闭 socket", {
      ms: elapsed(),
      ready,
      settled,
      frames: sentFrames,
      bytes: sentBytes,
      events: eventCount,
      buffered: backlog.length,
    });
    try {
      socket?.close();
    }
    catch (error) {
      logger.warn("close socket failed", error);
    }
    socket = null;
  };

  const fail = (message: string) => {
    if (settled) {
      closeSocket();
      return;
    }
    settled = true;
    logger.warn(`[asr-stream] ${message}`, {
      ms: elapsed(),
      ready,
      frames: sentFrames,
      bytes: sentBytes,
      events: eventCount,
    });
    closeSocket();
    handlers.onError?.(message);
  };

  const sendFinish = () => {
    if (closed || settled) {
      logger.debug("[asr-stream] 跳过 finish", { closed, settled });
      return;
    }
    logger.info("[asr-stream] 发送 finish（录音结束）", {
      ms: elapsed(),
      ready,
      frames: sentFrames,
      bytes: sentBytes,
      events: eventCount,
      buffered: backlog.length,
    });
    try {
      socket?.send(JSON.stringify({ type: "finish" }));
    }
    catch (error) {
      logger.warn("send finish failed", error);
      fail("语音识别中断");
      return;
    }
    if (finalTimer) return;
    finalTimer = setTimeout(() => fail("语音识别超时"), FINAL_TIMEOUT_MS);
  };

  logger.info("[asr-stream] 开始建链", { language, ms: elapsed() });
  try {
    socket = new WebSocket(buildAsrStreamUrl(language));
  }
  catch (error) {
    logger.warn("[asr-stream] 创建 socket 失败", error);
    settled = true;
    handlers.onError?.("语音识别通道建立失败");
    return { pushFrame() {}, finish() {}, close: closeSocket };
  }

  socket.binaryType = "arraybuffer";
  readyTimer = setTimeout(() => fail("语音识别连接超时"), READY_TIMEOUT_MS);
  maxTimer = setTimeout(sendFinish, MAX_SESSION_MS);

  socket.onopen = () => {
    logger.info("[asr-stream] socket 已连接，发送 start", { language, ms: elapsed() });
    try {
      socket?.send(JSON.stringify({ type: "start", language }));
    }
    catch (error) {
      logger.warn("[asr-stream] 发送 start 失败", error);
      fail("语音识别通道建立失败");
    }
  };

  socket.onmessage = (event) => {
    if (typeof event.data !== "string") {
      // 服务端目前只回文本 JSON，收到二进制说明协议不对，但不必打断这一轮
      logger.debug("[asr-stream] 收到非文本消息（忽略）", { ms: elapsed() });
      return;
    }
    let payload: AsrStreamPayload | null = null;
    try {
      payload = JSON.parse(event.data) as AsrStreamPayload;
    }
    catch (error) {
      logger.warn("[asr-stream] 服务端消息不是合法 JSON", { raw: event.data.slice(0, 200) }, error);
      return;
    }
    if (!payload?.type) {
      logger.debug("[asr-stream] 服务端消息缺少 type（忽略）", payload);
      return;
    }

    eventCount += 1;

    /**
     * 识别语言：拿到就记到 voice-language 里，回答播报（/speech/tts/v2/stream）按它取 language。
     * 服务端每条消息都可能带同一个值，只在变化时打日志，避免刷屏。
     */
    if (payload.language) {
      const language = setVoiceInputLanguage(payload.language);
      if (language && language !== lastLanguage) {
        lastLanguage = language;
        logger.info("[asr-stream] 识别语言（回答播报将使用）", {
          language,
          type: payload.type,
          ms: elapsed(),
        });
        handlers.onLanguage?.(language);
      }
    }

    if (payload.type === "ready") {
      ready = true;
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      logger.info("[asr-stream] 服务端 ready", { ms: elapsed(), buffered: backlog.length });
      handlers.onReady?.();
      // 就绪前的音频按顺序补发，保证「刚连上就开口」也不丢
      let flushed = 0;
      while (backlog.length) {
        const frame = backlog.shift();
        if (!frame) break;
        try {
          socket?.send(frame);
          flushed += 1;
          sentFrames += 1;
          sentBytes += frame.byteLength;
        }
        catch (error) {
          logger.warn("[asr-stream] 补发积压音频失败", error);
          break;
        }
      }
      if (flushed) logger.info("[asr-stream] 已补发积压音频", { flushed, ms: elapsed() });
      return;
    }

    if (payload.type === "partial") {
      if (settled) return;
      const text = String(payload.text ?? "");
      // 实时字幕：每来一版就打一版，端上能看出「有没有出半成品文字」
      logger.debug("[asr-stream] partial", { text, chars: text.length, ms: elapsed() });
      handlers.onPartial?.(text);
      return;
    }

    if (payload.type === "final") {
      if (settled) return;
      settled = true;
      const text = String(payload.text ?? "");
      logger.info("[asr-stream] final（识别定稿）", {
        text,
        chars: text.length,
        language: lastLanguage || "(未返回)",
        ms: elapsed(),
        frames: sentFrames,
        bytes: sentBytes,
        events: eventCount,
      });
      closeSocket();
      handlers.onFinal?.(text);
      return;
    }

    if (payload.type === "error") {
      logger.warn("[asr-stream] 服务端返回 error", { ms: elapsed(), payload });
      fail(payload.message || "语音识别服务异常");
      return;
    }

    logger.debug("[asr-stream] 未识别的事件类型", { ms: elapsed(), payload });
  };

  socket.onerror = () => {
    logger.warn("[asr-stream] socket onerror", {
      ms: elapsed(),
      ready,
      readyState: socket?.readyState,
      frames: sentFrames,
      events: eventCount,
    });
    fail("语音识别连接异常");
  };
  socket.onclose = (event?: { code?: number; reason?: string; wasClean?: boolean }) => {
    logger.info("[asr-stream] socket onclose", {
      ms: elapsed(),
      code: event?.code,
      reason: event?.reason || "(空)",
      wasClean: event?.wasClean,
      ready,
      settled,
      frames: sentFrames,
      bytes: sentBytes,
      events: eventCount,
    });
    // final 之后主动 close 是正常收尾，不走失败分支
    if (!settled) fail("语音识别连接已断开");
  };

  return {
    pushFrame(frame) {
      if (closed) return;
      const bytes = frame.byteLength;
      if (!ready) {
        backlog.push(frame);
        if (backlog.length > MAX_PRESTART_FRAMES) {
          backlog.shift();
          logger.debug("[asr-stream] ready 前积压已满，丢掉最旧一帧", { buffered: backlog.length, ms: elapsed() });
        }
        return;
      }
      try {
        socket?.send(frame);
        sentFrames += 1;
        sentBytes += bytes;
        // 10 帧 = 1s 一条；每帧都打会把 vConsole 刷满
        if (sentFrames % 10 === 0) {
          logger.debug("[asr-stream] 推流中", { frames: sentFrames, bytes: sentBytes, ms: elapsed() });
        }
      }
      catch (error) {
        logger.warn("[asr-stream] 发送音频帧失败", { frames: sentFrames, ms: elapsed() }, error);
        fail("音频发送失败");
      }
    },
    finish: sendFinish,
    close: () => {
      // 主动取消：标记 settled，别让 onclose 再弹一次失败提示
      settled = true;
      closeSocket();
    },
  };
}

import { createLogger } from "@/utils/logger";
import { callNative, isMpaasReady, onNativeEvent } from "@/utils/platform/mpaas";

const logger = createLogger("pcm-native");

/**
 * 原生 PCM 推流（mPaaS `pcmStreamStart`）。
 *
 * 安卓 WebView 在 `onPermissionRequest` 里拒了媒体采集，`getUserMedia` 只会回
 * `NotAllowedError: Permission denied`，WebAudio 那条实时链路在安卓上根本起不来。
 * 容器提供了另一条路：`pcmStreamStart` 由宿主直接录音、按 intervalMs 把 16k/16bit/单声道
 * 裸 PCM 以 base64 通过 `pcmStreamData` 事件抛给 H5。音频来源换了，但后续完全复用
 * 现有的流式 ASR 会话（`openAsrStreamSession` + `pushFrame`），所以实时文字照旧。
 *
 * 生命周期：start → （持续 Data 事件）→ stop / cancel。
 */

/** ASR 网关按 100ms 一帧收（3200 字节 = 16k/16bit/单声道）；原生分片通常 200ms，这里重切 */
const FRAME_BYTES = 3200;
/** 与宿主约定：16k 采样率、200ms 一片 */
const STREAM_SAMPLE_RATE = 16_000;
const STREAM_INTERVAL_MS = 200;
/** `pcmStreamStart` 迟迟不回调就别把「点说话」卡住：宿主没实现时尽快换通道 */
const START_TIMEOUT_MS = 1500;
/** 起来了却一个分片都不给（宿主半实现）：同样要尽快换通道，别让人对着麦克风白说 */
const DATA_WATCHDOG_MS = 1500;
const STOP_TIMEOUT_MS = 3000;

export interface NativePcmHandlers {
  /** 每 100ms 一帧（3200 字节）回调，直接丢给流式 ASR 会话 */
  onFrame: (frame: ArrayBuffer) => void;
  /** 音量强度（0~1，RMS）：驱动声纹 + 静音收尾，口径与 WebAudio 那条完全一致 */
  onLevel?: (level: number) => void;
  /** 原生侧报错（pcmStreamError）：调用方据此换通道或提示 */
  onError?: (message: string) => void;
}

export interface NativePcmCapture {
  stop: () => Promise<void>;
}

/** 容器是否可能支持（有 bridge 才谈得上 pcmStreamStart；真不支持会在 start 时抛错） */
export function isNativePcmStreamSupported() {
  return isMpaasReady();
}

/** base64 → 原始字节；宿主偶尔会给 Data URL 形式，这里把前缀去掉 */
function decodeBase64(input: unknown) {
  const raw = String(input ?? "");
  if (!raw) return new Uint8Array(0);
  const base64 = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
  if (typeof atob !== "function") return new Uint8Array(0);
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  catch (error) {
    logger.warn("[pcm-native] base64 解码失败", error);
    return new Uint8Array(0);
  }
}

/**
 * 自己按 PCM 算 RMS，不用宿主给的 level。
 * 一是不确定它的量纲（0~1 还是 0~100），二是这样和 WebAudio 那条路的阈值口径完全一致，
 * 静音收尾的判定不会因为换通道而漂。
 */
function measureLevel(bytes: Uint8Array) {
  const total = Math.floor(bytes.byteLength / 2);
  if (!total) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sum = 0;
  for (let index = 0; index < total; index += 1) {
    const sample = view.getInt16(index * 2, true) / 0x8000;
    sum += sample * sample;
  }
  return Math.sqrt(sum / total);
}

function failMessage(payload: Record<string, unknown>) {
  const code = Number(payload.errorCode ?? payload.error ?? 0);
  const text = String(payload.message ?? payload.errorMessage ?? "").trim();
  if (text) return text;
  return code ? `原生录音异常（${code}）` : "原生录音异常";
}

/**
 * 开始原生 PCM 推流。
 * 先订阅事件再 start —— 宿主可能连上就立刻抛第一片，订阅晚了会丢开头。
 */
export async function startNativePcmCapture(handlers: NativePcmHandlers): Promise<NativePcmCapture> {
  let closed = false;
  /** 不足一帧的尾巴：等下一片拼上再发，避免把 16bit 样本切在中间 */
  let carry = new Uint8Array(0);
  /**
   * 分片序号。onNativeEvent 同时挂了 DOM 事件和 AlipayJSBridge.on 两条通道，
   * 万一宿主两条都发，同一片会被处理两遍（音频重复 = 识别乱码），按 seq 去重兜一层。
   */
  let lastSeq = -1;
  /** 收到过多少片：用来判断宿主是不是「start 成功但从不吐数据」 */
  let chunkCount = 0;
  /** 重切成 100ms 一帧后真正推给 ASR 的帧数与字节数，收尾时打一条统计 */
  let frameCount = 0;
  let sentBytes = 0;
  let peakLevel = 0;
  const startedAt = Date.now();
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let stopPromise: Promise<void> | null = null;

  const unsubscribers = [
    onNativeEvent("pcmStreamData", (payload) => {
      if (closed) return;
      chunkCount += 1;
      const seq = Number(payload.seq);
      if (Number.isFinite(seq) && seq >= 0) {
        if (seq <= lastSeq) return;
        lastSeq = seq;
      }
      const bytes = decodeBase64(payload.base64 ?? payload.data);
      if (!bytes.byteLength) {
        logger.debug("[pcm-native] 收到空分片（base64 解码后 0 字节）", { chunks: chunkCount, seq });
        return;
      }
      const level = measureLevel(bytes);
      if (level > peakLevel) peakLevel = level;
      handlers.onLevel?.(level);

      const merged = new Uint8Array(carry.byteLength + bytes.byteLength);
      merged.set(carry, 0);
      merged.set(bytes, carry.byteLength);
      let offset = 0;
      while (merged.byteLength - offset >= FRAME_BYTES) {
        handlers.onFrame(merged.buffer.slice(offset, offset + FRAME_BYTES));
        frameCount += 1;
        sentBytes += FRAME_BYTES;
        offset += FRAME_BYTES;
      }
      carry = merged.slice(offset);
      // 宿主 200ms 一片，5 片 = 1s 一条；每片都打会刷屏
      if (chunkCount % 5 === 0) {
        logger.debug("[pcm-native] 收到分片", {
          chunks: chunkCount,
          frames: frameCount,
          bytes: sentBytes,
          level: Number(level.toFixed(3)),
          carry: carry.byteLength,
          ms: Date.now() - startedAt,
        });
      }
    }),
    onNativeEvent("pcmStreamEnd", (payload) => {
      if (closed) return;
      logger.info("[pcm-native] 推流结束", payload);
      void stopCapture();
      handlers.onError?.("原生语音采集已中断");
    }),
    onNativeEvent("pcmStreamError", (payload) => {
      if (closed) return;
      const message = failMessage(payload);
      logger.warn("[pcm-native] 原生推流报错", { message, payload });
      void stopCapture();
      handlers.onError?.(message);
    }),
  ];

  function teardown() {
    if (closed) return;
    closed = true;
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    unsubscribers.forEach(unsubscribe => unsubscribe());
    carry = new Uint8Array(0);
  }

  try {
    await callNative("pcmStreamStart", {
      sampleRate: STREAM_SAMPLE_RATE,
      intervalMs: STREAM_INTERVAL_MS,
    }, { timeoutMs: START_TIMEOUT_MS, silentTimeout: true });
  }
  catch (error) {
    // 宿主没实现 / 不回调 / 拒绝：交给上层换通道（整段识别）
    teardown();
    throw error;
  }

  logger.warn("[pcm-native] 原生推流已开始", { sampleRate: STREAM_SAMPLE_RATE, intervalMs: STREAM_INTERVAL_MS });

  // start 成功但一个分片都不给：交给上层换整段识别
  watchdog = setTimeout(() => {
    watchdog = null;
    if (closed || chunkCount > 0) return;
    logger.warn("[pcm-native] 1.5s 内没有收到任何 PCM 分片，换通道");
    void stopCapture();
    handlers.onError?.("no-pcm-data");
  }, DATA_WATCHDOG_MS);

  async function stopCapture() {
    if (closed) return stopPromise ?? undefined;
    // 尾巴补零凑满一帧再发，最后一两个字不至于丢。
    if (carry.byteLength) {
      const padded = new Uint8Array(FRAME_BYTES);
      padded.set(carry);
      handlers.onFrame(padded.buffer);
      frameCount += 1;
      sentBytes += FRAME_BYTES;
    }
    logger.info("[pcm-native] 采集已停止", {
      ms: Date.now() - startedAt,
      chunks: chunkCount,
      frames: frameCount,
      bytes: sentBytes,
      peak: Number(peakLevel.toFixed(3)),
    });
    teardown();
    stopPromise = callNative("pcmStreamStop", {}, { timeoutMs: STOP_TIMEOUT_MS, silentTimeout: true })
      .then(() => {})
      .catch(error => logger.warn("[pcm-native] pcmStreamStop 失败", error));
    await stopPromise;
  }

  return { stop: stopCapture };
}

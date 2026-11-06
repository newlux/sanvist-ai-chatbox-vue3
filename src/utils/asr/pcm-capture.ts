import { createLogger } from "@/utils/logger";

const logger = createLogger("pcm-capture");

/** 流式 ASR 要求的采样率（16kHz / 16bit / 单声道 / 裸 PCM，见接口文档 1.9） */
export const PCM_SAMPLE_RATE = 16000;
/** 每帧 100ms：16000 × 0.1 个采样，各 2 字节 */
const FRAME_SAMPLES = PCM_SAMPLE_RATE / 10;
/** 抽取前的低通截止：压掉降采样后会混叠回语音频段的高频 */
const LOW_PASS_HZ = 7000;
/** ScriptProcessor 的块大小：48k 下约 85ms 一块，够细也不至于把主线程拖满 */
const PROCESSOR_BUFFER_SIZE = 4096;

export interface PcmCaptureHandlers {
  /** 每攒满一帧（3200 字节 / 100ms）回调一次，直接把 ArrayBuffer 丢给 WebSocket 即可 */
  onFrame: (frame: ArrayBuffer) => void;
  /** 每帧的音量强度（0~1，RMS）：用来判静音，说完自动收尾 */
  onLevel?: (level: number) => void;
}

export interface PcmCapture {
  stop: () => void;
}

type AudioContextConstructor = typeof AudioContext;

function resolveAudioContext(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const ctor
    = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  return ctor ?? null;
}

/** 只要能建 AudioContext、能拿麦克风，就能在端上转出 16k PCM */
export function isPcmCaptureSupported() {
  if (typeof navigator === "undefined") return false;
  return Boolean(resolveAudioContext() && navigator.mediaDevices?.getUserMedia);
}

/**
 * 采集麦克风并持续吐出 16kHz / 16bit / 单声道裸 PCM 分片。
 *
 * 浏览器原生采集是 44.1k/48k 的 Float32，必须在这里完成「低通 → 抽取 → 量化」；
 * 直接把原始 48k 传上去，1 分钟流量会从 1.9MB 涨到 46MB，还会多出服务端转码延迟。
 */
export async function startPcmCapture(handlers: PcmCaptureHandlers): Promise<PcmCapture> {
  const AudioCtx = resolveAudioContext();
  if (!AudioCtx) throw new Error("AudioContext unsupported");
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia unsupported");

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const context = new AudioCtx();
  // 部分 WebView 建连后仍是 suspended，不显式唤醒的话 ScriptProcessor 一个回调都不会来
  if (context.state === "suspended") {
    await context.resume().catch((error) => logger.warn("audio context resume failed", error));
  }

  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
  // ScriptProcessor 必须接到 destination 才会被驱动；串一个 0 增益，避免把麦克风回放出来
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);

  /** 采样率比：44.1k 时是 2.75625，不能写死 3，否则出来的是 14.7k */
  const ratio = context.sampleRate / PCM_SAMPLE_RATE;
  /** 一阶低通系数 */
  const alpha = 1 - Math.exp((-2 * Math.PI * LOW_PASS_HZ) / context.sampleRate);

  let last = 0;
  /** 抽取相位要跨回调续上，每块都从 0 开始会让节奏忽快忽慢 */
  let phase = 0;
  const pending = new Int16Array(FRAME_SAMPLES);
  let pendingCount = 0;
  /** 当前帧的平方和，出帧时换算成 RMS */
  let frameSquares = 0;
  let stopped = false;

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    const input = event.inputBuffer.getChannelData(0);
    for (let i = 0; i < input.length; i++) {
      last += alpha * (input[i] - last);
      phase += 1;
      if (phase < ratio) continue;
      phase -= ratio;

      const sample = Math.max(-1, Math.min(1, last));
      frameSquares += sample * sample;
      pending[pendingCount++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (pendingCount < FRAME_SAMPLES) continue;

      handlers.onLevel?.(Math.sqrt(frameSquares / FRAME_SAMPLES));
      frameSquares = 0;
      // 必须复制出去：pending 会被下一帧复用
      handlers.onFrame(pending.buffer.slice(0));
      pendingCount = 0;
    }
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    processor.onaudioprocess = null;
    try {
      source.disconnect();
      processor.disconnect();
      mute.disconnect();
    }
    catch (error) {
      logger.warn("audio node disconnect failed", error);
    }
    stream.getTracks().forEach(track => track.stop());
    void context.close().catch((error) => logger.warn("audio context close failed", error));
  };

  return { stop };
}

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
/** 采集自检的观察窗口：这么久了还没有回调 / 回调全是 0，就留一条 warn 方便端上排查 */
const DIAG_DELAY_MS = 1200;
/** 判定「采到的是静音」的 RMS 上限（正常说话在 0.02 以上） */
const SILENT_RMS = 0.001;
/** 等一次用户手势来唤醒 AudioContext 的上限：等不到也继续往下走，别把录音卡住 */
const GESTURE_RESUME_TIMEOUT_MS = 1500;

/** 采集起不来的三种形态（都拿不到可用音频，只能换一条链路） */
export type PcmUnavailableReason = "no-context" | "no-callback" | "silent";

export interface PcmCaptureHandlers {
  /** 每攒满一帧（3200 字节 / 100ms）回调一次，直接把 ArrayBuffer 丢给 WebSocket 即可 */
  onFrame: (frame: ArrayBuffer) => void;
  /** 每帧的音量强度（0~1，RMS）：用来判静音，说完自动收尾 */
  onLevel?: (level: number) => void;
  /**
   * 采集链路不可用（只回调一次）。
   * 调用方据此把这一轮降到别的录音通道（例如 mPaaS 原生录音），
   * 而不是让用户对着一个不出声的麦克风说完整句、再收到「未识别到录音内容」。
   */
  onUnavailable?: (reason: PcmUnavailableReason) => void;
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

function isAndroidWebView() {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent || "");
}

/**
 * 麦克风约束。
 *
 * Android WebView（尤其离线包里的那套 H5 容器）在 `echoCancellation` / `noiseSuppression`
 * / `autoGainControl` 全开时，常拿到整段**纯 0 的样本**：采集链路不报错、轨道也是 live，
 * 但推给服务端的是一路静音，最后只等来一个空的 final —— 端上看到的就是「未识别到录音内容」。
 * 所以 Android 只做原始采集，这三项一律关掉；其它端保留处理，避免外放时把播报声音又收进去。
 */
function buildAudioConstraints(): MediaStreamConstraints {
  const processing = isAndroidWebView()
    ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  return { audio: { channelCount: 1, ...processing } };
}

/**
 * 把 DOMException 摊平成可读结构。
 * vConsole 展开 DOMException 只会列一堆原型常量（PARSE_ERROR / ABORT_ERR…），
 * 看不到真正的原因；这里直接取 name / code / message 打出来。
 */
function describeMicError(error: unknown) {
  const err = error as { name?: string; code?: number; message?: string } | null;
  return {
    name: String(err?.name || ""),
    code: Number(err?.code || 0),
    message: String(err?.message || error || ""),
  };
}

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

/**
 * 采集环境快照，只在失败日志里带上。
 * 离线包最容易踩的两件事：页面 origin 不是 https（非安全上下文 → 压根没有 getUserMedia），
 * 以及容器拒了媒体采集（有 getUserMedia 但抛 NotAllowedError）。两者处理方式完全不同，
 * 所以把 origin / isSecureContext / 是否有 getUserMedia 一起打出来，端上一眼能分清。
 */
function captureEnv() {
  try {
    return {
      origin: location.origin,
      secure: window.isSecureContext,
      hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
    };
  }
  catch {
    return {};
  }
}

/**
 * 打开麦克风：按「原始采集 → 最少约束 → 老式布尔」三档依次退。
 *
 * Android WebView（离线包容器）对 audio 约束字典的支持很不统一：实测有的版本对
 * `{ channelCount, echoCancellation, … }` 这种字典直接抛 DOMException，连麦克风都没打开，
 * 只认 `{ audio: true }`。所以不赌某一档：从「最想要的那一档」往下退，哪档能开用哪档，
 * 每档失败的原因都摊平记录 —— 端上日志里一眼能看出退到了第几档、为什么退。
 */
async function openMicrophone() {
  const media = navigator.mediaDevices;
  const ladder: Array<{ label: string; constraints: MediaStreamConstraints }> = [
    { label: "raw", constraints: buildAudioConstraints() },
    { label: "minimal", constraints: { audio: { channelCount: 1 } } },
    { label: "plain", constraints: { audio: true } },
  ];

  let lastError: unknown = null;
  for (let index = 0; index < ladder.length; index += 1) {
    const { label, constraints } = ladder[index];
    try {
      const stream = await media.getUserMedia(constraints);
      if (index > 0) {
        logger.warn(`[pcm] 麦克风已退到第 ${index + 1} 档（${label}）打开`, {
          prevError: describeMicError(lastError),
        });
      }
      return stream;
    }
    catch (error) {
      lastError = error;
      const detail = describeMicError(error);
      logger.warn(`[pcm] getUserMedia 第 ${index + 1} 档（${label}）失败`, { ...detail, env: captureEnv() });
      // NotAllowedError / SecurityError 是「WebView 层没给麦克风」，换约束也救不回来：
      // 直接抛出去让上层降级到原生录音，别再白等剩下两档
      if (detail.name === "NotAllowedError" || detail.name === "SecurityError") break;
      // AbortError 常见于「上一次采集没彻底释放」，隔一下再试下一档
      await delay(200);
    }
  }
  throw lastError ?? new Error("getUserMedia failed");
}

/**
 * 唤醒 AudioContext。
 *
 * Android WebView 建出来的 context 常停在 suspended，此时 ScriptProcessor 一个回调都不会来，
 * 表现同样是「一路静音」。先直接 resume，没醒就等一次真实手势再唤醒一次
 * （部分 WebView 只认手势里的 resume），最多等 1.5s 不拖住录音流程。
 */
async function ensureContextRunning(context: AudioContext) {
  if (context.state === "running") return;
  await context.resume().catch(error => logger.warn("audio context resume failed", error));
  if (context.state === "running") return;

  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const events = ["touchstart", "touchend", "click"];
    const wake = () => {
      cleanup();
      void context.resume()
        .catch(error => logger.warn("audio context gesture resume failed", error))
        .then(() => resolve());
    };
    const cleanup = () => {
      events.forEach(name => document.removeEventListener(name, wake));
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, GESTURE_RESUME_TIMEOUT_MS);
    events.forEach(name => document.addEventListener(name, wake, { passive: true }));
  });
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

  const stream = await openMicrophone();

  const context = new AudioCtx();
  // 部分 WebView 建连后仍是 suspended，不显式唤醒的话 ScriptProcessor 一个回调都不会来
  await ensureContextRunning(context);

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
  /** 自检用：出过多少帧、最大音量（判断「回调没来」还是「来的全是 0」） */
  let frameCount = 0;
  let peakLevel = 0;

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

      const level = Math.sqrt(frameSquares / FRAME_SAMPLES);
      frameSquares = 0;
      frameCount += 1;
      if (level > peakLevel) peakLevel = level;
      handlers.onLevel?.(level);
      // 必须复制出去：pending 会被下一帧复用
      handlers.onFrame(pending.buffer.slice(0));
      pendingCount = 0;
    }
  };

  /**
   * 采集自检。
   *
   * Android 上的失败几乎都不报错，只有两种形态：context 没真正跑起来（一个回调都没有），
   * 或者回调来了但样本全是 0（音频处理把信号压没了）。两种都会让服务端只拿到静音、
   * 最后回一个空 final —— 界面上就是「未识别到录音内容」。这里各留一条 warn，
   * 线上 vConsole 里能直接看出是哪一种，不用再对着「没识别到」猜。
   */
  const diagTimer = setTimeout(() => {
    if (stopped) return;
    const track = stream.getAudioTracks()[0];
    if (!frameCount) {
      const reason: PcmUnavailableReason = context.state === "running" ? "no-callback" : "no-context";
      logger.warn("[pcm] 1.2s 内没有任何音频回调", {
        reason,
        state: context.state,
        sampleRate: context.sampleRate,
        android: isAndroidWebView(),
        track: track ? { muted: track.muted, readyState: track.readyState } : null,
      });
      // 还睡着就再唤一次（部分 WebView 的手势唤醒会漏）
      void context.resume().catch(() => {});
      handlers.onUnavailable?.(reason);
      return;
    }
    if (peakLevel < SILENT_RMS) {
      logger.warn("[pcm] 采到的是静音", {
        frames: frameCount,
        peak: peakLevel,
        state: context.state,
        android: isAndroidWebView(),
        track: track ? { muted: track.muted, readyState: track.readyState } : null,
      });
      handlers.onUnavailable?.("silent");
      return;
    }
    logger.debug("[pcm] 采集正常", { frames: frameCount, peak: peakLevel, sampleRate: context.sampleRate });
  }, DIAG_DELAY_MS);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(diagTimer);
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

/**
 * 录音工具：原生（支付宝 mPaaS JSBridge）优先，降级到浏览器 MediaRecorder。
 *
 * 原生侧 microphoneStart / microphoneEnd / microphoneCancel 共用一个全局单例会话，
 * 因此这里有两条硬约束：
 * 1. 任意时刻只允许一个桥调用在途，否则原生会话状态会错乱 —— 由串行队列保证；
 * 2. 每个桥调用都必须在有限时间内落地，否则调用方被永久挂起 —— 每次调用持有自己的超时定时器。
 *
 * 会话状态机：idle -> starting -> recording -> stopping -> idle，
 * 任何异常路径都直接回到 idle，并通过 nativeSessionMaybeActive 记录“原生侧可能仍占用麦克风”，
 * 由下一次 start 前的一次 microphoneCancel 兜底释放。
 */

const BRIDGE_METHOD = {
  START: "microphoneStart",
  END: "microphoneEnd",
  CANCEL: "microphoneCancel",
};

// microphoneEnd 需要上传音频文件，弱网下明显慢于 start / cancel。
// 上限不宜过大：超时期间队列里的后续调用（含下一次 start）都要排队等待。
const BRIDGE_TIMEOUT_MS = {
  [BRIDGE_METHOD.START]: 8000,
  [BRIDGE_METHOD.END]: 12000,
  [BRIDGE_METHOD.CANCEL]: 2000,
};

const BRIDGE_TIMEOUT_MESSAGE = {
  [BRIDGE_METHOD.START]: "开始录音超时",
  [BRIDGE_METHOD.END]: "录音上传超时",
  [BRIDGE_METHOD.CANCEL]: "取消录音超时",
};

const BROWSER_STOP_TIMEOUT_MS = 5000;

export const RECORDER_PHASE = {
  IDLE: "idle",
  STARTING: "starting",
  RECORDING: "recording",
  STOPPING: "stopping",
};

class VoiceRecorder {
  constructor() {
    this.phase = RECORDER_PHASE.IDLE;
    // 每开始/作废一次会话自增，用于识别“迟到的”异步结果
    this.sessionId = 0;
    this.isNativeSession = false;
    // 原生侧可能仍持有麦克风（start 超时、end 失败、cancel 失败）
    this.nativeSessionMaybeActive = false;

    this.stream = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.onDataAvailable = null;
    this._browserStopResolve = null;
    this._browserStopTimer = null;

    this._bridgeQueue = Promise.resolve();
    this._releasePending = false;
  }

  get isRecording() {
    return this.phase === RECORDER_PHASE.RECORDING;
  }

  static isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  isAlipayBridgeAvailable() {
    return typeof window !== "undefined" && !!window.AlipayJSBridge?.call;
  }

  /**
   * 把桥调用串到同一条队列上，保证原生侧同一时刻只有一个在途请求。
   * 队列节点自身一定会 settle（成功回调或超时），因此队列不会被卡死。
   */
  enqueueBridgeCall(method, params = {}) {
    const run = () => this.invokeBridge(method, params);
    const task = this._bridgeQueue.then(run, run);
    this._bridgeQueue = task.then(
      () => {},
      () => {},
    );
    return task;
  }

  invokeBridge(method, params) {
    return new Promise((resolve) => {
      if (!this.isAlipayBridgeAvailable()) {
        resolve({ success: false, errorMessage: "原生录音能力不可用" });
        return;
      }
      let settled = false;
      let timer = null;
      const done = (result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        timer = null;
        resolve(result);
      };
      timer = setTimeout(() => {
        console.warn("[voice-recorder] bridge timeout", { method });
        done({
          success: false,
          timeout: true,
          errorMessage: BRIDGE_TIMEOUT_MESSAGE[method] || "原生录音调用超时",
        });
      }, BRIDGE_TIMEOUT_MS[method] || BRIDGE_TIMEOUT_MS[BRIDGE_METHOD.START]);
      try {
        window.AlipayJSBridge.call(method, params, (result) => {
          console.info("[voice-recorder] bridge result", { method, result });
          done(result || {});
        });
      } catch (error) {
        done({ success: false, errorMessage: error?.message || "调用原生桥失败" });
      }
    });
  }

  /**
   * 释放原生会话：只投递不等待，调用方永远不会因为它被挂起。
   * cancel 成功才清除泄漏标记，否则留给下一次 start 前继续兜底。
   */
  releaseNativeSession() {
    if (!this.isAlipayBridgeAvailable()) return;
    this.nativeSessionMaybeActive = true;
    // 已有 cancel 在队列里排队时无需重复投递：它一定排在后续所有调用之前执行
    if (this._releasePending) return;
    this._releasePending = true;
    void this.enqueueBridgeCall(BRIDGE_METHOD.CANCEL).then((result) => {
      this._releasePending = false;
      if (result?.success) {
        this.nativeSessionMaybeActive = false;
      }
    });
  }

  /**
   * 请求麦克风权限（仅浏览器路径使用）
   */
  async requestPermission() {
    try {
      if (!VoiceRecorder.isSupported()) {
        throw new Error("浏览器不支持录音功能");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.getTracks().forEach(track => track.stop());
      return { success: true };
    } catch (error) {
      console.error("获取麦克风权限失败:", error);
      const notAllowed =
        error?.name === "NotAllowedError" || error?.name === "SecurityError";
      return {
        success: false,
        error: error.message || "无法访问麦克风，请检查权限设置",
        notAllowed,
      };
    }
  }

  /**
   * 开始录音。返回 { success, error?, cancelled? }
   */
  async start(options = {}) {
    this.hardReset();
    const sessionId = this.sessionId;
    this.phase = RECORDER_PHASE.STARTING;
    this.isNativeSession = this.isAlipayBridgeAvailable();
    console.info("[voice-recorder] start", {
      sessionId,
      native: this.isNativeSession,
      nativeSessionMaybeActive: this.nativeSessionMaybeActive,
    });

    if (this.isNativeSession) {
      return this.startNative(sessionId);
    }
    return this.startBrowser(sessionId, options);
  }

  async startNative(sessionId) {
    if (this.nativeSessionMaybeActive) {
      // 队列保证这次 cancel 一定排在下面的 start 之前执行，无需在此 await
      this.releaseNativeSession();
    }

    const result = await this.enqueueBridgeCall(BRIDGE_METHOD.START);
    const superseded = sessionId !== this.sessionId;

    if (!result?.success) {
      // 超时不代表原生没起来，回调可能只是丢了，按“可能占用”处理
      if (result?.timeout) this.nativeSessionMaybeActive = true;
      if (!superseded) this.phase = RECORDER_PHASE.IDLE;
      return { success: false, error: result?.errorMessage || "开始录音失败" };
    }

    this.nativeSessionMaybeActive = true;
    if (superseded) {
      // 会话已被 cancel 或新的 start 取代，立即把刚起来的原生录音释放掉
      this.releaseNativeSession();
      return { success: false, error: "录音已取消", cancelled: true };
    }

    this.phase = RECORDER_PHASE.RECORDING;
    return { success: true };
  }

  async startBrowser(sessionId, options) {
    if (!VoiceRecorder.isSupported()) {
      this.phase = RECORDER_PHASE.IDLE;
      return { success: false, error: "浏览器不支持录音功能" };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: options.sampleRate || 16000,
        },
      });

      if (sessionId !== this.sessionId) {
        stream.getTracks().forEach(track => track.stop());
        return { success: false, error: "录音已取消", cancelled: true };
      }

      this.stream = stream;
      this.audioChunks = [];
      this.onDataAvailable = options.onDataAvailable || null;

      const mimeType = this.getSupportedMimeType();
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: options.audioBitsPerSecond || 128000,
      });
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
          this.onDataAvailable?.(event.data);
        }
      };
      this.mediaRecorder.onstop = () => {
        this.settleBrowserStop(this.getAudioBlob());
      };
      this.mediaRecorder.onerror = (event) => {
        console.error("[voice-recorder] browser recorder error", event?.error);
        this.settleBrowserStop(null);
      };
      this.mediaRecorder.start(options.timeSlice || 1000);
      this.phase = RECORDER_PHASE.RECORDING;
      return { success: true };
    } catch (error) {
      console.error("[voice-recorder] browser start failed", error);
      this.teardownBrowserRecorder();
      this.phase = RECORDER_PHASE.IDLE;
      const notAllowed =
        error?.name === "NotAllowedError" || error?.name === "SecurityError";
      return {
        success: false,
        error: error.message || "无法开始录音",
        notAllowed,
      };
    }
  }

  /**
   * 结束录音。成功时返回 { success: true, data }，
   * data 为原生音频 URL（原生路径）或 Blob（浏览器路径）。
   */
  async stop() {
    if (this.phase !== RECORDER_PHASE.RECORDING) {
      return { success: false, error: "当前没有正在进行的录音" };
    }
    const sessionId = this.sessionId;
    this.phase = RECORDER_PHASE.STOPPING;

    if (this.isNativeSession) {
      const result = await this.enqueueBridgeCall(BRIDGE_METHOD.END);
      const superseded = sessionId !== this.sessionId;
      if (!superseded) this.phase = RECORDER_PHASE.IDLE;

      if (!result?.success || !result?.url) {
        // end 失败/超时后原生大概率仍持有会话，交给 cancel 释放
        this.releaseNativeSession();
        return { success: false, error: result?.errorMessage || "停止录音失败" };
      }
      this.nativeSessionMaybeActive = false;
      if (superseded) {
        return { success: false, error: "录音已取消", cancelled: true };
      }
      return { success: true, data: result.url };
    }

    const blob = await this.stopBrowserRecorder();
    const superseded = sessionId !== this.sessionId;
    if (!superseded) this.phase = RECORDER_PHASE.IDLE;
    this.teardownBrowserRecorder();
    if (superseded) {
      return { success: false, error: "录音已取消", cancelled: true };
    }
    if (!blob || !blob.size) {
      return { success: false, error: "未录制到音频内容" };
    }
    return { success: true, data: blob };
  }

  stopBrowserRecorder() {
    if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
      return Promise.resolve(this.getAudioBlob());
    }
    return new Promise((resolve) => {
      this._browserStopResolve = resolve;
      this._browserStopTimer = setTimeout(() => {
        console.warn("[voice-recorder] browser stop timeout");
        this.settleBrowserStop(this.getAudioBlob());
      }, BROWSER_STOP_TIMEOUT_MS);
      try {
        this.mediaRecorder.stop();
      } catch (error) {
        console.error("[voice-recorder] browser stop failed", error);
        this.settleBrowserStop(null);
      }
    });
  }

  settleBrowserStop(blob) {
    if (this._browserStopTimer) {
      clearTimeout(this._browserStopTimer);
      this._browserStopTimer = null;
    }
    const resolve = this._browserStopResolve;
    this._browserStopResolve = null;
    resolve?.(blob);
  }

  /**
   * 取消录音：同步作废当前会话并立即返回，原生释放动作投递到队列后台执行。
   * 调用方不需要（也不应该）等待原生回包，避免任何取消路径把 UI 锁死。
   */
  cancel() {
    const previousPhase = this.phase;
    const wasNativeSession = this.isNativeSession;
    console.info("[voice-recorder] cancel", {
      sessionId: this.sessionId,
      phase: previousPhase,
      native: wasNativeSession,
    });

    this.sessionId += 1;
    this.phase = RECORDER_PHASE.IDLE;
    this.settleBrowserStop(null);

    if (wasNativeSession && (this.nativeSessionMaybeActive || previousPhase !== RECORDER_PHASE.IDLE)) {
      // 若此时 start/end 仍在途，这次 cancel 会被队列排在其后执行，顺序天然正确
      this.releaseNativeSession();
    }
    this.teardownBrowserRecorder();
    this.audioChunks = [];
    return { success: true };
  }

  /**
   * 作废当前会话并清空 JS 侧状态。
   * 不清 nativeSessionMaybeActive：那是留给下一次 start 释放原生残留会话的依据。
   */
  hardReset() {
    this.sessionId += 1;
    this.phase = RECORDER_PHASE.IDLE;
    this.isNativeSession = false;
    this.settleBrowserStop(null);
    this.teardownBrowserRecorder();
    this.audioChunks = [];
  }

  teardownBrowserRecorder() {
    const tracks = this.stream?.getTracks?.() || [];
    tracks.forEach((track) => {
      try {
        track.stop();
      } catch {
        // ignore
      }
    });
    this.stream = null;
    if (this.mediaRecorder) {
      this.mediaRecorder.ondataavailable = null;
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.onerror = null;
      try {
        if (this.mediaRecorder.state !== "inactive") this.mediaRecorder.stop();
      } catch {
        // ignore
      }
    }
    this.mediaRecorder = null;
    this.onDataAvailable = null;
  }

  getAudioBlob() {
    if (this.audioChunks.length === 0) {
      return null;
    }
    return new Blob(this.audioChunks, { type: this.getSupportedMimeType() });
  }

  getSupportedMimeType() {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
      "audio/wav",
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return "audio/webm";
  }
}

export default VoiceRecorder;

/**
 * 浏览器录音工具类
 * 使用浏览器 MediaRecorder API 实现录音功能
 */
class VoiceRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.stream = null;
    this.isRecording = false;
    this.onDataAvailable = null;
    this.onStop = null;
    this.useNativeRecorder = false;
    this.cancelled = false;
    this.isStarting = false;
    this.cancelRequested = false;
    this._cancelPendingResolve = null;
    this.nativeStartTimeoutMs = 5000;
    this.nativeStartTimeoutTimer = null;
    // 原生会话泄漏标记：microphoneEnd 失败/超时时置 true，
    // 表示原生侧麦克风可能仍被占用，需要 cancel 时主动调 microphoneCancel 释放。
    this._nativeSessionLeaked = false;
  }

  /**
   * 调用原生桥并带超时兜底；超时后清理并返回失败，避免 Promise 永不 resolve 卡死状态。
   * @param {string} method
   * @param {object} params
   * @param {number} timeoutMs
   */
  callAlipayBridgeWithTimeout(method, params, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        if (this.nativeStartTimeoutTimer) {
          clearTimeout(this.nativeStartTimeoutTimer);
          this.nativeStartTimeoutTimer = null;
        }
        resolve(result);
      };
      try {
        window.AlipayJSBridge.call(method, params, (result) => {
          done(result || {});
        });
      } catch (error) {
        done({ success: false, errorMessage: error?.message || "调用原生桥失败" });
        return;
      }
      this.nativeStartTimeoutTimer = setTimeout(() => {
        done({ success: false, errorMessage: "开始录音超时" });
      }, timeoutMs || this.nativeStartTimeoutMs);
    });
  }

  resolvePendingCancel(result) {
    this._cancelPendingResolve?.(result);
    this._cancelPendingResolve = null;
  }

  isAlipayBridgeAvailable() {
    return typeof window !== "undefined" && !!window.AlipayJSBridge?.call;
  }

  callAlipayBridge(method, params) {
    return new Promise((resolve) => {
      window.AlipayJSBridge.call(method, params, resolve);
    });
  }

  /**
   * 检查浏览器是否支持录音
   */
  static isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /**
   * 请求麦克风权限
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

      // 立即停止流，只是测试权限
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
   * 开始录音
   * @param {object} options 录音选项
   * @param {Function} onDataAvailable 数据可用回调
   * @param {Function} onStop 停止回调
   */
  async start(options = {}, onDataAvailable = null, onStop = null) {
    try {
      // 关键：每次 start 前先尝试释放可能残留的原生会话（microphoneCancel），
      // 再无条件强制重置 JS 状态。这样无论上一轮发生过什么（microphoneEnd 失败、
      // 短按立即松手、cancel 交错），下一次 start 一定从干净状态开始，
      // 彻底解决"短按一次后再也唤不醒"。
      if (this.isAlipayBridgeAvailable() && (this._nativeSessionLeaked || this.useNativeRecorder)) {
        console.warn("[voice-recorder] release native session before start", {
          useNativeRecorder: this.useNativeRecorder,
          leaked: this._nativeSessionLeaked,
        });
        try {
          await this.callAlipayBridgeWithTimeout(
            "microphoneCancel",
            {},
            this.nativeStartTimeoutMs,
          );
        } catch {
          // ignore，尽力而为，失败不阻塞后续 start
        }
      }
      // 无条件强制重置所有 JS 状态（含 useNativeRecorder / _nativeSessionLeaked）
      this.forceReset();

      this.isStarting = true;
      this.cancelRequested = false;
      console.info("[voice-recorder] start requested");

      if (this.isAlipayBridgeAvailable()) {
        const result = await this.callAlipayBridgeWithTimeout(
          "microphoneStart",
          {},
          this.nativeStartTimeoutMs,
        );
        console.info("[voice] native start result", result);
        if (!result?.success) {
          // 失败时彻底重置 useNativeRecorder/isRecording/isStarting，
          // 并标记原生会话泄漏，以便 cancel/start 能主动调 microphoneCancel 释放。
          this.isStarting = false;
          this.useNativeRecorder = false;
          this.isRecording = false;
          this._nativeSessionLeaked = true;
          this.resolvePendingCancel({
            success: false,
            error: result?.errorMessage || "开始录音失败",
          });
          return { success: false, error: result?.errorMessage || "开始录音失败" };
        }
        if (this.cancelRequested) {
          console.info("[voice-recorder] native start cancelled before ready");
          await this.callAlipayBridge("microphoneCancel", {});
          this.cleanup();
          const cancelledResult = { success: false, error: "录音已取消" };
          this.resolvePendingCancel(cancelledResult);
          return cancelledResult;
        }
        this.useNativeRecorder = true;
        this.cancelled = false;
        this.onStop = onStop;
        this.isRecording = true;
        this.isStarting = false;
        console.info("[voice-recorder] native recorder started");
        return { success: true };
      }

      if (!VoiceRecorder.isSupported()) {
        this.cleanup();
        return { success: false, error: "浏览器不支持录音功能" };
      }

      // 请求麦克风权限
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: options.sampleRate || 16000,
        },
      });

      if (this.cancelRequested) {
        console.info("[voice-recorder] browser start cancelled before ready");
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
        this.cleanup();
        const cancelledResult = { success: false, error: "录音已取消" };
        this.resolvePendingCancel(cancelledResult);
        return cancelledResult;
      }

      // 设置回调
      this.onDataAvailable = onDataAvailable;
      this.onStop = onStop;

      // 清空之前的录音数据
      this.audioChunks = [];

      // 创建 MediaRecorder
      const mimeType = this.getSupportedMimeType();
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        audioBitsPerSecond: options.audioBitsPerSecond || 128000,
      });

      // 监听数据可用事件
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
          if (this.onDataAvailable) {
            this.onDataAvailable(event.data);
          }
        }
      };

      // 监听停止事件
      this.mediaRecorder.onstop = () => {
        this.handleStop();
      };

      // 监听错误事件
      this.mediaRecorder.onerror = (event) => {
        console.error("录音错误:", event.error);
        this.stop();
      };

      // 开始录音
      this.mediaRecorder.start(options.timeSlice || 1000); // 每1秒收集一次数据
      this.isRecording = true;
      this.isStarting = false;
      console.info("[voice-recorder] browser recorder started");

      return { success: true };
    } catch (error) {
      console.error("[voice-recorder] start failed", error);
      this.cleanup();
      const notAllowed =
        error?.name === "NotAllowedError" || error?.name === "SecurityError";
      const failedResult = {
        success: false,
        error: error.message || "无法开始录音",
        notAllowed,
      };
      this.resolvePendingCancel(failedResult);
      return failedResult;
    }
  }

  /**
   * 停止录音
   */
  async stop() {
    if (!this.isRecording) {
      return { success: false, error: "当前没有正在进行的录音" };
    }

    if (this.useNativeRecorder) {
      try {
        const result = await this.callAlipayBridgeWithTimeout(
          "microphoneEnd",
          {},
          this.nativeStartTimeoutMs,
        );
        console.info("[voice] native end result", result);
        if (!result?.success || !result?.url) {
          // microphoneEnd 失败：仅清掉 JS 侧 isRecording 标记，避免下次 start 被"录音已在进行中"拦截。
          // 是否通过 microphoneCancel / microphonePause 释放原生麦克风，待原生侧确认后再定。
          this.isRecording = false;
          this.isStarting = false;
          return {
            success: false,
            error: result?.errorMessage || "停止录音失败",
          };
        }
        this.isRecording = false;
        this.useNativeRecorder = false;
        this._nativeSessionLeaked = false;
        if (!this.cancelled && this.onStop) {
          this.onStop(result.url);
        }
        return { success: true };
      } catch (error) {
        console.error("停止原生录音失败:", error);
        this.isRecording = false;
        this.isStarting = false;
        return { success: false, error: error?.message || "停止录音失败" };
      }
    }

    if (!this.mediaRecorder) {
      return { success: false, error: "当前没有正在进行的录音" };
    }

    try {
      if (this.mediaRecorder.state === "recording") {
        this.mediaRecorder.stop();
      }
      return { success: true };
    } catch (error) {
      console.error("停止录音失败:", error);
      this.cleanup();
      return { success: false, error: error.message };
    }
  }

  /**
   * 取消录音
   */
  async cancel() {
    this.cancelled = true;
    this.cancelRequested = true;
    console.info("[voice-recorder] cancel requested", {
      isRecording: this.isRecording,
      isStarting: this.isStarting,
      useNativeRecorder: this.useNativeRecorder,
    });
    if (this.isStarting && !this.isRecording) {
      // 若 start 已超时并 resolvePendingCancel，则这里可能已无挂起等待者；
      // 挂起 promise 由 start 超时/失败路径 resolvePendingCancel 释放，不会永久卡住。
      return new Promise((resolve) => {
        this._cancelPendingResolve = resolve;
      });
    }
    if (this.useNativeRecorder || this._nativeSessionLeaked) {
      // 主动调 microphoneCancel 释放原生侧麦克风会话。
      // 触发条件：进入过原生会话（useNativeRecorder），
      // 或 stop() 失败/超时导致 _nativeSessionLeaked 置 true（此时 JS 侧 useNativeRecorder 已被 stop cleanup 置 false，
      // 但原生侧可能仍占用麦克风，必须主动 cancel 释放，否则下次 microphoneStart 会被原生拒绝）。
      try {
        const result = await this.callAlipayBridgeWithTimeout(
          "microphoneCancel",
          {},
          this.nativeStartTimeoutMs,
        );
        console.info("[voice] native cancel result", {
          result,
          useNativeRecorder: this.useNativeRecorder,
          isRecording: this.isRecording,
          leaked: this._nativeSessionLeaked,
        });
        // 无论 cancel 成功失败，JS 侧 useNativeRecorder 强制重置为 false。
        // 原生侧麦克风如果还被占用，由下次 start() 入口的 _nativeSessionLeaked 分支再次尝试释放。
        this.useNativeRecorder = false;
        this.cleanup();
        this._nativeSessionLeaked = false;
        return result?.success
          ? { success: true }
          : { success: false, error: result?.errorMessage || "取消录音失败" };
      } catch (error) {
        this.cleanup();
        return { success: false, error: error?.message || "取消录音失败" };
      }
    }
    const result = await this.stop();
    this.audioChunks = [];
    this.cleanup();
    return result.success ? { success: true } : result;
  }

  base64ToBlob(value) {
    const base64 = String(value).replace(/^data:[^,]+,/, "");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: "audio/mp4" });
  }

  /**
   * 获取录音数据（Blob）
   */
  getAudioBlob() {
    if (this.audioChunks.length === 0) {
      return null;
    }
    return new Blob(this.audioChunks, { type: this.getSupportedMimeType() });
  }

  /**
   * 获取录音数据（Base64）
   */
  async getAudioBase64() {
    const blob = this.getAudioBlob();
    if (!blob) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(",")[1]; // 移除 data:audio/...;base64, 前缀
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * 获取录音数据（ArrayBuffer）
   */
  async getAudioArrayBuffer() {
    const blob = this.getAudioBlob();
    if (!blob) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
  }

  /**
   * 获取录音数据（File对象）
   */
  getAudioFile(filename = "recording.webm") {
    const blob = this.getAudioBlob();
    if (!blob) {
      return null;
    }
    return new File([blob], filename, { type: blob.type });
  }

  /**
   * 处理停止事件
   */
  handleStop() {
    this.isRecording = false;
    this.cleanup();

    if (this.onStop) {
      const blob = this.getAudioBlob();
      this.onStop(blob);
    }
  }

  /**
   * 强制重置：无条件清空所有 JS 状态，确保下一次 start 一定从干净状态开始。
   * 不依赖 isRecording/isStarting 判断，也不被"cleanup 需保留 useNativeRecorder 供 cancel 识别"
   * 的约束影响。在每次录音结束（clean）和每次录音开始前（start）都应调用。
   */
  forceReset() {
    const tracks = this.stream?.getTracks?.() || [];
    console.info("[voice-recorder] forceReset", {
      trackCount: tracks.length,
      isRecording: this.isRecording,
      isStarting: this.isStarting,
      useNativeRecorder: this.useNativeRecorder,
      nativeSessionLeaked: this._nativeSessionLeaked,
    });
    tracks.forEach((track) => {
      try {
        track.stop();
      } catch {
        // ignore
      }
    });
    if (this.nativeStartTimeoutTimer) {
      clearTimeout(this.nativeStartTimeoutTimer);
      this.nativeStartTimeoutTimer = null;
    }
    // 释放可能挂起的 cancel 等待者
    this.resolvePendingCancel({ success: false, error: "录音已强制重置" });
    this.stream = null;
    this.mediaRecorder = null;
    this.onStop = null;
    this.onDataAvailable = null;
    this.isRecording = false;
    this.isStarting = false;
    this.useNativeRecorder = false;
    this._nativeSessionLeaked = false;
    this.cancelled = false;
    this.cancelRequested = false;
  }

  /**
   * 清理资源（保留原生会话识别所需状态，供 cancel 主动释放；真正彻底重置用 forceReset）
   */
  cleanup() {
    const tracks = this.stream?.getTracks?.() || [];
    console.info("[voice-recorder] cleanup", {
      trackCount: tracks.length,
      trackStates: tracks.map(track => track.readyState),
      isRecording: this.isRecording,
      isStarting: this.isStarting,
      useNativeRecorder: this.useNativeRecorder,
      nativeSessionLeaked: this._nativeSessionLeaked,
    });
    tracks.forEach((track) => {
      track.stop();
    });
    if (this.nativeStartTimeoutTimer) {
      clearTimeout(this.nativeStartTimeoutTimer);
      this.nativeStartTimeoutTimer = null;
    }
    // 释放可能挂起的 cancel：避免 cleanup 后仍有等待者导致内存/状态泄漏
    this.resolvePendingCancel({ success: false, error: "录音已清理" });
    this.stream = null;
    this.mediaRecorder = null;
    this.isRecording = false;
    this.isStarting = false;
    // 关键：cleanup 不再重置 useNativeRecorder，让 cancel() 能识别需要主动释放原生会话。
    // useNativeRecorder 由 cancel 调 microphoneCancel 成功后（或下次 start 开始前）重置。
    // 同时保留 _nativeSessionLeaked，让 cancel() 在 useNativeRecorder 已被其他路径清掉时
    // 仍能检测到原生侧麦克风可能未释放。
    this.cancelled = false;
    this.cancelRequested = false;
  }

  /**
   * 获取支持的 MIME 类型
   */
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

    // 默认返回 webm
    return "audio/webm";
  }

  /**
   * 获取录音时长（秒）
   */
  getDuration() {
    // MediaRecorder 不直接提供时长，需要从音频数据计算
    // 这里返回一个估算值，实际应该从音频分析中获取
    return this.audioChunks.length; // 简化处理，返回chunk数量
  }
}

export default VoiceRecorder;

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
      stream.getTracks().forEach((track) => track.stop());

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
   * @param {Object} options 录音选项
   * @param {Function} onDataAvailable 数据可用回调
   * @param {Function} onStop 停止回调
   */
  async start(options = {}, onDataAvailable = null, onStop = null) {
    try {
      if (this.isRecording) {
        console.warn("录音已在进行中");
        return { success: false, error: "录音已在进行中" };
      }

      if (this.isAlipayBridgeAvailable()) {
        const result = await this.callAlipayBridge("microphoneStart", {});
        console.info("[voice] native start result", result);
        if (!result?.success) {
          return {
            success: false,
            error: result?.errorMessage || "开始录音失败",
          };
        }
        this.useNativeRecorder = true;
        this.cancelled = false;
        this.onStop = onStop;
        this.isRecording = true;
        return { success: true };
      }

      if (!VoiceRecorder.isSupported()) {
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

      // 设置回调
      this.onDataAvailable = onDataAvailable;
      this.onStop = onStop;

      // 清空之前的录音数据
      this.audioChunks = [];

      // 创建 MediaRecorder
      const mimeType = this.getSupportedMimeType();
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: mimeType,
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
      console.info("[voice] browser recorder started");

      return { success: true };
    } catch (error) {
      console.error("开始录音失败:", error);
      this.cleanup();
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
   * 停止录音
   */
  async stop() {
    if (!this.isRecording) {
      return { success: false, error: "当前没有正在进行的录音" };
    }

    if (this.useNativeRecorder) {
      try {
        const result = await this.callAlipayBridge("microphoneEnd", {});
        console.info("[voice] native end result", result);
        if (!result?.success || !result?.url) {
          return {
            success: false,
            error: result?.errorMessage || "停止录音失败",
          };
        }
        this.isRecording = false;
        this.useNativeRecorder = false;
        if (!this.cancelled && this.onStop) {
          this.onStop(result.url);
        }
        return { success: true };
      } catch (error) {
        console.error("停止原生录音失败:", error);
        this.cleanup();
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
    if (this.useNativeRecorder && this.isRecording) {
      try {
        const result = await this.callAlipayBridge("microphoneCancel", {});
        console.info("[voice] native cancel result", result);
        this.cleanup();
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
   * 清理资源
   */
  cleanup() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        track.stop();
      });
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.isRecording = false;
    this.useNativeRecorder = false;
    this.cancelled = false;
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

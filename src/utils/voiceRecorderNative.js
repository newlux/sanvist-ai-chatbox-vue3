import {
  cancelNativeRecord,
  isMpaasReady,
  startNativeRecord,
  stopNativeRecord,
} from "@/utils/platform/mpaas";

/**
 * 走 mPaaS 原生 JSAPI 的录音器（microphoneStart / microphoneEnd / microphoneCancel）。
 *
 * 与另外两个实现（小程序 / 浏览器 MediaRecorder）接口一致，差别只在停录的返回：
 * 原生那边已经把文件处理好了，回的是音频 URL（data.audioUrl）；
 * 个别宿主是直接回 base64（data.audioBase64），两种都透出去，
 * 由上层选「按地址识别」还是「按 base64 识别」，不用再上传一次本地文件。
 */

const MIN_RECORD_MS = 600;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readErrorMessage(error, fallback) {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  return error.message || fallback;
}

class NativeVoiceRecorder {
  constructor() {
    this.sessionId = 0;
    this.recording = false;
    this.startedAt = 0;
  }

  get isRecording() {
    return this.recording;
  }

  static isSupported() {
    return isMpaasReady();
  }

  async start() {
    this.hardReset();
    const sessionId = this.sessionId;

    try {
      await startNativeRecord();
      // 授权弹窗、启动耗时期间用户可能已经松手，这一路结果直接作废
      if (sessionId !== this.sessionId) {
        void cancelNativeRecord();
        return { success: false, error: "录音已取消", cancelled: true };
      }
      this.recording = true;
      this.startedAt = Date.now();
      console.info("[voice] native recorder started");
      return { success: true };
    } catch (error) {
      this.recording = false;
      const message = readErrorMessage(error, "录音启动失败");
      console.warn("[voice] native recorder start failed", error);
      return { success: false, error: message, notAllowed: /权限|permission|denied/i.test(message) };
    }
  }

  async stop() {
    if (!this.recording) {
      return { success: false, error: "当前没有正在进行的录音" };
    }

    const elapsed = Date.now() - this.startedAt;
    if (elapsed < MIN_RECORD_MS) await sleep(MIN_RECORD_MS - elapsed);

    const sessionId = this.sessionId;
    try {
      const audio = await stopNativeRecord();
      this.recording = false;
      if (sessionId !== this.sessionId) {
        return { success: false, error: "录音已取消", cancelled: true };
      }
      console.info("[voice] native recorder stopped", {
        url: audio.audioUrl,
        base64Length: audio.audioBase64 ? audio.audioBase64.length : 0,
      });
      return { success: true, data: audio };
    } catch (error) {
      this.recording = false;
      console.warn("[voice] native recorder stop failed", error);
      return { success: false, error: readErrorMessage(error, "录音失败") };
    }
  }

  cancel() {
    this.hardReset();
    return { success: true };
  }

  hardReset() {
    this.sessionId += 1;
    if (this.recording) {
      this.recording = false;
      // 取消是尽力而为：原生没在录时这一调用会失败，忽略即可
      cancelNativeRecord().catch(() => {});
    }
    this.startedAt = 0;
  }
}

export default NativeVoiceRecorder;

/* global MediaRecorder, navigator, URL */

/**
 * 浏览器端录音器（H5）。
 *
 * uni 的 getRecorderManager 只有 App / 小程序有，H5 只能自己走 MediaRecorder。
 * 对外暴露的方法与 VoiceRecorder 完全一致（start / stop / cancel / hardReset），
 * 返回结构也保持一致：stop 成功时给出 { data: { tempFilePath } }，
 * 这里的 tempFilePath 是 blob: 地址，uni.uploadFile 在 H5 上可以直接吃。
 */

import { createLogger } from "@/utils/logger";

const logger = createLogger("voice");

const MIN_RECORD_MS = 600;
const START_TIMEOUT_MS = 8000;

/** 优先挑后端认识的容器；都不支持时交给浏览器自选 */
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  return PREFERRED_MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type)) || "";
}

function readErrorMessage(error) {
  if (!error) return "录音失败";
  if (typeof error === "string") return error;
  const name = String(error.name || "");
  if (/NotAllowed|Security/i.test(name)) return "请允许浏览器使用麦克风";
  if (/NotFound/i.test(name)) return "没有检测到麦克风设备";
  return error.message || "录音失败";
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class WebVoiceRecorder {
  constructor() {
    this.sessionId = 0;
    this.recorder = null;
    this.stream = null;
    this.chunks = [];
    this.startedAt = 0;
    this.recording = false;
    this.lastObjectUrl = "";
  }

  get isRecording() {
    return this.recording;
  }

  /**
   * 只判断「是不是浏览器环境」。
   * getUserMedia 在非安全上下文（http 局域网地址）下会整个缺失，
   * 但那时也不该退回小程序实现——uni 在 H5 上的 getRecorderManager 只是个返回
   * undefined 的空壳，用了必崩。缺能力的情况留到 start 里给明确提示。
   */
  static isSupported() {
    return typeof MediaRecorder !== "undefined" && typeof navigator !== "undefined";
  }

  async start() {
    this.hardReset();
    if (!WebVoiceRecorder.isSupported()) {
      return { success: false, error: "当前浏览器不支持录音" };
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      // http 打开的页面拿不到 mediaDevices，浏览器的安全限制，换 HTTPS 或 localhost 才行
      return { success: false, error: "请用 HTTPS 打开页面后再录音", notAllowed: true };
    }

    const sessionId = this.sessionId;
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        sleep(START_TIMEOUT_MS).then(() => Promise.reject(new Error("录音启动超时"))),
      ]);
      // 授权弹窗期间用户可能已经松手，这一路结果直接作废
      if (sessionId !== this.sessionId) {
        stream.getTracks().forEach(track => track.stop());
        return { success: false, error: "录音已取消", cancelled: true };
      }

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size) this.chunks.push(event.data);
      };
      recorder.start();

      this.stream = stream;
      this.recorder = recorder;
      this.recording = true;
      this.startedAt = Date.now();
      logger.info("web recorder started", { mimeType: recorder.mimeType });
      return { success: true };
    } catch (error) {
      this.releaseStream();
      const message = readErrorMessage(error);
      const notAllowed = /允许|NotAllowed/i.test(message) || /NotAllowed/i.test(String(error?.name || ""));
      logger.warn("web recorder start failed", error);
      return { success: false, error: message, notAllowed };
    }
  }

  async stop() {
    if (!this.recording || !this.recorder) {
      return { success: false, error: "当前没有正在进行的录音" };
    }

    const elapsed = Date.now() - this.startedAt;
    if (elapsed < MIN_RECORD_MS) await sleep(MIN_RECORD_MS - elapsed);
    if (!this.recording || !this.recorder) {
      return { success: false, error: "录音已取消", cancelled: true };
    }

    const sessionId = this.sessionId;
    const recorder = this.recorder;

    return new Promise((resolve) => {
      recorder.onerror = (event) => {
        this.releaseStream();
        resolve({ success: false, error: readErrorMessage(event?.error) });
      };
      recorder.onstop = () => {
        const chunks = this.chunks;
        const mimeType = recorder.mimeType || "audio/webm";
        this.releaseStream();
        if (sessionId !== this.sessionId) {
          resolve({ success: false, error: "录音已取消", cancelled: true });
          return;
        }
        const blob = new Blob(chunks, { type: mimeType });
        if (!blob.size) {
          resolve({ success: false, error: "未录制到音频内容" });
          return;
        }
        // blob: 地址交给 uni.uploadFile；下一次录音开始时再回收
        this.lastObjectUrl = URL.createObjectURL(blob);
        logger.info("web recorder stopped", { size: blob.size, mimeType });
        resolve({ success: true, data: { tempFilePath: this.lastObjectUrl } });
      };
      try {
        recorder.stop();
      } catch (error) {
        this.releaseStream();
        resolve({ success: false, error: readErrorMessage(error) });
      }
    });
  }

  cancel() {
    this.hardReset();
    return { success: true };
  }

  hardReset() {
    this.sessionId += 1;
    const recorder = this.recorder;
    this.releaseStream();
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {
      // 尚未真正开始录音时忽略
    }
    this.revokeLastUrl();
  }

  revokeLastUrl() {
    if (!this.lastObjectUrl) return;
    try {
      URL.revokeObjectURL(this.lastObjectUrl);
    } catch {
      // 忽略
    }
    this.lastObjectUrl = "";
  }

  releaseStream() {
    this.recording = false;
    this.recorder = null;
    this.startedAt = 0;
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }
}

export default WebVoiceRecorder;

/* global uni */

export const RECORDER_PHASE = {
  IDLE: "idle",
  STARTING: "starting",
  RECORDING: "recording",
  STOPPING: "stopping",
};

/** 支付宝：录音不足 1s 时 onStop 不会触发，只会 onError(error: 7) */
const MIN_RECORD_MS = 1100;
const START_TIMEOUT_MS = 8000;
const STOP_TIMEOUT_MS = 8000;

function readErrorMessage(error) {
  if (!error) return "录音失败";
  if (typeof error === "string") return error;
  const code = error.error ?? error.errCode ?? error.code;
  if (Number(code) === 7) return "说话时间太短";
  if (Number(code) === 10) return "请在系统设置中允许使用麦克风";
  return error.errorMessage || error.errMsg || error.message || "录音失败";
}

function readFilePath(result) {
  return result?.tempFilePath || result?.apFilePath || result?.filePath || "";
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class VoiceRecorder {
  constructor() {
    this.phase = RECORDER_PHASE.IDLE;
    this.sessionId = 0;
    this.recorderManager = null;
    this.startPromise = null;
    this.startResolve = null;
    this.stopResolve = null;
    this.startedAt = 0;
    this.startTimer = null;
    this.stopTimer = null;
  }

  get isRecording() {
    return this.phase === RECORDER_PHASE.RECORDING;
  }

  static isSupported() {
    return typeof uni?.getRecorderManager === "function";
  }

  async start(options = {}) {
    this.hardReset();
    if (!VoiceRecorder.isSupported()) {
      return { success: false, error: "当前环境不支持录音功能" };
    }

    const sessionId = this.sessionId;
    const manager = uni.getRecorderManager();
    this.recorderManager = manager;
    this.phase = RECORDER_PHASE.STARTING;

    this.startPromise = new Promise((resolve) => {
      this.startResolve = resolve;
      const finish = (result) => {
        this.clearStartTimer();
        this.startResolve = null;
        if (this.sessionId !== sessionId) {
          resolve({ success: false, error: "录音已取消", cancelled: true });
          return;
        }
        resolve(result);
      };

      try {
        manager.offStart?.();
        manager.offError?.();
        manager.onStart(() => {
          if (this.sessionId !== sessionId) return;
          this.phase = RECORDER_PHASE.RECORDING;
          this.startedAt = Date.now();
          console.info("[voice] recorder started");
          finish({ success: true });
        });
        manager.onError((error) => {
          if (this.sessionId !== sessionId) return;
          this.phase = RECORDER_PHASE.IDLE;
          this.recorderManager = null;
          const errorMessage = readErrorMessage(error);
          const notAllowed = Number(error?.error) === 10
            || /auth|permission|deny|denied|麦克风/i.test(errorMessage);
          console.warn("[voice] recorder start error", error);
          finish({
            success: false,
            error: notAllowed ? "请在系统设置中允许使用麦克风" : errorMessage,
            notAllowed,
          });
        });
        this.startTimer = setTimeout(() => {
          finish({ success: false, error: "录音启动超时" });
        }, START_TIMEOUT_MS);
        manager.start({
          duration: options.duration || 60_000,
          sampleRate: options.sampleRate || 16_000,
          numberOfChannels: 1,
          encodeBitRate: options.encodeBitRate || 48_000,
          format: options.format || "mp3",
          hideTips: true,
        });
      } catch (error) {
        finish({ success: false, error: readErrorMessage(error) });
      }
    });

    return this.startPromise;
  }

  async stop() {
    if (this.phase === RECORDER_PHASE.STARTING && this.startPromise) {
      const startResult = await this.startPromise;
      if (!startResult?.success) return startResult;
    }

    if (this.phase !== RECORDER_PHASE.RECORDING || !this.recorderManager) {
      return { success: false, error: "当前没有正在进行的录音" };
    }

    const elapsed = Date.now() - this.startedAt;
    if (elapsed < MIN_RECORD_MS) {
      await sleep(MIN_RECORD_MS - elapsed);
      if (this.phase !== RECORDER_PHASE.RECORDING || !this.recorderManager) {
        return { success: false, error: "录音已取消", cancelled: true };
      }
    }

    const sessionId = this.sessionId;
    const manager = this.recorderManager;
    this.phase = RECORDER_PHASE.STOPPING;

    return new Promise((resolve) => {
      this.stopResolve = resolve;
      const finish = (result) => {
        this.clearStopTimer();
        this.stopResolve = null;
        this.resetState();
        resolve(result);
      };

      try {
        manager.offStop?.();
        manager.offError?.();
        manager.onStop((result) => {
          if (this.sessionId !== sessionId) return;
          const tempFilePath = readFilePath(result);
          console.info("[voice] recorder stopped", {
            tempFilePath,
            duration: result?.duration,
            fileSize: result?.fileSize,
            raw: result,
          });
          if (!tempFilePath) {
            finish({ success: false, error: "未录制到音频内容" });
            return;
          }
          finish({ success: true, data: { tempFilePath } });
        });
        manager.onError((error) => {
          if (this.sessionId !== sessionId) return;
          console.warn("[voice] recorder stop error", error);
          finish({ success: false, error: readErrorMessage(error) });
        });
        this.stopTimer = setTimeout(() => {
          finish({ success: false, error: "停止录音超时" });
        }, STOP_TIMEOUT_MS);
        manager.stop();
      } catch (error) {
        finish({ success: false, error: readErrorMessage(error) });
      }
    });
  }

  cancel() {
    this.abortCurrent("录音已取消");
    return { success: true };
  }

  hardReset() {
    this.abortCurrent("录音已重置");
  }

  abortCurrent(reason) {
    const manager = this.recorderManager;
    const startResolve = this.startResolve;
    const stopResolve = this.stopResolve;
    this.startResolve = null;
    this.stopResolve = null;
    this.sessionId += 1;
    this.clearTimers();
    this.resetState();
    startResolve?.({ success: false, error: reason, cancelled: true });
    stopResolve?.({ success: false, error: reason, cancelled: true });
    try {
      manager?.stop();
    } catch {
      // 录音尚未真正开始时，停止操作可安全忽略。
    }
  }

  clearStartTimer() {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
  }

  clearStopTimer() {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  clearTimers() {
    this.clearStartTimer();
    this.clearStopTimer();
  }

  resetState() {
    this.phase = RECORDER_PHASE.IDLE;
    this.recorderManager = null;
    this.startedAt = 0;
    this.startPromise = null;
    this.startResolve = null;
    this.stopResolve = null;
    this.clearTimers();
  }
}

export default VoiceRecorder;

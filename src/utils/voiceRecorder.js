/* global uni */

export const RECORDER_PHASE = {
  IDLE: "idle",
  STARTING: "starting",
  RECORDING: "recording",
  STOPPING: "stopping",
};

class VoiceRecorder {
  constructor() {
    this.phase = RECORDER_PHASE.IDLE;
    this.sessionId = 0;
    this.recorderManager = null;
    this.startResolve = null;
    this.stopResolve = null;
  }

  get isRecording() {
    return this.phase === RECORDER_PHASE.RECORDING;
  }

  static isSupported() {
    return typeof uni?.getRecorderManager === "function";
  }

  async requestPermission() {
    return new Promise((resolve) => {
      uni.getSetting({
        success: (result) => {
          if (result.authSetting?.["scope.record"]) {
            resolve({ success: true });
            return;
          }
          uni.authorize({
            scope: "scope.record",
            success: () => resolve({ success: true }),
            fail: error => resolve({
              success: false,
              error: error.errMsg || "无法访问麦克风，请检查权限设置",
              notAllowed: true,
            }),
          });
        },
        fail: error => resolve({
          success: false,
          error: error.errMsg || "无法获取麦克风权限",
        }),
      });
    });
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

    return new Promise((resolve) => {
      this.startResolve = resolve;
      manager.offStart?.();
      manager.offError?.();
      manager.onStart(() => {
        this.startResolve = null;
        if (sessionId !== this.sessionId) {
          manager.stop();
          resolve({ success: false, error: "录音已取消", cancelled: true });
          return;
        }
        this.phase = RECORDER_PHASE.RECORDING;
        resolve({ success: true });
      });
      manager.onError((error) => {
        this.startResolve = null;
        this.phase = RECORDER_PHASE.IDLE;
        this.recorderManager = null;
        resolve({ success: false, error: error.errMsg || "无法开始录音" });
      });
      manager.start({
        duration: options.duration || 60_000,
        sampleRate: options.sampleRate || 16_000,
        numberOfChannels: 1,
        encodeBitRate: 48_000,
        format: "mp3",
      });
    });
  }

  async stop() {
    if (this.phase !== RECORDER_PHASE.RECORDING || !this.recorderManager) {
      return { success: false, error: "当前没有正在进行的录音" };
    }

    const sessionId = this.sessionId;
    const manager = this.recorderManager;
    this.phase = RECORDER_PHASE.STOPPING;

    return new Promise((resolve) => {
      this.stopResolve = resolve;
      manager.offStop?.();
      manager.offError?.();
      manager.onStop((result) => {
        this.stopResolve = null;
        const cancelled = sessionId !== this.sessionId;
        this.resetState();
        if (cancelled) {
          resolve({ success: false, error: "录音已取消", cancelled: true });
          return;
        }
        if (!result.tempFilePath) {
          resolve({ success: false, error: "未录制到音频内容" });
          return;
        }
        resolve({
          success: true,
          data: { tempFilePath: result.tempFilePath, local: true },
        });
      });
      manager.onError((error) => {
        this.stopResolve = null;
        this.resetState();
        resolve({ success: false, error: error.errMsg || "停止录音失败" });
      });
      manager.stop();
    });
  }

  cancel() {
    const startResolve = this.startResolve;
    const stopResolve = this.stopResolve;
    const manager = this.recorderManager;

    this.startResolve = null;
    this.stopResolve = null;
    this.sessionId += 1;
    this.resetState();

    startResolve?.({ success: false, error: "录音已取消", cancelled: true });
    stopResolve?.({ success: false, error: "录音已取消", cancelled: true });
    try {
      manager?.stop();
    }
    catch {
      // 录音尚未真正开始时，停止操作可安全忽略。
    }
    return { success: true };
  }

  hardReset() {
    const startResolve = this.startResolve;
    const stopResolve = this.stopResolve;
    const manager = this.recorderManager;

    this.startResolve = null;
    this.stopResolve = null;
    this.sessionId += 1;
    this.resetState();

    startResolve?.({ success: false, error: "录音已重置", cancelled: true });
    stopResolve?.({ success: false, error: "录音已重置", cancelled: true });
    try {
      manager?.stop();
    }
    catch {
      // 录音尚未真正开始时，停止操作可安全忽略。
    }
  }

  resetState() {
    this.phase = RECORDER_PHASE.IDLE;
    this.recorderManager = null;
  }
}

export default VoiceRecorder;

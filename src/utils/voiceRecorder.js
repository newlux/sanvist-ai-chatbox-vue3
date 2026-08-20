import { createLogger } from "@/utils/logger";
import NativeVoiceRecorder from "./voiceRecorderNative";
import WebVoiceRecorder from "./voiceRecorderWeb";

const logger = createLogger("voice");

/**
 * 录音入口。真正的实现有两个：
 * - NativeVoiceRecorder：嵌在 mPaaS 容器里，权限、编码、上传都交给宿主；
 * - WebVoiceRecorder：普通浏览器，getUserMedia + MediaRecorder。
 *
 * 两者对外方法与返回结构一致（start / stop / cancel / hardReset），
 * 调用方不需要知道自己跑在哪。
 */
function pickRecorderImplementation() {
  if (NativeVoiceRecorder.isSupported()) return NativeVoiceRecorder;
  if (WebVoiceRecorder.isSupported()) return WebVoiceRecorder;
  logger.warn("当前环境不支持录音，回退到浏览器实现（调用时会给出提示）");
  return WebVoiceRecorder;
}

/**
 * 判断放在「实例化时」而不是模块加载时：AlipayJSBridge 是异步注入的，
 * 模块加载那一刻通常还没就绪，提前判定会永远选不到原生实现。
 */
class VoiceRecorder {
  constructor() {
    const Implementation = pickRecorderImplementation();
    // 构造函数返回别的对象是合法的：调用方拿到的就是选中的那个实现
    return new Implementation();
  }
}

export default VoiceRecorder;

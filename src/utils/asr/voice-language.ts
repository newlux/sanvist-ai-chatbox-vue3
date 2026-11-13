/**
 * 语音输入识别出来的语言（ASR 返回的 `language` 字段）。
 *
 * 用途：回答播报走 `POST /speech/tts/v2/stream`，它的 `language` 决定用哪套声音合成。
 * 以前这里直接取界面语言，用户用英文提问、界面还是中文时，英文答案会被按中文念出来。
 * 现在语音链路（WebSocket 流式 / 整段识别）拿到语言就记在这里，播报优先按它合成。
 *
 * 用模块级变量而不是 Pinia：只在本轮运行期内有意义，
 * 不需要持久化，也不需要跟着会话域（首页 / 智能体页）各存一份。
 */

/** 最近一次语音识别出的语言，空串表示还没识别过 */
let voiceInputLanguage = "";

/**
 * 归一化语言值：去空格、转小写。
 * zh 系（zh-CN / zh_cn / cmn / chinese…）与 en 系统一收成 `zh` / `en`，
 * 其它语言（未来后端支持的语种）原样带下去，不做臆测映射；空值返回空串。
 */
export function normalizeSpeechLanguage(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("zh") || raw.startsWith("cmn") || raw.includes("chinese")) return "zh";
  if (raw.startsWith("en") || raw.includes("english")) return "en";
  return raw;
}

/**
 * 记一次识别语言。ASR 每条消息都可能带 language，这里只在拿到有效值时覆盖，
 * 返回实际生效的语言（空串表示没拿到，调用方据此决定要不要打日志）。
 */
export function setVoiceInputLanguage(value: unknown) {
  const language = normalizeSpeechLanguage(value);
  if (!language) return "";
  voiceInputLanguage = language;
  return language;
}

/** 当前记住的识别语言（没识别过就是空串） */
export function getVoiceInputLanguage() {
  return voiceInputLanguage;
}

/** 清掉识别语言（切会话 / 退出语音态时按需调用） */
export function clearVoiceInputLanguage() {
  voiceInputLanguage = "";
}

/**
 * TTS 的 language 取值：优先本轮语音识别的语言，其次调用方给的兜底（一般是界面语言），
 * 都没有才落到 zh。
 */
export function resolveTtsLanguage(fallback?: unknown) {
  return voiceInputLanguage || normalizeSpeechLanguage(fallback) || "zh";
}

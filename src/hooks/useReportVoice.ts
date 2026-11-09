import type { ReportVoiceOption } from "@/config/report-voices";
import { REPORT_VOICE_OPTIONS, REPORT_VOICE_STORAGE_KEY } from "@/config/report-voices";
import { createLogger } from "@/utils/logger";

const logger = createLogger("report-voice");

/**
 * 报告听播音色的交互统一入口：保存所选音色、读取历史音色。
 *
 * 持久化只写可序列化字段（SavedReportVoice），hero/avatar/preview 属构建期资源、
 * 哈希会变，读取时按 id 从 REPORT_VOICE_OPTIONS 重新解析，避免存了失效的打包 URL。
 */

/** 保存所选音色到 localStorage。 */
export function saveReportVoice(voice: ReportVoiceOption) {
  const saved = {
    id: voice.id,
    voiceName: voice.voiceName,
    nameKey: voice.nameKey,
    descriptionKey: voice.descriptionKey,
    tagKey: voice.tagKey,
    gender: voice.gender,
  };
  try {
    uni.setStorageSync(REPORT_VOICE_STORAGE_KEY, saved);
  } catch (error) {
    logger.error("保存报告音色失败", error);
  }
}

/** 本机记住的音色值：可能是本地配置里的 id（xieshurou_v3.1），也可能是后台新下发的音色码（Cherry…） */
function readSavedVoiceValue(): string {
  let raw = null;
  try {
    raw = uni.getStorageSync(REPORT_VOICE_STORAGE_KEY);
  } catch (error) {
    logger.error("读取报告音色失败", error);
    return "";
  }
  return String((typeof raw === "string" ? raw : raw?.id) || "").trim();
}

/** 读取已保存的音色，按 id 还原完整选项（含 hero/avatar/preview）；无保存或不是本地选项返回 null。 */
export function loadReportVoice(): ReportVoiceOption | null {
  const id = readSavedVoiceValue();
  if (!id) return null;
  return REPORT_VOICE_OPTIONS.find(voice => voice.id === id) || null;
}

/**
 * 当前生效的音色 id：每次调用现读本机存储。
 *
 * 音色随时可能被 `…<VOICE_STYLE style="…">` 标签改写，所以 TTS 请求不要在进页 / 建会话时
 * 把音色固定下来，发请求那一刻现取，下一句播报就能用上新音色。没选过时返回空串（按后端默认音色）。
 */
export function resolveReportVoiceId(): string {
  return readSavedVoiceValue();
}

/** 音色值 → 本地音色选项：先按 id 精确匹配，再按性格标签（tagKey 后缀、下划线归一成连字符）匹配 */
function matchVoiceOption(value: string): ReportVoiceOption | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/_/g, "-");
  return REPORT_VOICE_OPTIONS.find(voice => voice.id.toLowerCase() === raw.toLowerCase())
    ?? REPORT_VOICE_OPTIONS.find(voice => voice.tagKey.toLowerCase().endsWith(`-${normalized}`))
    ?? null;
}

/**
 * 「<VOICE_STYLE style="…">」标签下发的音色值落库，返回最终生效的音色码（空串 = 没取到）。
 *
 * 标签值有三种口径，都要认：
 * - 本地音色 id（xieshurou_v3.1）：命中选项，连试听 / 头像一起存；
 * - 性格码（gentle_healing）：按 tagKey 后缀映射到对应选项；
 * - 后台声音列表里的新音色码（Cherry…）：本地没有对应的展示资源，就原样记住。
 * 以前只认前两种，匹配不上整条丢掉 —— 后台换成第三种口径后，表现就是「说了切换音色但没切」。
 */
export function saveReportVoiceByStyle(styleValue: string): string {
  const raw = String(styleValue || "").trim();
  if (!raw) return "";
  const option = matchVoiceOption(raw);
  if (option) {
    saveReportVoice(option);
    return option.id;
  }
  // 认不出的值只在「长得像音色码」时才记（Cherry / cherry_v3.1）；
  // 中文名之类的描述性文案当音色码发给 TTS 会把整句合成搞坏，直接忽略
  if (!/^[\w.-]+$/.test(raw)) {
    logger.warn("音色标签值既不是本地音色也不是音色码，忽略", { styleValue: raw });
    return "";
  }
  try {
    uni.setStorageSync(REPORT_VOICE_STORAGE_KEY, { id: raw });
  } catch (error) {
    logger.error("保存报告音色失败", error);
    return "";
  }
  logger.info("音色标签值不在本地配置里，按后台音色码记住", { styleValue: raw });
  return raw;
}

export function useReportVoice() {
  return {
    saveReportVoice,
    loadReportVoice,
    resolveReportVoiceId,
    saveReportVoiceByStyle,
  };
}

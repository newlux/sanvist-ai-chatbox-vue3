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

/** 读取已保存的音色，按 id 还原完整选项（含 hero/avatar/preview）；无保存或 id 不匹配返回 null。 */
export function loadReportVoice(): ReportVoiceOption | null {
  let raw = null;
  try {
    raw = uni.getStorageSync(REPORT_VOICE_STORAGE_KEY);
  } catch (error) {
    logger.error("读取报告音色失败", error);
    return null;
  }
  const id = typeof raw === "string" ? raw : raw?.id;
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
  return loadReportVoice()?.id || "";
}

/**
 * 「<VOICE_STYLE style="…">」标签下发的音色值落库：
 * 后端可能直接给音色 id（xieshurou_v3.1），也可能给性格码（gentle_healing），
 * 两种口径都认 —— 先按音色 id 精确匹配，再按性格标签（tagKey 后缀、下划线归一成连字符）匹配；
 * 命中后走 saveReportVoice 的同一份存储（ai-report-voice），听播页 / 维修内嵌页读的都是这份数据。
 * 匹配不到时不覆盖本机已选音色，只记日志。
 */
export function saveReportVoiceByStyle(styleValue: string): ReportVoiceOption | null {
  const raw = String(styleValue || "").trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/_/g, "-");
  const option
    = REPORT_VOICE_OPTIONS.find(voice => voice.id.toLowerCase() === raw.toLowerCase())
      ?? REPORT_VOICE_OPTIONS.find(voice => voice.tagKey.toLowerCase().endsWith(`-${normalized}`))
      ?? null;
  if (!option) {
    logger.warn("音色标签值匹配不到音色选项，忽略", { styleValue: raw });
    return null;
  }
  saveReportVoice(option);
  return option;
}

export function useReportVoice() {
  return {
    saveReportVoice,
    loadReportVoice,
    resolveReportVoiceId,
    saveReportVoiceByStyle,
  };
}

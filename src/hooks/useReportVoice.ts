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
    name: voice.name,
    description: voice.description,
    tag: voice.tag,
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

export function useReportVoice() {
  return {
    saveReportVoice,
    loadReportVoice,
  };
}

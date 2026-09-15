import type { ReportPlaybackRate } from "@/config/report-playback-rate";
import {
  DEFAULT_REPORT_PLAYBACK_RATE,
  REPORT_PLAYBACK_RATE_STORAGE_KEY,
  REPORT_PLAYBACK_RATES,
} from "@/config/report-playback-rate";
import { createLogger } from "@/utils/logger";

const logger = createLogger("report-playback-rate");

function isPlaybackRate(value: number): value is ReportPlaybackRate {
  return (REPORT_PLAYBACK_RATES as readonly number[]).includes(value);
}

export function saveReportPlaybackRate(rate: ReportPlaybackRate) {
  try {
    uni.setStorageSync(REPORT_PLAYBACK_RATE_STORAGE_KEY, rate);
  } catch (error) {
    logger.error("保存播放倍速失败", error);
  }
}

export function loadReportPlaybackRate(): ReportPlaybackRate {
  try {
    const saved = Number(uni.getStorageSync(REPORT_PLAYBACK_RATE_STORAGE_KEY));
    if (isPlaybackRate(saved)) return saved;
  } catch (error) {
    logger.error("读取播放倍速失败", error);
  }
  return DEFAULT_REPORT_PLAYBACK_RATE;
}

export function useReportPlaybackRate() {
  return {
    saveReportPlaybackRate,
    loadReportPlaybackRate,
  };
}

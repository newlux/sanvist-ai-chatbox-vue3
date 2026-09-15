export const REPORT_PLAYBACK_RATE_STORAGE_KEY = "ai-report-playback-rate";

export const REPORT_PLAYBACK_RATES = [1, 1.2, 1.5, 1.8, 2] as const;

export type ReportPlaybackRate = (typeof REPORT_PLAYBACK_RATES)[number];

export const DEFAULT_REPORT_PLAYBACK_RATE: ReportPlaybackRate = 1.2;

export function formatReportPlaybackRate(rate: number) {
  return `${rate.toFixed(1)}x`;
}

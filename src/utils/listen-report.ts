import { LISTEN_REPORT_CURRENT_DATE_KEY, LISTEN_REPORT_DATE_KEY } from "@/config";

export function getListenReportListenedDate(): string {
  try {
    return String(uni.getStorageSync(LISTEN_REPORT_DATE_KEY) || "");
  } catch {
    return "";
  }
}

export function isListenReportListened(bizDate?: string): boolean {
  const listenedDate = getListenReportListenedDate();
  return Boolean(listenedDate && bizDate && listenedDate === bizDate);
}

export function saveCurrentListenReportDate(bizDate?: string): void {
  if (!bizDate) return;
  try {
    uni.setStorageSync(LISTEN_REPORT_CURRENT_DATE_KEY, bizDate);
  } catch {
    // 本地存储不可用时不影响当前播报流程。
  }
}

export function getCurrentListenReportDate(): string {
  try {
    return String(uni.getStorageSync(LISTEN_REPORT_CURRENT_DATE_KEY) || "");
  } catch {
    return "";
  }
}

export function markListenReportListened(bizDate = getCurrentListenReportDate()): void {
  if (!bizDate) return;
  try {
    uni.setStorageSync(LISTEN_REPORT_DATE_KEY, bizDate);
  } catch {
    // 本地存储不可用时不影响当前播报流程。
  }
}

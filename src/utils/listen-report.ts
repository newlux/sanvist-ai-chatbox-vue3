import { LISTEN_REPORT_CURRENT_DATE_KEY, LISTEN_REPORT_DATE_KEY, LISTEN_REPORT_LANGUAGE_KEY } from "@/config";

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

/**
 * 记下 `<WORK_REPORT language="…">` 下发的播报语言，
 * 播报页发起 `/listen-broadcast/play` 时原样带上。
 * 传空即清掉：标签没带 language 时不能沿用上一次的旧值。
 */
export function saveCurrentListenReportLanguage(language?: string): void {
  const value = String(language || "").trim();
  try {
    if (!value) uni.removeStorageSync(LISTEN_REPORT_LANGUAGE_KEY);
    else uni.setStorageSync(LISTEN_REPORT_LANGUAGE_KEY, value);
  } catch {
    // 本地存储不可用时不影响当前播报流程。
  }
}

export function getCurrentListenReportLanguage(): string {
  try {
    return String(uni.getStorageSync(LISTEN_REPORT_LANGUAGE_KEY) || "").trim();
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

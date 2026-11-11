import { LISTEN_REPORT_CURRENT_DATE_KEY, LISTEN_REPORT_DATE_KEY, LISTEN_REPORT_LANGUAGE_KEY } from "@/config";
import { createLogger } from "@/utils/logger";
import { navigateToScene } from "@/utils/scene-navigation";

const logger = createLogger("listen-report");

/** 播报页路由（pages/podcast/index） */
export const PODCAST_PAGE_ROUTE = "/pages/podcast/index";

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

/**
 * 打开播报页（听汇报入口卡点击 / 旧的一跳了之链路共用）。
 *
 * 播报页 onLoad 从 storage 读「当前播报日期」与「播报语言」，所以先把 date / language 写进去再跳；
 * `direct=1` 让播报页跳过「选助手 → 选汇报内容」，直接起播。
 * 已经停在播报页时不重复跳自己（日期照写）。
 */
export function openListenReportPage(options: { date?: string; language?: string } = {}): void {
  saveCurrentListenReportDate(options.date);
  saveCurrentListenReportLanguage(options.language);
  const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
  const current = pages[pages.length - 1];
  if (current && `/${String(current.route || "")}` === PODCAST_PAGE_ROUTE) return;
  void navigateToScene(`${PODCAST_PAGE_ROUTE}?direct=1`).catch(error => logger.error("failed to open podcast page", error));
}

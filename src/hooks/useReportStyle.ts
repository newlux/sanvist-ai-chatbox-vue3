import { REPORT_STYLE_STORAGE_KEY } from "@/config/report-styles";
import { createLogger } from "@/utils/logger";

const logger = createLogger("report-style");

export interface SavedReportStyle {
  styleCode: string;
  moduleCodes: string[];
  reportTime?: string;
}

export function saveReportStyle(styleCode: string, moduleCodes: string[], reportTime?: string) {
  try {
    uni.setStorageSync(REPORT_STYLE_STORAGE_KEY, { styleCode, moduleCodes, reportTime });
  } catch (error) {
    logger.error("保存报告风格失败", error);
  }
}

export function loadReportStyle(): SavedReportStyle | null {
  try {
    const saved = uni.getStorageSync(REPORT_STYLE_STORAGE_KEY) as Partial<SavedReportStyle> | "" | null;
    if (!saved || typeof saved === "string" || !saved.styleCode || !Array.isArray(saved.moduleCodes)) return null;
    return {
      styleCode: saved.styleCode,
      moduleCodes: saved.moduleCodes.filter(code => typeof code === "string"),
      reportTime: typeof saved.reportTime === "string" ? saved.reportTime : undefined,
    };
  } catch (error) {
    logger.error("读取报告风格失败", error);
    return null;
  }
}

/**
 * 「<REPORT_STYLE style="…">」标签下发的风格码落库。
 *
 * 模块列表是「风格 × 汇报内容」的组合，风格一变旧模块就不再适用，所以风格码不同时清空模块，
 * 由播报页按该风格的 defaultModules 补齐（见 podcast 的 applyDefaultBroadcastParams）；
 * 同一个风格重复下发时保留原模块，避免把用户已选的汇报内容洗掉。
 */
export function saveReportStyleCode(styleCode: string) {
  const code = String(styleCode || "").trim();
  if (!code) return;
  const saved = loadReportStyle();
  const moduleCodes = saved && saved.styleCode === code ? saved.moduleCodes : [];
  saveReportStyle(code, moduleCodes, saved?.reportTime);
}

/**
 * 当前生效的风格码：每次调用现读本机存储。
 * 风格可能被 `…<REPORT_STYLE style="…">` 标签改写，所以听播拉流时现取，别在进页时把风格固定死。
 */
export function resolveReportStyleCode(): string {
  return loadReportStyle()?.styleCode || "";
}

export function useReportStyle() {
  return {
    saveReportStyle,
    loadReportStyle,
    saveReportStyleCode,
    resolveReportStyleCode,
  };
}

import { REPORT_STYLE_STORAGE_KEY } from "@/config/report-styles";
import { createLogger } from "@/utils/logger";

const logger = createLogger("report-style");

export interface SavedReportStyle {
  styleCode: string;
  moduleCodes: string[];
}

export function saveReportStyle(styleCode: string, moduleCodes: string[]) {
  try {
    uni.setStorageSync(REPORT_STYLE_STORAGE_KEY, { styleCode, moduleCodes });
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
    };
  } catch (error) {
    logger.error("读取报告风格失败", error);
    return null;
  }
}

export function useReportStyle() {
  return {
    saveReportStyle,
    loadReportStyle,
  };
}

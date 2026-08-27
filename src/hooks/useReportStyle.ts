import type { ReportStyleOption, SavedReportStyle } from "@/config/report-styles";
import { REPORT_STYLE_OPTIONS, REPORT_STYLE_STORAGE_KEY } from "@/config/report-styles";
import { createLogger } from "@/utils/logger";

const logger = createLogger("report-style");

/**
 * 报告听播「选择风格」交互入口：保存所选风格、读取历史风格。
 * 持久化只写可序列化字段（风格 id + 勾选的权限点 id 列表）。
 */

/** 保存所选风格到 localStorage。 */
export function saveReportStyle(styleId: string, permissionIds: string[]) {
  try {
    uni.setStorageSync(REPORT_STYLE_STORAGE_KEY, { styleId, permissionIds });
  } catch (error) {
    logger.error("保存报告风格失败", error);
  }
}

/** 读取已保存的风格及权限；无保存、风格不存在或权限点无效时返回 null。 */
export function loadReportStyle(): { style: ReportStyleOption; permissionIds: string[] } | null {
  let saved: SavedReportStyle | "" | null = null;
  try {
    saved = uni.getStorageSync(REPORT_STYLE_STORAGE_KEY) as SavedReportStyle | "" | null;
  } catch (error) {
    logger.error("读取报告风格失败", error);
    return null;
  }
  const styleId = typeof saved === "string" ? saved : saved?.styleId;
  if (!styleId) return null;
  const style = REPORT_STYLE_OPTIONS.find(item => item.id === styleId);
  if (!style) return null;
  const permissionIds = typeof saved === "object" && saved && Array.isArray(saved.permissionIds)
    ? saved.permissionIds.filter(id => style.permissions.some(permission => permission.id === id))
    : [];
  return { style, permissionIds };
}

export function useReportStyle() {
  return {
    saveReportStyle,
    loadReportStyle,
  };
}

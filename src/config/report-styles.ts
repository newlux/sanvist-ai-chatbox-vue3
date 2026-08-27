/**
 * 报告听播「选择风格」(Ardot 940:130) 配置。
 *
 * 每种汇报风格包含：风格名 + 说明 + 一组数据权限胶囊（默认勾选态）。
 * 风格在主体里做左右翻页（carousel），选中后连同语音一起持久化。
 * 设计稿 940:130 只给出「经营概览」一种风格，其余待后续补充，结构已按数组设计。
 */

export const REPORT_STYLE_STORAGE_KEY = "ai-report-style";

export interface ReportPermissionOption {
  /** 权限数据点 id */
  id: string;
  /** 胶囊文案，如「经营成本」 */
  label: string;
  /** 该权限点是否默认已勾选 */
  defaultChecked: boolean;
}

export interface ReportStyleOption {
  /** 风格 id */
  id: string;
  /** 风格名（大标题），如「经营概览」 */
  name: string;
  /** 风格说明（副标题），如「让助手只报告异常」 */
  description: string;
  /** 该风格下可勾选的权限数据点 */
  permissions: ReportPermissionOption[];
}

export const REPORT_STYLE_OPTIONS: ReportStyleOption[] = [
  {
    id: "operation-overview",
    name: "经营概览",
    description: "让助手只报告异常",
    permissions: [
      { id: "operating-cost", label: "经营成本", defaultChecked: true },
      { id: "risk-alert", label: "风险预警", defaultChecked: true },
      { id: "energy-cost", label: "成本能耗", defaultChecked: false },
    ],
  },
];

/** 持久化到 localStorage 的风格快照：风格 id + 所勾选的权限点 id 列表。 */
export interface SavedReportStyle {
  styleId: string;
  permissionIds: string[];
}

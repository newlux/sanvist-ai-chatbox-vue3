/**
 * 讲解模式身份（/user/operator-roles）。
 *
 * 后端把新老手分成两个字段：novice_operator（新手 / 需要带教）、
 * skilled_operator（老手 / 比较资深）。字段值可能是「身份标识字符串」，
 * 也可能是「带文案的对象」，这里统一收敛成 OperatorRoleOption 给页面用。
 */

/** 单个身份的原始返回：字符串或对象都兼容 */
export type OperatorRoleRaw = string | Record<string, unknown> | null | undefined;

export interface OperatorRolesData extends Record<string, unknown> {
  /** 新手：需要带教 */
  novice_operator?: OperatorRoleRaw;
  /** 老手：比较资深 */
  skilled_operator?: OperatorRoleRaw;
}

export interface OperatorRoleOption {
  /** 身份标识：选中后作为 inputs.operator_role 透传给 Dify */
  roleKey: string;
  /** 卡片标题 */
  roleName: string;
  /** 卡片描述（可含换行） */
  description: string;
  /** 卡片标签 */
  tag: string;
  /** 圆形头像 */
  avatar?: string;
}

export const OPERATOR_ROLE_KEYS = {
  novice: "novice_operator",
  skilled: "skilled_operator",
} as const;

/** 设计稿兜底文案：接口缺字段或加载失败时用它，保证选择页不空屏、流程不断 */
const FALLBACK_TEXT: Record<string, Pick<OperatorRoleOption, "roleName" | "description" | "tag">> = {
  [OPERATOR_ROLE_KEYS.skilled]: {
    roleName: "我是资深司机",
    description: "我操作过同类设备，\n希望重点了解这台设备的新功能和操作差异。",
    tag: "重点讲差异 · 快速定位新功能",
  },
  [OPERATOR_ROLE_KEYS.novice]: {
    roleName: "我是新手司机",
    description: "我第一次操作这款设备，\n希望从部件和术语开始，按步骤完成操作。",
    tag: "讲清基础 · 一步一操作一确认",
  },
};

function pickText(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return "";
  for (const key of keys) {
    const value = String(record[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

/** 把后端两种形态收敛成页面选项；文案缺失时回落到设计稿文案 */
export function toOperatorRoleOption(raw: OperatorRoleRaw, fieldKey: string, avatar?: string): OperatorRoleOption {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const inlineKey = typeof raw === "string" ? raw.trim() : "";
  const roleKey = inlineKey
    || pickText(record, ["roleKey", "role_key", "key", "value", "code"])
    || fieldKey;
  const fallback = FALLBACK_TEXT[fieldKey];
  return {
    roleKey,
    roleName: pickText(record, ["roleName", "role_name", "name", "label", "title"]) || fallback.roleName,
    description: pickText(record, ["description", "desc", "summary", "intro"]) || fallback.description,
    tag: pickText(record, ["tag", "tips", "hint", "subTitle"]) || fallback.tag,
    avatar,
  };
}

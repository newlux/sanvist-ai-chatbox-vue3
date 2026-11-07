/**
 * 回答正文里的身份切换标签：`<OWNER>老板身份已经切换。</OWNER>`。
 *
 * 后端把「切到哪个身份」和「给人看的文案」一起塞在 answer 里，
 * 标签只用于驱动前端动作，不能出现在气泡正文里。对应关系：
 *   OWNER → 老板 / ADMIN → 设备管理员 / OPERATOR → 操作手
 *
 * 流式期间标签可能分片到达，三种形态都要兜住：
 *   1. 完整 `<OWNER>…</OWNER>`：取码 + 保留中间文字；
 *   2. 只有开标签 `<OWNER>…`（闭合还没到）：同样取码，正文先按已有内容展示；
 *   3. 开标签都只到了一半（`<`、`<OWN`）：先把这段残片藏起来，避免气泡闪出半截标签。
 */

/** 对话里能切身份的三个角色码，顺序与设计稿的三颗身份球一致 */
export const ROLE_TAG_CODES = ["OWNER", "ADMIN", "OPERATOR"] as const;

export type RoleTagCode = (typeof ROLE_TAG_CODES)[number];

export interface RoleTagResult {
  /** 解析到的角色码；没有标签时为 null */
  role: RoleTagCode | null;
  /** 去掉标签源码后的正文（尖括号里的文字保留） */
  text: string;
}

/** 完整的 `<CODE>正文</CODE>`，可能有多段 */
const COMPLETE_TAG = /<(OWNER|ADMIN|OPERATOR)>([\s\S]*?)<\/\1>/gi;
/** 还没闭合的开标签：一直吃到文本结尾 */
const UNCLOSED_TAG = /<(OWNER|ADMIN|OPERATOR)>([\s\S]*)$/i;
/** 半截开标签：`<` 后面跟着 0~8 个大写字母且没有闭合尖括号 */
const PARTIAL_TAG = /<[A-Z]{0,8}$/i;

export function parseRoleTaggedAnswer(source: string): RoleTagResult {
  const raw = String(source || "");
  if (!raw) return { role: null, text: "" };

  let role: RoleTagCode | null = null;
  const take = (code: string) => {
    const upper = code.toUpperCase() as RoleTagCode;
    if (!role && (ROLE_TAG_CODES as readonly string[]).includes(upper)) role = upper;
  };

  let text = raw.replace(COMPLETE_TAG, (_match, code: string, inner: string) => {
    take(code);
    return inner;
  });
  text = text.replace(UNCLOSED_TAG, (_match, code: string, inner: string) => {
    take(code);
    return inner;
  });
  // 半截标签（流式中间）：整段残片去掉，正文等后续分片再补
  text = text.replace(PARTIAL_TAG, "");

  return { role, text };
}

/** 只剥离标签、不关心角色码时用（历史消息回看） */
export function stripRoleTags(source: string): string {
  return parseRoleTaggedAnswer(source).text;
}

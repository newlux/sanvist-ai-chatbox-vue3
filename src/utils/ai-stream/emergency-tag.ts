/**
 * 回答正文里的「异常全部加急」标签：
 *
 *   <EMERGENCY>已帮你把异常列表里的条目全部加急。</EMERGENCY>
 *
 * 语义与音色（voice-style-tag）/ 播报风格（report-style-tag）/ 听汇报（work-report-tag）一致：
 * 标签只用于驱动前端动作（拉一遍异常列表 → 逐条调加急接口），
 * 尖括号里的文字是给人看的正文，标签源码不能落到气泡里。
 *
 * 流式期间标签可能分片到达，三种形态都要兜住：
 *   1. 完整 `<EMERGENCY …>…</EMERGENCY>`（可能多段）：保留中间文字；
 *   2. 只有开标签 `<EMERGENCY …>…`（闭合还没到）：正文先按已有内容展示；
 *   3. 开标签 / 闭标签只到了一半（`<EMER`、`</EMERG`）：先把这段残片藏起来。
 */
const COMPLETE_TAG = /<EMERGENCY\b[^>]*>([\s\S]*?)<\/EMERGENCY>/gi;
const UNCLOSED_TAG = /<EMERGENCY\b[^>]*>([\s\S]*)$/i;
/** 开标签 / 闭标签只到一半（流式中间）：从 `<EMER` 起到结尾的残片先藏起来 */
const PARTIAL_TAG = /<\/?EMERG[A-Z]*$/i;
/** 标签体只是布尔 / 数字标记时不是给人看的正文，按纯标记丢掉 */
const FLAG_BODY = /^(?:true|false|1|0|yes|no)$/i;

export interface EmergencyTagResult {
  /** 正文里出现了 <EMERGENCY …> 开标签 */
  matched: boolean;
  /** 去掉标签源码后的正文（尖括号里的文字保留，标签前后的文字也保留） */
  text: string;
}

export function parseEmergencyTag(source: string): EmergencyTagResult {
  const raw = String(source || "");
  if (!raw) return { matched: false, text: "" };
  // 大部分正文不含这个词，先做一次便宜的排除，避免每条快照都跑正则
  if (!/EMERG/i.test(raw)) return { matched: false, text: raw };

  let matched = false;
  /** 标签体是 true / 1 这类标记时整体丢掉，不落进气泡 */
  const keepBody = (inner: string) => (FLAG_BODY.test(String(inner || "").trim()) ? "" : inner);

  // 先收完整的几段：标签源码替换成中间的文字
  let text = raw.replace(COMPLETE_TAG, (_match, inner: string) => {
    matched = true;
    return keepBody(inner);
  });
  // 再兜还没闭合的开标签：正文先按已有内容展示（闭合标签到了下一拍会再走到上面那段）
  text = text.replace(UNCLOSED_TAG, (_match, inner: string) => {
    matched = true;
    return keepBody(inner);
  });
  // 半截标签（流式中间）：整段残片去掉，正文等后续分片再补
  text = text.replace(PARTIAL_TAG, "");

  return { matched, text };
}

/** 只剥离标签、不关心是否命中时用（历史消息回看） */
export function stripEmergencyTags(source: string): string {
  return parseEmergencyTag(source).text;
}

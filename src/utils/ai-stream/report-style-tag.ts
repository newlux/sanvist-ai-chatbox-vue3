/**
 * 回答正文里的播报风格切换标签：
 *
 *   <REPORT_STYLE style="project_overview">好的，我会按项目概览风格为你准备播报内容，准备好后直接播给你听。</REPORT_STYLE>
 *
 * 语义与身份（role-tag）/ 音色（voice-style-tag）/ 听汇报（work-report-tag）标签一致：
 * 标签只用于驱动前端动作，尖括号里的文字是给人看的正文，标签源码不能落到气泡里。
 * style 属性的值就是播报风格码（听播接口的 styleCode 参数）。
 *
 * 流式期间标签可能分片到达，三种形态都要兜住：
 *   1. 完整 `<REPORT_STYLE …>…</REPORT_STYLE>`（可能多段）：取 style 值 + 保留中间文字；
 *   2. 只有开标签 `<REPORT_STYLE …>…`（闭合还没到）：同样取值，正文先按已有内容展示；
 *   3. 开标签只到了一半（`<`、`<REPORT_STY`）：先把这段残片藏起来，避免气泡闪出半截标签。
 */

/** 开标签只到一半（流式中间）：从 `<REPORT` 起到结尾的残片先藏起来 */
const PARTIAL_TAG = /<REPORT[_A-Z]*$/i;
/** style 属性，单双引号都认 */
const STYLE_ATTR = /style\s*=\s*["']([^"']+)["']/i;
/** 完整的「开标签 + 正文 + 闭合标签」，可能有多段 */
const COMPLETE_TAG = /<REPORT_STYLE\b([^>]*)>([\s\S]*?)<\/REPORT_STYLE>/gi;
/** 还没闭合的开标签：一直吃到文本结尾 */
const UNCLOSED_TAG = /<REPORT_STYLE\b([^>]*)>([\s\S]*)$/i;

export interface ReportStyleTagResult {
  /** 正文里出现了 <REPORT_STYLE …> 开标签 */
  matched: boolean;
  /** style 属性值（播报风格码），没有则为空串 */
  style: string;
  /** 去掉标签源码后的正文（尖括号里的文字保留，标签前后的文字也保留） */
  text: string;
}

export function parseReportStyleTag(source: string): ReportStyleTagResult {
  const raw = String(source || "");
  if (!raw) return { matched: false, style: "", text: "" };

  const takeStyle = (attrs: string) => String(STYLE_ATTR.exec(attrs || "")?.[1] || "").trim();

  let matched = false;
  let style = "";
  // 先收完整的几段：标签源码替换成中间的文字
  let text = raw.replace(COMPLETE_TAG, (_match, attrs: string, inner: string) => {
    matched = true;
    style = style || takeStyle(attrs);
    return inner;
  });
  // 再兜还没闭合的开标签：取值，正文先按已有内容展示（闭合标签到了下一拍会再走到上面那段）
  text = text.replace(UNCLOSED_TAG, (_match, attrs: string, inner: string) => {
    matched = true;
    style = style || takeStyle(attrs);
    return inner;
  });
  // 半截标签（流式中间）：整段残片去掉，正文等后续分片再补
  text = text.replace(PARTIAL_TAG, "");

  return { matched, style, text };
}

/** 只剥离标签、不关心风格码时用（历史消息回看） */
export function stripReportStyleTags(source: string): string {
  return parseReportStyleTag(source).text;
}

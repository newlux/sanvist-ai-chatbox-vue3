/**
 * 回答正文里的「听汇报」标签：
 *
 *   <WORK_REPORT date="2026-11-06" language="zh">好的，接下来为你汇报昨天的整体运营情况，预计约2分钟。</WORK_REPORT>
 *
 * 语义与二维码标签一致：标签只用于驱动前端动作（带着 date / language 跳播报页），
 * 尖括号里的文字是给人看的正文，标签源码不能落到气泡里。
 *
 * 流式期间开标签可能分片到达（`<WORK_REP`、`<WORK_REPORT date="2026-`），
 * 闭合标签也可能比正文晚到，所以这里区分 matched / closed 两个状态：
 * 只有 closed（或整轮结束）才跳页，避免气泡正文还没出完整就把页面切走。
 */

const OPEN_TAG = /<WORK_REPORT\b([^>]*)>/i;
const CLOSE_TAG = "</WORK_REPORT>";
/** 开标签只到一半（流式中间）：从 `<WORK` 起到结尾的残片先藏起来 */
const PARTIAL_TAG = /<WORK[_A-Z]*$/i;
/** date 属性，单双引号都认 */
const DATE_ATTR = /date\s*=\s*["']([^"']+)["']/i;
/** language 属性（播报语言），同样单双引号都认 */
const LANGUAGE_ATTR = /language\s*=\s*["']([^"']*)["']/i;

export interface WorkReportTagResult {
  /** 正文里出现了 <WORK_REPORT …> 开标签 */
  matched: boolean;
  /** 闭合标签是否已到（或整轮结束）；false 时不要跳页 */
  closed: boolean;
  /** date 属性值，没有则为空串 */
  date: string;
  /** language 属性值（播报语言），没有则为空串 */
  language: string;
  /** 去掉标签源码后的正文（尖括号里的文字保留，标签前后的文字也保留） */
  text: string;
}

export function parseWorkReportTag(source: string): WorkReportTagResult {
  const raw = String(source || "");
  if (!raw) return { matched: false, closed: false, date: "", language: "", text: "" };

  const open = OPEN_TAG.exec(raw);
  if (!open) {
    // 还没有完整开标签：把可能是半截标签的尾巴先摘掉，正文其它部分原样保留
    return { matched: false, closed: false, date: "", language: "", text: raw.replace(PARTIAL_TAG, "").trim() };
  }

  const openIndex = open.index;
  const bodyStart = openIndex + open[0].length;
  const body = raw.slice(bodyStart);
  const closeIndex = body.toUpperCase().indexOf(CLOSE_TAG);
  const inner = closeIndex >= 0 ? body.slice(0, closeIndex) : body;
  const tail = closeIndex >= 0 ? body.slice(closeIndex + CLOSE_TAG.length) : "";
  const attrs = open[1] || "";
  const dateMatch = DATE_ATTR.exec(attrs);
  const languageMatch = LANGUAGE_ATTR.exec(attrs);

  return {
    matched: true,
    closed: closeIndex >= 0,
    date: String(dateMatch?.[1] || "").trim(),
    language: String(languageMatch?.[1] || "").trim(),
    text: `${raw.slice(0, openIndex)}${inner}${tail}`.trim(),
  };
}

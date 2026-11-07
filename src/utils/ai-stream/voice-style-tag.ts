/**
 * 回答正文里的音色切换标签：
 *
 *   <VOICE_STYLE style="gentle_healing">音色已经切换为温柔治愈，现在听到的就是新的声音，我们继续聊吧。</VOICE_STYLE>
 *
 * 语义与身份（role-tag）/ 听汇报（work-report-tag）标签一致：
 * 标签只用于驱动前端动作（记住音色，写进听播音色的同一份存储），尖括号里的文字是给人看的正文，
 * 标签源码不能落到气泡里。style 属性的值就是音色值。
 *
 * 流式期间标签可能分片到达，三种形态都要兜住：
 *   1. 完整 `<VOICE_STYLE …>…</VOICE_STYLE>`（可能多段）：取 style 值 + 保留中间文字；
 *   2. 只有开标签 `<VOICE_STYLE …>…`（闭合还没到）：同样取值，正文先按已有内容展示；
 *   3. 开标签只到了一半（`<`、`<VOICE_STY`）：先把这段残片藏起来，避免气泡闪出半截标签。
 */

const OPEN_TAG = /<VOICE_STYLE\b([^>]*)>/i;
const CLOSE_TAG = "</VOICE_STYLE>";
/** 开标签只到一半（流式中间）：从 `<VOICE` 起到结尾的残片先藏起来 */
const PARTIAL_TAG = /<VOICE[_A-Z]*$/i;
/** style 属性，单双引号都认 */
const STYLE_ATTR = /style\s*=\s*["']([^"']+)["']/i;

export interface VoiceStyleTagResult {
  /** 正文里出现了 <VOICE_STYLE …> 开标签 */
  matched: boolean;
  /** style 属性值（音色值），没有则为空串 */
  style: string;
  /** 去掉标签源码后的正文（尖括号里的文字保留，标签前后的文字也保留） */
  text: string;
}

export function parseVoiceStyleTag(source: string): VoiceStyleTagResult {
  const raw = String(source || "");
  if (!raw) return { matched: false, style: "", text: "" };

  const takeStyle = (attrs: string) => String(STYLE_ATTR.exec(attrs || "")?.[1] || "").trim();

  // 先收完整的「开标签 + 正文 + 闭合标签」（可能多段），标签源码替换成中间的文字
  let matched = false;
  let style = "";
  let text = raw.replace(/<VOICE_STYLE\b([^>]*)>([\s\S]*?)<\/VOICE_STYLE>/gi, (_match, attrs: string, inner: string) => {
    matched = true;
    style = style || takeStyle(attrs);
    return inner;
  });
  // 再兜还没闭合的开标签：取值，正文先按已有内容展示（闭合标签到了下一拍会再走到上面那段）
  text = text.replace(/<VOICE_STYLE\b([^>]*)>([\s\S]*)$/i, (_match, attrs: string, inner: string) => {
    matched = true;
    style = style || takeStyle(attrs);
    return inner;
  });
  // 半截标签（流式中间）：整段残片去掉，正文等后续分片再补
  text = text.replace(PARTIAL_TAG, "");

  return { matched, style, text };
}

/** 只剥离标签、不关心音色值时用（历史消息回看） */
export function stripVoiceStyleTags(source: string): string {
  return parseVoiceStyleTag(source).text;
}

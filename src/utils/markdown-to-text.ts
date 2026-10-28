/**
 * Markdown → 纯文本（口播用）。
 *
 * 回答正文是 Markdown，直接丢给 TTS 会被念出「星号、井号、竖线」这类符号，
 * 而且表格、列表、链接的排版符号都会被逐个读出来。这里按行处理成一整段适合朗读的中文：
 * - 协议块 / 代码块 / 行内代码 / 图片 / 链接只保留可读文本；
 * - 标题、引用、分隔线整行去掉符号；
 * - 列表项、表格竖线改成顿号，句子之间直接串起来；
 * - 最后兜底清掉残留的行内标记 —— 流式切片时经常把 `**` `|` 这类标记切在两段中间，
 *   前后配对不上，正则匹配不到，只能收尾统一剔除。
 *
 * 只保留标点里的 `-`（日期 2026-10-21 这类不能拆），其余 Markdown 专用符号一律去掉。
 */

/** 正文里残留的协议块：只用于渲染（卡片 / 追问 / 步骤），不参与口播 */
const PROTOCOL_BLOCK_RE = /<(SANVIST|ASK|GUIDE|COMPONENT|PODCAST)>[\s\S]*?<\/\1>/g;

/** HTML 标签（<br> / <span ...> 之类）：换成空格，避免把单词黏在一起 */
const HTML_TAG_RE = /<\/?[a-z][^>]*>/gi;

/** 收尾兜底：残留的行内标记（含未配对的一半） */
const LEFTOVER_MARKUP_RE = /[*_~`#>|]+/g;

/**
 * @param raw Markdown 原文（可以是流式切片的一段）
 * @returns 适合直接送 TTS 的纯文本；没有可读内容时返回空串
 */
export function markdownToPlainText(raw: string): string {
  let text = String(raw ?? "");
  if (!text.trim()) return "";

  // 协议块、HTML 标签
  text = text.replace(PROTOCOL_BLOCK_RE, "");
  text = text.replace(HTML_TAG_RE, " ");

  // 代码块与行内代码：代码不适合朗读，整块丢掉；行内代码保留内容
  text = text.replace(/```[\s\S]*?```/g, "");
  text = text.replace(/`([^`]+)`/g, "$1");

  // 图片 / 链接：只保留文字（补一个空格，避免和前后文字黏成一词）
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1 ");
  text = text.replace(/\[([^\]]+)\]\(([^)]*)\)/g, "$1 ");

  // 强调：加粗 / 删除线 / 斜体（下划线斜体避开 a_b 这类标识符）
  text = text.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2");
  text = text.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1");
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2");
  text = text.replace(/(^|[^\w])_([^_\n]+)_/g, "$1$2");

  // 标题 / 引用 / 分隔线：整行的标记去掉
  text = text.replace(/^#{1,6}\s*/gm, "");
  text = text.replace(/^>\s?/gm, "");
  text = text.replace(/^\s*([-*_])(?:\s*\1){2,}\s*$/gm, "");

  // 列表项：连同前面的换行一起换成顿号，读起来是连续的句子（开头就是列表时 `^` 兜住）
  text = text.replace(/(^|[ \t]*\n)[ \t]*[-*+][ \t]+/g, "$1、");
  text = text.replace(/(^|[ \t]*\n)[ \t]*\d+[.、)）][ \t]*/g, "$1、");

  // 表格：表头分隔行整行去掉，每行首尾的竖线去掉（否则会读出开头结尾的顿号），剩下的换顿号
  text = text.replace(/^[\s|:\-]+$/gm, "");
  text = text.replace(/^[ \t]*\|/gm, "");
  text = text.replace(/[ \t]*\|[ \t]*$/gm, "");
  text = text.replace(/\|/g, "、");

  // 合并空白、去掉换行，串成一段
  text = text.replace(/[ \t\r]+/g, " ");
  text = text.replace(/\n+/g, " ");

  // 兜底：流式切片导致没配上对的标记
  text = text.replace(LEFTOVER_MARKUP_RE, "");

  // 修正连续分隔符与「：、」「。、」「、。」这类多余标点
  text = text.replace(/ {2,}/g, " ");
  text = text.replace(/、\s+/g, "、");
  text = text.replace(/([：:])\s*、+/g, "$1");
  text = text.replace(/[、，,]{2,}/g, "、");
  text = text.replace(/([。！？；])\s*、+/g, "$1");
  text = text.replace(/、+([。！？；,.!?;])/g, "$1");
  text = text.replace(/\s+([，。！？；：、])/g, "$1");
  text = text.replace(/^[、，,；;：:。\s]+/g, "");
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/[、\s]+$/, "");
  text = text.trim();

  if (text && !/[。！？!?；;]$/.test(text)) text += "。";
  return text;
}

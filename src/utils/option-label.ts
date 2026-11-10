/**
 * 选项文案清洗：去掉后端带回来的「A |」前缀。
 *
 * 追问卡 / 推荐问题在气泡里本来就是「字母 + 竖线 + 文案」三段式渲染
 * （A ｜ 文案，见 AskSlotBlock / GuideSuggestionBlock 等），但服务端下发的
 * `label` 有时自己就带了序号，例如 `"A | 老板"`，拼上去就成了「A ｜ A | 老板」。
 *
 * 这里只剥「一个字母 + 竖线」这一种前缀，且要求竖线前确实只有一个字母：
 * 文案正文里出现的竖线（如「直径 8 | 10 mm」）不会被误伤。
 */
const OPTION_PREFIX_PATTERN = /^\s*[A-Za-zＡ-Ｚａ-ｚ]\s*[|｜]\s*/;

/** 去掉选项文案的「A |」前缀；剥完为空（后端只给了个「A |」）时保留原文，避免渲染出空胶囊 */
export function stripOptionPrefix(label?: string | null): string {
  const original = String(label ?? "").trim();
  if (!original) return "";
  const stripped = original.replace(OPTION_PREFIX_PATTERN, "").trim();
  return stripped || original;
}

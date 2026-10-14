/** DOM id 里只留 [A-Za-z0-9_-]：id 会被拼进 `#id` 选择器，点号、冒号等字符会破坏选择器 */
function sanitizeDomId(value: unknown): string {
  return String(value ?? "").trim().replace(/[^\w-]/g, "_");
}

/**
 * 核对卡（步骤详情卡）在 DOM 上的唯一 id。
 *
 * block id 是按内容生成的（`guide-check-<step_id>`）：同一份作业指导被反复触发时，
 * 多轮消息里的卡片会拿到同一个 id，而 scroll-into-view / 选择器定位只会命中第一个同 id 元素，
 * 于是定位总是落到最早那张卡上。渲染时把所属消息 id 并进来做区分。
 * 滚动定位（消息列表、chat store 的 focusStepBlock）必须用同一个函数拼，才能指到同一张卡。
 */
export function guideStepCardDomId(messageId: unknown, blockId: unknown): string {
  const block = sanitizeDomId(blockId);
  if (!block) return "";
  const message = sanitizeDomId(messageId);
  return message ? `${block}--m-${message}` : block;
}

/**
 * 部分模型会把原始 URL 包成 Markdown 链接；仅剥掉外层语法，不改写实际地址。
 */
export function normalizeGuideUrl(value: unknown): string {
  const source = String(value || "").trim();
  const matched = /^\[https?:\/\/[^\]]+\]\((https?:\/\/[^)]+)\)(.*)$/.exec(source);
  if (!matched) return source;
  const suffix = matched[2].trim();
  return suffix ? `${matched[1]} ${suffix}` : matched[1];
}

/** GUIDE 正文图片和来源图片共用同一套预览、切换及关闭交互。 */
export function previewGuideImages(current: unknown, values: unknown[]) {
  const urls = values.map(normalizeGuideUrl).filter(Boolean);
  const currentUrl = normalizeGuideUrl(current);
  if (!currentUrl || !urls.length) return;
  uni.previewImage({ current: currentUrl, urls });
}

/** 点击来源卡时打开原件；非 H5 环境无法直接开外链时复制地址。 */
export function openGuideResource(value: unknown) {
  const url = normalizeGuideUrl(value);
  if (!url) return;

  // #ifdef H5
  const opened = window.open(url, "_blank");
  if (opened) {
    opened.opener = null;
    return;
  }
  // #endif

  uni.setClipboardData({
    data: url,
    success: () => uni.showToast({ title: "链接已复制", icon: "none" }),
  });
}

/**
 * 复制来源地址并提示。
 * PDF 这类文件不点开（H5 里会整页跳走或直接触发下载），统一复制链接交给用户自己粘贴。
 */
export function copyGuideResource(value: unknown) {
  const url = normalizeGuideUrl(value);
  if (!url) return;
  uni.setClipboardData({
    data: url,
    success: () => uni.showToast({ title: "链接已复制", icon: "none", duration: 1500 }),
    fail: () => uni.showToast({ title: "复制失败，请重试", icon: "none", duration: 1500 }),
  });
}

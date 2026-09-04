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

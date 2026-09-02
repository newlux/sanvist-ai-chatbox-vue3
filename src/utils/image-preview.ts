import { createLogger } from "@/utils/logger";

const logger = createLogger("image-preview");

/** 已转换过的 blob URL 缓存：同一地址多次失败/成功不再重复 fetch */
const blobCache = new Map<string, string>();

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

/**
 * 把可能带 `Content-Disposition: attachment` 的原始图片地址，
 * 通过 fetch + blob 换成可内联显示的本地地址。
 *
 * 背景：COS/网关对部分对象默认按附件下发（attachment 头），
 * Chrome 靠缓存或宽松嗅探能显示，Firefox/Safari 等会直接触发下载。
 * `<img>` 无法携带自定义请求头，但 blob URL 一定能被 img 渲染，
 * 因此这里用 fetch 把字节取回来转成 objectURL 作为最终兜底。
 *
 * 依赖 CORS：COS 桶需允许跨域 GET（通常已配置），失败时原样返回原地址。
 */
export async function toInlineImageUrl(url: string): Promise<string> {
  if (!url || !isHttpUrl(url)) return url;
  const cached = blobCache.get(url);
  if (cached) return cached;
  try {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.size) throw new Error("empty blob");
    const objectUrl = URL.createObjectURL(blob);
    blobCache.set(url, objectUrl);
    logger.info("[image-preview] inline via blob", {
      url: url.slice(0, 160),
      size: blob.size,
      type: blob.type,
    });
    return objectUrl;
  } catch (error) {
    logger.warn("[image-preview] fetch blob failed, keep original url", {
      url: url.slice(0, 160),
      error,
    });
    return url;
  }
}

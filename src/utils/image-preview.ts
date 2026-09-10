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
 * 注意：仅对同源地址执行 fetch + blob。跨域直链（如 OSS 签名 URL）在服务端
 * 未配置 CORS 时 fetch 必被浏览器拦截并在 console 报 CORS 错误（try/catch
 * 无法抑制），而这类地址通常以 Content-Disposition: inline 返回、可被
 * `<img>` 直接渲染，无需转 blob。若服务端已配 CORS（ACAO），可放开此处。
 */
export async function toInlineImageUrl(url: string): Promise<string> {
  if (!url || !isHttpUrl(url)) return url;
  const cached = blobCache.get(url);
  if (cached) return cached;
  // 跨域直链不 fetch：服务端无 CORS 时必然失败且每次都在 console 报错
  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";
  if (currentOrigin && new URL(url, window.location.href).origin !== currentOrigin) {
    logger.info("[image-preview] skip cross-origin fetch, render via <img>", {
      url: url.slice(0, 160),
    });
    return url;
  }
  try {
    const response = await fetch(url);
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



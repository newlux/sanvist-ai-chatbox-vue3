import { createApp, reactive } from "vue";
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

export interface OpenImagePreviewOptions {
  /** 图片地址列表 */
  urls: string[];
  /** 当前图片：URL 字符串（H5 习惯）或数字索引（media-picker 习惯），统一在内部归一化为索引 */
  current?: string | number;
  /** 每张图的说明文字（与 urls 对应），显示在图片下方；不传则不显示标题 */
  captions?: Array<string | null | undefined>;
}

/**
 * 全屏预览共享状态（模块级单例）。
 * 组件（src/components/image-preview/index.vue）以 prop 接收这个响应式对象直接渲染，
 * 避免 createApp 动态挂载时反复传 props 或依赖组件内部自管理。
 */
export interface ImagePreviewState {
  visible: boolean;
  urls: string[];
  current: number;
  /** 每张图的说明文字（与 urls 对应），显示在图片下方 */
  captions: string[];
}

const previewState: ImagePreviewState = reactive({
  visible: false,
  urls: [],
  current: 0,
  captions: [],
});

/** 关闭当前预览（组件点击关闭/遮罩时调用） */
export function closeImagePreview(): void {
  previewState.visible = false;
}

/** 供组件读取共享状态（避免组件反向 import 造成循环依赖，通过 prop 传入更直接） */
export function getImagePreviewState(): ImagePreviewState {
  return previewState;
}

/** 把 current 归一化为数组索引：字符串用 indexOf 定位，数字直接取，越界/找不到回落 0 */
function normalizeIndex(urls: string[], current?: string | number): number {
  if (typeof current === "number") {
    return Math.max(0, Math.min(current, urls.length - 1));
  }
  if (typeof current === "string") {
    const idx = urls.indexOf(current);
    return idx >= 0 ? idx : 0;
  }
  return 0;
}

/**
 * 全屏图片预览（H5 端自定义，其他端回退 uni.previewImage）。
 *
 * H5 端 uni 内建 uni.previewImage 的预览层 z-index 只有 999，会被本项目的
 * 页面 header（z-index 1010）等更高层级盖住，表现为「预览出现在顶部 header 下发」；
 * 且其关闭按钮固定右上角、背景为半透明黑，均不符合需求。
 * 这里改用项目自定义的全屏预览组件（src/components/image-preview/index.vue），
 * 用原生 DOM 元素 + 独立 createApp 单例挂载到 document.body，实现全屏覆盖、
 * 左上角关闭、不透明背景、左右切换。
 */
export function openImagePreview({ urls, current, captions }: OpenImagePreviewOptions): void {
  const list = (urls || []).filter(Boolean);
  if (!list.length) return;
  // 说明文字与 urls 对齐（截断到 urls 长度，避免错位）
  const captionList = (captions || []).slice(0, list.length).map((c) => String(c || ""));

  // #ifdef H5
  previewState.urls = list;
  previewState.current = normalizeIndex(list, current);
  previewState.captions = captionList;
  previewState.visible = true;
  void ensureH5Mounted();
  // #endif

  // #ifndef H5
  uni.previewImage({ urls: list, current: normalizeIndex(list, current) });
  // #endif
}

// H5 端单例挂载：首次用 createApp 动态挂载到 document.body，之后只更新共享状态并显示。
let h5Mounted = false;
let h5RootEl: HTMLDivElement | null = null;
let h5App: { unmount: () => void } | null = null;

async function ensureH5Mounted() {
  if (h5Mounted) return;
  const { default: ImagePreview } = await import("@/components/image-preview/index.vue");

  const host = document.createElement("div");
  host.id = "app-image-preview-host";
  document.body.appendChild(host);

  // 通过 prop 传入共享响应式状态，组件直接读它渲染；关闭时组件内部调 closeImagePreview 更新状态
  const app = createApp(ImagePreview, { state: previewState });
  app.mount(host);

  h5App = app;
  h5RootEl = host;
  h5Mounted = true;
  logger.info("[image-preview] H5 preview mounted");
}

/** 卸载 H5 单例（测试/异常时用，正常不调用） */
export function destroyH5Preview(): void {
  if (!h5Mounted) return;
  h5App?.unmount();
  h5RootEl?.remove();
  h5App = null;
  h5RootEl = null;
  h5Mounted = false;
}

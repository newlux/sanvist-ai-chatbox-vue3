import type { ChatFile } from "@/api/chat/types";
import type { ChatMessageAttachment } from "@/stores/chat-types";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { getCosPresignedDownloadUrl } from "@/api/chat";
import { createLogger } from "@/utils/logger";
import { getRequestHeaders } from "@/utils/request";

import {
  chooseNativeFiles,
  waitForMpaas,
  type NativeSelectedFile,
} from "@/utils/platform/mpaas";

const logger = createLogger("attachments");

export const MAX_ATTACHMENT_COUNT = 3;

/**
 * 允许上传的文件后缀白名单。
 * 与端上 FileUploadInterceptor#DEFAULT_ALLOWED_EXTENSIONS 一一对应，
 * 原生选择器（imageChoose.fileTypes）与前端本地校验共用这一份清单。
 */
export const DEFAULT_ALLOWED_EXTENSIONS = [
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg",
  "pdf",
  "doc", "docx",
  "xls", "xlsx",
  "ppt", "pptx",
  "txt", "md", "csv",
  "mp3", "wav", "m4a", "aac", "ogg", "flac", "wma",
  "mp4", "mov", "avi", "mkv", "webm", "flv", "wmv",
] as const;

/** 原生选择器 fileTypes：逗号分隔的完整白名单（文件选择用） */
export const DEFAULT_ALLOWED_FILE_TYPES = DEFAULT_ALLOWED_EXTENSIONS.join(",");

/** 纯图片选择（showFile=false）时的类型白名单 */
const ALLOWED_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] as const;
export const DEFAULT_ALLOWED_IMAGE_TYPES = ALLOWED_IMAGE_EXTENSIONS.join(",");

const ALLOWED_EXTENSION_SET = new Set<string>(DEFAULT_ALLOWED_EXTENSIONS);

type AttachmentKind = "image" | "audio" | "video" | "document" | "custom";

export interface ComposerAttachment {
  localId: string;
  /** 原生上传完成后的可访问地址，同时用于缩略图预览与发送 */
  localPath: string;
  /** 发送时作为 files[].url */
  url: string;
  /**
   * 预览回显地址：由 COS 预签名接口换取的可内联显示地址。
   * 上传返回的 url 可能带 Content-Disposition: attachment 无法内联预览。
   */
  previewPath?: string;
  name: string;
  size: number;
  extension: string;
  mimeType: string;
  type: AttachmentKind;
  /** 文件由原生完成上传，添加即完成，恒为 uploaded */
  status: "uploaded";
}

/**
 * 归类口径对齐服务端 files.type 的枚举：image / document / audio / video / custom。
 * 认不出的一律给 custom —— 这是协议里的合法取值，不要硬塞成 document，
 * 否则后端会拿一个非文档的文件去做文档解析。
 */
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "heic", "heif"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "wav", "webm", "amr", "mpga", "aac", "ogg", "opus", "flac"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "mpeg", "mpg", "avi", "mkv", "3gp"]);
const DOCUMENT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "mdx",
  "pdf",
  "html",
  "htm",
  "xlsx",
  "xls",
  "doc",
  "docx",
  "csv",
  "eml",
  "msg",
  "ppt",
  "pptx",
  "xml",
  "epub",
  "vtt",
  "properties",
]);

function createAttachmentLocalId() {
  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getFileExtension(name: string, path = "") {
  const source = String(name || path).split(/[?#]/)[0];
  const matched = /\.([^./]+)$/.exec(source);
  return String(matched?.[1] || "").trim().toLowerCase();
}

/**
 * 从原生 imageChoose 返回值中取出 objectKey（文件在存储桶里的路径+文件名）。
 *
 * 宿主回参有两种形态，都要兼容：
 * - 完整 URL：https://xxx.oss-cn-shanghai.aliyuncs.com/ai-files/2026/08/28/a.png
 *   → ai-files/2026/08/28/a.png（取路径部分）
 * - 纯对象路径：ai-files/2026/08/28/a.png 或 /ai-files/2026/08/28/a.png
 *   → 去掉开头 / 后原样返回（它本身就是 objectKey）
 */
function extractObjectKey(value: string) {
  if (!value) return "";
  const raw = String(value).split(/[?#]/)[0];
  // 没有协议头的就是对象路径本身，直接作为 objectKey
  if (!/^https?:\/\//i.test(raw)) return raw.replace(/^\//, "");
  try {
    const pathname = new URL(raw).pathname;
    return pathname.replace(/^\//, "");
  } catch {
    return raw.replace(/^\//, "");
  }
}

const DOCUMENT_MIME_HINTS = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/epub",
  "application/xml",
  "message/rfc822",
];

/**
 * 判定优先级：扩展名 > MIME。
 * 扩展名是文件真实身份最稳的线索；选择器给的 MIME 经常是
 * application/octet-stream 这种笼统值，先看它会把 docx、xlsx 全归成 custom。
 */
function inferAttachmentKind(extension: string, mimeType = ""): AttachmentKind {
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document";

  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("text/") || DOCUMENT_MIME_HINTS.some(hint => mime.startsWith(hint))) {
    return "document";
  }
  return "custom";
}

export function formatFileSize(size: number) {
  if (!size || size <= 0) return "";
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

/** 文件由原生完成上传，展示体积即可 */
export function formatAttachmentStatus(attachment: ComposerAttachment) {
  return formatFileSize(attachment.size) || "已上传";
}

/** 输入栏的附件选择（全部经由原生 imageChoose，由原生完成上传） */
export function useComposerAttachments() {
  const { t } = useI18n();

  function toastLimit() {
    uni.showToast({ title: t("attachment-limit", { count: MAX_ATTACHMENT_COUNT }), icon: "none" });
  }
  const attachments = ref<ComposerAttachment[]>([]);

  const hasAttachments = computed(() => attachments.value.length > 0);
  // 文件由原生完成上传，附件加入即可发送：不存在「上传中 / 上传失败」状态。
  // 保留这两个字段以兼容发送前的校验逻辑（恒为 false）。
  const hasIncompleteAttachments = computed(() => false);
  const hasFailedAttachments = computed(() => false);
  const isLimitReached = computed(() => attachments.value.length >= MAX_ATTACHMENT_COUNT);

  function findAttachment(localId: string) {
    return attachments.value.find(item => item.localId === localId);
  }

  /**
   * 通过 COS 预签名接口换取可内联预览的实际图片地址。
   * 上传返回的 url 可能带 Content-Disposition: attachment 导致浏览器不渲染，
   * 预签名 URL 用于缩略图与大图预览。
   */
  async function refreshAttachmentPreviewUrl(localId: string) {
    const attachment = findAttachment(localId);
    if (!attachment?.url || attachment.previewPath) return;
    const objectKey = extractObjectKey(attachment.url);
    logger.info("[attachment] refresh preview url start", {
      localId,
      url: attachment.url,
      objectKey,
    });
    if (!objectKey) {
      logger.warn("[attachment] refresh preview url skipped: empty objectKey", {
        localId,
        url: attachment.url,
      });
      return;
    }
    // 确认请求确实带上了登录凭证（只打印前缀与长度，不输出完整 token）
    const headers = getRequestHeaders() as Record<string, string>;
    const authValue = String(headers.Authorization || "");
    logger.info("[attachment] presigned request auth", {
      hasAuthorization: Boolean(authValue),
      scheme: authValue.split(" ")[0] || "",
      tokenLength: authValue.split(" ")[1]?.length || 0,
    });

    try {
      const presigned = await getCosPresignedDownloadUrl(objectKey);
      logger.info("[attachment] presigned url response", {
        localId,
        objectKey,
        bucket: presigned?.bucket,
        region: presigned?.region,
        fileUrl: presigned?.fileUrl,
        expireTime: presigned?.expireTime,
        hasPresignedUrl: Boolean(presigned?.presignedUrl),
      });
      const current = findAttachment(localId);
      if (!current) return;
      // 预览地址优先用带签名的 presignedUrl（响应 data.presignedUrl）；
      // 缺失时回退 fileUrl（响应 data.fileUrl，不带签名的原始对象地址）
      const previewUrl = presigned?.presignedUrl || presigned?.fileUrl || "";
      if (!previewUrl) {
        logger.warn("[attachment] presigned url missing, keep original url", { localId });
        return;
      }
      current.previewPath = previewUrl;
      logger.info("[attachment] preview url refreshed", {
        localId,
        from: presigned?.presignedUrl ? "presignedUrl" : "fileUrl",
        previewPath: current.previewPath,
      });
    } catch (error) {
      logger.warn("[attachment] fetch presigned url failed", { localId, objectKey, error });
    }
  }

  /**
   * 原生 imageChoose 回参整理：原生弹窗已完成选择与上传，回参即最终 URL。
   * 直接生成 uploaded 附件，前端不再做任何文件传输。
   */
  function appendNativeUploadedFiles(files: NativeSelectedFile[]) {
    const remaining = MAX_ATTACHMENT_COUNT - attachments.value.length;
    if (remaining <= 0) {
      toastLimit();
      return;
    }
    const accepted = files.slice(0, remaining);
    if (files.length > remaining) toastLimit();

    accepted.forEach((file, index) => {
      if (!file.url) {
        logger.warn("[attachment] skip native file: empty url", { index, file });
        return;
      }

      // 类型白名单校验：原生回参通常带扩展名；无扩展名时按图片 MIME 放行
      const extension = getFileExtension(file.name || "", file.url);
      const inWhitelist = ALLOWED_EXTENSION_SET.has(extension);
      const mimeIsImage = String(file.mimeType || "").toLowerCase().startsWith("image/");
      const isAllowed = inWhitelist || (!extension && mimeIsImage);

      logger.info("[attachment] native file received", {
        index,
        url: file.url,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
        extension,
        inWhitelist,
        mimeIsImage,
        isAllowed,
      });

      if (!isAllowed) {
        logger.warn("[attachment] reject by whitelist", {
          url: file.url,
          name: file.name,
          extension,
          mimeType: file.mimeType,
        });
        uni.showToast({ title: t("attachment-type-unsupported"), icon: "none" });
        return;
      }

      const type = inferAttachmentKind(extension, file.mimeType);
      const fallbackName = type === "image"
        ? `图片-${index + 1}.${extension || "jpg"}`
        : `附件-${index + 1}${extension ? `.${extension}` : ""}`;

      const localId = createAttachmentLocalId();
      attachments.value.push({
        localId,
        // 原生已上传，localPath 与 url 都指向最终地址，预览与发送直接可用
        localPath: file.url,
        url: file.url,
        name: file.name || fallbackName,
        size: Number(file.size) || 0,
        extension,
        mimeType: file.mimeType || "",
        type,
        status: "uploaded",
      });
      logger.info("[attachment] appended native-uploaded file", {
        localId,
        url: file.url,
        name: attachments.value[attachments.value.length - 1].name,
        extension,
        type,
        size: file.size,
        total: attachments.value.length,
      });
      // 换取 COS 预签名地址用于可内联预览
      void refreshAttachmentPreviewUrl(localId);
    });
  }

  /**
   * 选择照片/拍照：走原生 imageChoose（showFile=false，仅图片），
   * 原生弹窗自带来源选择，选择后由原生完成上传。
   */
  async function chooseImages(sourceType: Array<"album" | "camera">) {
    const count = Math.max(1, MAX_ATTACHMENT_COUNT - attachments.value.length);
    logger.info("[attachment] chooseImages start", {
      sourceType,
      currentCount: attachments.value.length,
      limit: MAX_ATTACHMENT_COUNT,
      requestCount: count,
    });

    // 等待 bridge 注入窗口，避免用户点击时 bridge 尚未就绪而白白错过原生弹窗
    const bridge = await waitForMpaas(2000);
    logger.info("[attachment] chooseImages bridge ready", { ready: Boolean(bridge) });
    if (!bridge) {
      logger.warn("[attachment] native picker unavailable, skip chooseImages", { sourceType });
      return;
    }

    try {
      const params = {
        showFile: false,
        fileTypes: DEFAULT_ALLOWED_IMAGE_TYPES,
        nativeUploaded: true,
      };
      logger.info("[attachment] chooseImages -> imageChoose", { count, params });
      const files = await chooseNativeFiles(count, params);
      logger.info("[attachment] native imageChoose result", {
        mode: "image",
        count: files.length,
        files: files.map(f => ({ url: f.url, name: f.name, size: f.size, mimeType: f.mimeType })),
      });
      appendNativeUploadedFiles(files);
      logger.info("[attachment] chooseImages done", { total: attachments.value.length });
    } catch (error) {
      logger.error("[attachment] native imageChoose failed", error);
    }
  }

  /**
   * 文件/图片混合选择：走原生 imageChoose（showFile=true + fileTypes 白名单），
   * 由原生弹窗完成选择与上传。
   */
  async function chooseFilesFromNative() {
    const count = Math.max(1, MAX_ATTACHMENT_COUNT - attachments.value.length);
    logger.info("[attachment] chooseFilesFromNative start", {
      currentCount: attachments.value.length,
      limit: MAX_ATTACHMENT_COUNT,
      requestCount: count,
    });

    // 等待 bridge 注入窗口
    const bridge = await waitForMpaas(2000);
    logger.info("[attachment] chooseFilesFromNative bridge ready", { ready: Boolean(bridge) });
    if (!bridge) {
      logger.warn("[attachment] native picker unavailable, skip chooseFilesFromNative");
      return;
    }

    try {
      const params = {
        showFile: true,
        fileTypes: DEFAULT_ALLOWED_FILE_TYPES,
        nativeUploaded: true,
      };
      logger.info("[attachment] chooseFilesFromNative -> imageChoose", { count, params });
      const files = await chooseNativeFiles(count, params);
      logger.info("[attachment] native imageChoose result", {
        mode: "file+image",
        count: files.length,
        files: files.map(f => ({ url: f.url, name: f.name, size: f.size, mimeType: f.mimeType })),
      });
      appendNativeUploadedFiles(files);
      logger.info("[attachment] chooseFilesFromNative done", { total: attachments.value.length });
    } catch (error) {
      logger.error("[attachment] native imageChoose failed", error);
    }
  }

  /**
   * 原生 imageChoose 是否可用（等待 bridge 注入窗口）。
   * 用于组件决定：优先触发原生弹窗（imageChoose 自带拍照/相册/文件），还是回退到前端三选项弹窗。
   */
  function isNativePickerAvailable() {
    return waitForMpaas(2000).then(Boolean);
  }

  /** 触发原生选择器；已达上限时只提示 */
  async function openAttachmentPicker() {
    if (isLimitReached.value) {
      toastLimit();
      return;
    }
    await chooseFilesFromNative();
  }

  function removeAttachment(localId: string) {
    attachments.value = attachments.value.filter(item => item.localId !== localId);
  }

  function clearAttachments() {
    attachments.value = [];
  }

  /**
   * 取出可提交的附件并清空输入栏。
   * files 按网关的 SendFile 契约（type/transferMethod/url）；
   * meta 多带名称体积，用于消息气泡展示和 inputs 透传。
   */
  function takeUploadedFiles(): { files: ChatFile[]; meta: ChatMessageAttachment[] } {
    logger.info("[attachment] takeUploadedFiles start", { total: attachments.value.length });
    const uploaded = attachments.value.filter(item => item.url);
    // type 直接用归类结果（含 custom），transferMethod 固定 remote_url——
    // 文件已由原生上传，这里给的是可访问地址
    const files = uploaded.map(item => ({
      type: item.type,
      transferMethod: "remote_url" as const,
      url: item.url,
    }));
    const meta = uploaded.map(item => ({
      url: item.url,
      name: item.name,
      type: item.type,
      size: item.size,
      mimeType: item.mimeType,
    }));
    logger.info("[attachment] takeUploadedFiles result", { files, meta });
    clearAttachments();
    return { files, meta };
  }

  return {
    attachments,
    hasAttachments,
    hasIncompleteAttachments,
    hasFailedAttachments,
    openAttachmentPicker,
    isNativePickerAvailable,
    chooseImages,
    chooseFilesFromNative,
    removeAttachment,
    clearAttachments,
    takeUploadedFiles,
  };
}

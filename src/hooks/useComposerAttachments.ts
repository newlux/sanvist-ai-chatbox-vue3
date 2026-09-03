import type { ChatFile } from "@/api/chat/types";
import type { ChatMessageAttachment } from "@/stores/chat-types";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { uploadChatFile } from "@/api/chat";
import { useUserStore } from "@/stores";
import { createLogger } from "@/utils/logger";

import {
  chooseNativeFiles,
  ensureNativePermission,
  isMpaasReady,
  permissionDeniedMessage,
  waitForMpaas,
  type NativeSelectedFile,
} from "@/utils/platform/mpaas";

const logger = createLogger("attachments");

export const MAX_ATTACHMENT_COUNT = 3;
/** 低版本降级路径（uni.chooseImage / chooseFile）的本地文件大小上限 */
const MAX_LOCAL_FILE_SIZE = 50 * 1024 * 1024;

/**
 * 是否强制走 H5 低版本自定义上传（uni.chooseImage / uni.chooseFile + /files/upload）。
 *
 * 当前需求：附件上传一律走 H5 上传，不再走原生 imageChoose（原生选择 + 原生上传 + COS 预签名）；
 * 回显直接用 /files/upload 返回的 url，不再调 COS 预签名 download 接口。
 * 原生相关代码（chooseNativeFiles / appendNativeUploadedFiles 等）全部保留备用，
 * 后续要恢复「原生优先」时改回 false 即可。
 */
const FORCE_H5_UPLOAD = true;

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
type AttachmentStatus = "uploading" | "uploaded" | "failed";

export interface ComposerAttachment {
  localId: string;
  /** Dify 文件 id：上传接口回填，图片展示走 GET /files/{file_id}/preview 鉴权拉取 */
  fileId: string;
  /** 原生上传完成后是可访问地址；低版本降级上传是本地临时路径，用于缩略图预览与失败重传 */
  localPath: string;
  /** 发送时作为 files[].url */
  url: string;
  /**
   * 预览回显地址。现在直接使用上传返回的 url 回显（不再走 COS 预签名接口），
   * 该字段保留以兼容历史消息里已有的预签名/blob 地址。
   */
  previewPath?: string;
  name: string;
  size: number;
  extension: string;
  mimeType: string;
  type: AttachmentKind;
  /** 原生路径恒为 uploaded（原生已完成上传）；低版本降级路径维护真实上传状态 */
  status: AttachmentStatus;
  error?: string;
  /**
   * H5 选择时保留的原生 File 对象：上传时直接透传给 uni.uploadFile，
   * 保证 multipart 里的文件名与 MIME 完整（避免 blob URL 二次转换退化）。
   */
  nativeFile?: File;
}

interface LocalSelectedFile {
  path: string;
  name: string;
  size: number;
  mimeType?: string;
  /** H5 选择器（uni.chooseFile / uni.chooseImage）回参里的原生 File 对象 */
  file?: File;
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

/**
 * 后缀白名单判定，原生与低版本降级两条入口共用同一份口径。
 * 扩展名优先命中 DEFAULT_ALLOWED_EXTENSIONS；
 * H5 选图回参常是 blob URL（拿不到后缀），这时按图片 MIME 放行，
 * 否则低版本 H5 选图会被整体误拒。
 */
function isAllowedExtension(extension: string, mimeType = "") {
  if (ALLOWED_EXTENSION_SET.has(extension)) return true;
  const mimeIsImage = String(mimeType || "").toLowerCase().startsWith("image/");
  return !extension && mimeIsImage;
}

/** 低版本降级上传时 uni.uploadFile 需要的 fileType */
function toUploadFileType(kind: AttachmentKind) {
  if (kind === "video") return "video" as const;
  if (kind === "audio") return "audio" as const;
  return "image" as const;
}

export function formatFileSize(size: number) {
  if (!size || size <= 0) return "";
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

/** 预览条上的副标题：上传中显示状态，失败提示重试，完成后显示体积 */
export function formatAttachmentStatus(attachment: ComposerAttachment) {
  if (attachment.status === "uploading") return "上传中...";
  if (attachment.status === "failed") return "上传失败，点击重试";
  return formatFileSize(attachment.size) || "已上传";
}

/**
 * 输入栏的附件选择与上传：
 * - 原生 mPaaS 可用：走原生 imageChoose（原生弹窗完成选择 + 原生完成上传，恒 uploaded）
 * - 原生不可用（低版本系统 / 普通 H5 / bridge 未注入）：降级到 uni 标准选择 + /files/upload 上传
 */
export function useComposerAttachments() {
  const { t } = useI18n();
  const userStore = useUserStore();

  function toastLimit() {
    uni.showToast({ title: t("attachment-limit", { count: MAX_ATTACHMENT_COUNT }), icon: "none" });
  }
  const attachments = ref<ComposerAttachment[]>([]);

  const hasAttachments = computed(() => attachments.value.length > 0);
  // 原生路径恒为 uploaded；低版本降级路径存在「上传中 / 上传失败」状态，发送前需校验
  const hasIncompleteAttachments = computed(() =>
    attachments.value.some(item => item.status !== "uploaded"),
  );
  const hasFailedAttachments = computed(() =>
    attachments.value.some(item => item.status === "failed"),
  );
  const isLimitReached = computed(() => attachments.value.length >= MAX_ATTACHMENT_COUNT);

  function findAttachment(localId: string) {
    return attachments.value.find(item => item.localId === localId);
  }

  /** 低版本降级路径：把本地选择的文件走 /files/upload 上传到网关，维护真实上传状态 */
  async function uploadAttachment(localId: string) {
    const attachment = findAttachment(localId);
    if (!attachment) return;

    attachment.status = "uploading";
    attachment.error = undefined;

    try {
      const uploaded = await uploadChatFile({
        filePath: attachment.localPath,
        // H5 下优先透传原生 File，保证文件名/MIME 完整，避免网关「file不能为空」
        file: attachment.nativeFile,
        // 网关校验非空：游客态没有用户 ID 时用固定占位
        user: String(userStore.userId || "guest"),
        fileType: toUploadFileType(attachment.type),
      });
      // 上传期间用户可能已移除该附件
      const current = findAttachment(localId);
      if (!current) return;
      // Dify 上传响应：id（file_id）+ source_url；无 id 也无 url 视为失败
      const uploadedId = String(uploaded?.id || uploaded?.fileId || "");
      const uploadedUrl = uploaded?.source_url || uploaded?.url || "";
      if (!uploadedId && !uploadedUrl) throw new Error(t("upload-result-missing-url"));

      current.fileId = uploadedId;
      current.url = uploadedUrl;
      current.name = uploaded.name || current.name;
      current.size = Number(uploaded.size) || current.size;
      current.extension = uploaded.extension || current.extension;
      current.mimeType = uploaded.mime_type || uploaded.mimeType || current.mimeType;
      current.type = inferAttachmentKind(current.extension, current.mimeType);
      current.status = "uploaded";
    } catch (error) {
      const current = findAttachment(localId);
      if (!current) return;
      const message = error instanceof Error ? error.message : t("upload-failed");
      current.status = "failed";
      current.error = message;
      logger.error("upload failed", error);
      uni.showToast({ title: message.slice(0, 28), icon: "none", duration: 2500 });
    }
  }

  /** 低版本降级路径：本地选择文件整理成附件并逐个触发上传 */
  function appendSelectedFiles(files: LocalSelectedFile[]) {
    const remaining = MAX_ATTACHMENT_COUNT - attachments.value.length;
    if (remaining <= 0) {
      toastLimit();
      return;
    }
    const accepted = files.slice(0, remaining);
    if (files.length > remaining) toastLimit();

    accepted.forEach((file, index) => {
      if (!file.path) return;
      if (file.size > MAX_LOCAL_FILE_SIZE) {
        uni.showToast({ title: t("attachment-oversize", { name: file.name || "文件" }), icon: "none" });
        return;
      }

      const extension = getFileExtension(file.name, file.path);
      // 后缀白名单：与原生选择器 fileTypes 同一份清单，不支持的直接拒绝并提示
      if (!isAllowedExtension(extension, file.mimeType)) {
        logger.warn("[attachment] reject by whitelist", {
          path: file.path,
          name: file.name,
          extension,
          mimeType: file.mimeType,
        });
        uni.showToast({ title: t("attachment-type-unsupported"), icon: "none" });
        return;
      }

      const type = inferAttachmentKind(extension, file.mimeType);
      const localId = createAttachmentLocalId();
      const fallbackName = type === "image"
        ? `图片-${index + 1}.${extension || "jpg"}`
        : `附件-${index + 1}${extension ? `.${extension}` : ""}`;

      attachments.value.push({
        localId,
        fileId: "",
        localPath: file.path,
        url: "",
        name: file.name || fallbackName,
        size: Number(file.size) || 0,
        extension,
        mimeType: file.mimeType || "",
        type,
        status: "uploading",
        nativeFile: file.file,
      });
      void uploadAttachment(localId);
    });
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

      // 类型白名单校验：与低版本降级路径共用同一份口径
      const extension = getFileExtension(file.name || "", file.url);
      const isAllowed = isAllowedExtension(extension, file.mimeType);

      logger.info("[attachment] native file received", {
        index,
        url: file.url,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
        extension,
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
        fileId: "",
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
    });
  }

  /** 低版本降级：uni.chooseImage 选择照片/拍照，再走 /files/upload 上传 */
  async function chooseImagesViaUni(sourceType: Array<"album" | "camera">) {
    // 容器里先向原生要权限：安卓 WebView 不先授权的话，选图/拍照会被静默拒绝
    const permission = sourceType.includes("camera") ? "camera" : "photo";
    if (!await ensureNativePermission(permission)) {
      uni.showToast({ title: permissionDeniedMessage(permission), icon: "none" });
      return;
    }

    const count = Math.max(1, MAX_ATTACHMENT_COUNT - attachments.value.length);
    uni.chooseImage({
      count,
      sourceType,
      sizeType: ["compressed", "original"],
      success: (result) => {
        // H5 下 tempFiles 元素就是原生 File 对象：保留引用，上传时透传避免文件名退化
        const tempFiles = (result.tempFiles || []) as Array<{
          path?: string;
          size?: number;
          name?: string;
          type?: string;
        }>;
        const paths = Array.isArray(result.tempFilePaths)
          ? result.tempFilePaths
          : [result.tempFilePaths].filter(Boolean) as string[];
        appendSelectedFiles(paths.map((path, index) => ({
          path: String(path),
          name: String(tempFiles[index]?.name || ""),
          size: Number(tempFiles[index]?.size) || 0,
          mimeType: String(tempFiles[index]?.type || "image/*"),
          file: tempFiles[index] as unknown as File | undefined,
        })));
      },
      fail: error => logger.warn("chooseImage failed", error),
    });
  }

  // #ifdef H5
  /** 低版本降级：H5 通用文件选择，再走 /files/upload 上传 */
  async function chooseFilesViaUni() {
    if (!await ensureNativePermission("photo")) {
      uni.showToast({ title: permissionDeniedMessage("photo"), icon: "none" });
      return;
    }

    const chooseFile = (uni as { chooseFile?: (options: Record<string, unknown>) => void }).chooseFile;
    if (typeof chooseFile !== "function") {
      uni.showToast({ title: t("file-select-unsupported"), icon: "none" });
      return;
    }
    chooseFile({
      count: Math.max(1, MAX_ATTACHMENT_COUNT - attachments.value.length),
      type: "all",
      // 选择器层面先过滤一轮（个别环境不认这个参数，appendSelectedFiles 还有一次白名单兜底）
      extension: DEFAULT_ALLOWED_EXTENSIONS.map(ext => `.${ext}`),
      success: (result: { tempFiles?: Array<Record<string, unknown>> }) => {
        appendSelectedFiles((result.tempFiles || []).map(file => ({
          path: String(file.path || ""),
          name: String(file.name || ""),
          size: Number(file.size) || 0,
          mimeType: String(file.type || ""),
          // H5 下 tempFiles 元素就是原生 File 对象本身，直接透传
          file: file as unknown as File | undefined,
        })));
      },
      fail: (error: unknown) => logger.warn("chooseFile failed", error),
    });
  }
  // #endif

  /**
   * 选择照片/拍照：默认优先走原生 imageChoose（showFile=false，仅图片，原生完成上传）；
   * 原生不可用（低版本容器 / 普通 H5）时降级到 uni.chooseImage + /files/upload。
   * FORCE_H5_UPLOAD=true 时强制走 uni.chooseImage（原生分支保留备用）。
   */
  async function chooseImages(sourceType: Array<"album" | "camera">) {
    const count = Math.max(1, MAX_ATTACHMENT_COUNT - attachments.value.length);
    logger.info("[attachment] chooseImages start", {
      sourceType,
      currentCount: attachments.value.length,
      limit: MAX_ATTACHMENT_COUNT,
      requestCount: count,
    });

    // 强制 H5 上传：直接走 uni.chooseImage（拍照/相册）+ /files/upload
    if (FORCE_H5_UPLOAD) {
      logger.warn("[attachment] FORCE_H5_UPLOAD, skip native imageChoose", { sourceType });
      await chooseImagesViaUni(sourceType);
      return;
    }

    // 等待 bridge 注入窗口，避免用户点击时 bridge 尚未就绪而白白错过原生弹窗
    const bridge = await waitForMpaas(2000);
    logger.info("[attachment] chooseImages bridge ready", { ready: Boolean(bridge) });
    if (!bridge) {
      // 原生不可用：降级到 uni 标准选择 + /files/upload 上传（低版本兼容）
      logger.warn("[attachment] native picker unavailable, fallback to uni.chooseImage", { sourceType });
      await chooseImagesViaUni(sourceType);
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
   * 文件/图片混合选择：默认优先走原生 imageChoose（showFile=true + fileTypes 白名单，原生完成上传）；
   * 原生不可用（低版本容器 / 普通 H5）时降级到 H5 文件选择 + /files/upload。
   * FORCE_H5_UPLOAD=true 时强制走 H5 文件选择（原生分支保留备用）。
   */
  async function chooseFilesFromNative() {
    const count = Math.max(1, MAX_ATTACHMENT_COUNT - attachments.value.length);
    logger.info("[attachment] chooseFilesFromNative start", {
      currentCount: attachments.value.length,
      limit: MAX_ATTACHMENT_COUNT,
      requestCount: count,
    });

    // 强制 H5 上传：直接走 H5 通用文件选择 + /files/upload（原生 imageChoose 分支保留备用）
    // #ifdef H5
    if (FORCE_H5_UPLOAD) {
      logger.warn("[attachment] FORCE_H5_UPLOAD, skip native imageChoose");
      await chooseFilesViaUni();
      return;
    }
    // #endif

    // 等待 bridge 注入窗口
    const bridge = await waitForMpaas(2000);
    logger.info("[attachment] chooseFilesFromNative bridge ready", { ready: Boolean(bridge) });
    if (!bridge) {
      // 原生不可用：降级到 H5 通用文件选择 + /files/upload 上传（低版本兼容）
      logger.warn("[attachment] native picker unavailable, fallback to uni file picker");
      // #ifdef H5
      await chooseFilesViaUni();
      // #endif
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
   * FORCE_H5_UPLOAD=true 时恒为 false：一律走前端三选项弹窗（拍照/相册/文件，
   * 分别落到 uni.chooseImage 的 camera/album 与 uni.chooseFile）。
   */
  function isNativePickerAvailable() {
    // 强制 H5 上传期间，不让 UI 直接触发原生弹窗，改由前端三选项弹窗分发到 H5 选择器
    if (FORCE_H5_UPLOAD) return Promise.resolve(false);
    return waitForMpaas(2000).then(Boolean);
  }

  /** 触发附件选择（含原生降级）；已达上限时只提示 */
  async function openAttachmentPicker() {
    if (isLimitReached.value) {
      toastLimit();
      return;
    }
    // 原生可用走原生（选择 + 上传一步完成）；不可用由 chooseFilesFromNative 内部降级
    await chooseFilesFromNative();
  }

  function removeAttachment(localId: string) {
    attachments.value = attachments.value.filter(item => item.localId !== localId);
  }

  function retryAttachment(localId: string) {
    void uploadAttachment(localId);
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
    const uploaded = attachments.value.filter(item => item.status === "uploaded" && item.url);
    // type 直接用归类结果（含 custom），transferMethod 固定 remote_url——
    // 文件已上传过，这里给的是可访问地址
    const files = uploaded.map(item => ({
      type: item.type,
      transferMethod: "remote_url" as const,
      url: item.url,
    }));
    const meta = uploaded.map(item => ({
      fileId: item.fileId,
      url: item.url,
      previewPath: item.previewPath,
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
    retryAttachment,
    clearAttachments,
    takeUploadedFiles,
  };
}

import type { ChatFile } from "@/api/chat/types";
import type { ChatMessageAttachment } from "@/stores/chat-types";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { uploadChatFile } from "@/api/chat";
import { useUserStore } from "@/stores";

import { createLogger } from "@/utils/logger";
import { getRequestBaseURL, getRequestHeaders } from "@/utils/request";
import {
  aiFileUploadNative,
  ensureNativePermission,
  imageChooseLocal,
  permissionDeniedMessage,
  waitForMpaas,
} from "@/utils/platform/mpaas";

const logger = createLogger("attachments");

export const MAX_ATTACHMENT_COUNT = 3;

/** 附件来源：前端三选项弹窗的三项，外加容器原生的合并入口 */
export type AttachmentSource = "camera" | "album" | "file" | "native";
/** 低版本降级路径（uni.chooseImage / chooseFile）的本地文件大小上限 */
const MAX_LOCAL_FILE_SIZE = 50 * 1024 * 1024;

/**
 * 允许上传的文件后缀白名单。
 * 与端上 FileUploadInterceptor#DEFAULT_ALLOWED_EXTENSIONS 一一对应，
 * 原生选择器（imageChoose.fileTypes）与前端本地校验共用这一份清单。
 */
export const DEFAULT_ALLOWED_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "md",
  "csv",
  "mp3",
  "wav",
  "m4a",
  "aac",
  "ogg",
  "flac",
  "wma",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "flv",
  "wmv",
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
  /** Dify 文件 id：上传接口回填，仅用于发送与后续历史预览。 */
  fileId: string;
  /**
   * 缩略图/预览地址（本地优先，不依赖网络）：
   * - 原生 mPaaS 链路：imageChoose(returnLocal) 返回的 base64 → data URL，无网即显
   * - H5 降级链路：uni.chooseImage/chooseFile 给的本地路径（blob: / tempFilePath），
   *   再经 FileReader 转本地 data URL
   * 发送时用 url，不读这里。
   */
  localPath: string;
  /**
   * 对话发送地址：
   * - 原生 mPaaS 链路：取 aiFileUpload 返回的 files[].source_url
   * - H5 降级链路：取 /files/upload 返回的 source_url
   */
  url: string;
  /** 兼容旧数据的预览地址；本次选择的图片始终使用 localPath 展示。 */
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
  /**
   * 上传用的原始本地路径：H5 下 localPath 会被 FileReader 换成 data URL 做缩略图，
   * 这里保留选择器给的原始地址（blob: / tempFilePath），供 uploadFile 使用。
   */
  uploadPath?: string;
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

/** H5 选择器给的是 blob: 临时地址：部分 WebView 的 uni-image 渲染不出来（消息里就是灰块） */
function isBlobUrl(path: string) {
  return /^blob:/.test(String(path || ""));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === "undefined") return Promise.resolve("");
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

/**
 * 附件缩略图地址：统一换成可直接渲染的 data URL。
 *
 * H5 下 uni.chooseImage / uni.chooseFile 给的本地地址是 `blob:` 临时 URL，
 * 部分 webview 的 uni-image 渲染不出来（空白/破图，消息里就是灰块）。
 * - 选择器给了原生 File → 直接 FileReader 转；
 * - 只给了 blob: 地址（个别版本 tempFiles 只是 {path}）→ fetch 回来再转，避免最终落到 blob: 上。
 * 非图片不转：base64 体积大，而文件类型本来走图标分支，不需要缩略图。
 */
async function readLocalPreviewSrc(file: LocalSelectedFile, type: AttachmentKind): Promise<string> {
  if (type !== "image") return "";
  const native = file.file;
  if (typeof Blob !== "undefined" && native instanceof Blob) {
    const converted = await blobToDataUrl(native);
    if (converted) return converted;
  }
  if (typeof fetch === "function" && isBlobUrl(file.path)) {
    try {
      const response = await fetch(file.path);
      return await blobToDataUrl(await response.blob());
    } catch (error) {
      logger.warn("[attachment] local preview fallback failed", error);
      return "";
    }
  }
  return "";
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

/**
 * 容器内原生附件选择器是否可用（等待 bridge 注入窗口）。
 * 单独导出是因为步骤卡要先判断「弹前端三选项弹窗」还是「直接走原生弹窗」，
 * 而它并不需要整个 hook 实例。
 */
export function isNativeAttachmentPickerAvailable() {
  return waitForMpaas(2000).then(Boolean);
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
  /** 缩略图转换是独立异步线：发送前要等它落地，否则消息里回显的还是 blob: 灰块 */
  const previewTasks = new Map<string, Promise<void>>();

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
        filePath: attachment.uploadPath || attachment.localPath,
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
        uploadPath: file.path,
        url: "",
        name: file.name || fallbackName,
        size: Number(file.size) || 0,
        extension,
        mimeType: file.mimeType || "",
        type,
        status: "uploading",
        nativeFile: file.file,
      });
      // H5 的 blob: 临时地址渲染不可靠，转成 data URL 后回填缩略图地址
      const previewTask = readLocalPreviewSrc(file, type).then((previewSrc) => {
        if (!previewSrc) return;
        const current = findAttachment(localId);
        if (current) current.localPath = previewSrc;
      });
      previewTasks.set(localId, previewTask);
      void uploadAttachment(localId);
    });
  }

  /**
   * WebView 原生附件：imageChoose(returnLocal) 选图 + aiFileUpload 上传。
   *
   * 预览与发送分两条线，避免互相干扰：
   * - 预览（localPath）：imageChoose 返回的 base64 → data URL，本地秒显、不依赖网络；
   *   没有 base64（如非图片文件）时回退到 picked.path（宿主端临时路径，缩略图组件走文件图标）。
   * - 发送（url）：aiFileUpload 返回的 files[].source_url，作为 Dify `remote_url` 的 url；
   *   files[].id 仅在没有 source_url 时兜底走 `local_file`。
   *
   * imageChoose 与 aiFileUpload 一一对应、按选中顺序回传，因此 files[i] ↔ uploaded[i] 直接配对。
   */
  async function chooseViaNative(options: { showFile: boolean; count: number }) {
    const files = await imageChooseLocal({
      count: options.count,
      showFile: options.showFile,
      fileTypes: options.showFile ? [...DEFAULT_ALLOWED_EXTENSIONS] : undefined,
    });

    if (!files.length) return;

    const uploadUrl = `${getRequestBaseURL().replace(/\/$/, "")}/proxy/v1/files/upload`;
    const headers = getRequestHeaders();
    const uploaded = await aiFileUploadNative({
      uploadUrl,
      headers,
      files: files.map(f => ({ path: f.path, uri: f.uri, name: f.name, type: f.type })),
    });

    if (!uploaded.length) {
      uni.showToast({ title: t("upload-failed"), icon: "none" });
      return;
    }

    const remaining = MAX_ATTACHMENT_COUNT - attachments.value.length;
    if (remaining <= 0) {
      toastLimit();
      return;
    }

    const pairs = uploaded.slice(0, remaining)
      .map((item, index) => ({ picked: files[index], uploaded: item }))
      .filter(pair => pair.uploaded && pair.picked);
    if (uploaded.length > pairs.length) toastLimit();

    pairs.forEach(({ picked, uploaded: up }) => {
      const extension = getFileExtension(up.name, picked.path || up.name);
      const mimeType = String(up.mime_type || picked.type || "");
      const type = inferAttachmentKind(extension, mimeType);

      // 预览源：imageChoose 给的 base64 直接拼 data URL；缺前缀时按 mime 补齐。
      // 没有 base64（如非图片）时退到 picked.path，让缩略图组件走文件图标分支。
      const base64 = String(picked.base64 || "");
      const previewSrc = base64
        ? (base64.startsWith("data:") ? base64 : `data:${mimeType || "image/jpeg"};base64,${base64}`)
        : String(picked.path || "");

      const localId = createAttachmentLocalId();
      attachments.value.push({
        localId,
        fileId: String(up.id || ""),
        localPath: previewSrc,
        // 对话发送地址：mPaaS 原生 aiFileUpload 唯一对外可见的地址就是 source_url
        url: String(up.source_url || ""),
        name: String(up.name || picked.name || ""),
        size: Number(up.size) || 0,
        extension,
        mimeType,
        type,
        status: "uploaded",
      });
    });
  }

  /** 低版本降级：uni.chooseImage 选择照片/拍照，再走 /files/upload 上传 */
  async function chooseImagesViaUni(sourceType: Array<"album" | "camera">, limit?: number) {
    // 容器里先向原生要权限：安卓 WebView 不先授权的话，选图/拍照会被静默拒绝
    const permission = sourceType.includes("camera") ? "camera" : "photo";
    if (!await ensureNativePermission(permission)) {
      uni.showToast({ title: permissionDeniedMessage(permission), icon: "none" });
      return;
    }

    const count = Math.max(1, Math.min(limit ?? MAX_ATTACHMENT_COUNT, MAX_ATTACHMENT_COUNT - attachments.value.length));
    // 选择器是异步弹窗，必须等它回调后再返回：调用方（步骤卡附件入口）选完要立刻判断有没有选中
    await new Promise<void>((resolve) => {
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
          resolve();
        },
        // 用户取消也 resolve：调用方靠「有没有选中附件」区分取消与选中
        fail: (error) => {
          logger.warn("chooseImage failed", error);
          resolve();
        },
      });
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
    // 同 chooseImagesViaUni：等文件选择器回调后再返回
    await new Promise<void>((resolve) => {
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
          resolve();
        },
        fail: (error: unknown) => {
          logger.warn("chooseFile failed", error);
          resolve();
        },
      });
    });
  }
  // #endif

  /**
   * 选择照片/拍照：按环境分流。
   * - mPaaS 容器（WebView）：imageChoose(returnLocal) 选图 + aiFileUpload 上传
   * - 普通浏览器：uni.chooseImage + /files/upload
   */
  async function chooseImages(sourceType: Array<"album" | "camera">, limit?: number) {
    const count = Math.max(1, Math.min(limit ?? MAX_ATTACHMENT_COUNT, MAX_ATTACHMENT_COUNT - attachments.value.length));

    // 等待 bridge 注入窗口，判断是否在 mPaaS 容器（WebView）里
    const bridge = await waitForMpaas(2000);
    if (bridge) {
      try {
        await chooseViaNative({ showFile: false, count });
      } catch (error) {
        logger.warn("[attachment] native choose/upload failed", error);
      }
      return;
    }

    // 浏览器：uni.chooseImage
    await chooseImagesViaUni(sourceType, limit);
  }

  /** 等某个附件的上传流程结束（uploaded / failed），最长等 timeoutMs */
  function waitForAttachmentSettled(localId: string, timeoutMs = 60_000) {
    return new Promise<void>((resolve) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        const attachment = findAttachment(localId);
        if (!attachment || attachment.status !== "uploading" || Date.now() - startedAt > timeoutMs) {
          clearInterval(timer);
          resolve();
        }
      }, 120);
    });
  }

  /**
   * 步骤卡的附件入口：选一个附件并等它上传完，直接返回可发送的 files/meta。
   * - "camera" / "album"：前端弹窗里的拍照 / 相册（uni.chooseImage，限 1 张）
   * - "file"：H5 文件选择；"native"：容器内原生弹窗（自带拍照 / 相册 / 文件）
   * 用户取消选择、上传失败都返回 null（失败提示由上传流程内部给出）。
   * 这条链路用独立的 hook 实例，选文件前先清空，避免和输入栏的附件互相干扰。
   */
  async function pickAttachmentForSend(source: AttachmentSource = "native") {
    clearAttachments();
    if (source === "camera" || source === "album") {
      await chooseImages([source], 1);
    } else {
      await chooseFilesFromNative();
    }
    const localId = attachments.value[attachments.value.length - 1]?.localId;
    if (!localId) return null;
    await waitForAttachmentSettled(localId);
    // 等缩略图转成 data URL：否则消息里回显的是 blob:，部分 WebView 上就是灰块
    await previewTasks.get(localId);
    const attachment = findAttachment(localId);
    if (!attachment || attachment.status !== "uploaded") return null;
    return takeUploadedFiles();
  }

  /**
   * 文件/图片混合选择：按环境分流。
   * - mPaaS 容器（WebView）：imageChoose(returnLocal, showFile) 选文件 + aiFileUpload 上传
   * - 普通浏览器：uni.chooseFile + /files/upload
   */
  async function chooseFilesFromNative() {
    const count = Math.max(1, MAX_ATTACHMENT_COUNT - attachments.value.length);

    // 等待 bridge 注入窗口，判断是否在 mPaaS 容器（WebView）里
    const bridge = await waitForMpaas(2000);
    if (bridge) {
      try {
        await chooseViaNative({ showFile: true, count });
      } catch (error) {
        logger.warn("[attachment] native choose/upload failed", error);
      }
      return;
    }

    // 浏览器：uni.chooseFile
    // #ifdef H5
    await chooseFilesViaUni();
    // #endif
  }

  /**
   * 原生 imageChoose 是否可用（等待 bridge 注入窗口）。
   * WebView 下返回 true：点击 + 直接触发原生弹窗（imageChoose showFile=true 自带拍照/相册/文件），
   * 不再弹前端三选项弹窗；浏览器下返回 false：弹前端三选项弹窗。
   */
  function isNativePickerAvailable() {
    return isNativeAttachmentPickerAvailable();
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
    previewTasks.delete(localId);
  }

  function retryAttachment(localId: string) {
    void uploadAttachment(localId);
  }

  function clearAttachments() {
    attachments.value = [];
    previewTasks.clear();
  }

  /**
   * 取出可提交的附件并清空输入栏。
   * 对话 files 一律以 `remote_url` 提交，url 取上传接口返回的 source_url
   * （mPaaS 原生 aiFileUpload / H5 /files/upload 两个来源同一口径）；
   * 仅当 source_url 缺失时才退回 `local_file` + upload_file_id。
   * meta 多带本地路径与名称体积，用于当前消息气泡展示。
   */
  function takeUploadedFiles(): { files: ChatFile[]; meta: ChatMessageAttachment[] } {
    const uploaded = attachments.value.filter(item =>
      item.status === "uploaded" && Boolean(item.url || item.fileId),
    );
    const files: ChatFile[] = uploaded.map(item => item.url
      ? {
          type: item.type,
          transferMethod: "remote_url",
          url: item.url,
        }
      : {
          type: item.type,
          transferMethod: "local_file",
          uploadFileId: item.fileId,
        });
    const meta = uploaded.map(item => ({
      fileId: item.fileId,
      url: item.url,
      // 消息只管回显：blob: 在部分 WebView 的 uni-image 上是灰块，交给远端 url 兜底
      localPath: isBlobUrl(item.localPath) ? "" : item.localPath,
      name: item.name,
      type: item.type,
      size: item.size,
      mimeType: item.mimeType,
    }));
    clearAttachments();
    return { files, meta };
  }

  /**
   * 外部已经上传好的附件（如步骤卡拍照的结果）直接挂到输入栏：
   * 不重新上传，也不自动发送，等用户在输入栏里补完说明自己发。
   * 入参结构与 takeUploadedFiles() 返回的 meta 一致。
   */
  function appendUploadedAttachments(list: ChatMessageAttachment[]) {
    (Array.isArray(list) ? list : []).forEach((item) => {
      const url = String(item?.url || "");
      const fileId = String(item?.fileId || "");
      if (!url && !fileId) return;
      if (attachments.value.length >= MAX_ATTACHMENT_COUNT) {
        toastLimit();
        return;
      }
      const name = String(item?.name || "附件");
      const mimeType = String(item?.mimeType || "");
      const extension = getFileExtension(name, url);
      attachments.value.push({
        localId: createAttachmentLocalId(),
        fileId,
        // 预览优先用本地地址（data URL 消息里也能渲染），没有再用远端地址
        localPath: String(item?.localPath || url || ""),
        url,
        name,
        size: Number(item?.size) || 0,
        extension,
        mimeType,
        type: (item?.type as AttachmentKind) || inferAttachmentKind(extension, mimeType),
        status: "uploaded",
      });
    });
  }

  return {
    attachments,
    hasAttachments,
    hasIncompleteAttachments,
    hasFailedAttachments,
    openAttachmentPicker,
    isNativePickerAvailable,
    chooseImages,
    pickAttachmentForSend,
    appendUploadedAttachments,
    chooseFilesFromNative,
    removeAttachment,
    retryAttachment,
    clearAttachments,
    takeUploadedFiles,
  };
}

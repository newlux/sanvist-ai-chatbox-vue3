import type { ChatFile } from "@/api/chat/types";
import type { ChatMessageAttachment } from "@/stores/chat-types";
import { computed, ref } from "vue";
import { uploadChatFile } from "@/api/chat";
import { useUserStore } from "@/stores";
import { ensureNativePermission, permissionDeniedMessage } from "@/utils/platform/mpaas";

export const MAX_ATTACHMENT_COUNT = 3;
const MAX_LOCAL_FILE_SIZE = 50 * 1024 * 1024;

type AttachmentStatus = "uploading" | "uploaded" | "failed";
type AttachmentKind = "image" | "audio" | "video" | "document" | "custom";

export interface ComposerAttachment {
  localId: string;
  /** 本地临时路径，用于图片缩略图预览与失败重传 */
  localPath: string;
  /** 上传成功后网关返回的可访问地址，发送时作为 files[].url */
  url: string;
  name: string;
  size: number;
  extension: string;
  mimeType: string;
  type: AttachmentKind;
  status: AttachmentStatus;
  error?: string;
}

interface LocalSelectedFile {
  path: string;
  name: string;
  size: number;
  mimeType?: string;
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
 * 扩展名是文件真实身份最稳的线索；相册/文件选择器给的 MIME 经常是
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

/** uploadFile 的 fileType 只影响小程序端的参数校验，与真实类型无关 */
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

function toastLimit() {
  uni.showToast({ title: `最多添加${MAX_ATTACHMENT_COUNT}个附件`, icon: "none" });
}

/** 输入栏的附件选择、上传与状态维护 */
export function useComposerAttachments() {
  const userStore = useUserStore();
  const attachments = ref<ComposerAttachment[]>([]);

  const hasAttachments = computed(() => attachments.value.length > 0);
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

  async function uploadAttachment(localId: string) {
    const attachment = findAttachment(localId);
    if (!attachment) return;

    attachment.status = "uploading";
    attachment.error = undefined;

    try {
      const uploaded = await uploadChatFile({
        filePath: attachment.localPath,
        // 网关校验非空：游客态没有用户 ID 时用固定占位
        user: String(userStore.userId || "guest"),
        fileType: toUploadFileType(attachment.type),
      });
      // 上传期间用户可能已移除该附件
      const current = findAttachment(localId);
      if (!current) return;
      if (!uploaded?.url) throw new Error("上传结果缺少文件地址");

      current.url = uploaded.url;
      current.name = uploaded.name || current.name;
      current.size = Number(uploaded.size) || current.size;
      current.extension = uploaded.extension || current.extension;
      current.mimeType = uploaded.mimeType || current.mimeType;
      current.type = inferAttachmentKind(current.extension, current.mimeType);
      current.status = "uploaded";
    } catch (error) {
      const current = findAttachment(localId);
      if (!current) return;
      const message = error instanceof Error ? error.message : "文件上传失败";
      current.status = "failed";
      current.error = message;
      console.error("[attachments] upload failed", error);
      uni.showToast({ title: message.slice(0, 28), icon: "none", duration: 2500 });
    }
  }

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
        uni.showToast({ title: `${file.name || "文件"}超过50MB`, icon: "none" });
        return;
      }

      const extension = getFileExtension(file.name, file.path);
      const type = inferAttachmentKind(extension, file.mimeType);
      const localId = createAttachmentLocalId();
      const fallbackName = type === "image"
        ? `图片-${index + 1}.${extension || "jpg"}`
        : `附件-${index + 1}${extension ? `.${extension}` : ""}`;

      attachments.value.push({
        localId,
        localPath: file.path,
        url: "",
        name: file.name || fallbackName,
        size: Number(file.size) || 0,
        extension,
        mimeType: file.mimeType || "",
        type,
        status: "uploading",
      });
      void uploadAttachment(localId);
    });
  }

  async function chooseImages(sourceType: Array<"album" | "camera">) {
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
        const tempFiles = (result.tempFiles || []) as Array<{ path?: string; size?: number; name?: string; type?: string }>;
        const paths = Array.isArray(result.tempFilePaths)
          ? result.tempFilePaths
          : [result.tempFilePaths].filter(Boolean) as string[];
        appendSelectedFiles(paths.map((path, index) => ({
          path: String(path),
          name: String(tempFiles[index]?.name || ""),
          size: Number(tempFiles[index]?.size) || 0,
          mimeType: String(tempFiles[index]?.type || "image/*"),
        })));
      },
      fail: error => console.warn("[attachments] chooseImage failed", error),
    });
  }

  // #ifdef H5
  async function chooseLocalFiles() {
    if (!await ensureNativePermission("photo")) {
      uni.showToast({ title: permissionDeniedMessage("photo"), icon: "none" });
      return;
    }

    const chooseFile = (uni as { chooseFile?: (options: Record<string, unknown>) => void }).chooseFile;
    if (typeof chooseFile !== "function") {
      uni.showToast({ title: "当前环境不支持选择文件", icon: "none" });
      return;
    }
    chooseFile({
      count: Math.max(1, MAX_ATTACHMENT_COUNT - attachments.value.length),
      type: "all",
      success: (result: { tempFiles?: Array<Record<string, unknown>> }) => {
        appendSelectedFiles((result.tempFiles || []).map(file => ({
          path: String(file.path || ""),
          name: String(file.name || ""),
          size: Number(file.size) || 0,
          mimeType: String(file.type || ""),
        })));
      },
      fail: (error: unknown) => console.warn("[attachments] chooseFile failed", error),
    });
  }
  // #endif

  /** 弹出来源选择。达到上限时只提示，不弹面板 */
  function openAttachmentPicker() {
    if (isLimitReached.value) {
      toastLimit();
      return;
    }

    // 支付宝小程序没有通用文件选择器，只能走相机与相册；H5 多给一个文件入口
    const itemList = ["拍照", "从相册选择"];
    // #ifdef H5
    itemList.push("选择文件");
    // #endif

    uni.showActionSheet({
      itemList,
      success: ({ tapIndex }) => {
        if (tapIndex === 0) void chooseImages(["camera"]);
        else if (tapIndex === 1) void chooseImages(["album"]);
        // #ifdef H5
        else if (tapIndex === 2) void chooseLocalFiles();
        // #endif
      },
      fail: () => {},
    });
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
    const uploaded = attachments.value.filter(item => item.status === "uploaded" && item.url);
    // type 直接用归类结果（含 custom），transferMethod 固定 remote_url——
    // 文件已经由 /files/upload 传过一次，这里给的是可访问地址
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
    clearAttachments();
    return { files, meta };
  }

  return {
    attachments,
    hasAttachments,
    hasIncompleteAttachments,
    hasFailedAttachments,
    openAttachmentPicker,
    removeAttachment,
    retryAttachment,
    clearAttachments,
    takeUploadedFiles,
  };
}

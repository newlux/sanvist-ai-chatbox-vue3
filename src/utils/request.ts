import type { PlatformRequestOptions } from "@/utils/platform/http-request";
import { createLogger } from "@/utils/logger";

import { platformRequest, PlatformRequestError, platformUploadFile } from "@/utils/platform/http-request";

const logger = createLogger("request");

export interface BaseResponse<T = unknown> {
  failed: boolean;
  code: number;
  errorCode?: number;
  data: T;
  message: string;
}

interface RequestOptions<T = unknown> extends PlatformRequestOptions {
  data?: T;
  /** 单独指定服务前缀：用于与主 API 不同域的服务（如 COS 预签名），不传则用全局 baseURL */
  baseURL?: string;
}

interface JsonRequest<T> {
  json: () => Promise<T>;
}

interface UploadOptions {
  filePath: string;
  /**
   * 优先上传的文件对象。H5 下 uni.uploadFile 直接接收原生 File，
   * 避免它对 blob URL 二次转换时文件名退化（file-<时间戳> 无扩展名）导致网关判空。
   */
  file?: File;
  name?: string;
  formData?: Record<string, string>;
  /** 支付宝必填；老版本只认 image，音频也会被映射成 image */
  fileType?: "image" | "video" | "audio";
  timeout?: number;
}

let authorization = "";
let guestRole = "";
let baseURL = import.meta.env.VITE_AI_QUESTION_BASE_URL;

export function setRequestAuth(value: string) {
  authorization = value;
}

export function setRequestBaseURL(value: string) {
  if (value) baseURL = value;
}

export function getRequestBaseURL() {
  return baseURL;
}

export function getRequestHeaders(headers: Record<string, string> = {}) {
  return {
    ...(authorization ? { Authorization: authorization } : {}),
    ...(guestRole ? { "guest-role": guestRole } : {}),
    ...headers,
  };
}

export const GUEST_ROLE_OPTIONS = ["OWNER", "OPERATOR"] as const;

export type GuestRole = typeof GUEST_ROLE_OPTIONS[number];

export function isGuestRole(value: unknown): value is GuestRole {
  return typeof value === "string" && (GUEST_ROLE_OPTIONS as readonly string[]).includes(value);
}

export function setGuestRole(role: string) {
  guestRole = role;
}

type AuthFailureHandler = (statusCode: number, message: string) => void;

let authFailureHandler: AuthFailureHandler | null = null;
let authFailureNotifiedAt = 0;

/**
 * 注册鉴权失效回调。由 App 决定怎么恢复（通知宿主换 token / 退回上一页 / 提示重进）。
 */
export function setAuthFailureHandler(handler: AuthFailureHandler | null) {
  authFailureHandler = handler;
}

/**
 * 只对 401 触发：后端的 403 是「游客模式权限不足」这类正常业务响应，
 * 拿它去踢登录会误伤。并发请求同时 401 时只通知一次。
 */
function notifyAuthFailure(statusCode: number, message: string) {
  if (statusCode !== 401) return;
  const now = Date.now();
  if (now - authFailureNotifiedAt < 1000) return;
  authFailureNotifiedAt = now;
  authFailureHandler?.(statusCode, message);
}

function unwrapResponse<T>(response: BaseResponse<T> | T): T {
  if (!response || typeof response !== "object" || !("code" in response)) return response as T;
  const envelope = response as BaseResponse<T>;
  // 主 API 成功包是 code=200；COS 预签名等 hfle 网关服务是 errorCode=200 + 业务码字符串
  // （code 形如 common.info.vo.success），两种都算成功并返回 data
  if (envelope.code === 200 || envelope.failed === false||envelope.errorCode===200) return envelope.data;
  const message = envelope.message || "业务请求失败";
  // 网关把鉴权结果放在业务 code 里返回，HTTP 状态仍是 200
  notifyAuthFailure(envelope.code, message);
  throw new PlatformRequestError(message, envelope.code, envelope);
}

/** HTTP 层失败也要过一遍鉴权判定，再原样抛给调用方 */
function rethrowWithAuthCheck(error: unknown): never {
  if (error instanceof PlatformRequestError && error.statusCode) {
    notifyAuthFailure(error.statusCode, error.message);
  }
  throw error;
}

function parseUploadPayload<T>(data: unknown): BaseResponse<T> | T {
  if (data == null || data === "") {
    throw new PlatformRequestError("上传响应为空");
  }
  if (typeof data === "object") return data as BaseResponse<T> | T;
  try {
    return JSON.parse(String(data)) as BaseResponse<T> | T;
  } catch {
    throw new PlatformRequestError("上传响应无法解析");
  }
}

function readHttpErrorMessage(data: unknown, fallback: string) {
  const payload = typeof data === "string"
    ? (() => {
        try {
          return JSON.parse(data) as { message?: string };
        } catch {
          return null;
        }
      })()
    : data;
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = String((payload as { message?: unknown }).message || "").trim();
    if (message) return message;
  }
  return fallback;
}

function createUploadRequest<T>(path: string, options: UploadOptions): JsonRequest<T> {
  return {
    async json() {
      const url = `${baseURL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
      logger.info("upload", {
        url,
        filePath: options.filePath,
        fileProvided: Boolean(options.file),
        fileType: options.fileType,
      });
      const response = await platformUploadFile({
        url,
        filePath: options.filePath,
        file: options.file,
        name: options.name || "file",
        fileType: options.fileType || "image",
        formData: options.formData,
        headers: getRequestHeaders(),
      });
      logger.info("upload success", {
        statusCode: response.statusCode,
        data: String(response.data ?? "").slice(0, 200),
      });
      const statusCode = Number(response.statusCode) || 0;
      if (statusCode < 200 || statusCode >= 300) {
        const message = readHttpErrorMessage(response.data, `上传失败（${statusCode}）`);
        notifyAuthFailure(statusCode, message);
        throw new PlatformRequestError(message, statusCode, response.data);
      }
      return unwrapResponse(parseUploadPayload<T>(response.data));
    },
  };
}

function createJsonRequest<T>(
  method: string,
  path: string,
  data?: unknown,
  options: RequestOptions = {},
): JsonRequest<T> {
  return {
    async json() {
      const response = await platformRequest<BaseResponse<T> | T>(options.baseURL || baseURL, method, path, {
        ...options,
        data: options.data ?? data,
        headers: getRequestHeaders(options.headers),
      }).catch(rethrowWithAuthCheck);
      return unwrapResponse(response.data);
    },
  };
}

export const request = {
  get<T>(path: string, data?: unknown, options?: RequestOptions) {
    return createJsonRequest<T>("GET", path, data, options);
  },
  post<T>(path: string, data?: unknown, options?: RequestOptions) {
    return createJsonRequest<T>("POST", path, data, options);
  },
  put<T>(path: string, data?: unknown, options?: RequestOptions) {
    return createJsonRequest<T>("PUT", path, data, options);
  },
  delete<T, D = unknown>(path: string, options?: RequestOptions<D>) {
    return createJsonRequest<T>("DELETE", path, undefined, options);
  },
  upload<T>(path: string, options: UploadOptions) {
    return createUploadRequest<T>(path, options);
  },
};

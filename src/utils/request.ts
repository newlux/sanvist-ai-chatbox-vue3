import type { PlatformRequestOptions } from "@/utils/platform/alipay-request";
import { alipayRequest, PlatformRequestError } from "@/utils/platform/alipay-request";

export interface BaseResponse<T = unknown> {
  code: number;
  errorCode?: number;
  data: T;
  message: string;
}

interface RequestOptions<T = unknown> extends PlatformRequestOptions {
  data?: T;
}

interface JsonRequest<T> {
  json: () => Promise<T>;
}

interface UploadOptions {
  filePath: string;
  name?: string;
  formData?: Record<string, string>;
}

let authorization = "";
let guestRole = "";
let baseURL = import.meta.env.VITE_AI_QUESTION_BASE_URL;
let chatSocketPath = import.meta.env.VITE_AI_CHAT_WS_PATH || "";

export function setRequestAuth(value: string) {
  authorization = value;
}

export function setRequestBaseURL(value: string) {
  if (value) baseURL = value;
}

export function getRequestBaseURL() {
  return baseURL;
}

export function setChatSocketPath(value: string) {
  chatSocketPath = value || "";
}

/**
 * 对话 WebSocket 地址。留空表示未开通，调用方走 HTTP 通道。
 * 支付宝小程序的 my.request 不支持分块响应，只有 WebSocket 能做到真流式。
 */
export function getChatSocketURL() {
  if (!chatSocketPath) return "";
  if (/^wss?:\/\//i.test(chatSocketPath)) return chatSocketPath;
  const origin = baseURL.replace(/\/$/, "").replace(/^http/i, "ws");
  return `${origin}/${chatSocketPath.replace(/^\//, "")}`;
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

export function clearGuestRole() {
  guestRole = "";
}

function unwrapResponse<T>(response: BaseResponse<T> | T): T {
  if (!response || typeof response !== "object" || !("code" in response)) return response as T;
  const envelope = response as BaseResponse<T>;
  if (envelope.code === 200) return envelope.data;
  throw new PlatformRequestError(envelope.message || "业务请求失败", envelope.code, envelope);
}

function createUploadRequest<T>(path: string, options: UploadOptions): JsonRequest<T> {
  return {
    json() {
      return new Promise<T>((resolve, reject) => {
        uni.uploadFile({
          url: `${baseURL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`,
          filePath: options.filePath,
          name: options.name || "file",
          formData: options.formData,
          header: getRequestHeaders(),
          success(response) {
            const statusCode = Number(response.statusCode) || 0;
            if (statusCode < 200 || statusCode >= 300) {
              reject(new PlatformRequestError(`上传失败（${statusCode}）`, statusCode, response.data));
              return;
            }
            try {
              const payload = JSON.parse(response.data) as BaseResponse<T> | T;
              resolve(unwrapResponse(payload));
            } catch (error) {
              reject(error);
            }
          },
          fail(error) {
            reject(new PlatformRequestError(error.errMsg || "文件上传失败"));
          },
        });
      });
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
      const response = await alipayRequest<BaseResponse<T> | T>(baseURL, method, path, {
        ...options,
        data: options.data ?? data,
        headers: getRequestHeaders(options.headers),
      });
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

export const post = request.post;
export const get = request.get;
export const put = request.put;
export const del = request.delete;

export default request;

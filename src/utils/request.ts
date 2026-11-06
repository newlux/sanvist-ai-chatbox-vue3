import type { PlatformRequestOptions } from "@/utils/platform/http-request";
import { createLogger } from "@/utils/logger";

import {
  platformRequest,
  PlatformRequestError,
  platformUploadFile,
} from "@/utils/platform/http-request";

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

/** 宿主下发的鉴权串（Authorization 头原值，通常形如 `bearer xxx`），由 App.vue 启动时写入 */
export function setRequestAuth(value: string) {
  authorization = String(value || "").trim();
}

export function setRequestBaseURL(value: string) {
  if (value) baseURL = value;
}

export function getRequestBaseURL() {
  return baseURL;
}

/**
 * 合并请求头：**头名大小写不敏感**（HTTP 规范如此）。
 *
 * 之前用对象展开，`Guest-Role`（这里注入的）和调用方传的 `guest-role`（工作流按身份覆盖）
 * 会同时留在 header 对象里，uni.request / fetch 就发两条同名头；
 * 网关把它们合并成一个值，最终变成 `Guest-Role: OWNER, OWNER`，工作流按错误身份取数。
 *
 * 规则：同名（忽略大小写）只保留一份，后传入的覆盖前面的；空值忽略。
 */
function mergeHeaders(base: Record<string, string>, extra: Record<string, string> = {}) {
  const merged: Record<string, string> = {};
  /** lowerCase → 当前实际写入 merged 的键名 */
  const nameByLower = new Map<string, string>();

  const write = (name: string, value: string | undefined) => {
    if (!name || value == null || value === "") return;
    const lower = name.toLowerCase();
    const previous = nameByLower.get(lower);
    if (previous !== undefined) delete merged[previous];
    nameByLower.set(lower, name);
    merged[name] = String(value);
  };

  Object.entries(base).forEach(([name, value]) => write(name, value));
  Object.entries(extra).forEach(([name, value]) => write(name, value));
  return merged;
}

/**
 * 统一请求头：JSON / 上传 / SSE（fetch）都走这里。
 * Authorization 与 Guest-Role 都从这里出，调用方不用各自拼。
 */
export function getRequestHeaders(headers: Record<string, string> = {}) {
  const base: Record<string, string> = {};
  // token 只由 App.vue 初始化时写入（宿主 query 里的 Authorization，取不到用本地配置），为空就不带头
  if (authorization) base.Authorization = authorization;
  if (guestRole) base["Guest-Role"] = guestRole;
  // 调用方显式传的（如工作流的 Guest-Role）覆盖全局身份，且不会产生重名头
  return mergeHeaders(base, headers);
}

export const GUEST_ROLE_OPTIONS = ["OWNER", "OPERATOR"] as const;

export type GuestRole = (typeof GUEST_ROLE_OPTIONS)[number];

export function isGuestRole(value: unknown): value is GuestRole {
  return typeof value === "string" && (GUEST_ROLE_OPTIONS as readonly string[]).includes(value);
}

/**
 * 写入驻场身份：选中「老板」即 OWNER，之后所有接口自动带 `Guest-Role: OWNER`。
 * 唯一入口是 App.vue 对 userStore.visitorRole 的 watch，页面不要各自调。
 */
export function setGuestRole(role: string | null | undefined) {
  guestRole = String(role || "").trim();
}

/** 当前入驻身份（调试 / 日志用） */
export function getGuestRole() {
  return guestRole;
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
  if (envelope.code === 200 || envelope.failed === false || envelope.errorCode === 200)
    return envelope.data;
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
  const payload =
    typeof data === "string"
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
      const response = await platformRequest<BaseResponse<T> | T>(
        options.baseURL || baseURL,
        method,
        path,
        {
          ...options,
          data: options.data ?? data,
          headers: getRequestHeaders(options.headers),
        },
      ).catch(rethrowWithAuthCheck);
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

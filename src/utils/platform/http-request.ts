import { createLogger } from "@/utils/logger";

const logger = createLogger("request");

export interface PlatformRequestOptions {
  data?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  responseType?: "text" | "arraybuffer";
}

export interface PlatformRequestResponse<T> {
  data: T;
  statusCode: number;
  headers: Record<string, string>;
}

export class PlatformRequestError extends Error {
  statusCode?: number;
  response?: unknown;

  constructor(message: string, statusCode?: number, response?: unknown) {
    super(message);
    this.name = "PlatformRequestError";
    this.statusCode = statusCode;
    this.response = response;
  }
}

function joinUrl(baseURL: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseURL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function appendQuery(url: string, data?: unknown) {
  if (!data || typeof data !== "object") return url;
  const query = Object.entries(data as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

export function platformRequest<T>(
  baseURL: string,
  method: string,
  path: string,
  options: PlatformRequestOptions = {},
): Promise<PlatformRequestResponse<T>> {
  const normalizedMethod = method.toUpperCase();
  const url = normalizedMethod === "GET"
    ? appendQuery(joinUrl(baseURL, path), options.data)
    : joinUrl(baseURL, path);

  return new Promise((resolve, reject) => {
    const requestWithCallbacks = uni.request as unknown as (
      options: UniApp.RequestOptions,
    ) => unknown;
    requestWithCallbacks({
      url,
      method: normalizedMethod as UniApp.RequestOptions["method"],
      data: (normalizedMethod === "GET" ? undefined : options.data) as UniApp.RequestOptions["data"],
      header: options.headers,
      timeout: options.timeout ?? 60_000,
      ...(options.responseType ? { responseType: options.responseType } : {}),
      success(response) {
        const statusCode = Number(response.statusCode) || 0;
        if (statusCode < 200 || statusCode >= 300) {
          reject(new PlatformRequestError(`请求失败（${statusCode}）`, statusCode, response.data));
          return;
        }
        resolve({
          data: response.data as T,
          statusCode,
          headers: (response.header || {}) as Record<string, string>,
        });
      },
      fail(error) {
        reject(new PlatformRequestError(error.errMsg || "网络请求失败"));
      },
    });
  });
}

export interface PlatformUploadOptions {
  url: string;
  filePath: string;
  name?: string;
  fileType?: "image" | "video" | "audio";
  formData?: Record<string, string>;
  headers?: Record<string, string>;
}

function readUploadFailMessage(error: { errMsg?: string; errorMessage?: string; error?: number } | undefined) {
  if (!error) return "文件上传失败";
  return error.errorMessage || error.errMsg || `文件上传失败${error.error ? `（${error.error}）` : ""}`;
}

/** 老容器会强制校验 fileType，但只认 image；这个字段对实际上传类型没有意义 */
function toUploadFileType(fileType?: "image" | "video" | "audio") {
  return fileType === "video" ? "video" : "image";
}

function pickPlainHeaders(headers?: Record<string, string>) {
  if (!headers) return undefined;
  const result: Record<string, string> = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (value == null || value === "") return;
    result[key] = String(value);
  });
  return Object.keys(result).length ? result : undefined;
}

/**
 * 走 uni.uploadFile。录音临时路径必须先 saveFile，否则真机报「无效参数」。
 */
/**
 * 支付宝的 my.uploadFile 会自己弹一个「上传中」的系统 loading，官方没给开关。
 * 它出现的时机跟传输快慢有关（小文件可能一闪而过，语音这种秒级上传必现），
 * 所以不能只在开头补几刀，得在整个上传期间持续压制，由调用方在 finally 里停。
 * 本项目自己从不调用 showLoading，误关不了别人的。
 */
function suppressNativeUploadLoading() {
  return () => {};
}

export async function platformUploadFile(
  options: PlatformUploadOptions,
): Promise<{ statusCode: number; data: unknown }> {
  const sourcePath = String(options.filePath || "");
  if (!sourcePath) {
    throw new PlatformRequestError("缺少上传文件路径");
  }

  let stopLoadingSuppressor: (() => void) | undefined;

  try {
    return await new Promise((resolve, reject) => {
      const payload: UniApp.UploadFileOption = {
        url: options.url,
        filePath: sourcePath,
        name: options.name || "file",
        fileType: toUploadFileType(options.fileType),
        success(response) {
          resolve({
            statusCode: Number(response.statusCode) || 0,
            data: response.data,
          });
        },
        fail(error) {
          reject(new PlatformRequestError(readUploadFailMessage(error)));
        },
      };
      const header = pickPlainHeaders(options.headers);
      if (header) payload.header = header;
      if (options.formData && Object.keys(options.formData).length > 0) {
        payload.formData = options.formData;
      }
      logger.debug("uploadFile", {
        url: payload.url,
        filePath: payload.filePath,
        name: payload.name,
        fileType: payload.fileType,
      });
      uni.uploadFile(payload);
      stopLoadingSuppressor = suppressNativeUploadLoading();
    });
  } finally {
    stopLoadingSuppressor?.();
  }
}

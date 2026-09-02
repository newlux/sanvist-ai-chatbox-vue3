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

/** 请求体大小，用于排查「体积过大被容器拒掉」这类问题（base64 音频动辄几百 KB） */
function measurePayloadSize(data: unknown) {
  if (data == null) return 0;
  try {
    return typeof data === "string" ? data.length : JSON.stringify(data).length;
  } catch {
    return -1;
  }
}

/** 错误对象在各容器里字段不统一，原样序列化出来，别让 request:fail 变成无信息的黑盒 */
function describeRequestError(error: unknown) {
  if (!error || typeof error !== "object") return String(error);
  const raw = error as Record<string, unknown>;
  const known = {
    errMsg: raw.errMsg,
    errno: raw.errno,
    errorMessage: raw.errorMessage,
    error: raw.error,
    statusCode: raw.statusCode,
  };
  let dump = "";
  try {
    dump = JSON.stringify(raw);
  } catch {
    dump = "[unserializable]";
  }
  return { ...known, raw: dump.slice(0, 500) };
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
  const payloadSize = normalizedMethod === "GET" ? 0 : measurePayloadSize(options.data);
  const startedAt = Date.now();

  logger.debug("request start", { method: normalizedMethod, url, payloadSize });

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
        const costMs = Date.now() - startedAt;
        if (statusCode < 200 || statusCode >= 300) {
          // 非 2xx 说明请求打到了服务端，问题在接口侧：把响应体也带出来
          logger.error("request http error", {
            url,
            statusCode,
            costMs,
            payloadSize,
            body: String(JSON.stringify(response.data) || "").slice(0, 500),
          });
          reject(new PlatformRequestError(`请求失败（${statusCode}）`, statusCode, response.data));
          return;
        }
        logger.debug("request done", { url, statusCode, costMs });
        resolve({
          data: response.data as T,
          statusCode,
          headers: (response.header || {}) as Record<string, string>,
        });
      },
      fail(error) {
        // 走到这里说明连响应都没拿到（网络/域名白名单/容器拦截/超时），问题在端上或链路上，
        // 与「接口返回了错误码」是两回事，日志里必须区分开
        logger.error("request transport failed", {
          url,
          method: normalizedMethod,
          payloadSize,
          costMs: Date.now() - startedAt,
          timeout: options.timeout ?? 60_000,
          detail: describeRequestError(error),
        });
        reject(new PlatformRequestError(error.errMsg || "网络请求失败"));
      },
    });
  });
}

export interface PlatformUploadOptions {
  url: string;
  filePath: string;
  /**
   * 优先上传的文件对象：H5 下 uni.uploadFile 直接接收原生 File（走 blobToFile 原样返回），
   * 保留真实文件名与 MIME；否则它对 blob URL 二次转换，文件名会退化且 MIME 可能丢失。
   */
  file?: File;
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
      // 优先传原生 File 对象（H5 形态）：uni.uploadFile 会直接用它的文件名与 MIME 构造 multipart
      if (options.file) payload.file = options.file;
      const header = pickPlainHeaders(options.headers);
      if (header) payload.header = header;
      if (options.formData && Object.keys(options.formData).length > 0) {
        payload.formData = options.formData;
      }
      logger.debug("uploadFile", {
        url: payload.url,
        filePath: payload.filePath,
        fileProvided: Boolean(options.file),
        fileName: options.file?.name,
        fileType: payload.fileType,
      });
      uni.uploadFile(payload);
      stopLoadingSuppressor = suppressNativeUploadLoading();
    });
  } finally {
    stopLoadingSuppressor?.();
  }
}

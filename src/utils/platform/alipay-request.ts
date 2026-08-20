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

export function alipayRequest<T>(
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

/**
 * 支付宝老版本会强制校验 fileType，但只认 image（video/audio 会直接「无效参数」）。
 * 官方说明：这个字段对实际上传类型没有意义，任意文件传 image 即可兼容。
 */
function toAlipayFileType(fileType?: "image" | "video" | "audio") {
  return fileType === "video" ? "video" : "image";
}

function getUserDataPath() {
  return (uni as { env?: { USER_DATA_PATH?: string } }).env?.USER_DATA_PATH || "";
}

/** 录音/选图产生的是本地临时文件，uploadFile 只接受缓存文件和用户文件 */
function shouldPersistUploadFile(filePath: string, fileType?: "image" | "video" | "audio") {
  // #ifndef MP-ALIPAY
  // 浏览器里拿到的是 blob:/http: 地址，没有也不需要 saveFile
  return false;
  // #endif
  // #ifdef MP-ALIPAY
  const userDir = getUserDataPath();
  if (userDir && filePath.startsWith(userDir)) return false;
  if (/^https:\/\/usr\//i.test(filePath)) return false;
  if (/^https:\/\/resource\//i.test(filePath)) return true;
  return fileType === "audio";
  // #endif
}

function guessFileExt(filePath: string, fileType?: "image" | "video" | "audio") {
  const matched = /\.[a-z0-9]+$/i.exec(filePath.split("?")[0] || "");
  if (matched) return matched[0];
  if (fileType === "audio") return ".aac";
  if (fileType === "video") return ".mp4";
  return ".png";
}

function persistTempFile(tempFilePath: string, fileType?: "image" | "video" | "audio"): Promise<string> {
  return new Promise((resolve, reject) => {
    const fail = (error?: { errMsg?: string }) => {
      reject(new PlatformRequestError(error?.errMsg || "临时文件保存失败"));
    };
    const finish = (saved?: string) => {
      if (!saved) fail();
      else resolve(saved);
    };
    const fs = typeof uni.getFileSystemManager === "function" ? uni.getFileSystemManager() : null;
    const baseDir = getUserDataPath();
    const destPath = baseDir ? `${baseDir}/upload_${Date.now()}${guessFileExt(tempFilePath, fileType)}` : "";

    if (fs && typeof fs.saveFile === "function") {
      fs.saveFile({
        tempFilePath,
        ...(destPath ? { filePath: destPath } : {}),
        success: (res: { savedFilePath?: string; apFilePath?: string }) => {
          finish(res.savedFilePath || res.apFilePath || destPath);
        },
        fail,
      });
      return;
    }

    uni.saveFile({
      tempFilePath,
      success: res => finish(res.savedFilePath),
      fail,
    });
  });
}

function removePersistedFile(filePath: string) {
  try {
    uni.removeSavedFile({ filePath });
  } catch {
    try {
      uni.getFileSystemManager()?.unlink?.({ filePath });
    } catch {
      // 清理失败不影响识别结果
    }
  }
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
  // #ifndef MP-ALIPAY
  return () => {};
  // #endif
  // #ifdef MP-ALIPAY
  const hide = () => {
    try {
      uni.hideLoading();
    } catch {
      // 没有 loading 时部分基础库会报错，忽略
    }
  };
  hide();
  const timer = setInterval(hide, 120);
  return () => clearInterval(timer);
  // #endif
}

export async function alipayUploadFile(
  options: PlatformUploadOptions,
): Promise<{ statusCode: number; data: unknown }> {
  const sourcePath = String(options.filePath || "");
  if (!sourcePath) {
    throw new PlatformRequestError("缺少上传文件路径");
  }

  let stopLoadingSuppressor: (() => void) | undefined;
  const persisted = shouldPersistUploadFile(sourcePath, options.fileType);
  const filePath = persisted
    ? await persistTempFile(sourcePath, options.fileType)
    : sourcePath;

  try {
    return await new Promise((resolve, reject) => {
      const payload: UniApp.UploadFileOption = {
        url: options.url,
        filePath,
        name: options.name || "file",
        fileType: toAlipayFileType(options.fileType),
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
      console.info("[request] uploadFile", {
        url: payload.url,
        filePath: payload.filePath,
        sourcePath,
        persisted,
        name: payload.name,
        fileType: payload.fileType,
      });
      uni.uploadFile(payload);
      stopLoadingSuppressor = suppressNativeUploadLoading();
    });
  } finally {
    stopLoadingSuppressor?.();
    if (persisted && filePath && filePath !== sourcePath) {
      removePersistedFile(filePath);
    }
  }
}

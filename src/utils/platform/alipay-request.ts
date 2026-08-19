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

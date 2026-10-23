/**
 * 语音识别（ASR）失败归类。
 *
 * ASR 服务侧失败时后端会直接回业务错误，例如：
 *   { code: 500, message: "ASR 业务失败: code=500 message=系统繁忙，请稍后重试" }
 * 这种报错对用户既看不懂也没法处理（不是权限、也不是网络问题），
 * 统一按「没有识别到内容，请重试」提示，引导用户重录；
 * 录音启动失败、识别超时、网络断开等其它错误仍然展示原始提示。
 */
const ASR_SERVICE_FAILURE_PATTERN = /asr\s*(业务失败|business|服务)/i;
const ASR_SERVICE_BUSY_PATTERN = /系统繁忙/;

function readMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  // PlatformRequestError 会把整个响应包挂在 response 上，message 缺失时再往下捞一层
  const record = error as {
    message?: unknown;
    errMsg?: unknown;
    errorMessage?: unknown;
    response?: { message?: unknown } | null;
  };
  const nested = record.response && typeof record.response === "object" ? record.response.message : "";
  const message = record.message || record.errMsg || record.errorMessage || nested;
  return typeof message === "string" ? message : "";
}

/**
 * 是否是 ASR 服务侧失败（后端 500 / 「ASR 业务失败」/「系统繁忙」）。
 * 命中时调用方应替换成友好文案，而不是把后端 message 原样弹给用户。
 */
export function isAsrServiceFailure(error: unknown): boolean {
  const message = readMessage(error);
  if (!message) return false;
  return ASR_SERVICE_FAILURE_PATTERN.test(message) || ASR_SERVICE_BUSY_PATTERN.test(message);
}

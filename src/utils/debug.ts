/**
 * vconsole / 调试日志运行时开关。
 *
 * - 开发环境（DEV）默认开启；
 * - 生产环境默认关闭，开发调试可通过 storage 标记控制。
 */
const VCONSOLE_STORAGE_KEY = "vconsole_enabled";

function readPersistedFlag(): boolean {
  try {
    return (
      typeof uni !== "undefined"
      && uni.getStorageSync(VCONSOLE_STORAGE_KEY) === "1"
    );
  } catch {
    return false;
  }
}

/** 应用启动时调用：解析 URL 参数并决定是否启用 vconsole */
export function resolveVConsoleEnabled(): boolean {
  return import.meta.env.DEV || readPersistedFlag();
}

/** 非启动路径（如 hooks）判断调试日志是否开启 */
export function isDebugLogEnabled(): boolean {
  return import.meta.env.DEV || readPersistedFlag();
}

/**
 * vconsole / 调试日志运行时开关。
 *
 * - 开发环境（DEV）默认开启；
 * - 生产环境默认关闭，真机可通过 URL 参数控制：
 *   ?vconsole=1 开启并持久化到 storage（之后不带参数也保持开启）；
 *   ?vconsole=0 关闭并清除持久化标记。
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
  if (import.meta.env.DEV) {
    return true;
  }
  try {
    const flag = new URLSearchParams(window.location.search).get("vconsole");
    if (flag === "1") {
      uni.setStorageSync(VCONSOLE_STORAGE_KEY, "1");
      return true;
    }
    if (flag === "0") {
      uni.removeStorageSync(VCONSOLE_STORAGE_KEY);
      return false;
    }
  } catch {
    // 解析失败时回退到持久化标记
  }
  return readPersistedFlag();
}

/** 非启动路径（如 hooks）判断调试日志是否开启 */
export function isDebugLogEnabled(): boolean {
  // TODO: 真机调试期间写死开启；调试完成后恢复为：
  // return import.meta.env.DEV || readPersistedFlag();
  return true;
}

import { createLogger } from "@/utils/logger";

const logger = createLogger("debug-console");

/**
 * 真机调试面板（vConsole）。
 *
 * 嵌在宿主 APP 里跑的 H5 没法直接连 Chrome DevTools，出问题只能靠猜。
 * 这里挂一个页内控制台，把 console 输出、网络请求、报错都收进去。
 *
 * 当前阶段【始终开启】。等排查告一段落要收回去时，把 ALWAYS_ON 改回 false，
 * 就退回按需开启：启动参数/地址栏带 debug=1，或打包时 VITE_LOG_LEVEL=debug。
 *
 * vConsole 走动态 import，单独成 chunk，不占主包体积（但始终开启时会多一次请求）。
 */

/** 排查期常开；改成 false 即恢复「按需开启」 */
const ALWAYS_ON = true;

let instance: unknown = null;
let loading: Promise<void> | null = null;

function readQueryFlag(key: string) {
  if (typeof location === "undefined") return "";
  const source = `${location.search || ""}${location.hash || ""}`;
  const matched = new RegExp(`[?&]${key}=([^&#]*)`).exec(source);
  return matched ? decodeURIComponent(matched[1]) : "";
}

function isTruthy(value: unknown) {
  const text = String(value ?? "").toLowerCase();
  return text === "1" || text === "true" || text === "yes";
}

/** 启动参数里带 debug 也算数：宿主是用启动参数传值的，未必落在 URL 上 */
export function shouldEnableDebugConsole(launchQuery: Record<string, unknown> = {}) {
  if (ALWAYS_ON) return true;
  if (isTruthy(launchQuery.debug) || isTruthy(launchQuery.Debug)) return true;
  if (isTruthy(readQueryFlag("debug"))) return true;
  return String(import.meta.env.VITE_LOG_LEVEL || "").toLowerCase() === "debug";
}

export async function openDebugConsole() {
  if (instance) return;
  if (loading) return loading;

  loading = (async () => {
    try {
      const { default: VConsole } = await import("vconsole");
      instance = new VConsole({ theme: "light" });
      logger.info("调试面板已开启");
    } catch (error) {
      logger.warn("调试面板加载失败", error);
    } finally {
      loading = null;
    }
  })();

  return loading;
}

export function setupDebugConsole(launchQuery: Record<string, unknown> = {}) {
  if (!shouldEnableDebugConsole(launchQuery)) return;
  void openDebugConsole();
}

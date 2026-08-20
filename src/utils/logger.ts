/**
 * 统一日志出口。
 *
 * 生产包只保留 warn / error：debug 与 info 里带着 URL、附件路径、键盘高度这些
 * 排查用的上下文，线上既没人看，又平白把内部信息打进用户可见的控制台。
 * 需要临时在生产环境排查时，把 VITE_LOG_LEVEL 调成 debug 重新打包即可。
 */

type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

function resolveLevel(): LogLevel {
  const configured = String(import.meta.env.VITE_LOG_LEVEL || "").toLowerCase();
  if (configured in LEVEL_WEIGHT) return configured as LogLevel;
  return import.meta.env.DEV ? "debug" : "warn";
}

const threshold = LEVEL_WEIGHT[resolveLevel()];

function enabled(level: LogLevel) {
  return LEVEL_WEIGHT[level] >= threshold;
}

/**
 * @param scope 模块名，输出时统一加方括号前缀，便于按模块过滤
 */
export function createLogger(scope: string) {
  const prefix = `[${scope}]`;
  return {
    debug(...args: unknown[]) {
      if (enabled("debug")) console.log(prefix, ...args);
    },
    info(...args: unknown[]) {
      if (enabled("info")) console.info(prefix, ...args);
    },
    warn(...args: unknown[]) {
      if (enabled("warn")) console.warn(prefix, ...args);
    },
    error(...args: unknown[]) {
      if (enabled("error")) console.error(prefix, ...args);
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;

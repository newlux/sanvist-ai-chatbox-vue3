import type { AppSettings, UpdateSettingsParams } from "./types";
import { getRequestAuth, request } from "@/utils/request";

/**
 * `/settings` 必须在请求头里显式带 `authorization`，值就是当前 token。
 *
 * 全局请求头本来也会注入一份（见 utils/request 的 getRequestHeaders），这里显式再写一次有两个作用：
 * - 后端这条路由按头名 `authorization` 取 token，不依赖网关的默认注入；
 * - 取值与全局同源（宿主下发的那份），token 晚到补正后这里跟着一起变，不会失效。
 * token 为空时不出这个头（与全局口径一致）。
 */
function settingsHeaders(extra: Record<string, string> = {}) {
  const authorization = getRequestAuth();
  return authorization ? { authorization, ...extra } : { ...extra };
}

const jsonOptions = {
  headers: {
    "Content-Type": "application/json",
  },
};

/** 读取系统设置（需 guest-role 或登录 token），返回全量字段 */
export function getSettings() {
  return request.get<AppSettings>("/settings", undefined, { headers: settingsHeaders() }).json();
}

/**
 * 保存系统设置（部分更新）。
 * 只传本次操作的字段，响应仍是全量，前端应以响应回显（服务端可能收敛取值，如 speechRate 上限）。
 */
export function updateSettings(params: UpdateSettingsParams) {
  return request
    .put<AppSettings>("/settings", params, { headers: settingsHeaders(jsonOptions.headers) })
    .json();
}

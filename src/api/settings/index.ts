import type { AppSettings, UpdateSettingsParams } from "./types";
import { request } from "@/utils/request";

const jsonOptions = {
  headers: {
    "Content-Type": "application/json",
  },
};

/** 读取系统设置（需 guest-role 或登录 token），返回全量字段 */
export function getSettings() {
  return request.get<AppSettings>("/settings").json();
}

/**
 * 保存系统设置（部分更新）。
 * 只传本次操作的字段，响应仍是全量，前端应以响应回显（服务端可能收敛取值，如 speechRate 上限）。
 */
export function updateSettings(params: UpdateSettingsParams) {
  return request.put<AppSettings>("/settings", params, jsonOptions).json();
}

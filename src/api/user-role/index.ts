import type { DeviceModelsData } from "@/api/user-role/device-models";
import type { OperatorRolesData } from "@/api/user-role/operator-roles";
import type { AwakeningPrompt, RoleOptionsData } from "@/api/user-role/role-options";
import { request } from "@/utils/request";

export function getRoleOptions() {
  return request.get<RoleOptionsData>("/user/role-options").json();
}

/** 机型列表（「选择体验的设备」页数据源） */
export function getDeviceModels() {
  return request.get<DeviceModelsData>("/user/device-models").json();
}

/** 讲解模式身份（新老手）：进入作业指导前在选择页拉取 */
export function getOperatorRoles() {
  return request.get<OperatorRolesData>("/user/operator-roles").json();
}

export function getTodayAwakeningPrompt() {
  return request.get<AwakeningPrompt>("/prompts/awakening/today").json();
}

/**
 * 切换当前账号身份。
 *
 * 对话回答里出现 `<OWNER>` / `<ADMIN>` / `<OPERATOR>` 标签，就代表后端已经把身份切过去了，
 * 前端再把角色码回写到账号上（`roleCode` 就是标签名，不再映射）。
 */
export function updateUserRole(roleCode: string) {
  return request.post<unknown>("/user/role", { roleCode }).json();
}

import type { DeviceModelsData } from "@/api/user-role/device-models";
import type { AwakeningPrompt, RoleOptionsData } from "@/api/user-role/role-options";
import { request } from "@/utils/request";

export function getRoleOptions() {
  return request.get<RoleOptionsData>("/user/role-options").json();
}

/** 机型下拉选项（作业指导页机型选项卡数据源） */
export function getDeviceModels() {
  return request.get<DeviceModelsData>("/user/device-models").json();
}

export function getTodayAwakeningPrompt() {
  return request.get<AwakeningPrompt>("/prompts/awakening/today").json();
}

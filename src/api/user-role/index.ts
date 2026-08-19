import type { AwakeningPrompt, RoleOptionsData } from "@/api/user-role/role-options";
import { request } from "@/utils/request";

export function getRoleOptions() {
  return request.get<RoleOptionsData>("/user/role-options").json();
}

export function getTodayAwakeningPrompt() {
  return request.get<AwakeningPrompt>("/prompts/awakening/today").json();
}

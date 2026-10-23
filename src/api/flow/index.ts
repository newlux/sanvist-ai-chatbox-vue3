import type { FlowStepsData, FlowStepsParams } from "./types";
import { request } from "@/utils/request";

export type { FlowStep, FlowStepOption, FlowStepsData, FlowStepsParams } from "./types";

/**
 * 拉取某个模块的流程步骤（GET /flow/steps?module=ASK[&roleCode=OWNER]）。
 * 返回里按 stepCode 取用：IDENTITY 是身份选择页（标题 + 三个身份选项），
 * IDENTITY_DETAIL 是身份信息页（标题 + 设备胶囊），带 roleCode 时按该角色返回。
 */
export function getFlowSteps(params: FlowStepsParams) {
  return request.get<FlowStepsData>("/flow/steps", {
    module: params.module,
    roleCode: params.roleCode,
  }).json();
}

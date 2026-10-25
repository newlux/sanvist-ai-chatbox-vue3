import type { FlowStepsData, FlowStepsParams } from "./types";
import { request } from "@/utils/request";

export type { FlowStep, FlowStepOption, FlowStepsData, FlowStepsParams } from "./types";

/**
 * 拉取某个模块的流程步骤（GET /flow/steps?module=ASK[&roleCode=OWNER]）。
 * 返回里按 stepCode 取用：IDENTITY 是身份选择页（标题 + 三个身份选项），
 * IDENTITY_DETAIL 是身份信息页（标题 + 设备胶囊），带 roleCode 时按该角色返回。
 *
 * 作业指导（module=GUIDE）另有 deviceType / deviceModel：选完设备再拉一次，
 * EXPERIENCE / MODEL_EXPERIENCE 的标题（「你以前带过带屏吗」「你开过新款SCC 400-8吗」）
 * 只有带上这两个上下文才下发。
 */
export function getFlowSteps(params: FlowStepsParams) {
  return request.get<FlowStepsData>("/flow/steps", {
    module: params.module,
    roleCode: params.roleCode,
    deviceType: params.deviceType,
    deviceModel: params.deviceModel,
    ttsSpeechRate: params.ttsSpeechRate,
  }).json();
}

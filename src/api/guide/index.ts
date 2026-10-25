import type {
  GuideProfileData,
  GuideProfileParams,
  RecommendedQuestionsData,
  RecommendedQuestionsParams,
} from "./types";
import { request } from "@/utils/request";

export type {
  GuideProfileData,
  GuideProfileParams,
  RecommendedQuestionsData,
  RecommendedQuestionsParams,
} from "./types";

/**
 * 作业指导资料 / 受众（GET /guide/profile，公开）。
 * 入参是「机型 + 两轮经验」：第一轮必填，第二轮不传时后端按第一轮兜底。
 * 返回的 audienceName 用于展示，operatorRole 直接作为 inputs.operator_role 回传给 chat。
 */
export function getGuideProfile(params: GuideProfileParams) {
  return request.get<GuideProfileData>("/guide/profile", {
    deviceModel: params.deviceModel,
    experience: params.experience,
    modelExperience: params.modelExperience,
  }).json();
}

/**
 * 推荐问题 + 播报文案（GET /recommended-questions/guide，公开）。
 * offset 每页递增（换一批），返回空数组表示已经展示完。
 */
export function getRecommendedGuideQuestions(params: RecommendedQuestionsParams) {
  return request.get<RecommendedQuestionsData>("/recommended-questions/guide", {
    deviceModel: params.deviceModel,
    experience: params.experience,
    modelExperience: params.modelExperience,
    count: params.count,
    offset: params.offset,
  }).json();
}

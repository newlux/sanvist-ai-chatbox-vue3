import { OPERATOR_ROLE_KEYS } from "@/api/user-role/operator-roles";

/**
 * 作业指导待机页文案（Ardot 580:1915 老司机 / 580:2276 新手司机）。
 *
 * 设计稿按「讲解模式」给了四套文案，App 里只区分新老手两档：
 * - skilled_operator → 580:1915「老司机，重点讲差异」
 * - novice_operator → 580:2276「新手司机，分步骤介绍」
 * 文案与问题都是设计稿里写死的，接口不参与；改文案对着设计稿改这里即可。
 */
export interface GuideWelcomeCopy {
  /** 问候标题 */
  title: string;
  /** 问候说明 */
  content: string;
  /** 「你可以这么问」下的问题，点一条直接发问 */
  questions: string[];
}

/** 没选过讲解模式时的兜底：按老司机那套展示，保证待机页不空 */
const DEFAULT_COPY: GuideWelcomeCopy = {
  title: "操作手，你好。",
  content: "好，我重点讲新功能的使用场景和注意事项。你可以直接问下面这几个问题。",
  questions: ["最近有什么升级的功能", "回顾一遍操作流程"],
};

const WELCOME_COPY: Record<string, GuideWelcomeCopy> = {
  [OPERATOR_ROLE_KEYS.skilled]: DEFAULT_COPY,
  [OPERATOR_ROLE_KEYS.novice]: {
    title: "操作手，你好。",
    content: "我先用分步骤的方式介绍。你可以从下面这几个问题开始，也可以直接说你想了解什么。",
    questions: ["找一段教学视频", "看懂一个仪表提示", "查一个最基础的操作步骤"],
  },
};

/** 按讲解模式取待机文案 */
export function getGuideWelcomeCopy(roleKey?: string): GuideWelcomeCopy {
  return WELCOME_COPY[String(roleKey || "").trim()] || DEFAULT_COPY;
}

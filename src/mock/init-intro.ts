import type { AiBlock } from "@/utils/ai-stream";

/**
 * 作业指导 / 任务协同进页面时的「自我介绍」mock 数据。
 *
 * 数据来源：`log/guide-ch.js`、`log/task-ch.js` 这两个真实 SSE 日志，
 * 用项目自己的解析器（`createDifyEventNormalizer` + `applyEventToBlocks`）跑出来的最终 blocks，
 * 只保留了用户要看的那几块，结构 / 字段与接口回包完全一致（渲染层不需要任何适配）：
 * - guide：一张开场引导卡（`guide` / `lead`），正文 + 三个可点设备；
 * - task：一段自我介绍正文（`answer`）+ 一张身份追问卡（`ask` / `slot`）。
 *
 * 约定：
 * - **不含 tips 块**：`<TIPS>` 是流式过程中的「正在思考」占位，初始化直接出结果，不该出现；
 * - 中英文分两份：日志后缀 `-ch` / `-en`。guide 的中英文都已提取，`log/task-en.js` 还没有，
 *   对应位置先留空数组 —— 空数组表示「这个语种暂时没有初始化内容」，页面会停在欢迎层，不会回退去请求接口；
 * - 纯前端数据，不落 storage、不带 sessionId / messageId（点赞 / 分享 / 播报这些依赖服务端消息的操作不挂）。
 */

export type InitIntroScene = "guide" | "task";

/** 中文：log/guide-ch.js */
const GUIDE_ZH: AiBlock[] = [
  {
    id: "guide-lead-mock",
    type: "guide-lead",
    payload: {
      text: "你好，我是 SANI，您的作业指导助手。\n按键怎么看、操作怎么做、作业前检查什么，都可以问我。\n我依据机型资料，新手分步讲，老师傅重点讲差异，提醒关键安全事项，现场操作请按规程确认。",
      lead_text: "可以和我说选择哪个设备（单选）",
      options: [
        "A｜320吨智混履带起重机 SCC3200T-EV",
        "B｜400吨燃油履带起重机 SCC4000A-8",
        "C｜39米智混泵车 390E-REEV",
      ],
    },
    complete: true,
  },
];

/** 中文：log/task-ch.js */
const TASK_ZH: AiBlock[] = [
  {
    id: "answer-mock",
    type: "answer",
    payload: {
      content: "你好，我是SANI，任务协同AI助手，可以帮你排明天的计划，也能在任务出现冲突时分析影响、讨论调整。\n\n我们准备了三个身份供你体验，你想体验哪个身份？",
    },
    complete: true,
  },
  {
    id: "ask-slot-role_select-mock",
    type: "ask-slot",
    payload: {
      slot_name: "role_select",
      selection: "single",
      title: "你想体验哪个身份？",
      description: "三个身份能做的业务动作相同，只是直接进入的异常不同。",
      options: [
        { label: "工地调度员", value: "A" },
        { label: "商混站调度员", value: "B" },
        { label: "泵送公司调度主管", value: "C" },
      ],
      original_query: "",
      // 不自动弹底部抽屉：初始化这轮只做「气泡里内联展示」，别一进页面就盖一层浮层
      auto_open: false,
    },
    complete: true,
  },
];

/** 英文：log/guide-en.js */
const GUIDE_EN: AiBlock[] = [
  {
    id: "guide-lead-mock",
    type: "guide-lead",
    payload: {
      text: "Hello, I'm SANI, your operation guidance assistant.\nYou can ask me how to read controls, perform operations, and carry out pre-operation checks.\nI use model-specific documentation, explain steps for beginners and key differences for experienced operators, and highlight essential safety points. Follow the applicable procedures for on-site operations.",
      lead_text: "Which device would you like to select? (single choice)",
      options: [
        "A｜SCC3200T-EV crawler crane",
        "B｜SCC4000A-8 crawler crane",
        "C｜390E-REEV 39 m concrete pump truck",
      ],
    },
    complete: true,
  },
];

/** 英文：log/task-en.js 待补 */
const TASK_EN: AiBlock[] = [];

const BLOCKS: Record<"zh_CN" | "en_US", Record<InitIntroScene, AiBlock[]>> = {
  zh_CN: { guide: GUIDE_ZH, task: TASK_ZH },
  en_US: { guide: GUIDE_EN, task: TASK_EN },
};

/**
 * 取某个页面、某个语种的初始化内容。
 *
 * `language` 传 `systemStore.header.Lang`（启动参数或设置弹层切换后的 `zh_CN` / `en_US`），
 * 非 `en` 开头一律按中文处理；返回空数组表示该语种还没有数据。
 */
export function getInitIntroBlocks(scene: InitIntroScene, language?: string): AiBlock[] {
  const isEnglish = String(language || "").trim().toLowerCase().startsWith("en");
  return BLOCKS[isEnglish ? "en_US" : "zh_CN"][scene] || [];
}

/**
 * 取初始化内容的「口播文本」，给 usePlainTts 播报用：
 * - task：自我介绍正文（`answer` 块）
 * - guide：开场引导卡正文（`guide-lead` 块）
 *
 * 追问卡、图表这类块不念；返回空串表示这份数据没有可播报的正文。
 */
export function getInitIntroSpeech(blocks: AiBlock[]): string {
  const answer = blocks.find(block => block.type === "answer");
  if (answer) return String(answer.payload.content || "").trim();

  const lead = blocks.find(block => block.type === "guide-lead");
  if (lead) return String(lead.payload.text || "").trim();

  return "";
}

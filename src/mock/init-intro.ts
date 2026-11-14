import type { AiBlock } from "@/utils/ai-stream";

/**
 * 作业指导 / 任务协同进页面时的「自我介绍」内容。
 *
 * 数据来源：
 * - guide：`log/guide-ch.js`、`log/guide-en.js` 两个真实 SSE 日志，用项目自己的解析器
 *   （`createDifyEventNormalizer` + `applyEventToBlocks`）跑出来的最终 blocks，
 *   只留一张开场引导卡（`guide` / `lead`），结构 / 字段与接口回包完全一致；
 * - task：产品给的三套开场文案（`三套开场文案.md`），每套含「显示正文 / Voice 文本 / 追问卡」，
 *   进页面随机挑**一整套**（正文、口播、选项必须同属一套、同一语言，不拆开随机）。
 *
 * 约定：
 * - **不含 tips 块**：`<TIPS>` 是流式过程中的「正在思考」占位，初始化直接出结果，不该出现；
 * - 纯前端数据，不落 storage、不带 sessionId / messageId（点赞 / 分享 / 播报这些依赖服务端消息的操作不挂）；
 * - 返回的 blocks 一律深拷贝：消息里改了 payload 不能污染这里的常量（下次进页面要还原成初始文案）。
 */

export type InitIntroScene = "guide" | "task";

/** 渲染 + 口播合成一份：两者必须来自同一套文案，所以由同一个函数一起返回 */
export interface InitIntroContent {
  blocks: AiBlock[];
  /** 口播文本（guide 取引导卡正文；task 取这套的 Voice 文本，跟显示正文不完全一致） */
  speech: string;
}

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

/** 任务协同的一套开场文案：正文 / 口播 / 追问卡（三件必须同套同语种） */
interface TaskIntroCopy {
  /** 气泡里显示的正文 */
  content: string;
  /** 口播文本：比显示正文口语化，两者不是同一段话 */
  voice: string;
  /** 追问卡标题 */
  title: string;
  /** 追问卡说明 */
  description: string;
  options: { label: string; value: string }[];
}

/** 三套共用同一组身份选项：value 与后端角色码一致 */
const ROLE_OPTIONS_ZH: TaskIntroCopy["options"] = [
  { label: "工地调度员", value: "A" },
  { label: "商混站调度员", value: "B" },
  { label: "泵送公司调度主管", value: "C" },
];

const ROLE_OPTIONS_EN: TaskIntroCopy["options"] = [
  { label: "Construction Site Dispatcher", value: "A" },
  { label: "Ready-Mix Plant Dispatcher", value: "B" },
  { label: "Concrete Pumping Company Dispatch Supervisor", value: "C" },
];

const TASK_TITLE_ZH = "你想体验哪个身份？";
const TASK_TITLE_EN = "Which role would you like to try?";
const TASK_DESC_ZH = "三个身份对应不同的现场异常，能体验的业务动作相同。";
const TASK_DESC_EN = "Each role starts with a different site issue. You can try the same actions in all three roles.";

/** 三套中文开场文案（顺序与文档一致） */
const TASK_ZH: TaskIntroCopy[] = [
  {
    content: "你好，我是 SANI，任务协同 AI 助理。\n\n为了让你更好地体验任务协同，我们准备了三个身份。你可以选一个，看看遇到现场异常和任务冲突时，我会怎样帮你分析影响、协调任务、讨论调整办法。",
    voice: "你好，我是 SANI，任务协同 AI 助理。为了方便你体验，我们准备了三个身份。选一个，我带你看看现场遇到异常冲突时，任务会受什么影响、又该怎么协调调整。",
    title: TASK_TITLE_ZH,
    description: TASK_DESC_ZH,
    options: ROLE_OPTIONS_ZH,
  },
  {
    content: "你好，我是 SANI，任务协同 AI 助理。\n\n第一次体验，可以从我们准备的三个身份里选一个。我会结合对应的现场异常，和你一起看看哪些任务受到影响、该怎么协调，以及有哪些调整办法。",
    voice: "你好，我是 SANI，任务协同 AI 助理。初次体验，我们准备了三个身份供你选择。选一个，我们从对应的现场异常看起，分析任务受到的影响，再讨论怎么协调和调整。",
    title: TASK_TITLE_ZH,
    description: TASK_DESC_ZH,
    options: ROLE_OPTIONS_ZH,
  },
  {
    content: "你好，我是 SANI，任务协同 AI 助理。\n\n为了让你更直观地了解我能做什么，我们准备了三个身份供你体验。你可以选一个，和我一起分析现场的异常冲突，看看任务怎样协调、安排如何调整。",
    voice: "你好，我是 SANI，任务协同 AI 助理。我们准备了三个身份，让你体验我怎样协助处理现场的异常冲突。你可以选一个，和我一起看影响、讨论任务怎么协调和调整。",
    title: TASK_TITLE_ZH,
    description: TASK_DESC_ZH,
    options: ROLE_OPTIONS_ZH,
  },
];

/** 三套英文开场文案：与中文一一对应 */
const TASK_EN: TaskIntroCopy[] = [
  {
    content: "Hello, I'm SANI, your Task.Collaboration AI assistant.\n\nTo help you try Task.Collaboration, we've prepared three roles to choose from. Pick one to see how I can help you assess the impact of site issues and task conflicts, coordinate tasks, and discuss possible adjustments.",
    voice: "Hello, I'm SANI, your Task.Collaboration AI assistant. We've prepared three roles to help you get started. Choose one, and I'll show you how site issues and conflicts can affect tasks and how we can coordinate and adjust the work.",
    title: TASK_TITLE_EN,
    description: TASK_DESC_EN,
    options: ROLE_OPTIONS_EN,
  },
  {
    content: "Hello, I'm SANI, your Task.Collaboration AI assistant.\n\nStart your first visit by choosing one of the three roles we've prepared. We'll look at the site issue for that role, see which tasks it affects, and discuss how to coordinate the work and what adjustments we could make.",
    voice: "Hello, I'm SANI, your Task.Collaboration AI assistant. We've prepared three roles for you to try on your first visit. Choose one, and we'll start with the site issue for that role, look at its impact on tasks, and discuss how to coordinate and adjust the work.",
    title: TASK_TITLE_EN,
    description: TASK_DESC_EN,
    options: ROLE_OPTIONS_EN,
  },
  {
    content: "Hello, I'm SANI, your Task.Collaboration AI assistant.\n\nTo help you see what I can do, we've prepared three roles for you to try. Choose one, and we'll look at site issues and conflicts, discuss how to coordinate tasks, and consider changes to the schedule.",
    voice: "Hello, I'm SANI, your Task.Collaboration AI assistant. We've prepared three roles to show you how I help with site issues and conflicts. Choose one, and we'll look at their impact and discuss how to coordinate and adjust the work.",
    title: TASK_TITLE_EN,
    description: TASK_DESC_EN,
    options: ROLE_OPTIONS_EN,
  },
];

/** 把一套文案拼成气泡要的两个 block（正文 + 内联追问卡） */
function buildTaskBlocks(copy: TaskIntroCopy): AiBlock[] {
  return [
    {
      id: "answer-mock",
      type: "answer",
      payload: { content: copy.content },
      complete: true,
    },
    {
      id: "ask-slot-role_select-mock",
      type: "ask-slot",
      payload: {
        slot_name: "role_select",
        selection: "single",
        title: copy.title,
        description: copy.description,
        options: copy.options,
        original_query: "",
        // 不自动弹底部抽屉：初始化这轮只做「气泡里内联展示」，别一进页面就盖一层浮层
        auto_open: false,
      },
      complete: true,
    },
  ];
}

/** blocks 深拷贝：消息里改 payload 不会污染上面的常量 */
function cloneBlocks(blocks: AiBlock[]): AiBlock[] {
  return JSON.parse(JSON.stringify(blocks)) as AiBlock[];
}

/**
 * 从 blocks 里取「要念的正文」：guide 取引导卡正文，task 取自我介绍正文。
 *
 * 手动点播报时用它兜底（消息上没有 `mockSpeech` 的情况）；task 的 Voice 与显示正文不同，
 * 优先用消息上带的那份。
 */
export function getInitIntroSpeech(blocks: AiBlock[]): string {
  const answer = blocks.find(block => block.type === "answer");
  if (answer) return String(answer.payload.content || "").trim();

  const lead = blocks.find(block => block.type === "guide-lead");
  return lead ? String(lead.payload.text || "").trim() : "";
}

/**
 * 取某个页面、某个语种的初始化内容（渲染用 blocks + 口播用文本）。
 *
 * `language` 传 `systemStore.header.Lang`（启动参数或设置弹层切换后的 `zh_CN` / `en_US`），
 * 非 `en` 开头一律按中文处理。返回 `blocks` 为空数组表示该语种还没有数据。
 *
 * task 每次调用随机挑一整套文案（正文 / 口播 / 选项同套同语言），所以要**在进入页面时取一次**、
 * 后续渲染和播报都用这同一份，不要分别调用两次。
 */
export function getInitIntroContent(scene: InitIntroScene, language?: string): InitIntroContent {
  const isEnglish = String(language || "").trim().toLowerCase().startsWith("en");

  if (scene === "task") {
    const copies = isEnglish ? TASK_EN : TASK_ZH;
    if (!copies.length) return { blocks: [], speech: "" };
    const copy = copies[Math.floor(Math.random() * copies.length)];
    return { blocks: buildTaskBlocks(copy), speech: copy.voice };
  }

  const blocks = isEnglish ? GUIDE_EN : GUIDE_ZH;
  return { blocks: cloneBlocks(blocks), speech: getInitIntroSpeech(blocks) };
}

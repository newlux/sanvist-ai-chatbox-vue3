import type {
  ChatStreamEvent,
  Identifier,
  MessageEndEvent,
} from "@/api/chat/types";

export type AiBlockType = "answer" | "tips" | "think" | "suggestion" | "ask-slot" | "guide-step" | "guide-suggestion"
  | "guide-check" | "guide-lead" | "chart" | "table" | "metric" | "image" | "video" | "source" | "status" | "tool_call" | "error"
  // assistant-navigation 解析层一直在产出（历史/流式都走它），之前漏在联合类型里导致两处 TS 报错；
  // gantt 是调度视图入口卡（scene=task / type=gantt）；
  // report-card 是听汇报入口卡（<WORK_REPORT> 标签命中后由 useChatSend 追加，不再自动跳播报页）。
  | "assistant-navigation" | "gantt" | "voice" | "report-card";

/** 深度思考步骤：由 status 事件按 node 聚合而来 */
export interface ThinkStep {
  node: string;
  message: string;
  complete: boolean;
}

export interface AiBlock {
  id: string;
  type: AiBlockType;
  payload: Record<string, unknown>;
  complete: boolean;
}

export interface StreamBlockUpdate {
  blocks: AiBlock[];
  conversationId?: Identifier;
  messageId?: Identifier;
  taskId?: Identifier;
  metadata?: MessageEndEvent["metadata"];
  /**
   * 本轮流中出现的「直接切页」目标（assistant_scene 事件）：
   * operations_assistant / work_guidance_assistant / task_coordination_assistant，由 useChatSend 映射成路由。
   */
  assistantScene?: string;
  /**
   * 本轮流中出现的「语言切换」指令（language_switch 事件）：`zh` / `en`，
   * 不落 block、不占位，由 useChatSend 切界面语言并落 `/settings`。
   */
  languageSwitch?: string;
  processSubtitle?: string | null;
  processStatus?: {
    phase: "thinking" | "succeeded" | "failed" | "stopped";
    title?: string;
    elapsedSeconds?: number;
  };
  receivedContent: boolean;
}

function completeBlocks(blocks: AiBlock[]) {
  return blocks.map(block => ({ ...block, complete: true }));
}

function upsertBlock(
  blocks: AiBlock[],
  id: string,
  type: AiBlockType,
  payload: Record<string, unknown>,
  complete?: boolean,
) {
  const index = blocks.findIndex(block => block.id === id);
  if (index < 0) return [...blocks, { id, type, payload, complete: Boolean(complete) }];

  const nextBlocks = [...blocks];
  nextBlocks[index] = {
    ...nextBlocks[index],
    payload: { ...nextBlocks[index].payload, ...payload },
    complete: complete ?? nextBlocks[index].complete,
  };
  return nextBlocks;
}

/**
 * 图片块的 upsert：命中已有块时把本次 items **合并**（去重），而不是像 upsertBlock 那样
 * 整体替换 payload——重放/合并的 image 事件可能带多张图，直接覆盖会丢掉流式阶段已有的图。
 * 未命中时按原样新建，位置落在数组末尾（与 upsertBlock 一致）。
 */
function upsertImageBlocks(
  blocks: AiBlock[],
  id: string,
  items: unknown[],
  fallbackIndex: number,
): AiBlock[] {
  const index = blocks.findIndex(block => block.id === id);
  if (index < 0) {
    return [...blocks, { id, type: "image", payload: { items }, complete: true }];
  }

  const existing = blocks[index];
  const existingItems = Array.isArray(existing.payload.items) ? existing.payload.items : [];
  // 按 chunk_id 去重合并：已存在的 chunk_id 不再重复加入（重放会把图3-24、图3-25 都带来）
  const merged = [...existingItems];
  for (const item of items) {
    const chunkId = String((item as Record<string, unknown> | undefined)?.chunk_id || "").trim();
    const already = merged.some(it => String((it as Record<string, unknown> | undefined)?.chunk_id || "").trim() === chunkId);
    if (!already) merged.push(item);
  }
  const nextBlocks = [...blocks];
  nextBlocks[index] = { ...existing, payload: { ...existing.payload, items: merged }, complete: true };
  return nextBlocks;
}

/**
 * 合并一段 answer 正文。
 *
 * 增量事件（delta）直接拼接；但同一条回答偶尔会被「整段重放」一次
 * （换了事件类型 / 换了通道，replace 标记却没带），拼上去正文就会变成两份。
 * 重放的识别方式：新内容以已有正文开头 —— 正常的 delta 不可能以整段已收内容开头。
 * 门槛放在 8 个字符，避免「你好」「好的」这类短前缀被误判成重放。
 */
function mergeAnswerContent(previous: string, chunk: string, replace: boolean) {
  if (replace) return chunk;
  const base = previous.trim();
  // 重放常常带一个前导换行（协议换行 / 段落分隔），先削掉再比
  if (base.length >= 8 && chunk.trimStart().startsWith(base)) return chunk;
  return `${previous}${chunk}`;
}

function readThinkSteps(blocks: AiBlock[]): ThinkStep[] {
  const steps = blocks.find(block => block.id === "think-0")?.payload.steps;
  return Array.isArray(steps) ? steps as ThinkStep[] : [];
}

function stablePayloadId(prefix: string, values: unknown[], fallbackIndex: number) {
  const parts = values.map(value => String(value || "").trim()).filter(Boolean);
  return parts.length ? `${prefix}-${parts.join("-")}` : `${prefix}-${fallbackIndex}`;
}

/** 卡片载荷快照：用来判断「这张卡片是不是已经被收过了」 */
function payloadKey(payload: unknown) {
  try {
    return JSON.stringify(payload ?? null) || "";
  }
  catch {
    return String(payload);
  }
}

export function buildInitialBlocks(): AiBlock[] {
  return [];
}

const FINAL_REPLY_BLOCK_TYPES = new Set<AiBlockType>([
  "answer", "guide-lead", "guide-step", "guide-check", "guide-suggestion",
  "ask-slot", "table", "chart", "gantt", "assistant-navigation", "image", "video", "voice",
]);

function hasFinalReply(blocks: AiBlock[]) {
  return blocks.some(block => FINAL_REPLY_BLOCK_TYPES.has(block.type)
    && (block.type !== "answer" || Boolean(String(block.payload.content || "").trim())));
}

export function applyEventToBlocks(blocks: AiBlock[], event: ChatStreamEvent): StreamBlockUpdate {
  const update = reduceEventToBlocks(blocks, event);
  // 正式回复也可能由引导卡、表格等内容组成，收到可展示的回复后统一移除临时提示。
  if (update.receivedContent && blocks.some(block => block.type === "tips") && hasFinalReply(update.blocks)) {
    return { ...update, blocks: update.blocks.filter(block => block.type !== "tips"), processSubtitle: null };
  }
  return update;
}

function reduceEventToBlocks(
  blocks: AiBlock[],
  event: ChatStreamEvent,
): StreamBlockUpdate {
  const base = {
    blocks,
    conversationId: event.conversationId,
    messageId: event.messageId,
    taskId: event.taskId,
    receivedContent: false,
  };

  switch (event.event) {
    case "message_start":
      return base;
    case "status": {
      const { node, message } = event.data;
      if (!message) return base;
      return {
        ...base,
        processStatus: {
          // status.completed 只代表当前节点完成；整轮结束由 message_end 确认。
          phase: "thinking",
          title: node ? String(node) : undefined,
        },
      };
    }
    case "tips": {
      if (!event.text.trim() || hasFinalReply(blocks)) return base;
      const tipsIndex = blocks.filter(block => block.type === "tips").length;
      return {
        ...base,
        blocks: upsertBlock(blocks, `tips-${tipsIndex}`, "tips", { content: event.text }, true),
        receivedContent: true,
      };
    }
    case "message": {
      if (!event.answer) return base;
      if (!event.answer.trim() && blocks.some(block => block.type === "tips")) return base;
      const answerBlocks = blocks.filter(block => block.type === "answer");
      // 低端安卓 WebView 不支持 ES2022 的 Array.prototype.at
      const lastBlock = blocks[blocks.length - 1];
      const lastAnswerBlock = answerBlocks[answerBlocks.length - 1];
      /**
       * replace 只表示「这一段是完整正文，覆盖旧的」（Dify 的 message_replace /
       * Agent 收尾整段回包），不是「另起一段」。之前按 `!event.replace` 判断会新开
       * `answer-1`，于是流式正文和收尾整段同时存在 —— 气泡里同一条回复出现两份。
       * 有 answer 块就写回它本身；一个都没有才是首块。
       */
      const answerId = event.replace
        ? (lastAnswerBlock?.id || "answer-0")
        : (lastBlock?.type === "answer" ? lastBlock.id : `answer-${answerBlocks.length}`);
      const answerIndex = blocks.findIndex(block => block.id === answerId);
      const previousContent = answerIndex < 0
        ? ""
        : String(blocks[answerIndex].payload.content || "");
      return {
        ...base,
        blocks: upsertBlock(blocks, answerId, "answer", {
          content: mergeAnswerContent(previousContent, event.answer, Boolean(event.replace)),
        }),
        receivedContent: true,
      };
    }
    case "suggestion":
      return {
        ...base,
        blocks: upsertBlock(blocks, "suggestion-0", "suggestion", event.data),
      };
    case "ask_slot": {
      const slotName = String(event.data.slot_name || "").trim();
      const slotIndex = blocks.filter(block => block.type === "ask-slot").length;
      return {
        ...base,
        blocks: upsertBlock(blocks, stablePayloadId("ask-slot", [slotName], slotIndex), "ask-slot", event.data, true),
        receivedContent: true,
      };
    }
    case "guide_step": {
      const steps = Array.isArray(event.data?.steps) ? event.data.steps : [];
      if (!steps.length) return base;
      const stepIndex = blocks.filter(block => block.type === "guide-step").length;
      const title = String(event.data?.title || "").trim();
      return {
        ...base,
        blocks: upsertBlock(blocks, stablePayloadId("guide-step", [title], stepIndex), "guide-step", event.data, true),
        receivedContent: true,
      };
    }
    case "guide_check": {
      const stepId = String(event.data?.step_id || "").trim();
      const checkIndex = blocks.filter(block => block.type === "guide-check").length;
      return {
        ...base,
        blocks: upsertBlock(blocks, stablePayloadId("guide-check", [stepId], checkIndex), "guide-check", event.data, true),
        receivedContent: true,
      };
    }
    case "guide_lead": {
      // 开场引导（COMPONENT scene=guide / type=lead）：正文 + 一轮单选，正文与选项都可能缺一项
      const text = String(event.data?.text || "").trim();
      const options = Array.isArray(event.data?.options) ? event.data.options : [];
      if (!text && !options.length) return base;
      const leadIndex = blocks.filter(block => block.type === "guide-lead").length;
      return {
        ...base,
        blocks: upsertBlock(blocks, stablePayloadId("guide-lead", [text], leadIndex), "guide-lead", event.data, true),
        receivedContent: true,
      };
    }
    case "voice": {
      // 老师傅导语文本（COMPONENT scene=guide / type=voice）：一句普通正文，渲染在回答顶部并参与播报。
      // 新手（分步骤）由消费侧按 operator_role 过滤，这里统一落 voice 块。
      const text = String(event.data?.text || "").trim();
      if (!text) return base;
      // 同一条回答只有一个导语，固定 voice-0：无论 agent_message / message / message_replace /
      // workflow_finished 重复解析多少次、messageId 是否变化、text 是否暂不完整，
      // 都 upsertBlock 覆盖同一块，不会累积出多个 voice 块（显示两次/三次的根因）。
      const voiceId = "voice-0";
      return {
        ...base,
        blocks: upsertBlock(blocks, voiceId, "voice", event.data, true),
        receivedContent: true,
      };
    }
    case "guide_suggestion": {
      const options = Array.isArray(event.data?.options) ? event.data.options : [];
      if (!options.length) return base;
      /**
       * 与表格 / 图表同理：同一张追问卡会被重复下发（流式正文里给过一次，
       * workflow_finished 的 outputs.answer 再回灌一次），不能每次新开一块。
       * 追问卡的 question 允许为空（协议只给 note / options），此时 id 无法按题目稳定，
       * 按「已有数量」递增就会把同一张卡拆成两块 —— 气泡里出现两份「可继续了解」。
       * 这里按整包内容去重：内容完全相同的卡写回原块，内容不同（新一轮追问）才新开。
       */
      const key = payloadKey(event.data);
      const duplicated = blocks.find(
        block => block.type === "guide-suggestion" && payloadKey(block.payload) === key,
      );
      const suggestionId = duplicated?.id
        || stablePayloadId(
          "guide-suggestion",
          [String(event.data?.question || "").trim()],
          blocks.filter(block => block.type === "guide-suggestion").length,
        );
      return {
        ...base,
        blocks: upsertBlock(blocks, suggestionId, "guide-suggestion", event.data, true),
        receivedContent: true,
      };
    }
    case "chart": {
      const chartData = event.data || {};
      const option = chartData.option;
      if (!option || typeof option !== "object") return base;
      const layout = chartData.layout && typeof chartData.layout === "object" ? chartData.layout : undefined;
      // 与表格同理：同一张图被重放时写回原来的块，别多画一张
      const key = payloadKey({ option, layout });
      const duplicated = blocks.find(block => block.type === "chart" && payloadKey(block.payload) === key);
      const chartId = duplicated?.id || `chart-${blocks.filter(block => block.type === "chart").length}`;
      return {
        ...base,
        blocks: upsertBlock(blocks, chartId, "chart", { option, layout }),
        receivedContent: true,
      };
    }
    case "message_end":
      return {
        ...base,
        blocks: completeBlocks(blocks.filter(block => block.type !== "tips")),
        metadata: event.metadata,
        processSubtitle: null,
        processStatus: {
          phase: event.metadata.status === "failed"
            ? "failed"
            : event.metadata.status === "stopped"
              ? "stopped"
              : "succeeded",
          elapsedSeconds: Number.isFinite(Number(event.metadata.duration_ms))
            ? Number(event.metadata.duration_ms) / 1000
            : undefined,
        },
      };
    case "think": {
      const { node, message, phase, append } = event.data;
      if (!node || !message) return base;
      const previousSteps = readThinkSteps(blocks);
      const stepIndex = previousSteps.findIndex(item => item?.node === node);
      const steps = [...previousSteps];
      const previous = stepIndex < 0 ? undefined : steps[stepIndex];
      const step: ThinkStep = {
        node: String(node),
        message: append ? `${previous?.message || ""}${message}` : String(message),
        complete: phase === "completed",
      };
      if (stepIndex < 0) steps.push(step);
      else steps[stepIndex] = { ...previous, ...step };
      return {
        ...base,
        blocks: upsertBlock(blocks, "think-0", "think", { steps }),
        receivedContent: true,
      };
    }
    case "subtitle":
      return {
        ...base,
        processSubtitle: event.message,
      };
    case "table": {
      /**
       * 表格不能按「已有 table 块数量」生成 id：同一张表会被重放一次
       * （`<COMPONENT type="table">` 在正文里出现两遍，或者 workflow_finished 的
       * outputs.answer 把协议块再回灌一遍），每来一次就新开一块 —— 气泡里同一条回答
       * 出现两张一模一样的表，和之前正文重复是同一个成因。
       * 内容完全相同的表写回原来那一块，内容不同才新开。
       */
      const key = payloadKey(event.data);
      const duplicated = blocks.find(block => block.type === "table" && payloadKey(block.payload) === key);
      const tableId = duplicated?.id
        || `table-${blocks.filter(block => block.type === "table").length}`;
      return {
        ...base,
        blocks: upsertBlock(blocks, tableId, "table", event.data, true),
        receivedContent: true,
      };
    }
    case "gantt": {
      // 一张调度视图卡：同一 viewId（该视图「业务阶段 + 数据上下文」的唯一标识）重复下发时覆盖同一块，避免多张卡。
      // viewId 缺失时也必须稳定落在同一块（固定 gantt-0），不能按「已有 gantt 块数量」递增——
      // 否则同一视图在流式里被多次下发时会拆成多张卡，stage / rows 各散落一块，多轮里卡片数据串扰。
      const viewId = String(event.data?.viewId || "").trim();
      const ganttId = viewId ? `gantt-${viewId}` : "gantt-0";
      const ganttIndex = blocks.findIndex(block => block.id === ganttId);
      // gantt 是「整包快照」：每次下发都是该视图当前阶段的完整数据（viewType / card / rows / stage …），
      // 直接整包替换 payload，不做浅合并——浅合并会把「本次省略的字段」残留成上一阶段的数据，
      // 让卡片绑错业务阶段（例如执行中阶段还显示计划中的 rows）。
      const ganttBlock: AiBlock = { id: ganttId, type: "gantt", payload: event.data, complete: true };
      const nextBlocks = ganttIndex < 0
        ? [...blocks, ganttBlock]
        : blocks.map((block, index) => index === ganttIndex ? ganttBlock : block);
      return {
        ...base,
        blocks: nextBlocks,
        receivedContent: true,
      };
    }
    case "assistant_navigation": {
      // 跳转确认（维修助理）：一条回复只保留一个确认块，重复下发时覆盖同一块。
      // SSE 顶层引用要映射进 payload（conversation_id → sessionId，message_id → conversationId），
      // 进入维修助理后靠这两个值轮询 summary；缺了它们回调存储会被整段跳过。
      const navigationPayload: Record<string, unknown> = {
        ...event.data,
        ...(event.conversationId ? { sessionId: event.conversationId } : {}),
        ...(event.messageId ? { conversationId: event.messageId } : {}),
      };
      return {
        ...base,
        blocks: upsertBlock(blocks, "assistant-navigation-0", "assistant-navigation", navigationPayload, true),
        receivedContent: true,
      };
    }
    case "assistant_scene": {
      // 直接切页的跳转指令（运营助手 / 作业指导 / 任务协同）：不落 block、不占位，
      // 只把目标带进快照，由 useChatSend 在整轮结束时切页，避免把 JSON / 空卡片留在气泡里。
      const target = String(event.data?.target || "").trim();
      if (!target) return base;
      return {
        ...base,
        assistantScene: target,
      };
    }
    case "language_switch": {
      /**
       * 语言切换指令：不落 block、不占位（同 assistant_scene），只把目标语言带进快照。
       * 落到气泡里就会多出一张空卡片 / 一段 JSON，正文那句「Sure, I've switched the interface…」
       * 才是给人看的。
       */
      const language = String(event.data?.language || "").trim().toLowerCase();
      if (!language) return base;
      return {
        ...base,
        languageSwitch: language,
      };
    }
    case "image": {
      const imageIndex = blocks.filter(block => block.type === "image").length;
      const items = Array.isArray(event.data?.items) ? event.data.items : [];
      /**
       * 图片块的稳定 id 只按「首张图的 chunk_id」生成，而不是用全部 chunk_id 拼一串。
       *
       * 原因：流式阶段每张图是独立 image 事件（id=image-<图A>、image-<图B>）；而
       * workflow_finished 重放 outputs.answer 时，`extractSanvistEvents` 的相邻图片合并
       * 逻辑（dify.ts appendGuideEvent）会把相邻图片并成一个 image 事件（items 含多张）。
       * 若 id 用全部 chunk_id 拼接，合并后的 id（image-<图A>-<图B>）就与流式阶段各自独立的
       * id（image-<图A>）对不上，upsertBlock 找不到已有块、当成新块 append 到末尾——
       * 于是「参考来源（source）」之后又冒出一个重复的图片堆叠块。
       *
       * 这里只取首项 chunk_id 作 id 锚点，让重放/合并的 image 事件命中流式阶段已有的
       * 首图块；再在下方把本次 items 合并进去（去重），保持原块位置、不新增到 source 之后。
       */
      const firstChunkId = String((items[0] as Record<string, unknown> | undefined)?.chunk_id || "").trim();
      const imageId = stablePayloadId("image", firstChunkId ? [firstChunkId] : [], imageIndex);
      return {
        ...base,
        blocks: upsertImageBlocks(blocks, imageId, items, imageIndex),
        receivedContent: true,
      };
    }
    case "video": {
      const videoIndex = blocks.filter(block => block.type === "video").length;
      const videoId = stablePayloadId("video", [event.data?.chunk_id], videoIndex);
      return {
        ...base,
        blocks: upsertBlock(blocks, videoId, "video", event.data, true),
        receivedContent: true,
      };
    }
    case "source": {
      const sourceIndex = blocks.filter(block => block.type === "source").length;
      const evidence = Array.isArray(event.data?.evidence) ? event.data.evidence : [];
      const sourceId = stablePayloadId("source", evidence.map(item => (item as Record<string, unknown>)?.chunk_id), sourceIndex);
      return {
        ...base,
        blocks: upsertBlock(blocks, sourceId, "source", event.data, true),
        receivedContent: true,
      };
    }
    case "metric":
    case "tool_call":
      return base;
  }
}

import type {
  ChatStreamEvent,
  Identifier,
  MessageEndEvent,
} from "@/api/chat/types";

export type AiBlockType = "answer" | "think" | "suggestion" | "ask-slot" | "guide-step" | "guide-suggestion"
  | "guide-check" | "chart" | "table" | "metric" | "image" | "video" | "source" | "status" | "tool_call" | "error"
  // assistant-navigation 解析层一直在产出（历史/流式都走它），之前漏在联合类型里导致两处 TS 报错；
  // gantt 是调度视图入口卡（scene=task / type=gantt）。
  | "assistant-navigation" | "gantt";

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

function readThinkSteps(blocks: AiBlock[]): ThinkStep[] {
  const steps = blocks.find(block => block.id === "think-0")?.payload.steps;
  return Array.isArray(steps) ? steps as ThinkStep[] : [];
}

function stablePayloadId(prefix: string, values: unknown[], fallbackIndex: number) {
  const parts = values.map(value => String(value || "").trim()).filter(Boolean);
  return parts.length ? `${prefix}-${parts.join("-")}` : `${prefix}-${fallbackIndex}`;
}

export function buildInitialBlocks(): AiBlock[] {
  return [];
}

export function applyEventToBlocks(
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
      const { node, message, phase } = event.data;
      if (!message) return base;
      return {
        ...base,
        processStatus: {
          phase: phase === "completed" ? "succeeded" : "thinking",
          title: node ? String(node) : undefined,
        },
      };
    }
    case "message": {
      if (!event.answer) return base;
      const answerBlocks = blocks.filter(block => block.type === "answer");
      // 低端安卓 WebView 不支持 ES2022 的 Array.prototype.at
      const lastBlock = blocks[blocks.length - 1];
      const answerId = !event.replace && lastBlock?.type === "answer"
        ? lastBlock.id
        : `answer-${answerBlocks.length}`;
      const answerIndex = blocks.findIndex(block => block.id === answerId);
      const previousContent = answerIndex < 0
        ? ""
        : String(blocks[answerIndex].payload.content || "");
      return {
        ...base,
        blocks: upsertBlock(blocks, answerId, "answer", {
          content: event.replace ? event.answer : `${previousContent}${event.answer}`,
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
    case "guide_suggestion": {
      const options = Array.isArray(event.data?.options) ? event.data.options : [];
      if (!options.length) return base;
      const suggestionIndex = blocks.filter(block => block.type === "guide-suggestion").length;
      const question = String(event.data?.question || "").trim();
      return {
        ...base,
        blocks: upsertBlock(
          blocks,
          stablePayloadId("guide-suggestion", [question], suggestionIndex),
          "guide-suggestion",
          event.data,
          true,
        ),
        receivedContent: true,
      };
    }
    case "chart": {
      const chartData = event.data || {};
      const option = chartData.option;
      if (!option || typeof option !== "object") return base;
      const layout = chartData.layout && typeof chartData.layout === "object" ? chartData.layout : undefined;
      const chartIndex = blocks.filter(block => block.type === "chart").length;
      const chartId = `chart-${chartIndex}`;
      return {
        ...base,
        blocks: upsertBlock(blocks, chartId, "chart", { option, layout }),
        receivedContent: true,
      };
    }
    case "message_end":
      return {
        ...base,
        blocks: completeBlocks(blocks),
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
      const tableIndex = blocks.filter(block => block.type === "table").length;
      return {
        ...base,
        blocks: upsertBlock(blocks, `table-${tableIndex}`, "table", event.data, true),
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
      // 跳转确认（维修助手）：一条回复只保留一个确认块，重复下发时覆盖同一块。
      // SSE 顶层引用要映射进 payload（conversation_id → sessionId，message_id → conversationId），
      // 进入维修助手后靠这两个值轮询 summary；缺了它们回调存储会被整段跳过。
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
    case "image": {
      const imageIndex = blocks.filter(block => block.type === "image").length;
      const items = Array.isArray(event.data?.items) ? event.data.items : [];
      const imageId = stablePayloadId("image", items.map(item => (item as Record<string, unknown>)?.chunk_id), imageIndex);
      return {
        ...base,
        blocks: upsertBlock(blocks, imageId, "image", event.data, true),
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

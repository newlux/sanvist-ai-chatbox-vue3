import type {
  ChatStreamEvent,
  Identifier,
  MessageEndEvent,
} from "@/api/chat/types";

export type AiBlockType = "answer" | "think" | "suggestion" | "chart" | "table" | "metric" | "image" | "video" | "source" | "status" | "tool_call" | "error";

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
      const lastBlock = blocks.at(-1);
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

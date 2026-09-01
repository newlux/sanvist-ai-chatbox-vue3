import type {
  ChatStreamEvent,
  Identifier,
  MessageEndEvent,
} from "@/api/chat/types";

export type AiBlockType = "answer" | "think" | "suggestion" | "chart" | "table" | "metric" | "status" | "tool_call" | "error";

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
      const answerIndex = blocks.findIndex(block => block.id === "answer-0");
      const previousContent = answerIndex < 0
        ? ""
        : String(blocks[answerIndex].payload.content || "");
      return {
        ...base,
        blocks: upsertBlock(blocks, "answer-0", "answer", {
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
    case "table":
    case "metric":
    case "tool_call":
      return base;
  }
}

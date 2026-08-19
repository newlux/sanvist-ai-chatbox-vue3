import type {
  ChatStreamEvent,
  Identifier,
  MessageEndEvent,
} from "@/api/chat/types";

export type AiBlockType = "answer" | "think" | "suggestion" | "chart";

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
  metadata?: MessageEndEvent["metadata"];
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
    receivedContent: false,
  };

  switch (event.event) {
    case "message_start":
      return base;
    case "status": {
      const { node, message, phase } = event.data;
      if (!node || !message) return base;
      const thinkIndex = blocks.findIndex(block => block.id === "think-0");
      const previousSteps = thinkIndex < 0
        ? []
        : Array.isArray(blocks[thinkIndex].payload.steps)
          ? blocks[thinkIndex].payload.steps
          : [];
      const stepIndex = previousSteps.findIndex(step => step?.node === node);
      const steps = [...previousSteps];
      const step = { node, message, complete: phase === "completed" };
      if (stepIndex < 0) steps.push(step);
      else steps[stepIndex] = { ...steps[stepIndex], ...step };
      return {
        ...base,
        blocks: upsertBlock(blocks, "think-0", "think", { steps }),
        receivedContent: true,
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
          content: `${previousContent}${event.answer}`,
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
      const chartIndex = blocks.filter(block => block.type === "chart").length;
      const chartId = `chart-${chartIndex}`;
      return {
        ...base,
        blocks: upsertBlock(blocks, chartId, "chart", { option }),
        receivedContent: true,
      };
    }
    case "message_end":
      return {
        ...base,
        blocks: completeBlocks(blocks),
        metadata: event.metadata,
      };
    case "table":
    case "metric":
    case "think":
    case "tool_call":
      return base;
  }
}

import type {
  ChatStreamEvent,
  Identifier,
  MessageEndEvent,
} from "@/api/chat/types";
import { unwrapGuideAnswerEnvelope } from "./answerEnvelope";

export type AiBlockType = "answer" | "think" | "suggestion" | "chart" | "table" | "metric" | "status" | "tool_call" | "error" | "evidence" | "pending";

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
      // 累积文本可能落在 answer-0（普通正文）或 pending-0（整包 JSON 还没到齐）里
      const packingIndex = blocks.findIndex(block => block.id === "pending-0");
      const answerIndex = blocks.findIndex(block => block.id === "answer-0");
      const previousContent = packingIndex >= 0
        ? String(blocks[packingIndex].payload.content || "")
        : answerIndex < 0
          ? ""
          : String(blocks[answerIndex].payload.content || "");
      const merged = event.replace ? event.answer : `${previousContent}${event.answer}`;

      // Guide 场景：后端把 answer+evidence 整体序列化成 JSON 塞进 answer 文本。
      // 整包到齐 → 解包，正文换成真正的 markdown，evidence 独立成块交给 UI。
      // 未到齐且看着像 JSON 开头 → 进 pending 攒包占位，绝不让半截 JSON 混进正文。
      const envelope = unwrapGuideAnswerEnvelope(merged);
      if (envelope) {
        let nextBlocks = upsertBlock(blocks, "answer-0", "answer", {
          content: envelope.answer,
        });
        if (envelope.evidence.length) {
          nextBlocks = upsertBlock(nextBlocks, "evidence-0", "evidence", {
            items: envelope.evidence,
          });
        }
        const settled = nextBlocks.filter(block => block.id !== "pending-0");
        return {
          ...base,
          blocks: settled,
          receivedContent: true,
        };
      }

      if (merged.trimStart().startsWith("{")) {
        const packing = upsertBlock(blocks, "pending-0", "pending", {
          content: merged,
        });
        return {
          ...base,
          blocks: packing,
          receivedContent: false,
        };
      }

      return {
        ...base,
        blocks: upsertBlock(blocks, "answer-0", "answer", {
          content: merged,
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
    case "message_end": {
      let finalBlocks = blocks;
      // 攒包占位收尾：整包到齐 → 解包成 answer/evidence；断流/未构成合法 JSON →
      // 把已收到的原文原样交给正文，避免内容凭空消失，也绝不残留 pending 占位块
      const packingIndex = finalBlocks.findIndex(block => block.id === "pending-0");
      if (packingIndex >= 0) {
        const rawContent = String(finalBlocks[packingIndex].payload.content || "");
        const unpacked = finalBlocks.filter(block => block.id !== "pending-0");
        const envelope = unwrapGuideAnswerEnvelope(rawContent);
        if (envelope) {
          finalBlocks = upsertBlock(unpacked, "answer-0", "answer", {
            content: envelope.answer,
          });
          if (envelope.evidence.length) {
            finalBlocks = upsertBlock(finalBlocks, "evidence-0", "evidence", {
              items: envelope.evidence,
            });
          }
        } else if (rawContent) {
          finalBlocks = upsertBlock(unpacked, "answer-0", "answer", {
            content: rawContent,
          });
        } else {
          finalBlocks = unpacked;
        }
      }
      // 兜底：正文若直到流结束都停留在「JSON 包装」形态（例如整包跨了太多帧、
      // 中途始终没构成完整 JSON），结束时最后再解一次，避免气泡里残留一坨 JSON
      const answerIndex = finalBlocks.findIndex(block => block.id === "answer-0");
      if (answerIndex >= 0) {
        const current = String(finalBlocks[answerIndex].payload.content || "");
        const envelope = unwrapGuideAnswerEnvelope(current);
        if (envelope) {
          finalBlocks = upsertBlock(finalBlocks, "answer-0", "answer", {
            content: envelope.answer,
          });
          if (envelope.evidence.length) {
            finalBlocks = upsertBlock(finalBlocks, "evidence-0", "evidence", {
              items: envelope.evidence,
            });
          }
        }
      }
      return {
        ...base,
        blocks: completeBlocks(finalBlocks),
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
    }
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
    case "table":
    case "metric":
    case "tool_call":
      return base;
  }
}

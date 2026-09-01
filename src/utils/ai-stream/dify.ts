import type { ChatStreamEvent, Identifier, SendChatMessageParams } from "@/api/chat/types";

/** Dify `/chat-messages` 的请求体；只在网络边界使用 snake_case。 */
export interface DifyChatMessagesRequest {
  inputs: Record<string, unknown>;
  query: string;
  response_mode: "streaming";
  /** 空字符串代表开启一轮新会话；后续请求传服务端返回的 conversation_id。 */
  conversation_id: Identifier | "";
  files: Array<{
    type: string;
    transfer_method: "remote_url";
    url: string;
  }>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asIdentifier(value: unknown): Identifier | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function getReferences(payload: Record<string, unknown>) {
  return {
    conversationId: asIdentifier(payload.conversation_id),
    messageId: asIdentifier(payload.message_id),
    taskId: asIdentifier(payload.task_id),
  };
}

/** 将页面内部的 camelCase 参数转换成 Dify 标准请求格式。 */
export function toDifyChatMessagesRequest(params: SendChatMessageParams): DifyChatMessagesRequest {
  return {
    inputs: params.inputs || {},
    query: params.query,
    response_mode: "streaming",
    conversation_id: params.conversationId ?? "",
    files: (params.files || []).map(file => ({
      type: file.type,
      transfer_method: file.transferMethod,
      url: file.url,
    })),
  };
}

/**
 * 建立单次请求的 Dify SSE 归一化器。
 * Agent 会先发 agent_message 增量，随后以 message 发完整答案；后者需要替换而不是追加。
 */
export function createDifyEventNormalizer() {
  let receivedAgentMessage = false;

  return (payload: unknown): ChatStreamEvent | Error | null => {
    const data = asRecord(payload);
    if (!data) return null;

    const event = String(data.event || "");
    if (event === "ping" || event === "message_file" || event === "tts_message" || event === "tts_message_end"
      || event.startsWith("node_") || event.startsWith("iteration_")
      || event.startsWith("loop_") || event === "agent_log" || event === "human_input_required") {
      return null;
    }
    if (event === "error") return new Error(String(data.message || data.code || "Dify 对话请求失败"));

    const { conversationId, messageId, taskId } = getReferences(data);
    if (conversationId == null || messageId == null) return null;

    // Chatflow 暂停或被停止时可能不会发送 message_end；将其收敛为正常结束，避免气泡永久 loading。
    if (event === "workflow_paused" || event === "workflow_finished") {
      const workflow = asRecord(data.data) || {};
      const status = String(workflow.status || "");
      if (event === "workflow_paused" || status === "stopped") {
        return {
          event: "message_end",
          conversationId,
          messageId,
          taskId,
          metadata: { is_end: true, status: "stopped", reason: "interrupt", duration_ms: null },
        };
      }
      return null;
    }

    if (event === "agent_message") {
      receivedAgentMessage = true;
      return { event: "message", conversationId, messageId, taskId, answer: String(data.answer || "") };
    }
    if (event === "message") {
      return {
        event: "message",
        conversationId,
        messageId,
        taskId,
        answer: String(data.answer || ""),
        replace: receivedAgentMessage,
      };
    }
    if (event === "message_replace") {
      return { event: "message", conversationId, messageId, taskId, answer: String(data.answer || ""), replace: true };
    }
    if (event === "agent_thought") {
      const message = String(data.thought || data.observation || "");
      if (!message) return null;
      return {
        event: "think",
        conversationId,
        messageId,
        taskId,
        data: {
          node: String(data.tool || `thought-${data.position || 0}`),
          message,
          phase: data.observation ? "completed" : "running",
        },
      };
    }
    if (event === "reasoning_chunk") {
      const detail = asRecord(data.data) || {};
      const message = String(detail.reasoning || "");
      const node = String(detail.node_id || "thinking");
      if (!message && !detail.is_final) return null;
      return {
        event: "think",
        conversationId,
        messageId,
        taskId,
        data: { node, message, append: true, phase: detail.is_final ? "completed" : "running" },
      };
    }
    if (event === "message_end") {
      const metadata = asRecord(data.metadata) || {};
      const usage = asRecord(metadata.usage) || {};
      const latency = Number(usage.latency);
      return {
        event: "message_end",
        conversationId,
        messageId,
        taskId,
        metadata: {
          is_end: true,
          status: "succeeded",
          reason: "normal",
          duration_ms: Number.isFinite(latency) ? Math.round(latency * 1000) : null,
        },
      };
    }
    return null;
  };
}

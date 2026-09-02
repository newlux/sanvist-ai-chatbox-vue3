import type { ChatResponseMode, ChatStreamEvent, Identifier, SendChatMessageParams } from "@/api/chat/types";

/** Dify `/chat-messages` 的请求体；只在网络边界使用 snake_case。 */
export interface DifyChatMessagesRequest {
  /** Dify 要求非空，用于标识同一用户的会话。 */
  user: string;
  inputs: Record<string, unknown>;
  query: string;
  response_mode: ChatResponseMode;
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
    user: String(params.user || ""),
    inputs: params.inputs || {},
    query: params.query,
    response_mode: params.responseMode ?? "streaming",
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
  let isWorkflowStream = false;
  /** Chatflow 通常先发 message_end，后发 workflow_finished；先暂存，等待后者提供总耗时。 */
  let pendingMessageEnd: {
    conversationId: Identifier;
    messageId: Identifier;
    taskId?: Identifier;
  } | null = null;

  return (payload: unknown): ChatStreamEvent | Error | null => {
    const data = asRecord(payload);
    if (!data) return null;

    const event = String(data.event || "");
    if (event === "workflow_started") isWorkflowStream = true;
    if (event === "ping" || event === "message_file" || event === "tts_message" || event === "tts_message_end"
      || event.startsWith("iteration_")
      || event.startsWith("loop_") || event === "agent_log" || event === "human_input_required") {
      return null;
    }
    if (event === "error") return new Error(String(data.message || data.code || "Dify 对话请求失败"));

    const { conversationId, messageId, taskId } = getReferences(data);
    if (conversationId == null || messageId == null) return null;

    // 将 Dify 工作流节点事件折叠为回答卡片标题状态；不渲染节点详情，避免干扰最终回答。
    if (event === "workflow_started") {
      return {
        event: "status",
        conversationId,
        messageId,
        taskId,
        data: { node: "", message: "思考中", phase: "running" },
      };
    }
    if (event === "node_started" || event === "node_finished") {
      const node = asRecord(data.data) || data;
      const title = String(node.title || node.node_type || "思考");
      // 隐藏节点仍在工作流里执行，但不应打断用户看到的上一个可见状态。
      if (title.trim().startsWith("[HIDDEN]")) return null;
      return {
        event: "status",
        conversationId,
        messageId,
        taskId,
        data: {
          node: title,
          message: title,
          phase: event === "node_finished" ? "completed" : "running",
        },
      };
    }

    // Chatflow 结束事件包含工作流总耗时（elapsed_time，单位秒），优先以它作为气泡「已消耗时间」。
    // 标准事件顺序可能为 message_end -> workflow_finished，因此不能在收到 message_end 时立即结束消费。
    if (event === "workflow_paused" || event === "workflow_finished") {
      const workflow = asRecord(data.data) || {};
      const status = String(workflow.status || "");
      const elapsedSeconds = Number(workflow.elapsed_time);
      const durationMs = Number.isFinite(elapsedSeconds)
        ? Math.round(elapsedSeconds * 1000)
        : null;
      const message = String(workflow.error || "") || null;
      const references = pendingMessageEnd || { conversationId, messageId, taskId };

      if (event === "workflow_paused" || status === "stopped") {
        return {
          event: "message_end",
          ...references,
          metadata: { is_end: true, status: "stopped", reason: "interrupt", duration_ms: durationMs, message },
        };
      }
      if (event === "workflow_finished") {
        return {
          event: "message_end",
          ...references,
          metadata: {
            is_end: true,
            status: status === "failed" ? "failed" : "succeeded",
            reason: status === "failed" ? "exception" : "normal",
            duration_ms: durationMs,
            message,
          },
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
      if (isWorkflowStream) {
        pendingMessageEnd = { conversationId, messageId, taskId };
        return null;
      }
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

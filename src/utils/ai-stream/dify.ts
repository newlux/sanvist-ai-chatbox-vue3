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

function getSanvistNodeTitle(event: Record<string, unknown>, data: Record<string, unknown>) {
  return String(event.title || data.title || event.message || data.message || "").trim();
}

function isHiddenSanvistTitle(title: string) {
  return title.startsWith("[HIDDEN]");
}

function isFailedSanvistEvent(event: Record<string, unknown>, data: Record<string, unknown>) {
  const phase = String(event.phase || data.phase || event.status || data.status || "").toLowerCase();
  return ["failed", "failure", "error", "exception"].includes(phase);
}

function splitMarkdownTableRow(line: string) {
  return line.trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map(cell => cell.trim());
}

function parseMarkdownTable(content: unknown) {
  const lines = String(content || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const columns = splitMarkdownTableRow(lines[0]);
  const separator = splitMarkdownTableRow(lines[1]);
  if (!columns.length || separator.length !== columns.length
    || !separator.every(cell => /^:?-{3,}:?$/.test(cell))) {
    return null;
  }
  return {
    columns,
    rows: lines.slice(2).map(splitMarkdownTableRow),
  };
}

export interface DifyHistoryBlockData {
  type: "answer" | "table" | "chart";
  payload: Record<string, unknown>;
}

/** 将完整历史 answer 中的 SANVIST/ASK 协议按原顺序还原为 UI blocks。 */
export function extractDifyHistoryBlocks(value: unknown): DifyHistoryBlockData[] {
  const source = String(value || "");
  const pattern = /<(SANVIST|ASK)>([\s\S]*?)<\/\1>/g;
  const blocks: DifyHistoryBlockData[] = [];
  let cursor = 0;
  let foundProtocol = false;

  const appendAnswer = (content: unknown) => {
    const text = String(content || "");
    if (!text.trim()) return;
    const previous = blocks.at(-1);
    if (previous?.type === "answer") {
      previous.payload.content = `${String(previous.payload.content || "")}${text}`;
    } else {
      blocks.push({ type: "answer", payload: { content: text } });
    }
  };

  while (true) {
    const match = pattern.exec(source);
    if (!match) break;
    appendAnswer(source.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    try {
      const payload = asRecord(JSON.parse(match[2]));
      if (!payload) continue;
      if (match[1] === "ASK") {
        const type = String(payload.type || "").toLowerCase();
        const data = asRecord(payload.data) || {};
        if (type === "table") {
          const table = String(data.format || "").toLowerCase() === "markdown"
            ? parseMarkdownTable(data.content)
            : { columns: data.columns, rows: data.rows };
          if (table) blocks.push({ type: "table", payload: table });
          foundProtocol = true;
        } else if (type === "echarts") {
          blocks.push({ type: "chart", payload: { option: data } });
          foundProtocol = true;
        }
        continue;
      }

      const difyEvent = String(payload.dify_event || "");
      const event = String(payload.event || "");
      const known = ["status", "answer", "done"].includes(event)
        || ["node_started", "node_retry", "node_finished", "workflow_finished"].includes(difyEvent);
      if (!known) continue;
      foundProtocol = true;
      if (event === "answer") appendAnswer(asRecord(payload.data)?.content);
    } catch {
      // 历史中的非法协议块不参与渲染。
    }
  }
  appendAnswer(source.slice(cursor));
  return foundProtocol ? blocks : [{ type: "answer", payload: { content: source } }];
}

/**
 * 历史消息是一段完整文本，不需要处理跨 SSE 分片；仅提取 SANVIST answer 事件的正文。
 * 若不包含有效 SANVIST 事件，按普通 Dify answer 原样返回。
 */
export function extractSanvistAnswer(value: unknown) {
  const source = String(value || "");
  const pattern = /<SANVIST>([\s\S]*?)<\/SANVIST>/g;
  let foundProtocol = false;
  let foundAnswer = false;
  let answer = "";
  let plainText = "";
  let cursor = 0;
  while (true) {
    const match = pattern.exec(source);
    if (!match) break;
    plainText += source.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    try {
      const customEvent = asRecord(JSON.parse(match[1]));
      const difyEvent = String(customEvent?.dify_event || "");
      const isLegacyEvent = ["status", "answer", "done"].includes(String(customEvent?.event || ""));
      const isDifyNodeEvent = ["node_started", "node_retry", "node_finished", "workflow_finished"].includes(difyEvent);
      if (!customEvent || (!isLegacyEvent && !isDifyNodeEvent)) {
        continue;
      }
      foundProtocol = true;
      if (customEvent.event !== "answer") continue;
      const data = asRecord(customEvent.data) || {};
      const content = String(data.content || "");
      foundAnswer = true;
      answer = data.is_delta === false ? content : `${answer}${content}`;
    } catch {
      // 非法的协议块不进入历史正文。
    }
  }
  plainText += source.slice(cursor);
  // 只有自定义 answer 事件才用其累积正文；节点状态协议不能吞掉标签外的标准 Dify 回答。
  if (foundAnswer) return answer;
  return foundProtocol ? plainText : source;
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
  let protocolBuffer = "";
  let receivedSanvistEvent = false;
  /** Chatflow 通常先发 message_end，后发 workflow_finished；先暂存，等待后者提供总耗时。 */
  let pendingMessageEnd: {
    conversationId: Identifier;
    messageId: Identifier;
    taskId?: Identifier;
  } | null = null;

  function extractSanvistEvents(
    value: string,
    references: { conversationId: Identifier; messageId: Identifier; taskId?: Identifier },
    replaceFirstAnswer: boolean,
  ): ChatStreamEvent[] {
    const events: ChatStreamEvent[] = [];
    let shouldReplace = replaceFirstAnswer;
    const appendAnswer = (content: unknown, replace = false) => {
      const answer = String(content || "");
      if (!answer) return;
      // 自定义事件包尾通常会带一个协议换行符；它不是回答内容，不能创建空 answer block。
      if (receivedSanvistEvent && !answer.trim()) return;
      events.push({
        event: "message",
        ...references,
        answer,
        replace: shouldReplace || replace,
      });
      shouldReplace = false;
    };

    protocolBuffer += value;
    while (protocolBuffer) {
      const sanvistStart = protocolBuffer.indexOf("<SANVIST>");
      const askStart = protocolBuffer.indexOf("<ASK>");
      const starts = [sanvistStart, askStart].filter(index => index >= 0);
      const start = starts.length ? Math.min(...starts) : -1;
      if (start < 0) {
        // 标签可能刚好被 SSE 分片切开，保留与任一起始标签相符的末尾。
        const suffixLength = ["<SANVIST>", "<ASK>"]
          .flatMap(marker => Array.from({ length: marker.length - 1 }, (_, index) => index + 1)
            .map(length => protocolBuffer.endsWith(marker.slice(0, length)) ? length : 0))
          .reduce((max, length) => Math.max(max, length), 0);
        appendAnswer(protocolBuffer.slice(0, -suffixLength || undefined));
        protocolBuffer = suffixLength ? protocolBuffer.slice(-suffixLength) : "";
        break;
      }

      if (start > 0) {
        appendAnswer(protocolBuffer.slice(0, start));
        protocolBuffer = protocolBuffer.slice(start);
      }

      const isAsk = protocolBuffer.startsWith("<ASK>");
      const openMarker = isAsk ? "<ASK>" : "<SANVIST>";
      const closeMarker = isAsk ? "</ASK>" : "</SANVIST>";
      const end = protocolBuffer.indexOf(closeMarker);
      if (end < 0) break;

      const raw = protocolBuffer.slice(openMarker.length, end);
      protocolBuffer = protocolBuffer.slice(end + closeMarker.length);
      try {
        const customEvent = asRecord(JSON.parse(raw));
        if (isAsk) {
          const type = String(customEvent?.type || "").toLowerCase();
          const askData = asRecord(customEvent?.data) || {};
          if (type === "table") {
            const table = String(askData.format || "").toLowerCase() === "markdown"
              ? parseMarkdownTable(askData.content)
              : { columns: askData.columns, rows: askData.rows };
            if (table) events.push({ event: "table", ...references, data: table });
          } else if (type === "echarts") {
            events.push({ event: "chart", ...references, data: { option: askData } });
          }
          receivedSanvistEvent = true;
          continue;
        }
        const customData = asRecord(customEvent?.data) || {};
        const difyEvent = String(customEvent?.dify_event || "");
        const title = getSanvistNodeTitle(customEvent || {}, customData);
        if (difyEvent === "node_started" || difyEvent === "node_retry") {
          receivedSanvistEvent = true;
          if (title && !isHiddenSanvistTitle(title)) {
            events.push({ event: "subtitle", ...references, message: title });
          }
        } else if (difyEvent === "node_finished") {
          receivedSanvistEvent = true;
          // 成功完成不闪回标题；失败和异常才展示当前节点，帮助定位执行问题。
          if (isFailedSanvistEvent(customEvent || {}, customData) && title && !isHiddenSanvistTitle(title)) {
            events.push({ event: "subtitle", ...references, message: title });
          }
        } else if (difyEvent === "workflow_finished") {
          receivedSanvistEvent = true;
          events.push({ event: "subtitle", ...references, message: "" });
        } else if (customEvent?.event === "status") {
          receivedSanvistEvent = true;
          const message = String(customData.message || "").trim();
          if (message) events.push({ event: "subtitle", ...references, message });
        } else if (customEvent?.event === "answer") {
          receivedSanvistEvent = true;
          appendAnswer(customData.content, customData.is_delta === false);
        } else if (customEvent?.event === "done") {
          receivedSanvistEvent = true;
          events.push({ event: "subtitle", ...references, message: "" });
        }
      } catch {
        // 自定义标记内容不完整或不合法时直接忽略，避免协议文本泄漏到用户回答。
      }
    }
    return events;
  }

  return (payload: unknown): ChatStreamEvent | ChatStreamEvent[] | Error | null => {
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
      return extractSanvistEvents(String(data.answer || ""), { conversationId, messageId, taskId }, false);
    }
    if (event === "message") {
      return extractSanvistEvents(
        String(data.answer || ""),
        { conversationId, messageId, taskId },
        receivedAgentMessage,
      );
    }
    if (event === "message_replace") {
      return extractSanvistEvents(String(data.answer || ""), { conversationId, messageId, taskId }, true);
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

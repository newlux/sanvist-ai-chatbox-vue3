import type { AskSlotOption, AskSlotPayload, ChatResponseMode, ChatStreamEvent, Identifier, SendChatMessageParams } from "@/api/chat/types";
import { createLogger } from "@/utils/logger";

const logger = createLogger("ai-stream-protocol");

/** Dify `/chat-messages` 的请求体；只在网络边界使用 snake_case。 */
export interface DifyChatMessagesRequest {
  /** Dify 要求非空，用于标识同一用户的会话。 */
  user: string;
  inputs: Record<string, unknown>;
  query: string;
  response_mode: ChatResponseMode;
  /** 空字符串代表开启一轮新会话；后续请求传服务端返回的 conversation_id。 */
  conversation_id: Identifier | "";
  files: Array<
    | { type: string; transfer_method: "local_file"; upload_file_id: string }
    | { type: string; transfer_method: "remote_url"; url: string }
  >;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asIdentifier(value: unknown): Identifier | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

/**
 * slot 槽位组件：除 slot_name / selection / options 外都可缺省。
 * options 只要求 label + value：device_* 只是设备类槽位的附加字段，
 * 时间（date_start/date_end）、项目等槽位并没有它，不能拿 device_id 当准入条件。
 */
function parseAskSlotPayload(value: Record<string, unknown>): AskSlotPayload | null {
  const slotName = String(value.slot_name || "").trim();
  // original_query 允许缺省，但始终归一成字符串，避免下游 trim 时崩。
  const originalQuery = String(value.original_query || "").trim();
  const selection = value.selection === "multiple" ? "multiple" : value.selection === "single" ? "single" : "";
  const options = Array.isArray(value.options)
    ? value.options
      .map(asRecord)
      .filter((item): item is Record<string, unknown> => Boolean(item))
      // 其余字段（device_*、date_start/date_end 等）原样透传给提交侧。
      .map(item => ({
        ...item,
        label: String(item.label || "").trim(),
        value: String(item.value || "").trim(),
      }))
      .filter(item => item.label && item.value) as AskSlotOption[]
    : [];
  if (!slotName || !selection || !options.length) return null;
  return { ...value, slot_name: slotName, original_query: originalQuery, selection, options };
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

export function parseMarkdownTable(content: unknown) {
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

/** 把一段普通 Markdown 文本中内嵌的表格拆成 answer/table 段落。 */
export function splitMarkdownTables(source: string): DifyHistoryBlockData[] {
  const lines = source.split(/\r?\n/);
  const segments: DifyHistoryBlockData[] = [];
  const textLines: string[] = [];
  function flushText() {
    if (!textLines.length) return;
    const content = textLines.join("\n");
    textLines.length = 0;
    if (content.trim()) {
      segments.push({ type: "answer", payload: { content } });
    }
  }
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const next = lines[index + 1];
    if (next && line.includes("|") && next.includes("|")) {
      let end = index + 2;
      while (end < lines.length && lines[end].includes("|")) {
        end += 1;
      }
      const candidate = lines.slice(index, end).join("\n");
      const table = parseMarkdownTable(candidate);
      if (table) {
        flushText();
        segments.push({ type: "table", payload: table });
        index = end;
        continue;
      }
    }
    textLines.push(line);
    index += 1;
  }
  flushText();
  return segments;
}

export interface DifyHistoryBlockData {
  type: "answer" | "table" | "chart" | "image" | "video" | "source" | "suggestion" | "ask-slot"
    | "assistant-navigation" | "guide-step" | "guide-check" | "guide-suggestion";
  payload: Record<string, unknown>;
}

type GuideBlockType = "image" | "video" | "source" | "suggestion" | "guide-step" | "guide-check" | "guide-suggestion";

/** 步骤配图：兼容 [{url,caption}] 与 ["url"] 两种写法 */
function parseGuideImages(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const record = asRecord(item);
      const url = String(
        record?.url || record?.src || record?.source_url || (typeof item === "string" ? item : "") || "",
      ).trim();
      return {
        url,
        caption: String(record?.caption || record?.title || record?.description || "").trim(),
      };
    })
    .filter(item => item.url);
}

function parseGuideBlock(value: Record<string, unknown> | null): { type: GuideBlockType; payload: Record<string, unknown> } | null {
  const type = String(value?.type || "").toLowerCase();
  const data = asRecord(value?.data) || {};
  if (type === "image") {
    const items = Array.isArray(data.items) ? data.items.filter(item => asRecord(item)?.url).slice(0, 2) : [];
    return items.length ? { type: "image", payload: { items } } : null;
  }
  if (type === "video") {
    return data.url ? { type: "video", payload: data } : null;
  }
  if (type === "source") {
    const evidence = Array.isArray(data.evidence) ? data.evidence.filter(item => asRecord(item)?.url) : [];
    return evidence.length ? { type: "source", payload: { evidence } } : null;
  }
  if (type === "options") {
    const items = Array.isArray(data.items)
      ? data.items.filter(item => String(asRecord(item)?.label || "").trim()).slice(0, 4)
      : [];
    return items.length
      ? { type: "suggestion", payload: { title: "你还可以继续问", ...data, items } }
      : null;
  }
  // 核对任务与资料：一张卡对应一个步骤，step_id 用于步骤卡片翻页时定位
  if (type === "check") {
    const content = String(data.content || "").trim();
    if (!content) return null;
    const stepIndex = Math.max(0, Number(data.step_index) || 0);
    const stepTotal = Math.max(0, Number(data.step_total) || 0);
    return {
      type: "guide-check",
      payload: {
        title: String(data.title || "").trim() || "核对任务与资料",
        step_id: String(data.step_id || "").trim(),
        step_index: stepIndex,
        step_total: stepTotal,
        content,
        status: String(data.status || "").trim(),
      },
    };
  }
  // 指导步骤卡片：每步自带确认问题与三个选项文案（确认 / 提问 / 拍照）。
  if (type === "step") {
    const steps = Array.isArray(data.steps)
      ? data.steps
        .map(asRecord)
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map(item => ({
          id: String(item.id || "").trim(),
          title: String(item.title || "").trim(),
          action: String(item.action || "").trim(),
          verification: String(item.verification || "").trim(),
          confirmation_question: String(item.confirmation_question || "").trim(),
          confirm_text: String(item.confirm_text || "").trim(),
          question_text: String(item.question_text || "").trim(),
          photo_text: String(item.photo_text || "").trim(),
          images: parseGuideImages(item.images),
        }))
        .filter(item => item.title)
      : [];
    if (!steps.length) return null;
    return {
      type: "guide-step",
      payload: {
        device_model: String(data.device_model || "").trim(),
        title: String(data.title || "").trim(),
        // 步骤卡左上角灰色小标签；老数据没有 note 时由页面退回 title
        note: String(data.note || "").trim(),
        overview: String(data.overview || "").trim(),
        steps,
      },
    };
  }
  // 多轮追问卡：options 是并行分支（区别于按顺序推进的 step 卡），选一个就发出去。
  if (type === "suggestion") {
    const items = (Array.isArray(data.items) ? data.items : [])
      .map(asRecord)
      .filter((item): item is Record<string, unknown> => Boolean(item));
    // 低端安卓 WebView 不支持 Array.prototype.flatMap，这里手写展开
    const options: Array<{ id: string; label: string }> = [];
    items.forEach((item) => {
      (Array.isArray(item.options) ? item.options : []).forEach((option) => {
        const record = asRecord(option);
        const label = String(record?.label || "").trim();
        if (!label) return;
        options.push({ id: String(record?.id || "").trim(), label });
      });
    });
    if (!options.length) return null;
    const first = items[0] || {};
    return {
      type: "guide-suggestion",
      payload: {
        note: String(first.note || "").trim(),
        question: String(first.suggestion_question || "").trim(),
        other_text: String(first.other_text || "").trim(),
        options,
      },
    };
  }
  return null;
}

/**
 * step 组件展开成「一张步骤卡 + 每步一张详情卡」：
 * - 步骤卡（guide-step）负责提问：note 标签 + confirmation_question + 三个选项；
 * - 详情卡（guide-check）负责讲这一步做什么：steps.title / steps.action / steps.images；
 * 两者靠 step_id 关联，步骤卡翻页时对话滚动到对应详情卡，并且一次只显示当前那一步。
 * 每步恒定一张，保证详情卡下标与步骤顺序一一对应。其余 GUIDE 卡片原样返回。
 */
function expandStepBlocks(block: { type: GuideBlockType; payload: Record<string, unknown> }) {
  if (block.type !== "guide-step") return [block];
  const steps = Array.isArray(block.payload.steps)
    ? block.payload.steps as Record<string, unknown>[]
    : [];
  const detailBlocks = steps.map((step, index) => ({
    type: "guide-check" as const,
    payload: {
      title: String(step.title || "").trim(),
      step_id: String(step.id || "").trim(),
      step_index: index + 1,
      step_total: steps.length,
      content: String(step.action || "").trim(),
      images: Array.isArray(step.images) ? step.images : [],
      status: "✓ 询问用户",
    },
  }));
  return [block, ...detailBlocks];
}

/** 正文协议标签；历史解析与 SSE 流式解析共用同一份标记表。 */
const PROTOCOL_MARKERS = ["<SANVIST>", "<ASK>", "<GUIDE>", "<COMPONENT>"];

/** ASK 交互组件：表格 / 图表 / 追问槽位；历史与流式解析共用同一份判定。 */
function parseAskBlock(value: Record<string, unknown> | null): DifyHistoryBlockData | null {
  const type = String(value?.type || "").toLowerCase();
  const data = asRecord(value?.data) || {};
  if (type === "table") {
    const table = String(data.format || "").toLowerCase() === "markdown"
      ? parseMarkdownTable(data.content)
      : { columns: data.columns, rows: data.rows };
    return table ? { type: "table", payload: table } : null;
  }
  if (type === "echarts") return { type: "chart", payload: { option: data } };
  if (type === "slot") {
    const slot = parseAskSlotPayload(data);
    return slot ? { type: "ask-slot", payload: slot } : null;
  }
  if (type === "navigation" && data.target === "maintenance_assistant") {
    return {
      type: "assistant-navigation",
      payload: {
        target: "maintenance_assistant",
        title: String(data.title || "").trim() || undefined,
        confirm_text: String(data.confirm_text || "").trim() || undefined,
        cancel_text: String(data.cancel_text || "").trim() || undefined,
        context: asRecord(data.context) || {},
      },
    };
  }
  return null;
}

/** 流式事件只差事件名（ask-slot → ask_slot）与 auto_open 标记。 */
function parseAskStreamEvent(value: Record<string, unknown> | null) {
  const block = parseAskBlock(value);
  if (block?.type === "table") return { event: "table" as const, data: block.payload };
  if (block?.type === "chart") return { event: "chart" as const, data: block.payload };
  if (block?.type === "ask-slot") return { event: "ask_slot" as const, data: { ...block.payload, auto_open: true } };
  if (block?.type === "assistant-navigation") {
    return { event: "assistant_navigation" as const, data: { ...block.payload, auto_open: true } };
  }
  return null;
}

/**
 * 新版协议在组件外又包了一层：<COMPONENT>{"scene":"ask","type":"table","data":{...}}</COMPONENT>。
 * 解包后按 scene 路由：
 * - ask（或缺省 scene，兼容老协议）→ 走交互组件渲染；
 * - guide → 走 GUIDE 卡片；
 * - 带 dify_event/event 的 → 仍按节点状态事件处理；
 * - voice 等只服务语音播报的场景 → 返回 null，正文直接丢弃，避免 JSON 泄漏到气泡与 TTS。
 */
function unwrapComponent(value: Record<string, unknown>) {
  const scene = String(value.scene || "").toLowerCase();
  if (scene === "guide") return { kind: "guide" as const, payload: value };
  if (scene === "ask") return { kind: "ask" as const, payload: value };
  if (!scene) {
    return value.event || value.dify_event
      ? { kind: "sanvist" as const, payload: value }
      : { kind: "ask" as const, payload: value };
  }
  return null;
}

/** 将完整历史 answer 中的 SANVIST/ASK/GUIDE/COMPONENT 协议按原顺序还原为 UI blocks。 */
export function extractDifyHistoryBlocks(value: unknown): DifyHistoryBlockData[] {
  const source = String(value || "");
  const pattern = /<(SANVIST|ASK|GUIDE|COMPONENT)>([\s\S]*?)<\/\1>/g;
  const blocks: DifyHistoryBlockData[] = [];
  let cursor = 0;
  let foundProtocol = false;

  const appendAnswer = (content: unknown) => {
    const text = String(content || "");
    if (!text.trim()) return;
    // 低端安卓 WebView 不支持 ES2022 的 Array.prototype.at
    const previous = blocks[blocks.length - 1];
    if (previous?.type === "answer") {
      previous.payload.content = `${String(previous.payload.content || "")}${text}`;
    } else {
      blocks.push({ type: "answer", payload: { content: text } });
    }
  };

  while (true) {
    const match = pattern.exec(source);
    if (!match) break;
    foundProtocol = true;
    appendAnswer(source.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    try {
      const payload = asRecord(JSON.parse(match[2]));
      if (!payload) continue;
      const tag = match[1];
      let eventPayload = payload;
      if (tag === "COMPONENT") {
        // 新版包装层：先按 scene 解包；voice 等播报专用场景不落正文。
        const component = unwrapComponent(payload);
        if (!component) continue;
        if (component.kind === "guide") {
          const guideBlock = parseGuideBlock(component.payload);
          if (guideBlock) blocks.push(...expandStepBlocks(guideBlock));
          continue;
        }
        if (component.kind === "ask") {
          const askBlock = parseAskBlock(component.payload);
          if (askBlock) blocks.push(askBlock);
          continue;
        }
        eventPayload = component.payload;
      } else if (tag === "GUIDE") {
        const guideBlock = parseGuideBlock(payload);
        if (guideBlock) blocks.push(...expandStepBlocks(guideBlock));
        continue;
      } else if (tag === "ASK") {
        const askBlock = parseAskBlock(payload);
        if (askBlock) blocks.push(askBlock);
        continue;
      }

      const difyEvent = String(eventPayload.dify_event || "");
      const event = String(eventPayload.event || "");
      const known = ["status", "answer", "done"].includes(event)
        || ["node_started", "node_retry", "node_finished", "workflow_finished"].includes(difyEvent);
      if (!known) continue;
      if (event === "answer") appendAnswer(asRecord(eventPayload.data)?.content);
    } catch (error) {
      // 历史中的非法协议块不参与渲染，但要留下线索，避免整块内容静默消失。
      logger.warn("忽略历史中无法解析的协议块", { tag: match[1], error });
    }
  }
  appendAnswer(source.slice(cursor));
  const result: DifyHistoryBlockData[] = [];
  for (const block of blocks) {
    if (block.type === "answer") {
      result.push(...splitMarkdownTables(String(block.payload.content || "")));
    } else {
      result.push(block);
    }
  }
  if (result.length) return result;
  // 命中过协议但没产出 block（例如整条 answer 只有播报层）时不能回落成原文，否则会把 JSON 泄漏到气泡。
  return foundProtocol ? [] : [{ type: "answer", payload: { content: source } }];
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
    files: (params.files || []).map(file => file.transferMethod === "local_file"
      ? {
          type: file.type,
          transfer_method: file.transferMethod,
          upload_file_id: file.uploadFileId,
        }
      : {
          type: file.type,
          transfer_method: file.transferMethod,
          url: file.url,
        }),
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

    /** GUIDE 卡片入队；步骤卡 / 追问卡都要自动弹起等用户选，其余卡片交给对应 block 渲染。 */
    const appendGuideEvent = (guideBlock: { type: GuideBlockType; payload: Record<string, unknown> }) => {
      if (guideBlock.type === "guide-step") {
        events.push({ event: "guide_step", ...references, data: { ...guideBlock.payload, auto_open: true } });
        return;
      }
      if (guideBlock.type === "guide-suggestion") {
        events.push({ event: "guide_suggestion", ...references, data: { ...guideBlock.payload, auto_open: true } });
        return;
      }
      if (guideBlock.type === "guide-check") {
        events.push({ event: "guide_check", ...references, data: guideBlock.payload });
        return;
      }
      events.push({ event: guideBlock.type, ...references, data: guideBlock.payload });
    };

    protocolBuffer += value;
    while (protocolBuffer) {
      const starts = PROTOCOL_MARKERS
        .map(marker => protocolBuffer.indexOf(marker))
        .filter(index => index >= 0);
      const start = starts.length ? Math.min(...starts) : -1;
      if (start < 0) {
        // 标签可能刚好被 SSE 分片切开，保留与任一起始标签相符的末尾。
        // lib 锁在 es2018，这里不能用 flatMap（ES2019）。
        let suffixLength = 0;
        for (const marker of PROTOCOL_MARKERS) {
          for (let length = 1; length < marker.length; length += 1) {
            if (protocolBuffer.endsWith(marker.slice(0, length))) {
              suffixLength = Math.max(suffixLength, length);
            }
          }
        }
        appendAnswer(protocolBuffer.slice(0, -suffixLength || undefined));
        protocolBuffer = suffixLength ? protocolBuffer.slice(-suffixLength) : "";
        break;
      }

      if (start > 0) {
        appendAnswer(protocolBuffer.slice(0, start));
        protocolBuffer = protocolBuffer.slice(start);
      }

      const openMarker = PROTOCOL_MARKERS.find(marker => protocolBuffer.startsWith(marker));
      if (!openMarker) break;
      const tag = openMarker.slice(1, -1);
      const closeMarker = `</${tag}>`;
      const end = protocolBuffer.indexOf(closeMarker);
      if (end < 0) break;

      const raw = protocolBuffer.slice(openMarker.length, end);
      protocolBuffer = protocolBuffer.slice(end + closeMarker.length);
      try {
        const parsed = asRecord(JSON.parse(raw));
        let customEvent = parsed;
        if (tag === "COMPONENT") {
          // 新版包装层：按 scene 解包；voice 等播报专用场景不进正文，避免 JSON 泄漏到气泡与 TTS。
          const component = parsed ? unwrapComponent(parsed) : null;
          if (!component) {
            receivedSanvistEvent = true;
            continue;
          }
          customEvent = component.payload;
          if (component.kind === "guide") {
            const guideBlock = parseGuideBlock(customEvent);
            if (guideBlock) expandStepBlocks(guideBlock).forEach(item => appendGuideEvent(item));
            receivedSanvistEvent = true;
            continue;
          }
          if (component.kind === "ask") {
            const askEvent = parseAskStreamEvent(customEvent);
            if (askEvent) events.push({ event: askEvent.event, ...references, data: askEvent.data });
            receivedSanvistEvent = true;
            continue;
          }
        }
        if (tag === "GUIDE") {
          const guideBlock = parseGuideBlock(customEvent);
          if (guideBlock) expandStepBlocks(guideBlock).forEach(item => appendGuideEvent(item));
          receivedSanvistEvent = true;
          continue;
        }
        if (tag === "ASK") {
          const askEvent = parseAskStreamEvent(customEvent);
          if (askEvent) events.push({ event: askEvent.event, ...references, data: askEvent.data });
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
      } catch (error) {
        // 自定义标记内容不完整或不合法时直接忽略，避免协议文本泄漏到用户回答；日志留作排查线索。
        logger.warn("忽略无法解析的协议块", { tag, raw: raw.slice(0, 120), error });
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

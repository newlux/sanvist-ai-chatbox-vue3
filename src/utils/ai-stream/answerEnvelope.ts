/**
 * Guide（作业指导）场景的应答封装识别与解包。
 *
 * 后端在该场景下把「answer + status + evidence」整体序列化成一个 JSON 字符串，
 * 塞进 SANVIST answer 事件的 content 字段下发，前端 streaming 层按普通文本
 * 累加后，气泡正文里看到的是一整坨 JSON，而不是真正的 markdown 回答。
 *
 * 该工具在累计文本刚好构成合法 JSON 时解包：
 * - 命中形态：JSON 对象，且 `answer` 为 string，且（`evidence` 为数组 或 `status` 为字符串）
 * - 其余情况一律返回 null（普通正文、流式未闭合、格式不一致），由调用方原样渲染
 */
export interface GuideAnswerEnvelope {
  answer: string;
  evidence: unknown[];
}

export function unwrapGuideAnswerEnvelope(raw: string): GuideAnswerEnvelope | null {
  const text = String(raw || "");
  if (!text.trimStart().startsWith("{")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 流式未闭合或不是 JSON：保持原样继续累积，等到包尾再试
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.answer !== "string") return null;
  if (!Array.isArray(record.evidence) && typeof record.status !== "string") return null;

  return {
    answer: record.answer,
    evidence: Array.isArray(record.evidence) ? record.evidence : [],
  };
}

export interface ResolvedAnswerText {
  content: string;
  evidence: unknown[];
}

/**
 * 把一段可能带 guide 包装的 answer 文本解析成「可直接渲染的正文 + 证据数组」。
 * 命中包装则返回解包后的正文与证据；否则正文原样、证据为空。
 * 供非流式路径（历史消息、阻塞响应）与 AnswerBlock 兜底共用，幂等。
 */
export function resolveAnswerText(raw: string): ResolvedAnswerText {
  const envelope = unwrapGuideAnswerEnvelope(raw);
  return envelope
    ? { content: envelope.answer, evidence: envelope.evidence }
    : { content: String(raw || ""), evidence: [] };
}

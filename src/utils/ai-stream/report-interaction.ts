export interface ReportQaInteraction {
  interactionType: "qa";
  answer: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 只接受听播工作流约定的 QA JSON 回答，其他格式交给原有文本回答链路处理。 */
export function parseReportQaInteraction(rawAnswer: string): ReportQaInteraction | null {
  try {
    const payload: unknown = JSON.parse(rawAnswer);
    if (!isRecord(payload) || payload.interaction_type !== "qa") return null;

    const answer = typeof payload.answer === "string" ? payload.answer.trim() : "";
    return answer ? { interactionType: "qa", answer } : null;
  } catch {
    return null;
  }
}

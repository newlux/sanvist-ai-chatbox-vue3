import type { AskSlotSubmitPayload } from "@/api/chat/types";

export function buildAskSlotQuery(payload: AskSlotSubmitPayload) {
  // 作业协同多步骤表单：按题目顺序拼「Q1: 问题，A1: 回答；Q2: …」
  const answers = Array.isArray(payload.answers) ? payload.answers : [];
  if (answers.length) {
    return answers
      .map((item, index) => `Q${index + 1}: ${item.question}，A${index + 1}: ${item.answer}`)
      .join("；");
  }

  // 通用路由的 value 是完整指令；业务槽位的 value 可能是编码，继续使用 label。
  const isRouteSlot = ["role_selection", "voice_style", "assistant_selection"].includes(payload.slot.slot_name);
  const selectedLabels = payload.selectedOptions
    .map(option => String(isRouteSlot ? option.value || option.label : option.label || option.value).trim())
    .filter(Boolean);
  // 「其他输入」填的自定义内容也算作答，跟选项一起按「、」拼进提问
  const remark = String(payload.remark || "").trim();
  /**
   * 只发本次点击的内容，**不再拼上一轮的提问**（原 `original_query` 前缀）：
   * 追问卡的选项本身就是一句完整意图（如「近 7 天：11 月 3 日至 11 月 9 日」），
   * 再把上一问带进去会让后端把两轮问题合成一条重新理解，一串重复语义反而查不准。
   */
  return [selectedLabels.join("、"), remark].filter(Boolean).join("、");
}


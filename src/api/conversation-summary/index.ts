import type { ConversationSummary, GetConversationSummaryParams } from "./types";
import { request } from "@/utils/request";

export type { ConversationSummary, GetConversationSummaryParams } from "./types";

export function getConversationSummary(params: GetConversationSummaryParams) {
  return request.get<ConversationSummary>("/conversation-summary/query", params).json();
}

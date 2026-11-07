export { expandChartFences } from "./chartFence";
export type { AiBlock, AiBlockType, StreamBlockUpdate, ThinkStep } from "./chatStreamParser";

export { applyEventToBlocks, buildInitialBlocks } from "./chatStreamParser";
export type { ChunkData, ChunkDecoder } from "./chunkDecoder";

export { createChunkDecoder } from "./chunkDecoder";
export { createDifyEventNormalizer, extractDifyHistoryBlocks, toDifyChatMessagesRequest } from "./dify";
export type {
  ReportAdjustmentAction,
  ReportInteraction,
  ReportListFilter,
  ReportModuleCode,
  ReportNavigationAction,
  ReportQaInteraction,
  ReportUrgentAction,
  ReportUrgentTarget,
  ReportWorkflowAction,
} from "./report-interaction";
export { parseReportInteraction } from "./report-interaction";
export type { ReportStyleTagResult } from "./report-style-tag";
export { parseReportStyleTag, stripReportStyleTags } from "./report-style-tag";
export type { RoleTagCode, RoleTagResult } from "./role-tag";
export { parseRoleTaggedAnswer, ROLE_TAG_CODES, stripRoleTags } from "./role-tag";

export type { SseSession, SseSessionOptions } from "./sseSession";
export { createSseSession } from "./sseSession";

export type { ChatStreamSnapshot, ConsumeChatStreamOptions } from "./streamConsumer";
export { consumeChatStream } from "./streamConsumer";

export type { StreamFlusher, StreamFlusherOptions } from "./streamFlusher";
export { createStreamFlusher } from "./streamFlusher";
export { expandMarkdownTables, stripMarkdownTables } from "./tableFence";
export type { VoiceStyleTagResult } from "./voice-style-tag";
export { parseVoiceStyleTag, stripVoiceStyleTags } from "./voice-style-tag";
export type { WorkReportTagResult } from "./work-report-tag";
export { parseWorkReportTag } from "./work-report-tag";

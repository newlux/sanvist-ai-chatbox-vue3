import type {
  GetReportInsightEventsParams,
  ReportInsightPage,
  ToggleReportInsightUrgentParams,
  ToggleReportInsightUrgentResult,
} from "./types";
import { request } from "@/utils/request";

export type {
  GetReportInsightEventsParams,
  ReportInsightEvent,
  ReportInsightPage,
  ToggleReportInsightUrgentParams,
  ToggleReportInsightUrgentResult,
} from "./types";

const jsonOptions = {
  headers: {
    "Content-Type": "application/json",
  },
};

export function getReportInsightEvents(params: GetReportInsightEventsParams = {}) {
  return request.get<ReportInsightPage>("/sanvist-event/list", params).json();
}

export function toggleReportInsightUrgent(params: ToggleReportInsightUrgentParams) {
  return request.post<ToggleReportInsightUrgentResult>("/sanvist-event/urgent", params, jsonOptions).json();
}

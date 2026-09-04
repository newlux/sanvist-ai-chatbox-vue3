export interface ReportInsightEvent {
  eventId: string;
  deviceNo: string;
  eventCategory: string;
  eventType: string;
  description: string;
  eventTime: string;
  processStatus: string;
  eventTypeCode: string;
  evidenceLevel: string;
  ownerTag: string;
  urgent: boolean;
  urgentBy: string | null;
  urgentTime: string | null;
}

export interface ReportInsightPage {
  items: ReportInsightEvent[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface GetReportInsightEventsParams {
  page?: number;
  pageSize?: number;
}

export interface ToggleReportInsightUrgentParams {
  eventId: string;
}

export interface ToggleReportInsightUrgentResult {
  eventId: string;
  urgent: boolean;
  urgentBy: string | null;
  urgentUserName: string | null;
  urgentTime: string | null;
}

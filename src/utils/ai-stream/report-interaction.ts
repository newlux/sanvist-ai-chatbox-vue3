export interface ReportQaInteraction {
  interactionType: "qa";
  answer: string;
}

const REPORT_MODULE_CODES = ["operation", "energy", "risk"] as const;
export type ReportModuleCode = (typeof REPORT_MODULE_CODES)[number];

export interface ReportListFilter {
  deviceIds?: string[];
  eventIds?: string[];
  statuses?: string[];
  urgency?: "urgent" | "normal";
}

export interface ReportUrgentTarget {
  eventId: string;
  deviceId?: string;
  title?: string;
}

export type ReportAdjustmentAction =
  | {
    type: "update_modules";
    selectedModules: ReportModuleCode[];
  }
  | {
    type: "switch_script_version";
    scriptVersion: "normal" | "brief";
  }
  | {
    type: "playback_control";
    playbackCommand: "pause" | "resume";
    delaySeconds: number;
  };

export interface ReportNavigationAction {
  type: "open_insight" | "enter_insight";
}

export type ReportWorkflowAction =
  | ReportAdjustmentAction
  | ReportNavigationAction
  | {
    type: "filter_list";
    filter: ReportListFilter;
  }
  | {
    type: "request_confirmation";
    target: ReportUrgentTarget;
    message?: string;
  }
  | {
    type: "execute_urgent";
    target: ReportUrgentTarget;
  }
  | {
    type: "update_confirmation";
    confirmed: boolean;
    target?: ReportUrgentTarget;
  }
  | {
    type: "none";
  };

export interface ReportAdjustmentInteraction {
  interactionType: "adjustment";
  action: ReportAdjustmentAction;
}

export interface ReportNavigationInteraction {
  interactionType: "navigation";
  action: ReportNavigationAction;
}

export interface ReportWorkflowInteraction {
  interactionType: "workflow";
  action: ReportWorkflowAction;
}

export type ReportInteraction = ReportQaInteraction | ReportAdjustmentInteraction | ReportNavigationInteraction | ReportWorkflowInteraction;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPayload(value: unknown) {
  if (!isRecord(value)) return null;
  return isRecord(value.data) ? value.data : value;
}

function getActionParams(value: Record<string, unknown>) {
  return isRecord(value.params) ? value.params : value;
}

function parseString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseStringList(value: unknown) {
  if (!Array.isArray(value)) return null;
  const items = value.map(parseString);
  return items.every(Boolean) ? items as string[] : null;
}

function parseSelectedModules(value: unknown): ReportModuleCode[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const modules = value.filter((item): item is ReportModuleCode =>
    typeof item === "string" && REPORT_MODULE_CODES.includes(item as ReportModuleCode),
  );
  return modules.length === value.length && new Set(modules).size === modules.length ? modules : null;
}

function parseUrgentTarget(value: unknown): ReportUrgentTarget | null {
  if (!isRecord(value)) return null;
  const eventId = parseString(value.event_id ?? value.eventId);
  if (!eventId) return null;
  const deviceId = parseString(value.device_id ?? value.deviceId) ?? undefined;
  const title = parseString(value.title) ?? undefined;
  return { eventId, deviceId, title };
}

function parseListFilter(value: unknown): ReportListFilter | null {
  if (!isRecord(value)) return null;
  const deviceIds = parseStringList(value.device_ids ?? value.deviceIds) ?? undefined;
  const eventIds = parseStringList(value.event_ids ?? value.eventIds) ?? undefined;
  const statuses = parseStringList(value.statuses) ?? undefined;
  const rawUrgency = value.urgency;
  if (rawUrgency !== undefined && rawUrgency !== "urgent" && rawUrgency !== "normal") return null;
  const urgency = rawUrgency as ReportListFilter["urgency"];
  const filter = { deviceIds, eventIds, statuses, urgency };
  return Object.values(filter).some(Boolean) ? filter : null;
}

function parseNavigationAction(value: unknown): ReportNavigationAction | null {
  if (!isRecord(value)) return null;
  return value.type === "open_insight" || value.type === "enter_insight" ? { type: value.type } : null;
}

function parseAdjustmentAction(value: unknown): ReportAdjustmentAction | null {
  if (!isRecord(value)) return null;
  const { type } = value;
  const params = getActionParams(value);

  if (type === "update_modules") {
    const selectedModules = parseSelectedModules(params.selected_modules ?? params.selectedModules);
    return selectedModules ? { type, selectedModules } : null;
  }

  if (type === "switch_script_version") {
    const scriptVersion = params.script_version ?? params.scriptVersion;
    return scriptVersion === "normal" || scriptVersion === "brief" ? { type, scriptVersion } : null;
  }

  if (type === "playback_control") {
    const playbackCommand = params.playback_command ?? params.playbackCommand;
    if (playbackCommand === "resume") return { type, playbackCommand, delaySeconds: 0 };
    const delaySeconds = params.delay_seconds ?? params.delaySeconds ?? 0;
    return playbackCommand === "pause"
      && typeof delaySeconds === "number"
      && Number.isFinite(delaySeconds)
      && Number.isInteger(delaySeconds)
      && delaySeconds >= 0
      ? { type, playbackCommand, delaySeconds }
      : null;
  }

  return null;
}

function parseWorkflowAction(value: unknown): ReportWorkflowAction | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  const adjustment = parseAdjustmentAction(value);
  if (adjustment) return adjustment;
  const navigation = parseNavigationAction(value);
  if (navigation) return navigation;
  const params = getActionParams(value);

  if (value.type === "filter_list") {
    const filter = parseListFilter(params.filter ?? params);
    return filter ? { type: value.type, filter } : null;
  }
  if (value.type === "request_confirmation") {
    const target = parseUrgentTarget(params.target ?? params);
    const message = parseString(params.message) ?? undefined;
    return target ? { type: value.type, target, message } : null;
  }
  if (value.type === "execute_urgent") {
    const target = parseUrgentTarget(params.target ?? params);
    return target ? { type: value.type, target } : null;
  }
  if (value.type === "update_confirmation") {
    const confirmed = params.confirmed ?? params.confirmation;
    const target = parseUrgentTarget(params.target ?? params) ?? undefined;
    return typeof confirmed === "boolean" ? { type: value.type, confirmed, target } : null;
  }
  return value.type === "none" ? { type: value.type } : null;
}

/** 只消费协议约定且参数完整的汇报交互，其他内容由原有普通回答链路处理。 */
export function parseReportInteraction(rawAnswer: string): ReportInteraction | null {
  try {
    const trimmedAnswer = rawAnswer.trim();
    const podcastStart = /^<PODCAST>/i;
    const podcastEnd = /<\/PODCAST>$/i;
    const normalizedAnswer = podcastStart.test(trimmedAnswer) && podcastEnd.test(trimmedAnswer)
      ? trimmedAnswer.replace(podcastStart, "").replace(podcastEnd, "").trim()
      : trimmedAnswer;
    const payload = getPayload(JSON.parse(normalizedAnswer));
    if (!payload) return null;

    if (payload.interaction_type === "qa") {
      const answer = parseString(payload.answer);
      return answer ? { interactionType: "qa", answer } : null;
    }

    const fallbackAction = typeof payload.action_type === "string"
      ? {
          type: payload.action_type,
          params: payload.params,
        }
      : null;
    const action = parseWorkflowAction(payload.action ?? fallbackAction);
    if (!action) return null;

    if (payload.interaction_type === "adjustment" && (
      action.type === "update_modules"
      || action.type === "switch_script_version"
      || action.type === "playback_control"
    )) {
      return { interactionType: "adjustment", action };
    }
    if (payload.interaction_type === "navigation" && (action.type === "open_insight" || action.type === "enter_insight")) {
      return { interactionType: "navigation", action };
    }
    return { interactionType: "workflow", action };
  } catch {
    return null;
  }
}

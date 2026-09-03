export interface ReportQaInteraction {
  interactionType: "qa";
  answer: string;
}

const REPORT_MODULE_CODES = ["operation", "energy", "risk"] as const;
export type ReportModuleCode = (typeof REPORT_MODULE_CODES)[number];

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

export interface ReportAdjustmentInteraction {
  interactionType: "adjustment";
  action: ReportAdjustmentAction;
}

export type ReportInteraction = ReportQaInteraction | ReportAdjustmentInteraction;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPayload(value: unknown) {
  if (!isRecord(value)) return null;
  return isRecord(value.data) ? value.data : value;
}

function parseSelectedModules(value: unknown): ReportModuleCode[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const modules = value.filter((item): item is ReportModuleCode =>
    typeof item === "string" && REPORT_MODULE_CODES.includes(item as ReportModuleCode),
  );
  return modules.length === value.length && new Set(modules).size === modules.length ? modules : null;
}

function parseAdjustmentAction(value: unknown): ReportAdjustmentAction | null {
  if (!isRecord(value) || !isRecord(value.params)) return null;
  const { type, params } = value;

  if (type === "update_modules") {
    const selectedModules = parseSelectedModules(params.selected_modules);
    return selectedModules ? { type, selectedModules } : null;
  }

  if (type === "switch_script_version") {
    const scriptVersion = params.script_version;
    return scriptVersion === "normal" || scriptVersion === "brief" ? { type, scriptVersion } : null;
  }

  if (type === "playback_control") {
    const playbackCommand = params.playback_command;
    if (playbackCommand === "resume") return { type, playbackCommand, delaySeconds: 0 };
    const delaySeconds = params.delay_seconds ?? 0;
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

/** 只消费协议约定且参数完整的汇报交互，其他内容由原有普通回答链路处理。 */
export function parseReportInteraction(rawAnswer: string): ReportInteraction | null {
  try {
    const payload = getPayload(JSON.parse(rawAnswer));
    if (!payload) return null;

    if (payload.interaction_type === "qa") {
      const answer = typeof payload.answer === "string" ? payload.answer.trim() : "";
      return answer ? { interactionType: "qa", answer } : null;
    }

    if (payload.interaction_type !== "adjustment") return null;
    const action = parseAdjustmentAction(payload.action);
    return action ? { interactionType: "adjustment", action } : null;
  } catch {
    return null;
  }
}

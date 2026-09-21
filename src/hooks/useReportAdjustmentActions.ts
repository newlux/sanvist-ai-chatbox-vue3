import type { PlayListenBroadcastParams } from "@/api/listen-broadcast/types";
import type {
  ReportAdjustmentAction,
  ReportNavigationAction,
  ReportWorkflowAction,
} from "@/utils/ai-stream/report-interaction";
import { createLogger } from "@/utils/logger";

const logger = createLogger("report-adjustment-actions");

export interface ReportPlaybackController {
  pause: () => void;
  resume: () => void;
  restart: (params: PlayListenBroadcastParams) => void;
}

export interface UseReportAdjustmentActionsOptions {
  getParams: () => PlayListenBroadcastParams | null;
  setParams: (params: PlayListenBroadcastParams) => void;
  saveReportStyle: (styleCode: string, moduleCodes: string[]) => void;
  getPlayer: () => ReportPlaybackController | null;
  /** 打开异常列表；animated=true 时播放入场过渡（仅语音跳转需要）。 */
  openInsight: (animated?: boolean) => void;
  filterInsightList: (action: Extract<ReportWorkflowAction, { type: "filter_list" }>) => void;
  requestUrgentConfirmation: (action: Extract<ReportWorkflowAction, { type: "request_confirmation" }>) => void;
  executeUrgent: (action: Extract<ReportWorkflowAction, { type: "execute_urgent" }>) => void;
  executeCancelUrgent: (action: Extract<ReportWorkflowAction, { type: "cancel_urgent" }>) => void;
  updateUrgentConfirmation: (action: Extract<ReportWorkflowAction, { type: "update_confirmation" }>) => void;
}

/** 收到加急 / 取消加急指令后回到异常列表，等待 1 秒再真正发请求。 */
const URGENT_ACTION_DELAY = 1000;

export function useReportAdjustmentActions(options: UseReportAdjustmentActionsOptions) {
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  let urgentTimer: ReturnType<typeof setTimeout> | null = null;

  function clearDelayedPause() {
    if (!pauseTimer) return;
    clearTimeout(pauseTimer);
    pauseTimer = null;
  }

  function clearDelayedUrgent() {
    if (!urgentTimer) return;
    clearTimeout(urgentTimer);
    urgentTimer = null;
  }

  function scheduleUrgent(run: () => void) {
    clearDelayedUrgent();
    urgentTimer = setTimeout(() => {
      urgentTimer = null;
      run();
    }, URGENT_ACTION_DELAY);
  }

  function restartWith(params: PlayListenBroadcastParams) {
    options.setParams(params);
    if (params.styleCode && params.checkedModules?.length) {
      options.saveReportStyle(params.styleCode, params.checkedModules);
    }
    options.getPlayer()?.restart(params);
  }

  function executeNavigation(action: ReportNavigationAction) {
    // 语音跳转异常页保留入场过渡；异常处理回到列表则直接呈现。
    if (action.type === "open_insight" || action.type === "enter_insight") options.openInsight(true);
  }

  function executeWorkflow(action: ReportWorkflowAction) {
    if (action.type === "none") return;
    if (action.type === "open_insight" || action.type === "enter_insight") {
      executeNavigation(action);
      return;
    }
    if (action.type === "filter_list") {
      options.openInsight();
      options.filterInsightList(action);
      return;
    }
    if (action.type === "request_confirmation") {
      options.openInsight();
      options.requestUrgentConfirmation(action);
      return;
    }
    if (action.type === "execute_urgent") {
      options.openInsight();
      scheduleUrgent(() => options.executeUrgent(action));
      return;
    }
    if (action.type === "cancel_urgent") {
      options.openInsight();
      scheduleUrgent(() => options.executeCancelUrgent(action));
      return;
    }
    if (action.type === "update_confirmation") {
      // 取消：不动加急；确认：先回异常列表，1 秒后再执行加急。
      if (!action.confirmed) {
        options.updateUrgentConfirmation(action);
        return;
      }
      options.openInsight();
      scheduleUrgent(() => options.updateUrgentConfirmation(action));
      return;
    }
    if (
      action.type === "update_modules"
      || action.type === "switch_script_version"
      || action.type === "playback_control"
    ) {
      execute(action);
    }
  }

  function execute(action: ReportAdjustmentAction) {
    if (action.type === "update_modules") {
      const params = options.getParams();
      if (!params) {
        logger.warn("忽略模块调整：当前没有播报配置");
        return;
      }
      clearDelayedPause();
      restartWith({ ...params, checkedModules: action.selectedModules });
      return;
    }

    if (action.type === "switch_script_version") {
      const params = options.getParams();
      if (!params) {
        logger.warn("忽略版本切换：当前没有播报配置");
        return;
      }
      clearDelayedPause();
      restartWith({ ...params, scriptVersion: action.scriptVersion });
      return;
    }

    clearDelayedPause();
    const player = options.getPlayer();
    if (!player) {
      logger.warn("忽略播放控制：播放器未就绪");
      return;
    }
    if (action.playbackCommand === "resume") {
      player.resume();
      return;
    }
    if (!action.delaySeconds) {
      player.pause();
      return;
    }
    pauseTimer = setTimeout(() => {
      pauseTimer = null;
      options.getPlayer()?.pause();
    }, action.delaySeconds * 1000);
  }

  return {
    execute,
    executeNavigation,
    executeWorkflow,
    dispose() {
      clearDelayedPause();
      clearDelayedUrgent();
    },
  };
}

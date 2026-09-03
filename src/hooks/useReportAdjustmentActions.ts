import type { PlayListenBroadcastParams } from "@/api/listen-broadcast/types";
import type { ReportAdjustmentAction } from "@/utils/ai-stream/report-interaction";
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
}

export function useReportAdjustmentActions(options: UseReportAdjustmentActionsOptions) {
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;

  function clearDelayedPause() {
    if (!pauseTimer) return;
    clearTimeout(pauseTimer);
    pauseTimer = null;
  }

  function restartWith(params: PlayListenBroadcastParams) {
    options.setParams(params);
    if (params.styleCode && params.checkedModules?.length) {
      options.saveReportStyle(params.styleCode, params.checkedModules);
    }
    options.getPlayer()?.restart(params);
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
    dispose: clearDelayedPause,
  };
}

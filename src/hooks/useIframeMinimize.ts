/**
 * 对话类页面的「最小化到主应用」能力。
 *
 * PC 端（from=sanvist_pc）把本应用嵌在悬浮窗 iframe 里，各对话页
 * （首页 / 听播 / 作业指导 / 任务协同）都需要在头部露出「最小化」。
 *
 * 判定与投递都收在这里，页面只做两件事：拿 canMinimize 控制显隐、把 onMinimize 接到点击。
 * 这样新增页面不用重复理解 iframe 协议。
 */

import { computed } from "vue";
import { useSystemStore } from "@/stores/modules/system";
import { FROM_SANVIST_PC, isSanvistPcEmbedded, notifyParentMinimize } from "@/utils/iframe";
import { createLogger } from "@/utils/logger";

const logger = createLogger("iframe-minimize");

export function useIframeMinimize() {
  const systemStore = useSystemStore();

  /**
   * 是否需要展示「最小化」入口。
   *
   * 只看来源标识：from=sanvist_pc 即认为主应用会处理这条消息，
   * 不额外校验真实嵌套，方便直接在浏览器里带参调试。
   * 取值兜底两层：启动时写入 store 的值优先，为空再回落到当前 location
   * —— 跨页跳转（首页 ↔ 听播 ↔ 指导）时 query 可能没带上。
   */
  const canMinimize = computed(() => (
    systemStore.from === FROM_SANVIST_PC || isSanvistPcEmbedded()
  ));

  /**
   * 通知主应用收起悬浮窗。本页状态一律不动，
   * 收起后再展开要能无缝回到原对话 / 原播报进度。
   */
  function onMinimize() {
    if (!notifyParentMinimize()) {
      logger.warn("父应用未响应最小化，可能是直接打开页面而非内嵌");
    }
  }

  return { canMinimize, onMinimize };
}

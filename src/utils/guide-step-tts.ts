/**
 * 多步骤卡翻页时「接着播新一步」的一次性信号。
 *
 * 点「确认，进入下一步」之后，当前这张步骤卡会被整块卸载、下一步的卡片重新挂载，
 * 中间没有公共父级可以传 props，所以用模块级标记传递：
 * 点确认时记下目标步序 → 新卡片挂载时按自己的步序认领 → 认领即清空。
 *
 * 只认「序号对得上」的那次挂载：同一条消息里其它轮次的卡、列表重排引起的挂载
 * 序号对不上，就不会误把标记吃掉，也不会莫名出声。
 *
 * 纯 UI 时序标记，不进 store；页面刷新即复位。
 */
let pendingStepIndex = 0;
let pendingStepAt = 0;
/**
 * 完成态（步骤小结已出现）下切回前面步骤时，翻页信号要附带小结文本：
 * 期望「切回某步」播报 该步正文 + 步骤小结，组件认领后把它拼进播报文本。
 * 非完成态翻页（普通步骤间切换）没有小结，保持空串走原来的 stepId 兜底。
 */
let pendingStepSummary = "";
/** 最后一步确认完：小结卡挂载后要念小结 */
let pendingSummaryAt = 0;
/** 标记存活时间：翻页是「点完立刻重挂载」，超过这个时间还没人认领就是过期信号 */
const STEP_TTS_SWITCH_TTL_MS = 2000;

/** 点「确认，进入下一步」：标记下一步（1 起的步序）的卡片挂载后要接着播 */
export function requestStepTtsSwitch(nextStepIndex: number, summaryText = "") {
  pendingStepIndex = Math.round(Number(nextStepIndex) || 0);
  pendingStepSummary = String(summaryText || "");
  pendingStepAt = Date.now();
}

/**
 * 新卡片挂载时按自己的步序认领标记：返回认领到的小结文本（无小结为空串），
 * 返回 null 表示这次挂载不是「翻页」来的那一步（不该出声）。
 * 认领即清空标记，避免重复挂载误吞。
 */
export function consumeStepTtsSwitch(stepIndex: number): string | null {
  if (!pendingStepIndex) return null;
  if (Date.now() - pendingStepAt > STEP_TTS_SWITCH_TTL_MS) {
    pendingStepIndex = 0;
    pendingStepSummary = "";
    return null;
  }
  if (Math.round(Number(stepIndex) || 0) !== pendingStepIndex) return null;
  const summaryText = pendingStepSummary;
  pendingStepIndex = 0;
  pendingStepSummary = "";
  return summaryText;
}

/**
 * 最后一步点确认：步骤卡让位给小结，标记「小结卡挂载后要念小结」。
 * 和翻页信号分开存，两个时刻互不影响（0 值表示没有待认领的小结播报）。
 */
export function requestSummaryTts() {
  pendingSummaryAt = Date.now();
}

/** 小结卡挂载时认领标记：返回 true 表示这次挂载是「刚确认完最后一步」来的 */
export function consumeSummaryTts(): boolean {
  if (!pendingSummaryAt) return false;
  const fresh = Date.now() - pendingSummaryAt <= STEP_TTS_SWITCH_TTL_MS;
  pendingSummaryAt = 0;
  return fresh;
}

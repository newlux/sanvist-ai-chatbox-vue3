/**
 * 点步骤条 / 左右滑动切步时，「新卡片挂载后不要顶到对话区顶部」的一次性信号。
 *
 * 卡片翻页是整卡卸载再挂载，中间没有公共父级能传 props，所以和 guide-step-tts 同一套模块级标记：
 * 切步前记下目标步序 → 紧跟着挂载的那张卡按自己的步序认领 → 认领即清空。
 *
 * 只认「序号对得上」的那次挂载：同一条消息里其它轮次的卡、列表重排引起的挂载序号对不上，
 * 不会误把标记吃掉，也不会让下一次该顶置的挂载变成不顶置。
 *
 * 点「已经确认，进入下一步」不落标记，仍按原逻辑顶到对话区顶部。
 */
let pendingKeepStepIndex = 0;
let pendingKeepAt = 0;
/** 标记存活时间：切步是「点完立刻重挂载」，超过这个时间还没人认领就是过期信号 */
const KEEP_POSITION_TTL_MS = 2000;

/** 切步前登记：目标步序（1 起）的卡片挂载后保持视口不动 */
export function requestStepCardKeepPosition(stepIndex: number) {
  pendingKeepStepIndex = Math.round(Number(stepIndex) || 0);
  pendingKeepAt = Date.now();
}

/**
 * 新卡片挂载时认领：返回 true 表示这次挂载来自「点步骤条 / 滑动切步」，不要顶置。
 * 认领即清空标记，避免重复挂载误吞。
 */
export function consumeStepCardKeepPosition(stepIndex: number): boolean {
  if (!pendingKeepStepIndex) return false;
  if (Date.now() - pendingKeepAt > KEEP_POSITION_TTL_MS) {
    pendingKeepStepIndex = 0;
    return false;
  }
  if (Math.round(Number(stepIndex) || 0) !== pendingKeepStepIndex) return false;
  pendingKeepStepIndex = 0;
  return true;
}

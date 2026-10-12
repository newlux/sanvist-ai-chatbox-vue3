/**
 * 甘特图（横屏调度视图）里问的问题，要在「离开甘特图 → 回到作业协同对话页」之后才发送。
 *
 * 两条返回路径都要覆盖：
 * - 上一页就是对话页：navigateBack 回去，对话页的 onShow 里取走文本；
 * - 独立场景窗口（nativeSceneWindow=1）：关闭 webview 回到对话页，同样是 onShow。
 *
 * 所以文本走本地存储（而不是 url 参数 / 事件总线）——对话页可能是已经存在的那个实例，
 * 页面参数不会再解析一次，存储 + onShow 才两条路都稳。
 * 参考同目录 repair-callback.ts 的写法。
 */
const PENDING_SCHEDULE_ASK_KEY = "pending-schedule-ask";

/** 记下一段待发送的问题（发送前调用） */
export function stashPendingScheduleAsk(text: string) {
  const value = String(text || "").trim();
  if (!value) return;
  try {
    uni.setStorageSync(PENDING_SCHEDULE_ASK_KEY, value);
  }
  catch {
    // 本地存储不可用时仍然放行返回，只是这条问题会丢。
  }
}

/** 取走待发送的问题（对话页 onShow 调用，取完即清） */
export function consumePendingScheduleAsk() {
  let value = "";
  try {
    value = String(uni.getStorageSync(PENDING_SCHEDULE_ASK_KEY) || "").trim();
  }
  catch {
    return "";
  }
  if (!value) return "";
  try {
    uni.removeStorageSync(PENDING_SCHEDULE_ASK_KEY);
  }
  catch {
    // 删除失败只会在下次进入时重发一次，这里不改返回值。
  }
  return value;
}

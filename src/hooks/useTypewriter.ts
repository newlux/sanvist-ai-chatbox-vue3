import { computed, onBeforeUnmount, ref, watch } from "vue";

/**
 * 打字机逐字揭示（参考听播页 report-broadcast-content 的「当前段打字机」实现）。
 *
 * 为什么需要：回答正文由 SSE 下发，后端有时整段一次性到达（workflow_finished 兜底），
 * 渲染出来就是「唰」地一整屏文字；顺带把列表高度一次撑高，滚动对齐只能整屏跳一下。
 * 这里把「已到达的文本」按固定节奏逐字放出，内容高度平滑增长，滚动跟随也就平了。
 *
 * 与听播固定 80ms/字的区别：字幕只有一句，正文动辄几百上千字，固定慢速会让用户干等。
 * 所以按「积压量」自适应：积压少时逐字慢放（40ms/字 ≈ 25 字/秒），积压多时每帧多吐几个字，
 * 最长 catchUpTicks × tickMs 毫秒内一定追平 —— 既保留打字机手感，又不让长回答拖太久。
 */
export interface TypewriterOptions {
  /** 总开关（函数形式，便于随外部状态实时判断）。false 时直接整体显示，不做逐字 */
  enabled?: () => boolean;
  /** 每帧间隔（ms），默认 40（≈25 字/秒的基础速度） */
  tickMs?: number;
  /** 追平当前积压所需的帧数，默认 50（40ms × 50 = 2 秒内一定追平任意长度的整段文本） */
  catchUpTicks?: number;
}

export function useTypewriter(source: () => string, options: TypewriterOptions = {}) {
  const tickMs = options.tickMs ?? 40;
  const catchUpTicks = Math.max(1, options.catchUpTicks ?? 50);
  const enabled = () => Boolean(options.enabled?.());

  /** 已经放出的字数（打字进度） */
  const revealed = ref(0);
  /** 是否还在吐字：渲染层据此保持「流式」渲染节奏（markdown 按流式节流解析） */
  const typing = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;
  /** 上一次看到的完整文本：判断本次是「追加」还是「整段替换」 */
  let previousText = "";

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    typing.value = false;
  }

  function tick() {
    const text = source() || "";
    const backlog = text.length - revealed.value;
    if (backlog <= 0) {
      stop();
      return;
    }
    // 积压越多每帧吐字越多：积压 10 字时仍逐字，积压 500 字时约 10 字/帧（2 秒追平）
    revealed.value = Math.min(text.length, revealed.value + Math.max(1, Math.ceil(backlog / catchUpTicks)));
    if (revealed.value >= text.length) stop();
  }

  function start() {
    if (timer) return;
    typing.value = true;
    timer = setInterval(tick, tickMs);
  }

  function sync() {
    const text = source() || "";
    if (!enabled()) {
      /**
       * 关闭：可见文本直接整体显示（见 visible）。
       * 这里**不把进度推到末尾**——开关可能稍后才确定（例如核对卡挂载时才知道是不是切步来的），
       * 提前推到末尾就再也不会从头打了；保持进度不动，开关一打开就能从当前位置继续吐字。
       */
      previousText = text;
      stop();
      return;
    }
    /**
     * 不是在上一次文本后面追加（整段覆盖 / 清空 / 换了一段正文）就从头打：
     * 流式追加一定以旧文本为前缀，前缀对不上只可能是被替换了。
     */
    if (!text.startsWith(previousText)) revealed.value = 0;
    previousText = text;
    if (revealed.value > text.length) revealed.value = text.length;
    if (revealed.value < text.length) start();
    else stop();
  }

  watch(source, sync, { immediate: true });
  // 开关中途打开（例如消息从历史态被重新认定为新鲜回答）：立刻按新状态重算一次
  watch(() => enabled(), (on) => {
    if (on) sync();
  });

  const visible = computed(() => {
    const text = source() || "";
    if (!enabled() || revealed.value >= text.length) return text;
    return text.slice(0, revealed.value);
  });

  onBeforeUnmount(stop);

  return { visible, typing };
}

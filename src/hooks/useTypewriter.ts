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

/** 新旧文本的公共前缀长度：整段被覆盖时用它兜住已经放出来的字 */
function commonPrefixLength(a: string, b: string) {
  const max = Math.min(a.length, b.length);
  let index = 0;
  while (index < max && a.charCodeAt(index) === b.charCodeAt(index)) index += 1;
  return index;
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
     * 不是在上一次文本后面追加（整段覆盖 / 清空 / 换了一段正文）时，只把进度退回到
     * 新旧文本的公共前缀长度，**不直接清零**。
     *
     * 触发场景：长回答还在逐字揭示时，workflow_finished 会重放 answer_layout 把整段正文
     * 重新覆盖一次（空白 / 协议标记归一化后和流式期间不完全一致，前缀对不上）。
     * 以前这里清零 —— 整段文字先消失、再从第一个字重打一遍，看起来就是「闪一下」。
     * 按公共前缀回退后，已经放出来的字保持可见，只重打真正变化的那一截。
     */
    if (!text.startsWith(previousText)) {
      const prefix = commonPrefixLength(text, previousText);
      // 公共前缀已经盖住已打出的字：进度不受影响，不必再往下判断
      if (prefix < revealed.value) {
        /**
         * 正文被「删掉一段」时不要按公共前缀回退：流式期间正文里还带着 Markdown 表格源码，
         * 表格被拆成独立的 table 块后这段源码从正文里消失（可能出现在开头，也可能在中间），
         * 前缀可能只剩开头几句甚至 0 —— 已经打出来的字会整段收回去再逐字重打一遍，
         * 看起来就是「文字整段消失又出现」。新文本仍是旧文本的一部分时，进度夹到新长度以内即可。
         */
        if (text && previousText.includes(text)) {
          revealed.value = Math.min(revealed.value, text.length);
        } else {
          revealed.value = prefix;
        }
      }
    }
    previousText = text;
    if (revealed.value > text.length) revealed.value = text.length;
    if (revealed.value < text.length) start();
    else stop();
  }

  watch(source, sync, { immediate: true });
  /**
   * 开关中途变化时都同步一次：
   * - 打开（例如重放块直接整段显示后又被重新认定为新鲜回答）：按新状态重算，从当前位置继续吐字；
   * - 关闭：只把 previousText 跟到最新（见 sync 的 !enabled 分支，不动已放出的进度），
   *   否则再次打开时拿的是关闭前的旧文本，等于把「开关关闭期间已经换过一遍的内容」误判成整段替换。
   */
  watch(() => enabled(), sync);

  const visible = computed(() => {
    const text = source() || "";
    if (!enabled() || revealed.value >= text.length) return text;
    return text.slice(0, revealed.value);
  });

  onBeforeUnmount(stop);

  return { visible, typing };
}

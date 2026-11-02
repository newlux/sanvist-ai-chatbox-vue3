import { onScopeDispose, ref } from "vue";
import { getMicrophoneVolume } from "@/utils/platform/mpaas";

/**
 * 麦克风实时电平（0~1），用来让「按住说话」时底部的渐变跟着声音抖。
 *
 * - 100ms 轮询一次 `microphoneVolume`，宿主不回调就退避重试，绝不停止（这个 JSAPI
 *   本来就时有时无，停了表现就是「说话时底部一动不动」）；
 * - rAF 里做 attack / release 平滑：电平 100ms 才来一次，不插值会是 100ms 一跳的硬抖动；
 * - 只在按压态 `start()`，松手 `stop()`，不录音时完全不占轮询与帧。
 *
 * 视觉怎么用由调用方决定（缩放系数、抖动曲线），这里只给一个平滑后的电平。
 */
export function useMicLevel(options: {
  /** 电平上升的跟随速度，越大越"跟手" */
  attack?: number;
  /** 落回速度，比 attack 慢才像人说话 */
  release?: number;
  /** 轮询间隔（毫秒） */
  intervalMs?: number;
  /**
   * 每帧回调（平滑后的 0~1）。
   * 页面元素大、或者只想直接改某个 DOM 的样式时用这个，别把 level 绑进模板 ——
   * 每帧触发一次整页重渲染，真机上会明显掉帧。
   */
  onLevel?: (level: number) => void;
} = {}) {
  const { attack = 0.7, release = 0.2, intervalMs = 100, onLevel } = options;
  /** 平滑后的电平，0~1 */
  const level = ref(0);

  let polling = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let target = 0;
  let smoothed = 0;
  let misses = 0;

  async function poll() {
    if (!polling) return;
    const value = await getMicrophoneVolume();
    if (!polling) return;
    if (value == null) {
      // 宿主这一次没给：退避重试，采不到电平也不能停（停了视觉就死了）
      misses += 1;
      timer = setTimeout(poll, Math.min(1000, intervalMs * 2 ** Math.min(misses, 4)));
      return;
    }
    misses = 0;
    target = value;
    timer = setTimeout(poll, intervalMs);
  }

  function tick() {
    frame = requestAnimationFrame(tick);
    const follow = target > smoothed ? attack : release;
    smoothed += (target - smoothed) * follow;
    if (Math.abs(target - smoothed) < 0.002) smoothed = target;
    level.value = Number(smoothed.toFixed(3));
    onLevel?.(smoothed);
  }

  function start() {
    if (polling) return;
    polling = true;
    misses = 0;
    if (typeof requestAnimationFrame === "function" && !frame) frame = requestAnimationFrame(tick);
    void poll();
  }

  function stop() {
    polling = false;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (frame) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      frame = 0;
    }
    target = 0;
    smoothed = 0;
    level.value = 0;
    onLevel?.(0);
  }

  onScopeDispose(stop);

  return { level, start, stop };
}

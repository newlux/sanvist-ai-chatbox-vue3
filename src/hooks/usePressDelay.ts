import { onScopeDispose, ref } from "vue";

/**
 * 按压类交互的防误触延迟。
 *
 * 按下时**什么都不发生**，持续按住超过 delayMs 才把 `active` 置 true；
 * 不到点就松手（真机上点一下、手抖、误碰）全程不会有任何视觉 / 状态变化。
 *
 * 典型用法：
 * ```ts
 * const { active: pressing, press, release } = usePressDelay(500);
 * // touchstart -> press()，touchend / touchcancel -> release()
 * // 模板里用 pressing 控制底部渐变、录音遮罩这类"按住才出现"的 UI
 * ```
 *
 * 注意：这里只管**视觉 / UI 的展示时机**，录音本身仍应在按下瞬间就开始，
 * 否则会把用户开口的头几百毫秒切掉。
 */
export function usePressDelay(delayMs = 500) {
  const active = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  /** 按下：开始计时，满 delayMs 后 active 才变 true */
  function press() {
    clearTimer();
    timer = setTimeout(() => {
      timer = undefined;
      active.value = true;
    }, delayMs);
  }

  /** 松手 / 取消 / 页面切走：立即复位，未到点的那次也会被取消 */
  function release() {
    clearTimer();
    active.value = false;
  }

  onScopeDispose(clearTimer);

  return { active, press, release };
}

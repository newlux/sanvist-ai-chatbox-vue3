import { onBeforeUnmount, onDeactivated, onMounted } from "vue";

/**
 * 声波芯片手势：单击（抬手）触发 `onClick`，按住两秒触发 `onHold`；一次手势只执行一种动作。
 * 双工场景下调用方把两者都接到 `duplex-toggle`，等于「点一下开、长按也是开」；
 * 「点击说话」在旁边的独立按钮上，不经过这个 hook。
 */
export function useDuplexButtonGesture(options: {
  onClick: () => void;
  onHold: () => void;
  onPressStart?: () => void;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let suppressTapUntil = 0;
  let press: { id: string; x: number; y: number; startedAt: number; held: boolean } | null = null;

  function cancel() {
    if (timer != null) clearTimeout(timer);
    timer = null;
    press = null;
  }

  function point(event: any) {
    const touch = event.touches?.[0] ?? event.changedTouches?.[0];
    return {
      id: touch ? `touch:${touch.identifier}` : event.pointerId != null ? `pointer:${event.pointerId}` : 'mouse',
      x: Number(touch?.clientX ?? event.clientX ?? 0),
      y: Number(touch?.clientY ?? event.clientY ?? 0),
    };
  }

  function sourceOf(id: string) {
    const index = id.indexOf(':');
    return index < 0 ? id : id.slice(0, index);
  }

  /**
   * 把当前手势对齐到收到的事件 id。
   *
   * 同一个元素同时挂了 pointer* 与 touch*：按下可能建立 `pointer:1`，随后却只收到
   * touchend（`touch:0`）或反之。原先 id 对不上就直接 return，press 永远留着，
   * 之后每次按下都被 `if (press) return` 挡回去，按钮表现为「彻底点不动」，
   * 只有切后台 / 失焦的 cancel 才能解开。
   * 这里跨事件源时直接把 id 续接过去（仍属同一次按压），同源但 id 不同则视为其他触点。
   */
  function syncPressId(id: string) {
    if (!press) return false;
    if (press.id === id) return true;
    if (sourceOf(press.id) !== sourceOf(id)) {
      press.id = id;
      return true;
    }
    return false;
  }

  function start(event: any) {
    if (event.isPrimary === false || (event.button != null && event.button !== 0)) return;
    if (press) {
      // 残留手势自愈：超过 5s 的 press 直接清掉，避免一次丢失的抬起永久锁死按钮。
      if (Date.now() - press.startedAt > 5000) cancel();
      else {
        syncPressId(point(event).id);
        return;
      }
    }
    if (Date.now() < suppressTapUntil) return;
    options.onPressStart?.();
    press = {
      ...point(event),
      startedAt: Date.now(), held: false,
    };
    if (event.pointerId != null) {
      try { (event.currentTarget as Element)?.setPointerCapture?.(event.pointerId); }
      catch { /* uni-view 的 currentTarget 可能不是原生 DOM，触摸/tap 仍可完成手势。 */ }
    }
    timer = setTimeout(() => {
      timer = null;
      if (!press) return;
      press.held = true;
      suppressTapUntil = Date.now() + 800;
      options.onHold();
    }, 2000);
  }

  function move(event: any) {
    const current = point(event);
    if (!press || !syncPressId(current.id)) return;
    if (Math.hypot(current.x - press.x, current.y - press.y) > 16) {
      suppressTapUntil = Date.now() + 800;
      cancel();
    }
  }

  function end(event: any) {
    // 抬起必须收尾：跨事件源会续接 id，只有同源的其他触点才忽略，避免 press 残留。
    if (!press || !syncPressId(point(event).id)) return;
    const { held, startedAt } = press;
    cancel();
    suppressTapUntil = Date.now() + 800;
    if (held) return;
    if (Date.now() - startedAt >= 2000) options.onHold();
    else options.onClick();
  }

  // uni-app 的 tap 在不同 WebView 中可能独立于 Pointer 事件产生。
  function tap() {
    if (Date.now() < suppressTapUntil) return;
    cancel();
    suppressTapUntil = Date.now() + 800;
    options.onClick();
  }

  function onVisibilityChange() {
    if (document.hidden) cancel();
  }

  onMounted(() => {
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", onVisibilityChange);
  });
  onDeactivated(cancel);
  onBeforeUnmount(() => {
    cancel();
    window.removeEventListener("blur", cancel);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  });

  return { start, move, end, cancel, tap };
}

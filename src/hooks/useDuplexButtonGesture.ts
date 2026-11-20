import { onBeforeUnmount, onDeactivated, onMounted } from "vue";

/** 双工按钮单击录音、长按两秒切换双工；一次手势只执行一种动作。 */
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

  function start(event: any) {
    if (event.isPrimary === false || (event.button != null && event.button !== 0) || press) return;
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
    if (!press || press.id !== current.id) return;
    if (Math.hypot(current.x - press.x, current.y - press.y) > 16) {
      suppressTapUntil = Date.now() + 800;
      cancel();
    }
  }

  function end(event: any) {
    if (!press || press.id !== point(event).id) return;
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

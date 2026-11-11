import type { Ref } from "vue";
import { onScopeDispose, watch } from "vue";

/** 松手监听归页面持有：录音条与欢迎动画切换时，统一在捕获阶段接住松手。 */
export function useVoiceQueryGesture(options: {
  active: Ref<boolean>;
  holding?: Ref<boolean>;
  cancelPending?: Ref<boolean>;
  start: () => unknown;
  send: () => unknown;
  cancel: () => unknown;
}) {
  let dispose: (() => void) | undefined;
  let sequence = 0;
  // 自动静音收尾/取消后，旧手势不得结束随后开启的新一轮。
  watch(options.active, active => {
    if (!active) sequence += 1;
  }, { flush: "sync" });

  onScopeDispose(() => {
    sequence += 1;
    dispose?.();
  });

  return async (mode?: "hold", pressTarget?: EventTarget) => {
    if (mode !== "hold" || typeof document === "undefined") {
      await options.start();
      return;
    }
    dispose?.();
    if (options.holding) options.holding.value = true;
    if (options.cancelPending) options.cancelPending.value = false;
    // WebView 可能继续把 touchend 派发给已移除的触点节点（此时不再冒泡到 document）。
    const target = pressTarget && typeof pressTarget.addEventListener === "function" ? pressTarget : null;
    const element = target as Element | null;
    // 固定按下时的语音区域，避免欢迎动画/录音条替换让区域跟着移动。
    const region = element?.closest?.(".input-bar__hold, .welcome__composer-voice") || element;
    const bounds = region?.getBoundingClientRect?.();
    let outside = false;
    const updatePosition = (event: Event) => {
      if (!bounds) return;
      const source = event as TouchEvent & MouseEvent;
      const point = source.touches?.[0] || source.changedTouches?.[0] || source;
      if (!Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return;
      outside = point.clientX < bounds.left || point.clientX > bounds.right
        || point.clientY < bounds.top || point.clientY > bounds.bottom;
      if (options.cancelPending) options.cancelPending.value = outside;
    };
    const onMove = (event: Event) => {
      updatePosition(event);
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };
    const current = ++sequence;
    let settle: (send: boolean) => void;
    const release = new Promise<boolean>(resolve => { settle = resolve; });
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    const swallowClick = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const removeRelease = () => {
      document.removeEventListener("touchend", onRelease, { capture: true });
      document.removeEventListener("mouseup", onRelease, { capture: true });
      document.removeEventListener("touchcancel", onCancel, { capture: true });
      document.removeEventListener("touchmove", onMove, { capture: true });
      document.removeEventListener("mousemove", onMove, { capture: true });
      target?.removeEventListener("touchend", onRelease, { capture: true });
      target?.removeEventListener("mouseup", onRelease, { capture: true });
      target?.removeEventListener("touchcancel", onCancel, { capture: true });
      target?.removeEventListener("touchmove", onMove, { capture: true });
      target?.removeEventListener("mousemove", onMove, { capture: true });
      window.removeEventListener("blur", onCancel);
    };
    const cleanup = () => {
      if (options.holding) options.holding.value = false;
      if (options.cancelPending) options.cancelPending.value = false;
      removeRelease();
      document.removeEventListener("click", swallowClick, { capture: true });
      if (clickTimer) clearTimeout(clickTimer);
      settle(false);
    };
    const finish = (event: Event, send: boolean) => {
      if (options.holding) options.holding.value = false;
      if (options.cancelPending) options.cancelPending.value = false;
      // 不让这次抬手落到刚出现的录音条上，也不生成第二次 tap。
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
      removeRelease();
      document.addEventListener("click", swallowClick, true);
      clickTimer = setTimeout(cleanup, 450);
      settle(send);
    };
    const onRelease = (event: Event) => {
      if ((event as TouchEvent).touches?.length) return;
      updatePosition(event);
      finish(event, !outside);
    };
    const onCancel = (event: Event) => finish(event, false);
    dispose = cleanup;
    document.addEventListener("touchend", onRelease, { capture: true, passive: false });
    document.addEventListener("mouseup", onRelease, true);
    document.addEventListener("touchcancel", onCancel, true);
    document.addEventListener("touchmove", onMove, { capture: true, passive: false });
    document.addEventListener("mousemove", onMove, true);
    target?.addEventListener("touchend", onRelease, { capture: true, passive: false });
    target?.addEventListener("mouseup", onRelease, true);
    target?.addEventListener("touchcancel", onCancel, true);
    target?.addEventListener("touchmove", onMove, { capture: true, passive: false });
    target?.addEventListener("mousemove", onMove, true);
    window.addEventListener("blur", onCancel);
    try {
      // 松手可能发生在麦克风授权或异步启动期间，等启动完成再结束同一轮。
      await options.start();
      const send = await release;
      if (current === sequence) {
        if (send) options.send();
        else options.cancel();
      }
    } catch (error) {
      cleanup();
      throw error;
    }
  };
}

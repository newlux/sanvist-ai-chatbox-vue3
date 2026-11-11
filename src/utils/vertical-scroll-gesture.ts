/** 横向表格/图表内的竖滑显式交给外层，避免安卓 WebView 和图表引擎吃掉手势。 */
export function bindVerticalScrollGesture(root: HTMLElement, selector?: string) {
  let scroller: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let lastTime = 0;
  let velocity = 0;
  let axis: 'x' | 'y' | null = null;
  let active = false;
  let pointerId: number | undefined;
  let momentum = 0;

  function stopMomentum() {
    if (momentum) cancelAnimationFrame(momentum);
    momentum = 0;
  }
  function findScroller() {
    let node = root.parentElement;
    while (node) {
      if (/^(auto|scroll)$/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
      node = node.parentElement;
    }
    const page = root.ownerDocument?.scrollingElement as HTMLElement | null;
    return page && page.scrollHeight > page.clientHeight + 1 ? page : null;
  }
  function point(event: Event) {
    const touch = event as TouchEvent;
    if (touch.touches) return touch.touches.length === 1 ? touch.touches[0] : null;
    const pointer = event as PointerEvent;
    if (pointer.pointerType === 'mouse' || (pointerId !== undefined && pointer.pointerId !== pointerId)) return null;
    return pointer;
  }
  function start(event: Event) {
    stopMomentum();
    active = false;
    pointerId = undefined;
    if ((event as PointerEvent).isPrimary === false) return;
    if (selector && !(event.target as Element)?.closest?.(selector)) return;
    const p = point(event);
    if (!p) return;
    scroller = findScroller();
    if (!scroller) return;
    pointerId = (event as PointerEvent).pointerId;
    startX = p.clientX;
    startY = lastY = p.clientY;
    lastTime = event.timeStamp;
    velocity = 0;
    axis = null;
    active = true;
  }
  function move(event: Event) {
    if (!active) return;
    const p = point(event);
    if (!p) { active = false; return; }
    if (!axis) {
      const dx = Math.abs(p.clientX - startX);
      const dy = Math.abs(p.clientY - startY);
      if (Math.max(dx, dy) < 6) return;
      axis = dy > dx ? 'y' : 'x';
    }
    if (axis !== 'y' || !scroller) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    const delta = lastY - p.clientY;
    const dt = event.timeStamp - lastTime;
    if (dt > 0) velocity = Math.max(-2.5, Math.min(2.5, delta / dt));
    scroller.scrollTop += delta;
    lastY = p.clientY;
    lastTime = event.timeStamp;
  }
  function end(event: Event) {
    if (!active) return;
    if ((event as PointerEvent).pointerId !== undefined && (event as PointerEvent).pointerId !== pointerId) return;
    active = false;
    if (axis !== 'y' || !scroller) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    if (event.type.endsWith('cancel') || event.timeStamp - lastTime > 100 || typeof requestAnimationFrame !== 'function') return;
    const target = scroller;
    let previous = performance.now();
    const started = previous;
    const frame = (now: number) => {
      const dt = Math.min(32, now - previous);
      previous = now;
      const before = target.scrollTop;
      target.scrollTop += velocity * dt;
      velocity *= Math.exp(-dt / 140);
      if (now - started < 400 && Math.abs(velocity) > 0.03 && Math.abs(target.scrollTop - before) > 0.1) {
        momentum = requestAnimationFrame(frame);
      } else momentum = 0;
    };
    momentum = requestAnimationFrame(frame);
  }
  function wheel(event: WheelEvent) {
    if (selector && !(event.target as Element)?.closest?.(selector)) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const target = findScroller();
    if (!target) return;
    stopMomentum();
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1;
    target.scrollTop += event.deltaY * unit;
  }
  // iOS 同时支持 Pointer/Touch。浏览器接管嵌套滚动时可能先派发 pointercancel，
  // 不能仅凭 PointerEvent 存在就丢掉后续 touchmove；竖滑需在 Touch 事件上阻止默认行为。
  // 只绑定一套事件，避免安卓同时派发两套事件时重复滚动。
  const view = root.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : null);
  const touch = Boolean(view && 'ontouchstart' in view);
  const pointer = !touch && typeof PointerEvent !== 'undefined';
  const events: Array<[string, EventListener]> = pointer
    ? [['pointerdown', start], ['pointermove', move], ['pointerup', end], ['pointercancel', end]]
    : [['touchstart', start], ['touchmove', move], ['touchend', end], ['touchcancel', end]];
  events.push(['wheel', wheel as EventListener]);
  events.forEach(([name, handler]) => root.addEventListener(name, handler, { capture: true, passive: false }));
  return () => {
    active = false;
    stopMomentum();
    events.forEach(([name, handler]) => root.removeEventListener(name, handler, { capture: true }));
  };
}

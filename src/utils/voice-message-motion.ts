/** 语音转写移入右侧胶囊，只改变绘制位置，不改变滚动定位使用的布局。 */
export interface VoiceMessageOrigin {
  left: number;
  top: number;
}

export function readVoiceMessageOrigin(element: Element | null): VoiceMessageOrigin | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return { left: rect.left, top: rect.top };
}

export function resolveMotionElement(value: unknown): HTMLElement | null {
  if (typeof HTMLElement === 'undefined') return null;
  if (value instanceof HTMLElement) return value;
  const element = (value as { $el?: unknown } | null)?.$el;
  return element instanceof HTMLElement ? element : null;
}

export function animateVoiceMessageArrival(element: HTMLElement | null, origin: VoiceMessageOrigin | null): (() => void) | null {
  if (!element || !origin || typeof element.animate !== 'function') return null;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const dx = origin.left - rect.left - (Number.parseFloat(style.paddingLeft) || 0);
  const dy = origin.top - rect.top - (Number.parseFloat(style.paddingTop) || 0);
  try {
    const animation = element.animate([
      { transform: `translate3d(${dx}px, ${dy}px, 0)`, backgroundColor: 'transparent', borderColor: 'transparent' },
      { transform: 'translate3d(0, 0, 0)', backgroundColor: style.backgroundColor, borderColor: style.borderColor },
    ], { duration: 420, easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)' });
    return () => animation.cancel();
  } catch {
    return null;
  }
}

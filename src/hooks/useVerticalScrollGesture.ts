import type { Ref } from 'vue';
import { onBeforeUnmount, watch } from 'vue';
import { bindVerticalScrollGesture } from '@/utils/vertical-scroll-gesture';

/** 同时兼容 uni 组件实例和 H5 原生元素，根节点重建时重新绑定。 */
export function useVerticalScrollGesture(root: Ref<unknown>, selector?: string) {
  let release: (() => void) | undefined;
  watch(root, (value) => {
    release?.();
    release = undefined;
    if (typeof HTMLElement === 'undefined') return;
    const element = value instanceof HTMLElement ? value : (value as { $el?: unknown } | null)?.$el;
    if (element instanceof HTMLElement) release = bindVerticalScrollGesture(element, selector);
  }, { flush: 'post' });
  onBeforeUnmount(() => release?.());
}

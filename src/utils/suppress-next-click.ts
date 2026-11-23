/**
 * 吞掉「同一次手势随后补发的那次 click」。
 *
 * 手机上按下→抬起会先派发 `pointerup`，再补一个 `click`。如果我们在 `pointerup` 里就把录音打开，
 * 页面这时已经把底部输入栏换成了录音条，那个补发的 `click` 会落到录音条上 ——
 * 声纹区和发送键都挂在 `@tap`（= click）上，于是 `onSubmit` 立刻收尾，
 * 表现就是「刚开录就结束、提示未识别到语音内容」。
 *
 * 用法：先调用本函数，再做会替换 DOM 的动作。只吞窗口期内第一次 click；
 * 只派发 click、不派发 pointerup 的内核由超时自动解除，不会长期拦住正常点击。
 */
const SWALLOW_WINDOW_MS = 500;

let releasePrevious: (() => void) | null = null;

export function suppressNextClick() {
  if (typeof document === "undefined") return;

  // 上一次还没解除（连续快速点按）：先清掉，避免监听器越叠越多
  releasePrevious?.();

  function release() {
    document.removeEventListener("click", swallow, true);
    clearTimeout(timer);
    if (releasePrevious === release) releasePrevious = null;
  }

  /** 捕获阶段直接拦下：要赶在 uni-app 绑在容器上的 tap 之前 */
  function swallow(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    release();
  }

  const timer = setTimeout(release, SWALLOW_WINDOW_MS);
  releasePrevious = release;
  document.addEventListener("click", swallow, true);
}

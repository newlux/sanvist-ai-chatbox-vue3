<script lang="ts">
import { defineComponent, h, ref, type PropType } from "vue";
import { closeImagePreview, type ImagePreviewState } from "@/utils/image-preview";

/**
 * 全屏图片预览组件（H5 端）。
 *
 * 用纯原生 DOM 元素（div/img）构建，不依赖 uni 组件标签，因此可以脱离
 * uni 页面上下文用 createApp 独立挂载到 document.body（见 utils/image-preview.ts）。
 *
 * 数据通过 `state` prop 传入（模块级响应式单例，由 utils/image-preview.ts 持有），
 * 组件只读渲染、不反向依赖 util，避免循环 import。
 *
 * 交互（对齐需求）：
 * - 多图横向堆叠成一条轨道，左右滑动切换（手指拖动 + 松手吸附），带过渡动画；
 * - 底部圆点指示当前页（多图时）；
 * - 左上角关闭按钮直接关闭；点击遮罩空白处也关闭。
 *
 * 背景 / z-index / 关闭按钮位置都是本项目自定义的，不满足 uni 内建
 * uni.previewImage 的行为（其 z-index 999 会被页面 header 的 1010 盖住、
 * 关闭按钮固定右上角、背景 rgba(0,0,0,0.8) 半透明）。
 */
export default defineComponent({
  name: "AppImagePreview",
  props: {
    /** 模块级共享响应式状态：visible / urls / current 由 util 写入，组件据此渲染 */
    state: { type: Object as PropType<ImagePreviewState>, required: true },
  },
  setup(props) {
    // 手指拖动过程中的横向位移（px），松手后归零并吸附到目标页
    const dragX = ref(0);
    const isDragging = ref(false);
    const touchStartX = ref(0);
    const touchStartY = ref(0);
    const SWIPE_THRESHOLD = 40; // px，松手时位移超过该值判定翻页
    const DRAG_RATIO = 0.5; // 拖动跟随比例，避免手指移动 1px 轨道就跑 1px 显得过于灵敏

    const count = () => props.state.urls.length;

    function clampCurrent(idx: number) {
      const max = count() - 1;
      if (idx < 0) return 0;
      if (idx > max) return max;
      return idx;
    }

    function goTo(idx: number) {
      props.state.current = clampCurrent(idx);
    }

    function onTouchStart(e: TouchEvent) {
      dragX.value = 0;
      isDragging.value = true;
      touchStartX.value = e.touches[0].clientX;
      touchStartY.value = e.touches[0].clientY;
    }

    function onTouchMove(e: TouchEvent) {
      // 实时跟随：只处理明显横向的拖动，纵向留给页面滚动（预览全屏无滚动，但避免误翻）
      const dx = e.touches[0].clientX - touchStartX.value;
      const dy = e.touches[0].clientY - touchStartY.value;
      if (Math.abs(dx) > Math.abs(dy)) {
        dragX.value = dx * DRAG_RATIO;
      }
    }

    function onTouchEnd(e: TouchEvent) {
      const dx = e.changedTouches[0].clientX - touchStartX.value;
      const dy = e.changedTouches[0].clientY - touchStartY.value;
      dragX.value = 0;
      isDragging.value = false;
      // 明显横向滑动才翻页
      if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) goTo(props.state.current + 1);
      else goTo(props.state.current - 1);
    }

    function onCloseClick(e: MouseEvent | TouchEvent) {
      e.stopPropagation();
      closeImagePreview();
    }

    function onBackdrop() {
      closeImagePreview();
    }

    function onImageTap(e: MouseEvent | TouchEvent) {
      // 点图片本身不关闭（只有点遮罩空白才关闭）
      e.stopPropagation();
    }

    function onDotTap(idx: number) {
      goTo(idx);
    }

    function onArrowClick(e: MouseEvent | TouchEvent, idx: number) {
      // 阻止冒泡：点箭头不触发遮罩关闭，只切页
      e.stopPropagation();
      goTo(idx);
    }

    return () => {
      const { visible, urls, current } = props.state;
      if (!visible) return null;

      const total = urls.length;
      const hasPrev = current > 0;
      const hasNext = current < total - 1;
      // 当前图说明文字（图2：图片下方、圆点上方）
      const caption = props.state.captions?.[current] || "";
      // 轨道位移：基准 -current*100% 加上手指拖动偏移（拖动时禁用过渡动画，松手恢复）
      const trackShift = `calc(-${current * 100}% + ${dragX.value}px)`;

      return h(
        "div",
        {
          class: "app-image-preview",
          onClick: onBackdrop,
          onTouchstart: onTouchStart,
          onTouchmove: onTouchMove,
          onTouchend: onTouchEnd,
        },
        [
          // 图片区：高度自适应当前图，圆点/标题自然流跟随图片底部（不贴屏幕底）
          h(
            "div",
            { class: "app-image-preview__stage" },
            [
              // 多图横向堆叠轨道：每张图占满一屏宽度，整体 translateX 滑动切换
              h(
                "div",
                {
                  class: [
                    "app-image-preview__track",
                    { "app-image-preview__track--dragging": isDragging.value },
                  ],
                  style: { transform: `translateX(${trackShift})` },
                },
                urls.map((url) =>
                  h("img", {
                    class: "app-image-preview__img",
                    src: url,
                    alt: "",
                    draggable: false,
                    onClick: onImageTap,
                    // 注意：不要阻断 touch 事件，否则根容器的 touchstart/touchmove 收不到，
                    // 在图片上滑动无法切页。这里只阻断 click（点图不关闭）。
                  }),
                ),
              ),
            ],
          ),

          // 图片下方信息区（标题 + 圆点）：距图片底部 34px，随图片高度自然流动
          h(
            "div",
            { class: "app-image-preview__footer" },
            [
              caption
                ? h("div", { class: "app-image-preview__caption" }, caption)
                : null,
              total > 1
                ? h(
                    "div",
                    { class: "app-image-preview__dots" },
                    urls.map((_, i) =>
                      h("span", {
                        class: [
                          "app-image-preview__dot",
                          { "app-image-preview__dot--active": i === current },
                        ],
                        onClick: (e: MouseEvent) => onArrowClick(e, i),
                      }),
                    ),
                  )
                : null,
            ],
          ),

          // 左上角关闭按钮：直接关闭（无圆形背景，仅白色 × 图标）
          h("div", { class: "app-image-preview__close", onClick: onCloseClick }, [
            // pointer-events: none：× 描边很细，点击中间空白会穿透到父 div 才有 44×44 热区；
            // 否则点击 × 的空白区域会落到下方图片上（onImageTap 阻断），导致无法关闭
            h(
              "svg",
              {
                class: "app-image-preview__close-icon",
                viewBox: "0 0 24 24",
                width: "26",
                height: "26",
                style: { pointerEvents: "none" },
              },
              [
                h("path", {
                  d: "M6 6l12 12M18 6L6 18",
                  stroke: "#fff",
                  "stroke-width": "2",
                  "stroke-linecap": "round",
                  fill: "none",
                }),
              ],
            ),
          ]),

          // 左右切换箭头（点按翻页）
          hasPrev
            ? h(
                "div",
                { class: ["app-image-preview__arrow", "app-image-preview__arrow--left"], onClick: (e: MouseEvent) => onArrowClick(e, current - 1) },
                [h("span", { class: "app-image-preview__arrow-glyph" }, "‹")],
              )
            : null,
          hasNext
            ? h(
                "div",
                { class: ["app-image-preview__arrow", "app-image-preview__arrow--right"], onClick: (e: MouseEvent) => onArrowClick(e, current + 1) },
                [h("span", { class: "app-image-preview__arrow-glyph" }, "›")],
              )
            : null,
        ],
      );
    };
  },
});
</script>

<style>
/* 非 scoped：独立 createApp 挂载，用全局类名前缀便于排查。 */
.app-image-preview {
  position: fixed;
  inset: 0;
  z-index: 3000; /* 盖过页面 header 1010 / 设置弹层 1200 / 全屏弹层 2001 */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 1); /* 不透明黑 */
  overflow: hidden;
  -webkit-user-select: none;
  user-select: none;
  touch-action: pan-y; /* 横向翻页由触摸事件接管 */
}

/* 图片区：高度自适应当前图（img 高度按比例），圆点/标题 footer 自然流在其下方 */
.app-image-preview__stage {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.app-image-preview__track {
  display: flex;
  width: 100%;
  transition: transform 0.25s ease-out;
}

/* 拖动过程中禁用过渡，让轨道跟手；拖动结束（dragX 归零）时重新开启 */
.app-image-preview__track--dragging {
  transition: none;
}

/* 每张图占满一屏宽度，高度按比例自适应（超高时 contain 压缩），stage 高度随之而定 */
.app-image-preview__img {
  flex: 0 0 100%;
  width: 100%;
  height: auto;
  max-height: calc(100vh - 140px);
  object-fit: contain;
  -webkit-user-drag: none;
}

.app-image-preview__close {
  position: absolute;
  top: 40px;
  left: 24px;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 2;
}

.app-image-preview__arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 2;
}

.app-image-preview__arrow--left {
  left: 8px;
}

.app-image-preview__arrow--right {
  right: 8px;
}

.app-image-preview__arrow-glyph {
  color: #fff;
  font-size: 34px;
  line-height: 1;
  opacity: 0.85;
  display: none;
}

.app-image-preview__arrow-glyph:active {
  opacity: 1;
}

/* 图片下方信息区：margin-top 34 使圆点距图片底部 34，随图片高度自然流动（不贴屏幕底） */
.app-image-preview__footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 34px;
  padding: 0 20px calc(env(safe-area-inset-bottom, 0px) + 20px);
  pointer-events: none;
}

.app-image-preview__caption {
  max-width: 100%;
  text-align: center;
  color: rgba(255, 255, 255, 0.92);
  font-size: 15px;
  line-height: 22px;
  word-break: break-word;
}

.app-image-preview__dots {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.app-image-preview__dot {
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.4);
  transition: background 0.2s, transform 0.2s;
  pointer-events: auto;
  cursor: pointer;
}

.app-image-preview__dot--active {
  background: #fff;
  transform: scale(1.25);
}
</style>

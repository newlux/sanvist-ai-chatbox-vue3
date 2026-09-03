<script setup lang="ts">
import MarkdownIt from "markdown-it";
import mpHtml from "mp-html/dist/uni-app/components/mp-html/mp-html.vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { createLogger } from "@/utils/logger";

defineOptions({ name: "MarkdownRenderer" });
const props = defineProps({
  content: { type: String, default: "" },
  // 流式阶段：合并高频更新，降低全量解析与渲染频率
  streaming: { type: Boolean, default: false },
});
const emit = defineEmits(["ready"]);
const logger = createLogger("markdown");
/**
 * 单例：一次对话里会同时存在很多气泡，每个气泡各建一个 MarkdownIt
 * 会白白吃掉内存，且规则表完全一致。
 *
 * html 关闭：小程序侧最终由 mp-html 解析节点树，放开原始 HTML 既有 XSS 风险，
 * 也会让模型输出里的尖括号内容被静默吞掉。
 */
const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: false,
});

/**
 * tagStyle 里的 rpx 得自己折成 px，而且必须跟其它 UI 用同一把尺子。
 *
 * mp-html 内部一律按 `值 * windowWidth / 750` 换算，用的是
 * getSystemInfoSync().windowWidth；而 H5 的样式表里，rpx 是编译成 rem 的
 * （24rpx → 0.75rem，即 1rpx = 1/32 rem），跟着 uni 设的根字号走。
 * 内嵌 webview 里这两个基准会对不上（宿主把 windowWidth 按物理像素报出来时正好差一倍），
 * 正文就会比周围文字大一圈。所以 H5 直接照根字号折算，小程序仍走 upx2px。
 */
const RPX_PER_REM = 32;

function getRpxToPx() {
  // #ifdef H5
  const rootFontSize = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  ) || 16;
  return rootFontSize / RPX_PER_REM;
  // #endif
  // #ifndef H5
  return uni.upx2px(100) / 100;
  // #endif
}

function rpx2px(style, ratio) {
  return style.replace(/([0-9.]+)rpx/g, (_, value) => `${Math.round(Number(value) * ratio * 100) / 100}px`);
}

// mp-html 用行内样式渲染节点，scoped 样式无法作用到内部节点，排版一律走 tagStyle
const rawTagStyle = {
  h1: "margin: 20rpx 0 12rpx; color: #2f323c; font-size: 40rpx; font-weight: 600; line-height: 1.4;",
  h2: "margin: 20rpx 0 12rpx; color: #2f323c; font-size: 36rpx; font-weight: 600; line-height: 1.4;",
  h3: "margin: 20rpx 0 12rpx; color: #2f323c; font-size: 32rpx; font-weight: 600; line-height: 1.4;",
  h4: "margin: 20rpx 0 12rpx; color: #2f323c; font-size: 28rpx; font-weight: 600; line-height: 1.4;",
  h5: "margin: 20rpx 0 12rpx; color: #2f323c; font-size: 28rpx; font-weight: 600; line-height: 1.4;",
  h6: "margin: 20rpx 0 12rpx; color: #2f323c; font-size: 28rpx; font-weight: 600; line-height: 1.4;",
  p: "margin: 0 0 12rpx; color: #2f323c; font-size: 28rpx; line-height: 42rpx; word-break: normal; overflow-wrap: break-word;",
  strong: "font-weight: 600; color: #1a1a1e;",
  em: "font-style: italic;",
  ul: "width: 100%; box-sizing: border-box; margin: 0 0 12rpx; padding-left: 34rpx; list-style: disc;",
  ol: "width: 100%; box-sizing: border-box; margin: 0 0 12rpx; padding-left: 34rpx; list-style: decimal;",
  li: "margin: 4rpx 0; color: #2f323c; font-size: 28rpx; line-height: 42rpx; word-break: normal; overflow-wrap: break-word;",
  blockquote: "margin: 12rpx 0; padding: 12rpx 20rpx; border-left: 6rpx solid #e4e9f0; color: #5f6775; background: #f6f7f9; border-radius: 8rpx;",
  hr: "margin: 16rpx 0; height: 1px; border: 0; background: #e4e9f0;",
  a: "color: #f12832; text-decoration: underline; word-break: break-all;",
  code: "padding: 2rpx 6rpx; border-radius: 4rpx; background: #f3f5f7; color: #d63200; font-size: 24rpx;",
  pre: "margin: 8rpx 0; padding: 16rpx; border-radius: 12rpx; background: #fff; overflow-x: auto; font-size: 24rpx; line-height: 36rpx; white-space: pre;",
  img: "max-width: 100%; height: auto; display: block; margin: 12rpx 0; border-radius: 8rpx;",
  table: "width: 100%; margin: 12rpx 0; border-collapse: collapse; background: #fff; font-size: 24rpx;",
  th: "padding: 10rpx 12rpx; border: 1px solid #e4e9f0; font-weight: 600; text-align: left; vertical-align: top;",
  td: "padding: 10rpx 12rpx; border: 1px solid #e4e9f0; text-align: left; vertical-align: top;",
};

// 首次渲染时才计算：根字号是 uni 启动后设的，模块加载期取到的可能还是浏览器默认值
const tagStyle = computed(() => {
  const ratio = getRpxToPx();
  return Object.fromEntries(
    Object.entries(rawTagStyle).map(([tag, style]) => [tag, rpx2px(style, ratio)]),
  );
});

/**
 * markdown-it 没有增量解析能力，未闭合的代码块、表格、列表只有拿完整上下文
 * 才能解析正确，所以流式阶段仍是全量解析，只把解析频率压下来。
 * mp-html 内部对新节点树做差量更新，重复 render 不会整棵重建。
 */
const STREAM_RENDER_INTERVAL_MS = 100;
const LONG_STREAM_RENDER_INTERVAL_MS = 200;
const VERY_LONG_STREAM_RENDER_INTERVAL_MS = 300;

const renderedHtml = ref("");
/** 分片中的 Markdown 结构可能暂时不完整；HTML 更新后重建 mp-html，避免残留临时列表/换行节点。 */
const renderVersion = ref(0);
let pendingContent = "";
let lastRenderedContent = "";
let renderTimer = null;
let lastRenderAt = 0;

function getStreamRenderInterval(length) {
  if (length >= 12000) return VERY_LONG_STREAM_RENDER_INTERVAL_MS;
  if (length >= 4000) return LONG_STREAM_RENDER_INTERVAL_MS;
  return STREAM_RENDER_INTERVAL_MS;
}

function clearRenderTimer() {
  if (!renderTimer) return;
  clearTimeout(renderTimer);
  renderTimer = null;
}

function parseMarkdown(content) {
  if (!content.trim()) return "";
  try {
    return markdown.render(content);
  }
  catch (error) {
    logger.error("解析失败，回退为纯文本", error);
    return content;
  }
}

function renderLatest() {
  clearRenderTimer();
  if (pendingContent === lastRenderedContent) return;
  const html = parseMarkdown(pendingContent);
  // 有正文却解析不出任何标签，说明 markdown-it 在当前运行环境失效了，
  // 直接把原文交给 mp-html，至少不会白屏
  renderedHtml.value = !html && pendingContent ? pendingContent : html;
  renderVersion.value += 1;
  lastRenderedContent = pendingContent;
  lastRenderAt = Date.now();

  if (import.meta.env.DEV) {
    logger.debug(
      `[MarkdownRenderer] 正文 ${pendingContent.length} 字 → HTML ${renderedHtml.value.length} 字`,
    );
  }
}

watch(
  () => [props.content, props.streaming],
  ([content, streaming]) => {
    pendingContent = content || "";

    if (!streaming) {
      renderLatest();
      return;
    }

    const elapsed = Date.now() - lastRenderAt;
    const interval = getStreamRenderInterval(pendingContent.length);
    // 段落刚闭合时排版最稳定，此时提前 flush 观感最好
    const reachedBlockBoundary = /\n[\t ]*\n$/.test(pendingContent);

    if (!renderedHtml.value || elapsed >= interval || (reachedBlockBoundary && elapsed >= STREAM_RENDER_INTERVAL_MS)) {
      renderLatest();
      return;
    }
    if (!renderTimer) {
      renderTimer = setTimeout(renderLatest, interval - elapsed);
    }
  },
  { immediate: true },
);

onBeforeUnmount(clearRenderTimer);

function onLinkTap(e) {
  const href = String(e?.detail?.href || e?.href || "");
  if (!href) return;
  uni.setClipboardData({
    data: href,
    success: () => uni.showToast({ title: "链接已复制", icon: "none", duration: 1500 }),
  });
}

function onParseError(e) {
  logger.warn("mp-html 渲染异常", e?.detail || e);
}
</script>

<template>
  <mpHtml
    :key="renderVersion"
    class="markdown-renderer"
    :content="renderedHtml"
    :tag-style="tagStyle"
    :selectable="true"
    :scroll-table="true"
    :preview-img="true"
    :copy-link="false"
    :lazy-load="false"
    @linktap="onLinkTap"
    @error="onParseError"
    @ready="emit('ready')"
  >
    <!--
      mp-html 在节点树为空时渲染默认插槽。把原文放进来，
      任何一环（解析、节点渲染）失效都会退化成纯文本而不是空白气泡。
    -->
    <text v-if="props.content" class="markdown-renderer__fallback" :selectable="true">
      {{ props.content }}
    </text>
  </mpHtml>
</template>

<style lang="scss" scoped>
.markdown-renderer {
  display: block;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  color: #2f323c;
  font-size: 28rpx;
  line-height: 42rpx;
  word-break: break-word;
}
.markdown-renderer__fallback {
  display: block;
  width: 100%;
  color: #2f323c;
  font-size: 28rpx;
  line-height: 42rpx;
  word-break: break-word;
  white-space: pre-wrap;
}
</style>

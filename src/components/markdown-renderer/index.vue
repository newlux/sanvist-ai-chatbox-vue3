<script setup>
import MarkdownIt from "markdown-it";
import mpHtml from "mp-html/dist/uni-app/components/mp-html/mp-html.vue";
import { onBeforeUnmount, ref, watch } from "vue";

defineOptions({ name: "MarkdownRenderer" });

const props = defineProps({
  content: { type: String, default: "" },
  // 流式阶段：合并高频更新，降低全量解析与渲染频率
  streaming: { type: Boolean, default: false },
});

const emit = defineEmits(["ready"]);

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

// mp-html 用行内样式渲染节点，scoped 样式无法作用到内部节点，排版一律走 tagStyle
const tagStyle = {
  h1: "margin: 20rpx 0 12rpx; color: #2f323c; font-size: 40rpx; font-weight: 600; line-height: 1.4;",
  h2: "margin: 20rpx 0 12rpx; color: #2f323c; font-size: 36rpx; font-weight: 600; line-height: 1.4;",
  h3: "margin: 20rpx 0 12rpx; color: #2f323c; font-size: 32rpx; font-weight: 600; line-height: 1.4;",
  h4: "margin: 20rpx 0 12rpx; color: #2f323c; font-size: 28rpx; font-weight: 600; line-height: 1.4;",
  h5: "margin: 20rpx 0 12rpx; color: #2f323c; font-size: 28rpx; font-weight: 600; line-height: 1.4;",
  h6: "margin: 20rpx 0 12rpx; color: #2f323c; font-size: 28rpx; font-weight: 600; line-height: 1.4;",
  p: "margin: 0 0 12rpx; color: #2f323c; font-size: 28rpx; line-height: 42rpx;",
  strong: "font-weight: 600; color: #1a1a1e;",
  em: "font-style: italic;",
  ul: "margin: 0 0 12rpx; padding-left: 34rpx; list-style: disc;",
  ol: "margin: 0 0 12rpx; padding-left: 34rpx; list-style: decimal;",
  li: "margin: 4rpx 0; color: #2f323c; font-size: 28rpx; line-height: 42rpx;",
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

/**
 * markdown-it 没有增量解析能力，未闭合的代码块、表格、列表只有拿完整上下文
 * 才能解析正确，所以流式阶段仍是全量解析，只把解析频率压下来。
 * mp-html 内部对新节点树做差量更新，重复 render 不会整棵重建。
 */
const STREAM_RENDER_INTERVAL_MS = 100;
const LONG_STREAM_RENDER_INTERVAL_MS = 200;
const VERY_LONG_STREAM_RENDER_INTERVAL_MS = 300;

const renderedHtml = ref("");
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
    console.error("[MarkdownRenderer] 解析失败，回退为纯文本", error);
    return content;
  }
}

function renderLatest() {
  clearRenderTimer();
  if (pendingContent === lastRenderedContent) return;
  renderedHtml.value = parseMarkdown(pendingContent);
  lastRenderedContent = pendingContent;
  lastRenderAt = Date.now();
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
  console.warn("[MarkdownRenderer] mp-html 渲染异常", e?.detail || e);
}
</script>

<template>
  <mpHtml
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
  />
</template>

<style lang="scss" scoped>
.markdown-renderer {
  display: block;
  width: 100%;
  color: #2f323c;
  font-size: 28rpx;
  line-height: 42rpx;
  word-break: break-word;
}
</style>

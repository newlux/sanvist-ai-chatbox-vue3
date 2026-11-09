<script setup lang="ts">
import MarkdownIt from "markdown-it";
import mpHtml from "mp-html/dist/uni-app/components/mp-html/mp-html.vue";
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
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
 * 是否渲染在深色 AI 气泡里：由 AiBubbleV2 provide（Ardot 1193:5104 深色稿）。
 * mp-html 把排版写成行内 style，scoped 样式压不住，正文换色只能走 tagStyle；
 * 没有 provide 的场景（听播 / 报告 / 分享海报）默认浅色稿。
 */
const darkContainer = inject("ai-bubble-dark", computed(() => false));
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
  // 表格：表头格子铺淡蓝底 #E1F0FF，单元格之间与表格外框统一 #E8E8E8 细线
  table: "width: max-content; min-width: 100%; margin: 12rpx 0; border-collapse: collapse; background: transparent; font-size: 24rpx; white-space: nowrap;",
  th: "min-width: 160rpx; padding: 10rpx 12rpx; border: 1px solid #e8e8e8; background: #e1f0ff; font-weight: 600; text-align: left; vertical-align: top; white-space: nowrap; word-break: keep-all;",
  td: "min-width: 160rpx; padding: 10rpx 12rpx; border: 1px solid #e8e8e8; text-align: left; vertical-align: top; white-space: nowrap; word-break: keep-all;",
};

/**
 * 深色正文配色（Ardot 1193:5104）：
 * - 正文 p：1193:5140「设备运行状态正常…」14 / 24 / #FFFFFF 80%（行高 24px = 48rpx）
 * - 标题 / 加粗：设计稿没有标题态，取正文白的实色 #FFFFFF
 * - 引用块 / 分割线 / 表格描边：与深色卡分隔线 1193:5139 同值 #303030
 * - code / pre：设计稿未给代码态，只把浅色底换成中性深色，文字保留原强调色
 * 只追加同名属性（后写的覆盖前面的），字号 / 行高 / 间距一律不动。
 */
const darkTagOverrides: Record<string, string> = {
  h1: "color: #ffffff;",
  h2: "color: #ffffff;",
  h3: "color: #ffffff;",
  h4: "color: #ffffff;",
  h5: "color: #ffffff;",
  h6: "color: #ffffff;",
  p: "color: rgba(255, 255, 255, 0.8); line-height: 48rpx;",
  strong: "color: #ffffff;",
  li: "color: rgba(255, 255, 255, 0.8);",
  blockquote: "color: #bababa; background: rgba(255, 255, 255, 0.06); border-left-color: #303030;",
  hr: "background: #303030;",
  pre: "background: #1a1a1a;",
  code: "background: #303030;",
  // 表格：文字色与外部正文完全一致（同 p 的 80% 白），只换描边，不铺底
  // （浅色稿表头的 #E1F0FF 在这里要被顶掉，深底上铺淡蓝会看不清白字）
  table: "color: rgba(255, 255, 255, 0.8);",
  th: "border-color: #303030; background: transparent; color: rgba(255, 255, 255, 0.8);",
  td: "border-color: #303030; color: rgba(255, 255, 255, 0.8);",
};

// 首次渲染时才计算：根字号是 uni 启动后设的，模块加载期取到的可能还是浏览器默认值
const tagStyle = computed(() => {
  const ratio = getRpxToPx();
  const dark = Boolean(darkContainer.value);
  return Object.fromEntries(
    Object.entries(rawTagStyle).map(([tag, style]) => {
      const override = dark ? darkTagOverrides[tag] : "";
      return [tag, rpx2px(override ? `${style} ${override}` : style, ratio)];
    }),
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

/** 可信 HTML 渲染前缀：内容以该标记开头时直接交给 mp-html，跳过 markdown-it 转义。
 * 仅用于本地 demo 等可控场景，正常模型输出仍走 markdown 安全渲染。 */
const TRUSTED_HTML_PREFIX = "<!--html-->";

function parseMarkdown(content) {
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith(TRUSTED_HTML_PREFIX)) {
    return trimmed.slice(TRUSTED_HTML_PREFIX.length).trimStart();
  }
  try {
    return markdown.render(content);
  }
  catch (error) {
    logger.error("解析失败，回退为纯文本", error);
    return content;
  }
}

/** 深色正文色（Ardot 1193:5140）：表格单元格要和表格外的正文同色 */
const DARK_TEXT_COLOR = "rgba(255, 255, 255, 0.8)";

/**
 * 深色下把正文色直接写进表格标签的 style。
 *
 * 原因：mp-html 解析表格时会重写 table / tr / th / td 节点，并用自己的行内 style
 * 覆盖 attrs.style（parser 里 `td.attrs.style = 'border:…;' + 原 style`），
 * tagStyle 注入的 color 会被挤掉，单元格文字就还是浅色稿的 #2f323c。
 * 这里在 HTML 层补 color，mp-html 会原样保留，和表格外正文保持一致。
 * 只动表格标签；单元格里的 strong / code / a 有自己的行内色，优先级更高。
 */
function paintTableText(html: string) {
  return html.replace(/<(table|thead|tbody|tr|th|td)(\s[^>]*)?>/gi, (_match, tag, attrs = "") => {
    const styleMatch = attrs.match(/\bstyle\s*=\s*"([^"]*)"/i);
    if (styleMatch) {
      return `<${tag}${attrs.replace(styleMatch[0], `style="color:${DARK_TEXT_COLOR};${styleMatch[1]}"`)}>`;
    }
    return `<${tag}${attrs} style="color:${DARK_TEXT_COLOR}">`;
  });
}

function renderLatest() {
  clearRenderTimer();
  if (pendingContent === lastRenderedContent) return;
  let html = parseMarkdown(pendingContent);
  // 深色容器里给表格补正文色（mp-html 会覆盖 tagStyle 注入的 color）
  if (html && darkContainer.value) html = paintTableText(html);
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

// 主题切换：表格染色是写在 HTML 里的，内容没变也要重新排一次
watch(darkContainer, () => {
  lastRenderedContent = "";
  renderLatest();
});

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
    :class="{ 'markdown-renderer--dark': darkContainer }"
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

/* ===== 深色容器（Ardot 1193:5104 → 正文 1193:5140）=====
   正文主体在 tagStyle 里换色，这里补不走行内样式的兜底：容器默认字色、纯文本降级、表格 */
.markdown-renderer--dark {
  color: rgba(255, 255, 255, 0.8);

  .markdown-renderer__fallback {
    color: rgba(255, 255, 255, 0.8);
  }

  /* 表格：mp-html 会把 table / tr / th / td 重写成 table 布局的模拟结构，
     并给单元格补自己的行内 style，tagStyle 的 color 会被它后写的 style 盖掉。
     这里再按「表格内所有后代」兜一层，确保单元格文字和表格外正文完全一致；
     单元格里的 code / a 有自己的行内色，行内优先级更高，不受影响。 */
  :deep(table),
  :deep(table *) {
    color: rgba(255, 255, 255, 0.8);
  }
}
</style>

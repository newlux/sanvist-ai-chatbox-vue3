<script setup lang="ts">
import MarkdownIt from "markdown-it";
import mpHtml from "mp-html/dist/uni-app/components/mp-html/mp-html.vue";
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import { createLogger } from "@/utils/logger";
import { useVerticalScrollGesture } from "@/hooks/useVerticalScrollGesture";

defineOptions({ name: "MarkdownRenderer" });
const props = defineProps({
  content: { type: String, default: "" },
  // 流式阶段：合并高频更新，降低全量解析与渲染频率
  streaming: { type: Boolean, default: false },
});
const emit = defineEmits(["ready"]);
const logger = createLogger("markdown");
const markdownRoot = ref<unknown>(null);
useVerticalScrollGesture(markdownRoot, "table, ._table");
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
  // 表格：表头格子铺淡蓝底 #E1F0FF，单元格之间与表格外框统一 #E8E8E8 细线。
  // 单元格不强制 nowrap：mp-html 在 App 端（安卓 WebView）给表格包的横向滚动层
  // 触摸滚动不可靠（只有拖拽选中才滚），内容会超出屏幕被裁切；
  // 改为自动换行让表格收缩进容器，内容完整可见，H5 / App 两端行为一致。
  table: "width: 100%; margin: 12rpx 0; border-collapse: collapse; background: transparent; font-size: 24rpx; word-break: break-word; overflow-wrap: break-word;",
  th: "min-width: 0; padding: 10rpx 12rpx; border: 1px solid #e8e8e8; background: #e1f0ff; font-weight: 600; text-align: left; vertical-align: top; word-break: break-word; overflow-wrap: break-word;",
  td: "min-width: 0; padding: 10rpx 12rpx; border: 1px solid #e8e8e8; text-align: left; vertical-align: top; word-break: break-word; overflow-wrap: break-word;",
};

/**
 * 深色正文配色（Ardot 1193:5104，正文色按需求从 80% 白抬到实色）：
 * - 正文 p / li / 表格单元格：一律 #FFFFFF（行高 24px = 48rpx）
 * - 标题 / 加粗：实色 #FFFFFF，与正文同级
 * - 引用块保留次级灰白 #BABABA（引文语义，不与正文抢主次）
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
  // 正文一律纯白：深色稿原先给的是 80% 白，端上看着发灰，按需求统一抬到 #FFFFFF
  p: "color: #ffffff; line-height: 48rpx;",
  strong: "color: #ffffff;",
  li: "color: #ffffff;",
  blockquote: "color: #bababa; background: rgba(255, 255, 255, 0.06); border-left-color: #303030;",
  hr: "background: #303030;",
  pre: "background: #1a1a1a;",
  code: "background: #303030;",
  // 表格：文字色与外部正文完全一致（纯白）；表头换深蓝底 #173859（浅色稿的 #E1F0FF 顶掉），
  // 外框与内部网格线一律 #303030 —— 完整重写 border，避免只改颜色时漏掉某条边
  table: "color: #ffffff;",
  th: "border: 1px solid #303030; background: #173859; color: #ffffff;",
  td: "border: 1px solid #303030; color: #ffffff;",
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

/**
 * 文字落定动效（对齐 demo 录屏 62→66 帧那段）：一段字写完停更之后，整段轻轻「压淡一下再落定」
 * —— opacity 0.7 起手，SETTLE_MS 内淡回正文色。生成中的文字保持正常不透明度：
 * 逐字流过的那部分如果也做淡入，反而会整段发虚，和录屏里「写完了才落一下」对不上。
 *
 * 关键点：mp-html 每帧都按 `:key="renderVersion"` 整体重建，元素上的 CSS 动画会从 0 重跑，
 * 所以落定动画只在「停更之后」开一次，并用负的 animation-delay 记录已经走了多少，
 * 中途被重建也能接着走，不会跳回起点。
 *
 * 「停更」的判定阈值要跟着当前那档 flush 间隔走（见 settleDelay）：阈值比 flush 间隔还小的话，
 * 正在出字的时候就会被当成停更，一段字要闪好几下落定。
 */
const SETTLE_DELAY_MIN_MS = 150;
const SETTLE_DELAY_MARGIN_MS = 40;
const SETTLE_MS = 240;
const SETTLE_KEYFRAMES = "md-text-settle";
/** 参与落定的块：正文段落、标题、列表项（紧凑列表的文字直接挂在 li 上，没有 p） */
const SETTLE_TOKEN_TYPES = new Set(["paragraph_open", "heading_open", "list_item_open"]);

/** markdown-it 没带类型声明，这里只取落定动效要用到的那几个字段 */
interface MarkdownToken {
  type: string;
  level: number;
  nesting: number;
  map?: [number, number];
  attrJoin: (name: string, value: string) => void;
}

/** 块签名（类型@起始行）→ 上一次渲染时的源码片段 / 最后一次变化时间，仅本实例使用 */
const settleSource = new Map<string, string>();
const settleChangedAt = new Map<string, number>();
/** 首帧不铺动效：历史消息、分享海报一进来就该是落定态，不能整片淡一下 */
let settleStarted = false;
/** 本次渲染后是否还有块停在「等停更」的窗口里——有的话要补一次渲染，否则落定那一帧永远画不出来 */
let settlePending = false;
let settleTimer = null;

/** 当前这档 flush 间隔（流式时由内容长度决定），落定阈值跟着它走 */
let streamIntervalMs = STREAM_RENDER_INTERVAL_MS;

/** 停更判定阈值：比当前这档 flush 间隔再宽松一点，保证「还在出字」不会被误判成停更 */
function settleDelay() {
  return Math.max(SETTLE_DELAY_MIN_MS, streamIntervalMs + SETTLE_DELAY_MARGIN_MS);
}

/** 给刚停更的块打上落定动画（写在 token 的 style 上，跟随 HTML 一起交给 mp-html） */
function decorateSettle(tokens: MarkdownToken[], content: string) {
  const now = Date.now();
  const lines = content.split(/\r?\n/);
  const alive = new Set<string>();
  const delay = settleDelay();
  /** 已经铺过动效的层级：外层块铺过，里层（li > p）就不再叠一层，否则透明度会翻倍 */
  let settledLevel: number | undefined;
  settlePending = false;

  tokens.forEach((token, index) => {
    if (token.nesting === -1) {
      if (settledLevel !== undefined && token.level === settledLevel) settledLevel = undefined;
      return;
    }
    if (!SETTLE_TOKEN_TYPES.has(token.type)) return;
    if (settledLevel !== undefined && token.level > settledLevel) return;

    const [start = index, end = index + 1] = token.map || [];
    const key = `${token.type}@${start}`;
    const source = lines.slice(start, end).join("\n");
    alive.add(key);

    if (!settleStarted) settleChangedAt.set(key, now - delay - SETTLE_MS);
    else if (settleSource.get(key) !== source) settleChangedAt.set(key, now);
    settleSource.set(key, source);

    const idle = now - (settleChangedAt.get(key) ?? now);
    // 还在往外流：不动它，等停更
    if (idle < delay) {
      settlePending = true;
      return;
    }
    const elapsed = idle - delay;
    if (elapsed >= SETTLE_MS) return;

    settledLevel = token.level;
    token.attrJoin(
      "style",
      `animation: ${SETTLE_KEYFRAMES} ${SETTLE_MS}ms ease-out both; animation-delay: -${elapsed}ms;`,
    );
  });

  settleStarted = true;
  // 重新解析后行号整体挪动过：清掉签名表里已经不存在的块，避免越攒越大
  for (const key of [...settleSource.keys()]) {
    if (alive.has(key)) continue;
    settleSource.delete(key);
    settleChangedAt.delete(key);
  }
}

function parseMarkdown(content) {
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith(TRUSTED_HTML_PREFIX)) {
    return trimmed.slice(TRUSTED_HTML_PREFIX.length).trimStart();
  }
  try {
    // 先出 token 再自己 render：落定动效要挂在块级 token 的 style 上，纯 render 拿不到这一层
    const env = {};
    const tokens = markdown.parse(content, env);
    decorateSettle(tokens, content);
    return markdown.renderer.render(tokens, markdown.options, env);
  }
  catch (error) {
    logger.error("解析失败，回退为纯文本", error);
    return content;
  }
}

/** 深色正文色：表格单元格要和表格外的正文同色（纯白，与 p / li 一致） */
const DARK_TEXT_COLOR = "#ffffff";

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

/**
 * 落定那一帧要自己补一次渲染：内容停更后不会再有 watch 触发，
 * 单独等 setTimeout 到点重排，才能把「压淡 → 落定」这一次动画挂上去。
 */
function scheduleSettleCheck() {
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  if (!settlePending) return;
  const scheduledFor = pendingContent;
  settleTimer = setTimeout(() => {
    settleTimer = null;
    // 期间又来了新内容：交给正常 flush 重排，别在这里多重建一次
    if (pendingContent !== scheduledFor) return;
    // 内容没变，但这一帧必须重排：清掉「已渲染」标记绕过相等判断
    lastRenderedContent = "";
    renderLatest();
  }, settleDelay() + 20);
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
  scheduleSettleCheck();

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
    // 落定动效判「停更」用的阈值跟这档间隔走，别用写死的毫秒数
    streamIntervalMs = interval;
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

onBeforeUnmount(() => {
  clearRenderTimer();
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
});

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
    ref="markdownRoot"
    :key="renderVersion"
    class="markdown-renderer"
    :class="{ 'markdown-renderer--dark': darkContainer }"
    :content="renderedHtml"
    :tag-style="tagStyle"
    :selectable="true"
    :scroll-table="false"
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
  :deep(table),
  :deep(._table) { touch-action: pan-x; }
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
  color: #ffffff;

  .markdown-renderer__fallback {
    color: #ffffff;
  }

  /* 表格：mp-html 会把 table / tr / th / td 重写成 table 布局的模拟结构，
     并给单元格补自己的行内 style，tagStyle 的 color 会被它后写的 style 盖掉。
     这里再按「表格内所有后代」兜一层，确保单元格文字和表格外正文完全一致；
     单元格里的 code / a 有自己的行内色，行内优先级更高，不受影响。 */
  :deep(table),
  :deep(table *) {
    color: #ffffff;
  }
}
</style>

<!--
  文字落定动效的 keyframes。
  单独用非 scoped 的块：动画是写在 mp-html 生成的行内 style 上的，
  而 mp-html 内部的节点不带你组件的 data-v 属性，scoped 选择器根本选不到；
  keyframes 本身是全局的，放这里只为了跟上面那段样式区分开。
  起始透明度与脚本里的 SETTLE_MS 配套，改一处要想着另一处。
-->
<style>
@keyframes md-text-settle {
  from {
    opacity: 0.7;
  }

  to {
    opacity: 1;
  }
}
</style>

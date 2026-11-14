<script setup lang="ts">
import type { ThinkStep } from "@/utils/ai-stream";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import feedbackGoodFilledIcon from "@/assets/img/report-broadcast/feedback-good-filled.svg";
import feedbackGoodIcon from "@/assets/img/report-broadcast/feedback-good.svg";
import tellLogoDark from "@/assets/img/tell-dark.webp";
import tellLogoLight from "@/assets/img/tell-light.webp";
import MarkdownRenderer from "@/components/markdown-renderer/index.vue";
import { useSystemStore } from "@/stores";
import { resolveMotionElement } from "@/utils/voice-message-motion";

const props = defineProps<{
  /** 所选音色头像：头像位已统一改用 tell 动图（深浅两套），仅为父级传参兼容保留 */
  portrait?: string;
  playing: boolean;
  loading: boolean;
  currentSeq: number | null;
  transcriptSegments: Array<{ seq: number; text: string }>;
  /** 归一化播报进度（0~1），由播放器周期估算。 */
  progress: number;
  /** 按住说话后的识别中状态：与回答结果一起占用字幕区，播报文字隐藏。 */
  qaLoading?: boolean;
  /** 思考中的过程小标题：接口 chat-messages 的 subtitle 事件下发（如「目标 Dify 工作流已开始。」）。 */
  qaSubtitle?: string;
  /** 问答返回的结果文本，渲染在字幕区内。 */
  qaAnswer?: string;
  /** 按住说话录音中：先隐藏播报文字，等识别态接管字幕区。 */
  voiceRecording?: boolean;
  /** 录音中的实时转写文本（点击说话走流式 ASR）：边说边出字，为空时展示「识别中」。 */
  voiceTranscript?: string;
}>();

// 播放控制与进度条都已在浅色稿中移除，事件声明保留，兼容上层的 @play-pause / @seek 绑定
defineEmits<{ "play-pause": []; seek: [seq: number] }>();
const { t } = useI18n();
/**
 * 外观：深色走 C 方案暗色稿 1193:2708「听播-正在播放」与 1193:3357「听播-正在回答」。
 * 左右声波已在两个主题下都去掉，只留光晕；字幕 / 答案卡换暗色材质。
 */
const systemStore = useSystemStore();
const isDark = computed(() => systemStore.isDark);
/**
 * 头像位动图：深浅各一套 tell（light 480×480 / dark 600×600 画布，图案约占画布 40.5%、居中），
 * 与对话页灵动岛「回答 / 播报」用的是同一组素材。
 */
const portraitLogoSrc = computed(() => (isDark.value ? tellLogoDark : tellLogoLight));
const transcriptViewportRef = ref<unknown>(null);
const transcriptTrackRef = ref<unknown>(null);
const transcriptHasScrolled = ref(false);
/** 字幕内容超出可视区（可滚动）时为 true：底部渐隐只在这种时候出现。 */
const transcriptOverflow = ref(false);
let bottomFrame: number | null = null;
let bottomQueued = false;
let contentResizeObserver: ResizeObserver | null = null;

function getTranscriptScroller() {
  const component = transcriptViewportRef.value as { $getMain?: () => unknown } | null;
  // uni H5 暴露的 main 才是滚动节点；外层 .uni-scroll-view 只是包装层。
  const main = resolveMotionElement(component?.$getMain?.());
  if (main) return main;
  const root = resolveMotionElement(transcriptViewportRef.value);
  return root?.querySelector<HTMLElement>(".uni-scroll-view > .uni-scroll-view")
    || root?.querySelector<HTMLElement>(".uni-scroll-view")
    || root;
}

/** 只负责滚到底部；列表仅包含已开始播放的句子，不再计算居中和回中。 */
function scrollTranscriptToBottom() {
  if (bottomQueued) return;
  bottomQueued = true;
  void nextTick(() => {
    const apply = () => {
      bottomFrame = null;
      bottomQueued = false;
      if (props.voiceRecording || qaVisible.value || showTranscriptSkeleton.value) return;
      const scroller = getTranscriptScroller();
      if (!scroller) return;
      const bottom = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      transcriptOverflow.value = bottom > 1;
      // 未溢出时自然从顶部展示；只有超高、正在播放时才跟随到底部。
      if (bottom <= 1) {
        if (scroller.scrollTop !== 0) scroller.scrollTop = 0;
        transcriptHasScrolled.value = false;
        return;
      }
      if (props.playing && Math.abs(scroller.scrollTop - bottom) > 1) scroller.scrollTop = bottom;
      transcriptHasScrolled.value = scroller.scrollTop > 1;
    };
    // 等待 WebView 完成这次布局后再读 scrollHeight，不读取插入前的旧高度。
    if (typeof requestAnimationFrame === "function") bottomFrame = requestAnimationFrame(apply);
    else apply();
  });
}
watch(transcriptTrackRef, value => {
  contentResizeObserver?.disconnect();
  contentResizeObserver = null;
  const element = resolveMotionElement(value);
  if (element && typeof ResizeObserver !== "undefined") {
    // 只监听内容高度以保持贴底，不计算段落坐标或居中位置。
    contentResizeObserver = new ResizeObserver(scrollTranscriptToBottom);
    contentResizeObserver.observe(element);
  }
}, { flush: "post" });
const showTranscriptSkeleton = computed(
  () => props.loading && props.transcriptSegments.length === 0,
);
/** 按住说话的识别/问答态：字幕区让位给「正在理解」与回答结果。 */
const qaVisible = computed(() => Boolean(props.qaLoading || props.qaAnswer));

/**
 * 识别中标题下方的文字：全部来自 chat-messages 流——
 * 先放后端下发的当前过程文案，再补上 think 步骤里的执行说明（同文去重）。
 */
const qaTextLines = computed(() => {
  const lines: string[] = [];
  const push = (text: unknown) => {
    const value = String(text || "").trim();
    if (!value || lines.includes(value)) return;
    lines.push(value);
  };
  push(props.qaSubtitle);
  (props.qaSteps || []).forEach(step => push(step?.message));
  return lines;
});
// 播放器在音频 onplay 时追加当前句；未播放分片只留在音频缓存中。
const transcriptItems = computed(() => props.transcriptSegments.map(segment => ({
  key: `segment-${segment.seq}`,
  role: segment.seq === props.currentSeq ? "current" : "previous",
  text: segment.text,
})));

/* —— 打字机（设计稿 195:1985）：当前播报段落逐字出现，不一次性摊开 ——
   只作用于「当前段」：已播完的段落保持全文，未开始播放的句子不加入列表，
   所以视觉上是「正在念的这一句在长字」，和播报节奏一致。
   80ms/字（约 12 字/秒）：比原先 50ms 更慢，突出「边念边长」的打字机手感。 */
const TYPE_INTERVAL_MS = 80;
/** 当前段落已打出的字数：切句归零，暂停冻结，恢复后接着打 */
const typedLength = ref(0);
watch([
  transcriptItems,
  typedLength,
  transcriptViewportRef,
  () => props.playing,
  () => props.voiceRecording,
  qaVisible,
  showTranscriptSkeleton,
], scrollTranscriptToBottom, { flush: "post" });
let typingTimer: ReturnType<typeof setInterval> | null = null;

function stopTyping() {
  if (typingTimer) {
    clearInterval(typingTimer);
    typingTimer = null;
  }
}

/** 当前段落全文长度：字幕是流式下发的，句子还可能继续变长 */
function currentSegmentLength() {
  if (props.currentSeq === null) return 0;
  const segment = props.transcriptSegments.find(item => item.seq === props.currentSeq);
  return segment ? segment.text.length : 0;
}

/** 按播放状态启停打字机：播报中才继续吐字，暂停就停在当前字数上 */
function syncTyping() {
  stopTyping();
  if (!props.playing || props.currentSeq === null) return;
  if (typedLength.value >= currentSegmentLength()) return;
  typingTimer = setInterval(() => {
    if (!props.playing || typedLength.value >= currentSegmentLength()) {
      stopTyping();
      return;
    }
    typedLength.value += 1;
  }, TYPE_INTERVAL_MS);
}

watch(() => props.currentSeq, () => {
  typedLength.value = 0;
  syncTyping();
});
watch(() => props.playing, syncTyping);
// 句子流式变长：如果已经打到当前长度就停过计时器，这里重新接上
watch(() => currentSegmentLength(), syncTyping);

onBeforeUnmount(() => {
  contentResizeObserver?.disconnect();
  if (bottomFrame !== null) cancelAnimationFrame(bottomFrame);
  stopTyping();
});

/* 进度条已按浅色稿 195:1927 移除（画板中没有进度控件，只有头像 + 字幕）。
   seek 能力由分句点击等其它入口承担，emit 声明保留以兼容上层绑定。 */
</script>

<template>
  <!-- Broadcast Content -->
  <view
    class="report-broadcast-content"
    :class="{
      'report-broadcast-content--dark': isDark,
      'report-broadcast-content--light': !isDark,
      'report-broadcast-content--reading': !qaVisible && !voiceRecording,
    }"
  >
    <view class="report-broadcast-content__portrait-gap" />
    <view class="report-broadcast-content__portrait-stage">
      <view class="report-broadcast-content__glow report-broadcast-content__glow--blue" />
      <view class="report-broadcast-content__glow report-broadcast-content__glow--red" />
      <!-- 左右声波已去掉（深色稿同步移除，浅色稿本就没有）：头像位只剩图形本体 -->
      <!-- 头像位（浅色设计稿 195:2031）：112×112 换成 tell 动图，深浅各一套（tell-light / tell-dark），
           画布为正方形透明底，图案居中占 40.5%，缩放比例见下方 __portrait 注释 -->
      <view class="report-broadcast-content__portrait-wrap">
        <image
          class="report-broadcast-content__portrait"
          :src="portraitLogoSrc"
          mode="aspectFill"
        />
      </view>
      <!-- 暂停/播放按钮已按浅色稿 195:1927 去掉：画板头像位只有头像本身，没有播放控件 -->
    </view>
    <!-- 进度条按浅色稿 195:1927 去掉：画板中头像与字幕之间没有进度控件 -->
    <view class="report-broadcast-content__transcript">
      <view v-show="showTranscriptSkeleton" class="report-broadcast-content__skeleton">
        <view v-for="index in 5" :key="index" class="report-broadcast-content__skeleton-segment">
          <view class="report-broadcast-content__skeleton-line" /><view
            class="report-broadcast-content__skeleton-line"
          /><view
            class="report-broadcast-content__skeleton-line report-broadcast-content__skeleton-line--short"
          />
        </view>
      </view>
      <scroll-view
        ref="transcriptViewportRef"
        v-show="!showTranscriptSkeleton && !qaVisible && !voiceRecording"
        class="report-broadcast-content__transcript-content"
        scroll-y
        @scroll="scrollTranscriptToBottom"
      >
        <view
          ref="transcriptTrackRef"
          class="report-broadcast-content__transcript-track"
        >
          <text
            v-for="item in transcriptItems"
            :id="item.key"
            :key="item.key"
            class="report-broadcast-content__segment"
            :class="`report-broadcast-content__segment--${item.role}`"
          >
            <!-- 当前段走打字机（逐字出现），已播完的段落保持全文；光标跟在最后一个字后面 -->
            {{ item.role === "current" ? item.text.slice(0, typedLength) : item.text }}<text
              v-if="item.role === 'current'"
              class="report-broadcast-content__caret"
            />
          </text>
        </view>
      </scroll-view>
      <!-- 录音中：字幕区让给实时转写，边说边出字（与首页提问气泡里的 partial 同源） -->
      <view
        v-if="!showTranscriptSkeleton && voiceRecording"
        class="report-broadcast-content__voice"
      >
        <text class="report-broadcast-content__voice-text">
          {{ voiceTranscript || t("identifying") }}
        </text>
      </view>
      <!-- 点击说话：识别中/回答结果直接占用字幕区，头像与播放控制保持不动 -->
      <view v-else-if="!showTranscriptSkeleton && qaLoading" class="report-broadcast-content__qa-loading">
        <!-- 思考态背景：设计稿光斑，缓慢明暗起伏做呼吸灯 -->
        <image
          class="report-broadcast-content__qa-loading-glow"
          :src="thinkingGlow"
          mode="aspectFill"
        />
        <view class="report-broadcast-content__qa-loading-copy">
          <text class="report-broadcast-content__qa-title">
            {{ t("broadcast-understanding") }}
          </text>
          <!-- 标题位置固定：小标题始终占位，有文案才显示，不推动标题 -->
          <text class="report-broadcast-content__qa-subtitle">
            {{ qaSubtitle || "" }}
          </text>
        </view>
      </view>
      <scroll-view
        v-else-if="!showTranscriptSkeleton && qaAnswer"
        class="report-broadcast-content__qa-scroll"
        scroll-y
      >
        <!-- 与首页问答同一套富文本渲染：Markdown 的标题/列表/加粗等原样呈现 -->
        <MarkdownRenderer class="report-broadcast-content__qa-answer" :content="qaAnswer" />
      </scroll-view>
      <view
        v-if="transcriptHasScrolled && !showTranscriptSkeleton && !qaVisible && !voiceRecording"
        class="report-broadcast-content__top-fade"
      />
      <!-- 底部渐隐：与顶部渐隐对称，字幕溢出可滚动时压住底部边缘 -->
      <view
        v-if="transcriptOverflow && !showTranscriptSkeleton && !qaVisible && !voiceRecording"
        class="report-broadcast-content__bottom-fade"
      />
    </view>
  </view>
</template>

<style scoped lang="scss">
.report-broadcast-content {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  overflow: hidden;
}
.report-broadcast-content__portrait-gap {
  height: 34rpx;
  flex: 0 0 34rpx;
}
.report-broadcast-content__portrait-stage {
  position: relative;
  display: flex;
  width: 100%;
  height: 510rpx;
  flex: 0 0 510rpx;
  align-items: center;
  justify-content: center;
  overflow: visible;
}
/* 头像位保持 480rpx 正方形；tell 是正方形画布（light 480×480 / dark 600×600），
   图案居中、约占画布 40.5%，四周是透明留白，不需要 aspectFill 裁切。 */
.report-broadcast-content__portrait-wrap {
  position: relative;
  display: flex;
  width: 480rpx;
  height: 480rpx;
  flex: 0 0 480rpx;
  align-items: center;
  justify-content: center;
}
.report-broadcast-content__portrait {
  position: relative;
  z-index: 1;
  width: 480rpx;
  height: 480rpx;
  /* 只缩小动画本体、保留原占位，字幕位置不跟着跳。
     tell 图案占画布 40.5% → 480rpx 盒子里图案约 194rpx；缩到 0.81 后约 157rpx，
     与原来 think（aspectFill 裁成 1:1 后 158rpx）视觉等大。 */
  transform: scale(0.81);
  transform-origin: center;
}
.report-broadcast-content__glow {
  position: absolute;
  z-index: 0;
  border-radius: 50%;
  filter: blur(92rpx);
}
.report-broadcast-content__glow--blue {
  top: 90rpx;
  left: 86rpx;
  width: 282rpx;
  height: 350rpx;
  // background: rgb(229 242 255 / 30%);
}
.report-broadcast-content__glow--red {
  top: 40rpx;
  left: 303.714rpx;
  width: 362.571rpx;
  height: 450rpx;
  // background: rgb(255 216 216 / 40%);
}
/* 进度条已按浅色稿 195:1927 移除（头像与字幕之间无进度控件），
   相关轨道 / 拖拽点 / 热区样式一并删掉，避免留死代码。 */
.report-broadcast-content__transcript {
  position: relative;
  width: 100%;
  min-height: 0;
  flex: 1 1 auto;
  /* 底部累计留白 120px（原 40px 再增加 80px），滚动区域和渐隐一起上移。 */
  margin-bottom: 240rpx;
  /* 距 logo 再靠近约 20px，底部留白保持不变。 */
  margin-top: -40rpx;
  padding: 32rpx 88rpx 0;
  box-sizing: border-box;
  overflow: hidden;
}
.report-broadcast-content__transcript-content {
  width: 100%;
  height: 100%;
  :deep(.uni-scroll-view) {
    overflow-anchor: none;
    scroll-behavior: auto;
  }
}
.report-broadcast-content__transcript-track {
  display: flex;
  box-sizing: border-box;
  flex-direction: column;
  justify-content: flex-start;
  padding-bottom: 24rpx;
  gap: 12rpx;
}
.report-broadcast-content__skeleton {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}
.report-broadcast-content__skeleton-segment {
  display: flex;
  height: 152rpx;
  flex-direction: column;
  gap: 12rpx;
}
.report-broadcast-content__skeleton-line {
  width: 100%;
  height: 24rpx;
  border-radius: 8rpx;
  background: linear-gradient(90deg, #f2f3f5 25%, #e5e7eb 50%, #f2f3f5 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
.report-broadcast-content__skeleton-line--short {
  width: 68%;
}
.report-broadcast-content__segment {
  display: block;
  flex-shrink: 0;
  color: #e0e0e0;
  font-size: 38rpx;
  font-weight: 500;
  line-height: 48rpx;
  white-space: normal;
}
.report-broadcast-content__segment--current {
  color: #211b1b;
  font-size: 36rpx;
  font-weight: 700;
  line-height: 50rpx;
}
/* 打字机光标：竖线贴在当前段最后一个字后面。
   填充用播报页品牌渐变（#3D21CD → #1999FE → #C067FA → #FD90C4），整体 60% 不透明，
   1.1s 阶梯闪烁；高度用 1em 跟随段落字号，两个主题共用 */
.report-broadcast-content__caret {
  display: inline-block;
  width: 4rpx;
  height: 1em;
  margin-left: 6rpx;
  border-radius: 2rpx;
  vertical-align: -0.18em;
  opacity: 0.6;
  background-image: linear-gradient(180deg, #3d21cd 0%, #1999fe 33.33%, #c067fa 66.67%, #fd90c4 100%);
  animation: podcast-caret-blink 1.1s steps(1) infinite;
}

@keyframes podcast-caret-blink {
  0%,
  55% {
    opacity: 0.6;
  }

  55.01%,
  100% {
    opacity: 0;
  }
}
/* —— 录音中的实时转写：占用字幕区，排版沿用「当前句」的字号，像把播报文字换成用户的话 —— */
.report-broadcast-content__voice {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: flex-start;
  justify-content: center;
  padding-top: 120rpx;
  box-sizing: border-box;
  overflow: hidden;
}
.report-broadcast-content__voice-text {
  color: #211b1b;
  font-size: 38rpx;
  font-weight: 700;
  line-height: 52rpx;
  text-align: center;
  word-break: break-word;
}
/* —— 点击说话的识别/问答态：占用字幕区，文案与呼吸灯光晕整体跟随 —— */
.report-broadcast-content__qa-loading {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
/* 思考态背景：设计稿光斑铺满字幕区，明暗配合轻微缩放做呼吸灯 */
.report-broadcast-content__qa-loading-glow {
  position: absolute;
  z-index: 0;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  animation: qa-loading-breathe 3.6s ease-in-out infinite;
}
.report-broadcast-content__qa-loading-copy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}
.report-broadcast-content__qa-title {
  color: #1a1a1a;
  font-size: 38rpx;
  font-weight: 500;
  line-height: 54rpx;
  text-align: center;
}
/* 小标题无论有没有接口文案都占住这一行，标题位置保持不变 */
.report-broadcast-content__qa-subtitle {
  min-height: 36rpx;
  color: #999;
  font-size: 26rpx;
  font-weight: 400;
  line-height: 36rpx;
}
@keyframes qa-loading-breathe {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(1);
  }

  50% {
    opacity: 1;
    transform: scale(1.04);
  }
}
/* 答案卡片：白底圆角卡，高度随内容自适应，超长时在卡片内滚动 */
.report-broadcast-content__qa-scroll {
  flex: 0 1 auto;
  width: 100%;
  max-height: calc(100% - 48rpx);
  margin-bottom: 48rpx;
  padding: 36rpx 36rpx 40rpx;
  border: 1px solid #f0f1f3;
  border-radius: 24rpx;
  box-sizing: border-box;
  background: #fff;
  box-shadow: 0 6rpx 20rpx rgb(21 27 38 / 4%);
}
/* 正文排版交给 MarkdownRenderer，这里只补齐卡片内的字号与行距 */
.report-broadcast-content__qa-answer {
  display: block;
  width: 100%;
}
.report-broadcast-content__qa-answer :deep(p) {
  margin-bottom: 14rpx !important;
  color: #2f323c !important;
  font-size: 30rpx !important;
  line-height: 46rpx !important;
}
.report-broadcast-content__top-fade {
  position: absolute;
  z-index: 2;
  top: 0;
  right: 0;
  left: 0;
  height: 72rpx;
  max-height: 30%;
  pointer-events: none;
  background: linear-gradient(180deg, #fff 0%, rgb(255 255 255 / 86%) 40%, rgb(255 255 255 / 0%) 100%);
}
/* 底部渐隐：与顶部渐隐对称，贴在字幕区底边，压住滚出的文字 */
.report-broadcast-content__bottom-fade {
  position: absolute;
  z-index: 2;
  right: 0;
  bottom: 0;
  left: 0;
  height: 72rpx;
  max-height: 30%;
  pointer-events: none;
  background: linear-gradient(0deg, #fff 0%, rgb(255 255 255 / 86%) 40%, rgb(255 255 255 / 0%) 100%);
}
/* 播放/暂停按钮已按浅色稿 195:1927 移除（节点样式一并删掉，不留死代码） */
.report-broadcast-content__play-btn {
  display: flex;
  width: 48rpx;
  height: 48rpx;
  align-items: center;
  justify-content: center;
}
@keyframes shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

/* ===== 浅色主题：Ardot 195:1927「日常运营助手-听播-正在播放」=====
   只按浅色稿的坐标与材质实现，深色稿（1193:2708）继续走下面的 --dark 块：
   - 头像位 195:2031：换成 tell-light.webp 动图，正方形画布、图案居中占 40.5%，整体缩到 0.81 摆放
   - 光晕：浅色稿无此元素，隐藏（声波两个主题都已去掉）
   - 字幕 195:1985：左 44 / 右 48（文本宽 283），头像底 → 文字顶 49px，18/26 Medium #0D0D0D
   - 上下渐隐：底色跟随页面底色 #FAFAFA，文字淡出不出现色块接缝 */
.report-broadcast-content--light {
  /**
   * 头像位放 tell-light.webp：正方形画布、透明底，缩放后图案约 157rpx，
   * 按「画布中心 = 头像位中心」摆放：
   *   - 舞台高度 110px（220rpx）= 设计稿头像位 112px；
   *   - 480rpx 画布相对 220rpx 舞台上下各溢出 130rpx（65px），溢出部分全透明，不遮字幕。
   */
  .report-broadcast-content__portrait-stage {
    position: relative;
    height: 220rpx; /* 110px：设计稿头像位高度 */
    flex: 0 0 220rpx;
  }

  .report-broadcast-content__portrait-wrap {
    position: absolute;
    top: -130rpx; /* (220 - 480) / 2：画布垂直跟随 */
    left: 50%;
    width: 480rpx; /* 240px */
    height: 480rpx; /* 240px */
    margin-left: -240rpx;
  }

  .report-broadcast-content__portrait {
    position: absolute;
    top: 0;
    left: 0;
    width: 480rpx; /* 240px */
    height: 480rpx; /* 240px */
  }

  .report-broadcast-content__glow {
    display: none;
  }

  /* 头像底(195) → 文字顶(244) = 49px：进度条与播放按钮都已去掉，这里直接补满 49px */
  .report-broadcast-content__transcript {
    padding: 98rpx 96rpx 0 88rpx; /* 上 49 / 右 48 / 左 44 */
  }

  /* 字幕排版（设计稿 195:1985 文本样式）：
     fontFamily Source Han Sans CN / fontSize 18 / Medium 500 / lineHeight 26 /
     左对齐 / 顶对齐 / textCase ORIGINAL / textDecoration NONE / 字间距 0 */
  .report-broadcast-content__segment,
  .report-broadcast-content__segment--current {
    color: #0d0d0d;
    font-family: "Source Han Sans CN", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    font-size: 36rpx; /* 18px */
    font-style: normal;
    font-weight: 500; /* Medium */
    line-height: 52rpx; /* 26px */
    letter-spacing: 0; /* 设计稿字间距 0 */
    text-align: left;
    text-decoration: none;
    text-transform: none; /* textCase: ORIGINAL */
    vertical-align: top;
  }

  .report-broadcast-content__top-fade {
    background: linear-gradient(180deg, #fafafa 0%, rgb(250 250 250 / 86%) 40%, rgb(250 250 250 / 0%) 100%);
  }

  .report-broadcast-content__bottom-fade {
    background: linear-gradient(0deg, #fafafa 0%, rgb(250 250 250 / 86%) 40%, rgb(250 250 250 / 0%) 100%);
  }

}

/* ===== 深色主题：播报内容区（Ardot 1193:2708 正在播放 / 1193:3357 正在回答 / 1193:1864 中途提问）=====
   暗色稿与浅色稿的坐标、字号、行高、层级一一对应，这里只换材质：
   - 字幕后景 1193:1903 / 1193:2814：竖向由 #0D0D0D 47.7% 渐到 #0D0D0D，压住上下滚动的字幕
   - 段落 1193:1977：#FFFFFF；淡化段 1193:1997 / 1193:1865：rgba(255,255,255,0.2)
   - 进度条已移除（浅色稿 195:1927 无进度控件），暗色稿同步不再渲染
   - 播放/暂停按钮已移除，暗色稿同步不再渲染
   - 答案卡 1193:3413：底 #1A1A1A + 1px #303030 描边，正文 #FFFFFF；标题 #FFFFFF、过程说明 #8F8F8F
   - 骨架屏：浅色 #F2F3F5→#E5E7EB 的流光换成 #212121→#303030 */
.report-broadcast-content--dark {
  /* 头像位同样用 tell-dark.webp：透明底素材直接叠在 #0D0D0D 上，
     不再需要 screen 混合或径向遮罩去消方形色差 */

  .report-broadcast-content__glow--blue {
    // background: rgb(17 102 214 / 35%);
  }

  .report-broadcast-content__segment {
    color: rgb(255 255 255 / 20%);
  }

  .report-broadcast-content__segment--current {
    color: #ffffff;
  }

  .report-broadcast-content__skeleton-line {
    background: linear-gradient(90deg, #212121 25%, #303030 50%, #212121 75%);
    background-size: 200% 100%;
  }

  .report-broadcast-content__top-fade {
    background: linear-gradient(180deg, #0d0d0d 0%, rgb(13 13 13 / 86%) 40%, rgb(13 13 13 / 0%) 100%);
  }

  .report-broadcast-content__bottom-fade {
    background: linear-gradient(0deg, #0d0d0d 0%, rgb(13 13 13 / 86%) 40%, rgb(13 13 13 / 0%) 100%);
  }


  .report-broadcast-content__voice-text {
    color: #ffffff;
  }

  .report-broadcast-content__qa-title {
    color: #ffffff;
  }

  .report-broadcast-content__qa-subtitle {
    color: #8f8f8f;
  }

  .report-broadcast-content__qa-scroll {
    border-color: #303030;
    background: #1a1a1a;
    box-shadow: 0 6rpx 20rpx rgb(0 0 0 / 20%);
  }

  .report-broadcast-content__qa-answer :deep(p) {
    color: #ffffff !important;
  }
}
/* 播报态采用短阅读区：先从顶部逐句展示，超高后滚底，上方旧文字渐隐。
   通过区域位置形成页面中下部的视觉重心，不再给段落塞半屏留白来强制居中。 */
.report-broadcast-content--reading .report-broadcast-content__transcript {
  flex: 0 1 360rpx;
  height: 360rpx;
  max-height: 24vh;
  margin-top: auto;
  margin-bottom: max(240rpx, 30vh);
  padding-top: 0;
}
</style>

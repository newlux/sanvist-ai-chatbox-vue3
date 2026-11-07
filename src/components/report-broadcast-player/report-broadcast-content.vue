<script setup lang="ts">
import type { ThinkStep } from "@/utils/ai-stream";
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import feedbackGoodFilledIcon from "@/assets/img/report-broadcast/feedback-good-filled.svg";
import feedbackGoodIcon from "@/assets/img/report-broadcast/feedback-good.svg";
import tellDarkGif from "@/assets/img/tell-dark.gif";
import tellLightGif from "@/assets/img/tell-light.gif";
import MarkdownRenderer from "@/components/markdown-renderer/index.vue";
import { useSystemStore } from "@/stores";

const props = defineProps<{
  /** 所选音色头像：头像位已按主题改用 tell-dark / tell-light 动图，仅为父级传参兼容保留 */
  portrait?: string;
  playing: boolean;
  loading: boolean;
  currentSeq: number | null;
  nextText: string;
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
const instance = getCurrentInstance();
const transcriptScrollTop = ref(0);
/**
 * 滚动视图的真实位置。transcriptScrollTop 是单向受控值，用户手动滚动时不会同步，
 * 一旦两者脱节，切句时以受控值为基数算出的目标位置就是错的，高亮回不到中间。
 */
let transcriptRealScrollTop = 0;
/** 自动居中滚动进行中：动画中间态不回写受控值，否则会自己打断自己。 */
let transcriptAutoCentering = false;
let transcriptAutoCenterTimer: ReturnType<typeof setTimeout> | null = null;
/** 手动滚动停手后延迟这么久，若无新滚动就把当前高亮段拉回中间（不等下一句切句）。 */
const TRANSCRIPT_RECENTER_DELAY_MS = 3000;
let transcriptRecenterTimer: ReturnType<typeof setTimeout> | null = null;

/** 取消已排定的「停手回中」，避免用户继续滚动时半路被打断。 */
function cancelTranscriptRecenter() {
  if (!transcriptRecenterTimer) return;
  clearTimeout(transcriptRecenterTimer);
  transcriptRecenterTimer = null;
}

/** 每次手动滚动都重新计时：只有真正停下来 TRANSCRIPT_RECENTER_DELAY_MS 才回中。 */
function scheduleTranscriptRecenter() {
  cancelTranscriptRecenter();
  // 暂停时用户通常在看文字，不打扰；恢复播放后由切句逻辑接管回中
  if (!props.playing) return;
  transcriptRecenterTimer = setTimeout(() => {
    transcriptRecenterTimer = null;
    updateTranscriptScroll();
  }, TRANSCRIPT_RECENTER_DELAY_MS);
}

/**
 * 记录真实滚动位置；手动滚动时同步受控值到真实位置，
 * 保证下次自动居中的目标值与旧值不同，scroll-view 才会真正滚动。
 */
function onTranscriptScroll(e: { detail?: { scrollTop?: number } }) {
  const top = Number(e?.detail?.scrollTop ?? 0);
  if (!Number.isFinite(top)) return;
  transcriptRealScrollTop = top;
  if (transcriptAutoCentering) return;
  transcriptScrollTop.value = Math.max(0, top);
  // 手动滚动：排定停手后回中，高亮段重新回到中间阅读带
  scheduleTranscriptRecenter();
}
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
const transcriptItems = computed(() => {
  const items = props.transcriptSegments.map(segment => ({
    key: `segment-${segment.seq}`,
    role: (segment.seq === props.currentSeq
      ? "current"
      : segment.seq < (props.currentSeq ?? Infinity)
        ? "previous"
        : "next") as "previous" | "current" | "next",
    text: segment.text,
  }));
  /**
   * 浅色稿 195:1985 只有「当前播报段落」一块文字，配合打字机逐句摊开：
   * 还没播到的段落先不渲染，字幕随播报一句一句长出来，不是一进页就把全稿摊平。
   * 深色稿（1193:2708）保留原来的「下一句」淡显预览，不动。
   */
  if (!isDark.value) return items.filter(item => item.role !== "next");
  if (
    props.nextText &&
    props.currentSeq !== null &&
    !items.some(item => item.key === `segment-${props.currentSeq + 1}`)
  ) {
    items.push({ key: `segment-${props.currentSeq + 1}`, role: "next", text: props.nextText });
  }
  return items;
});

function updateTranscriptScroll() {
  if (!props.playing || props.currentSeq === null) return;
  const targetSeq = props.currentSeq;
  void nextTick(() => {
    if (!props.playing || props.currentSeq !== targetSeq) return;
    const query = uni.createSelectorQuery().in(instance?.proxy);
    query.select(".report-broadcast-content__transcript-content").boundingClientRect();
    query.select(`#segment-${targetSeq}`).boundingClientRect();
    query.exec((rects) => {
      if (!props.playing || props.currentSeq !== targetSeq) return;
      const viewport = rects?.[0] as UniApp.NodeInfo | undefined;
      const current = rects?.[1] as UniApp.NodeInfo | undefined;
      if (
        !viewport
        || !current
        || typeof viewport.top !== "number"
        || typeof viewport.bottom !== "number"
        || typeof current.top !== "number"
        || typeof current.bottom !== "number"
      ) {
        return;
      }

      // 预留上下渐隐和底部反馈区，当前播报段落只在中间阅读带内定位。
      const safeTop = viewport.top + Math.min(80, (viewport.bottom - viewport.top) * 0.25);
      const safeBottom = viewport.bottom - Math.min(112, (viewport.bottom - viewport.top) * 0.35);
      const currentHeight = current.bottom - current.top;
      const targetTop = currentHeight >= safeBottom - safeTop
        ? safeTop
        : safeTop + (safeBottom - safeTop - currentHeight) / 2;
      const offset = current.top - targetTop;
      if (Math.abs(offset) > 1) {
        // 已经在自动回中，取消可能残留的停手排定，避免重复触发
        cancelTranscriptRecenter();
        // 以「真实滚动位置」为基数校正：受控值可能因用户手动滚动而与真实位置脱节，
        // 用脱节的受控值做基数会把高亮滚偏，甚至新旧值相同导致 scroll-view 不滚动（表现为不复原）。
        const nextTop = Math.max(0, Math.round(transcriptRealScrollTop + offset));
        transcriptAutoCentering = true;
        transcriptScrollTop.value = nextTop;
        transcriptRealScrollTop = nextTop;
        if (transcriptAutoCenterTimer) clearTimeout(transcriptAutoCenterTimer);
        // 与 scroll-with-animation 的动画时长同量级，动画结束后恢复手动滚动回写
        transcriptAutoCenterTimer = setTimeout(() => {
          transcriptAutoCentering = false;
        }, 360);
      }
    });
  });
}
watch(() => props.currentSeq, updateTranscriptScroll);

/* —— 打字机（设计稿 195:1985）：当前播报段落逐字出现，不一次性摊开 ——
   只作用于「当前段」：已播完的段落保持全文，未播到的段落在浅色稿里不渲染，
   所以视觉上是「正在念的这一句在长字」，和播报节奏一致。 */
const TYPE_INTERVAL_MS = 50;
/** 当前段落已打出的字数：切句归零，暂停冻结，恢复后接着打 */
const typedLength = ref(0);
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
  if (transcriptAutoCenterTimer) clearTimeout(transcriptAutoCenterTimer);
  cancelTranscriptRecenter();
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
    }"
  >
    <view class="report-broadcast-content__portrait-gap" />
    <view class="report-broadcast-content__portrait-stage">
      <view class="report-broadcast-content__glow report-broadcast-content__glow--blue" />
      <view class="report-broadcast-content__glow report-broadcast-content__glow--red" />
      <!-- 左右声波已去掉（深色稿同步移除，浅色稿本就没有）：头像位只剩图形本体 -->
      <!-- 头像位（浅色设计稿 195:2031）：112×112 换成 tell 动图，按主题取素材：
           深色 → tell-dark.gif（自带纯黑底），浅色 → tell-light.gif（自带 #FCFCFF 底） -->
      <view class="report-broadcast-content__portrait-wrap">
        <image
          class="report-broadcast-content__portrait"
          :src="isDark ? tellDarkGif : tellLightGif"
          mode="aspectFit"
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
        v-show="!showTranscriptSkeleton && !qaVisible && !voiceRecording"
        class="report-broadcast-content__transcript-content"
        scroll-y
        :scroll-top="transcriptScrollTop"
        :scroll-with-animation="playing"
        @scroll="onTranscriptScroll"
      >
        <view class="report-broadcast-content__transcript-track">
          <text
            v-for="item in transcriptItems"
            :id="item.key"
            :key="item.key"
            class="report-broadcast-content__segment"
            :class="`report-broadcast-content__segment--${item.role}`"
          >
            <!-- 当前段走打字机（逐字出现），已播完的段落保持全文 -->
            {{ item.role === "current" ? item.text.slice(0, typedLength) : item.text }}
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
        v-if="!showTranscriptSkeleton && !qaVisible && !voiceRecording"
        class="report-broadcast-content__top-fade"
      />
      <view
        v-if="!showTranscriptSkeleton && !qaVisible && !voiceRecording"
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
/* 深色头像位：tell 系列素材画布 1000×1000、图形居中且满幅（无透明留白），
   等比缩到 180px（360rpx）后由舞台 flex 居中即可，不做裁剪 */
.report-broadcast-content__portrait-wrap {
  position: relative;
  display: flex;
  width: 360rpx;
  height: 360rpx;
  flex: 0 0 360rpx;
  align-items: center;
  justify-content: center;
}
.report-broadcast-content__portrait {
  position: relative;
  z-index: 1;
  width: 360rpx;
  height: 360rpx;
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
  background: rgb(229 242 255 / 30%);
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
  padding: 32rpx 88rpx 0;
  box-sizing: border-box;
  overflow: hidden;
}
.report-broadcast-content__transcript-content {
  width: 100%;
  height: 100%;
}
.report-broadcast-content__transcript-track {
  display: flex;
  min-height: 100%;
  padding-bottom: 180rpx;
  box-sizing: border-box;
  flex-direction: column;
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
/* —— 点击说话的识别/问答态：占用字幕区，文案与呼吸灯光晕整体居中 —— */
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
  height: 160rpx;
  pointer-events: none;
  // background: linear-gradient(180deg, #fff 0%, rgb(255 255 255 / 86%) 52%, rgb(255 255 255 / 0%) 100%);
}
/* 播放/暂停按钮已按浅色稿 195:1927 移除（节点样式一并删掉，不留死代码） */
.report-broadcast-content__bottom-fade {
  position: absolute;
  z-index: 2;
  right: 0;
  bottom: 0;
  left: 0;
  height: 180rpx;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgb(255 255 255 / 0%) 0%,
    rgb(255 255 255 / 86%) 58%,
    #fff 100%
  );
}
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
   - 头像位 195:2031：换成 tell-light.gif 动图，画布 1000×1000 等比缩到 180px 摆放
   - 光晕：浅色稿无此元素，隐藏（声波两个主题都已去掉）
   - 字幕 195:1985：左 44 / 右 48（文本宽 283），头像底 → 文字顶 49px，18/26 Medium #0D0D0D
   - 上下渐隐：底色跟随页面底色 #FAFAFA，文字淡出不出现色块接缝 */
.report-broadcast-content--light {
  /**
   * 头像位放 tell-light.gif：画布 1000×1000 满幅构图，等比缩到 180px（360rpx）。
   * 图形本体约占画布中间一半（统计结果四周是浅色底 + 放散光效，没有可裁的透明留白），
   * 所以按「画布中心 = 头像位中心」摆放：
   *   - 舞台高度 110px（220rpx）= 设计稿头像位 112px；
   *   - 360rpx 画布相对 220rpx 舞台上下各溢出 70rpx（35px），
   *     溢出部分是素材自带的 #FCFCFF 底，与页面 #FAFAFA 肉眼无差，不裁也不遮字幕。
   */
  .report-broadcast-content__portrait-stage {
    position: relative;
    height: 220rpx; /* 110px：设计稿头像位高度 */
    flex: 0 0 220rpx;
  }

  .report-broadcast-content__portrait-wrap {
    position: absolute;
    top: -70rpx; /* (220 - 360) / 2：画布垂直居中 */
    left: 50%;
    width: 360rpx; /* 180px */
    height: 360rpx; /* 180px */
    margin-left: -180rpx;
  }

  .report-broadcast-content__portrait {
    position: absolute;
    top: 0;
    left: 0;
    width: 360rpx; /* 180px */
    height: 360rpx; /* 180px */
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
    // background: linear-gradient(
    //   180deg,
    //   #fafafa 0%,
    //   rgb(250 250 250 / 86%) 52%,
    //   rgb(250 250 250 / 0%) 100%
    // );
  }

  .report-broadcast-content__bottom-fade {
    background: linear-gradient(
      180deg,
      rgb(250 250 250 / 0%) 0%,
      rgb(250 250 250 / 86%) 58%,
      #fafafa 100%
    );
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
  /* 头像位用 tell-dark.gif：素材自带纯黑（#000000）底，页面是 #0D0D0D，
     直接铺会露出一块方形黑底。screen 叠加让纯黑完全融进页面，只剩发光图形 */
  .report-broadcast-content__portrait {
    mix-blend-mode: screen;
  }

  .report-broadcast-content__glow--blue {
    background: rgb(17 102 214 / 35%);
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
    // background: linear-gradient(
    //   180deg,
    //   #0d0d0d 0%,
    //   rgb(13 13 13 / 86%) 52%,
    //   rgb(13 13 13 / 0%) 100%
    // );
  }

  .report-broadcast-content__bottom-fade {
    background: linear-gradient(
      180deg,
      rgb(13 13 13 / 0%) 0%,
      rgb(13 13 13 / 86%) 58%,
      #0d0d0d 100%
    );
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
</style>

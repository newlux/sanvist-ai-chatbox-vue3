<script setup lang="ts">
import type { GuideCheckPayload, GuideStepSelectEvent } from "@/api/chat/types";
import { computed, onMounted, ref } from "vue";
import iconCopy from "@/assets/img/icon-action-copy.svg";
import iconRadioOn from "@/assets/img/icon-action-radio-on.svg";
import iconShare from "@/assets/img/icon-action-share.svg";
import saniIcon from "@/assets/img/icon-sani.png";
import GuideSourceBlock from "./GuideSourceBlock.vue";
import { normalizeGuideUrl, previewGuideImages } from "@/utils/guide-content";
import { consumeStepTtsSwitch, requestStepTtsSwitch } from "@/utils/guide-step-tts";

/**
 * 核对任务与资料卡片（设计稿 2667:4520）。
 *
 * 独立白卡（白底 + #EFEFEF 边框 + 圆角 20 + 阴影 + 内边距 20），不套在回答气泡里，
 * 由消息列表在气泡下方单独渲染。
 * 结构：标题 + 右上角红色「步骤i/n」→ 步骤条（按步骤数切分，高亮当前步）→ 核对清单正文
 * → 参考来源（步骤卡回答气泡正文隐藏时，由消息列表注入同一条回答的 source 组件）→ 状态行
 * → 底部动作区（播报 / 复制 / 分享）。
 */
defineOptions({ name: "GuideCheckBlock" });

const props = defineProps({
  payload: { type: Object as () => GuideCheckPayload, required: true },
  /** 动作区是否展示：生成中 / 被中断的那一轮不展示（与气泡操作栏一致） */
  showActions: { type: Boolean, default: true },
  /** 这一轮是否支持语音播报：由消息的 ttsEnabled 决定，不支持时不画播报按钮 */
  ttsEnabled: { type: Boolean, default: false },
  ttsLoading: { type: Boolean, default: false },
  ttsPlaying: { type: Boolean, default: false },
  /**
   * 精简版（作业协同 / 作业指导页要的效果，和首页步骤卡对齐）：
   * 只留标题、步骤条、正文、参考图、确认问题与选项，
   * 不画底部动作区（复制/分享）、状态行和参考来源。
   */
  compact: { type: Boolean, default: false },
});

/**
 * 卡片的动作全部上抛，由页面复用现成能力：
 * - select-step → 页面切步骤并打开底部白板；
 * - tts-click   → 页面 useChatTts / 实时 TTS（按消息下标）；
 * - copy-click  → 页面 useChatShare 的复制（带卡片自身文案，这条消息气泡正文是隐藏的）；
 * - share-click → 页面 useChatShare 把这张卡片截成海报（带的是卡片根节点，不是未渲染的正文）。
 */
const emit = defineEmits<{
  (e: "select-step", payload: GuideStepSelectEvent): void;
  /** 非「下一步」的选项：文案原样上抛，由页面当成下一轮提问发出去 */
  (e: "pick", text: string): void;
  /** 最后一步确认完：上抛给消息列表，进入「小结 + 推荐问题」完成态 */
  (e: "finish"): void;
  /** 这张卡真正挂到 DOM 上了：外层据此把它滚到对话区顶部（切步骤时卡会整块重挂载） */
  (e: "card-ready"): void;
  (e: "tts-click"): void;
  (e: "copy-click", payload: { text: string }): void;
  (e: "share-click", payload: { element: HTMLElement | null }): void;
}>();

/** 卡片根节点：分享时整卡截图用（uni 的 view 在部分端会包一层组件实例） */
const rootRef = ref<HTMLElement | { $el?: HTMLElement } | null>(null);

const title = computed(() => String(props.payload?.title || "").trim() || "核对任务与资料");
/** 顶部标题行：优先用步骤卡带下来的 note（如「随车教练 — 司机上岗」），老数据退回 title */
const headerTitle = computed(() => String(props.payload?.note || "").trim() || title.value);
/** 这一小步的标题（加粗那一行），与顶部标题行分开 */
const stepTitle = computed(() => String(props.payload?.title || "").trim());
const showStepTitle = computed(() => Boolean(stepTitle.value) && stepTitle.value !== headerTitle.value);
const content = computed(() => String(props.payload?.content || ""));
/** 确认问题（「请确认当前步骤是否学会？」） */
const question = computed(() => String(props.payload?.confirmation_question || "").trim());
/** 这一步的选项文案，序号按顺序补 A/B/C */
const options = computed(() => (Array.isArray(props.payload?.options) ? props.payload.options : [])
  .map(item => String(item ?? "").trim())
  .filter(Boolean));
/** 这一步的参考图（steps[].images）：渲染在「参考来源」上方，宽高自适应 */
const images = computed(() => (Array.isArray(props.payload?.images) ? props.payload.images : [])
  .map(item => ({
    url: normalizeGuideUrl(String(item?.url || "")),
    caption: String(item?.caption || ""),
  }))
  .filter(item => item.url));
/** 参考来源：由消息列表从同一条回答的 source 组件注入，卡片内沿用「参考来源」样式展示 */
const sources = computed(() => (Array.isArray(props.payload?.sources) ? props.payload.sources : []));

function previewImage(current: string) {
  previewGuideImages(current, images.value.map(item => item.url));
}
const status = computed(() => String(props.payload?.status || "").trim());
const stepIndex = computed(() => Math.max(0, Number(props.payload?.step_index) || 0));
const stepTotal = computed(() => Math.max(0, Number(props.payload?.step_total) || 0));
const showStep = computed(() => stepTotal.value > 0 && stepIndex.value > 0);
/**
 * 进度：轨道按步等分，只亮「当前这一步」，不累积已完成的步。
 * 只显示当前步是为了让「我在第几步」一眼可见（累积填充读起来像总进度条，
 * 视觉上会把已经走过的步也算成正在做的事）。
 */
const progressStyle = computed(() => {
  const total = stepTotal.value;
  if (!total) return {};
  const ratio = 100 / total;
  const offset = ratio * Math.max(stepIndex.value - 1, 0);
  // 段首尾各内缩 2rpx，相邻段之间留出缝隙，看得出是分段而不是一根整线
  return {
    width: `calc(${ratio}% - 4rpx)`,
    marginLeft: `calc(${offset}% + 2rpx)`,
  };
});

/** 选项序号：A / B / C… */
function optionLetter(index: number) {
  return String.fromCharCode(65 + index);
}

/** 点进度条某一段 → 切到该步（越界不响应）；切步同样要停旧语音、播新的一步 */
function onSelectStep(index: number) {
  if (index < 1 || index > stepTotal.value) return;
  if (index === stepIndex.value) return;
  requestStepTtsSwitch(index);
  emit("select-step", { index, stepId: String(props.payload?.step_id || "") });
}

const isLast = computed(() => Boolean(props.payload?.is_last) || (stepTotal.value > 0 && stepIndex.value >= stepTotal.value));

/**
 * 选项点击：
 * - 第一项（「确认学会，下一步」）：没到最后一步就翻页（只切卡片，不发对话）；
 *   最后一步则上抛 finish，由消息列表切换到「小结 + 推荐问题」完成态；
 * - 其余项（「换个方式再讲解」/「我有其他问题」）：文案原样当下一轮提问发出去，
 *   与追问卡、开场引导卡的交互一致。
 */
function onOptionTap(index: number) {
  const label = options.value[index];
  if (!label) return;
  if (index === 0) {
    if (stepIndex.value > 0 && stepIndex.value < stepTotal.value) {
      // 确认翻页：新卡片挂载后播下一步（旧语音由页面停掉）；标记带目标步序，只被那一步认领
      requestStepTtsSwitch(stepIndex.value + 1);
      emit("select-step", { index: stepIndex.value + 1, stepId: String(props.payload?.step_id || "") });
      return;
    }
    if (isLast.value) {
      emit("finish");
      return;
    }
  }
  emit("pick", label);
}

/**
 * 翻页续播：点「确认，进入下一步」后本卡被卸载、下一步卡片重新挂载，
 * 挂载时若认领到「翻页」标记，就把这一步的播报点一下
 * （页面会先停旧语音，再按新的 step_id 取文本播放）。
 *
 * 不再要求「翻页前正在播」：一步念完后再点确认（playing 已被置回 false）时，
 * 旧判断会直接 return，表现为「确认后不播下一步」。
 */
onMounted(() => {
  // 先告诉外层「卡已经在了」，让它把视图滚到这张卡（切步骤时新卡是重新挂载的，
  // 页面在改 stepCardStepId 那一下 nextTick 滚，滚的还是上一张卡，所以必须等挂载后再说）
  emit("card-ready");
  if (!consumeStepTtsSwitch(stepIndex.value)) return;
  if (!props.ttsEnabled) return;
  emit("tts-click");
});

/** 复制卡片自身文案：这条消息的气泡正文是隐藏的，用户看到的就是卡内的标题 + 正文 */
const copyText = computed(() => [title.value, content.value].filter(Boolean).join("\n"));

function onCopyTap() {
  emit("copy-click", { text: copyText.value });
}

function onTtsTap() {
  if (!props.ttsEnabled) return;
  emit("tts-click");
}

/** 分享：把卡片根节点交给页面的 useChatShare 截图（动作区带 data-share-poster-ignore，不会进海报） */
function onShareTap() {
  emit("share-click", { element: resolveRootElement() });
}

/** 取卡片根 DOM：H5 下 view 直接就是元素，部分端会包一层组件实例（取 $el） */
function resolveRootElement(): HTMLElement | null {
  const node = rootRef.value;
  if (!node) return null;
  const hasDom = typeof HTMLElement !== "undefined";
  if (hasDom && node instanceof HTMLElement) return node;
  const inner = (node as { $el?: HTMLElement }).$el;
  return hasDom && inner instanceof HTMLElement ? inner : null;
}
</script>

<template>
  <view ref="rootRef" class="guide-check-block">
    <!-- 卡片左上角品牌署名：sani logo + SANI + 语音播报控制（与气泡里的完成态同一套观感） -->
    <view class="guide-check-block__brand">
      <image class="guide-check-block__brand-icon" :src="saniIcon" mode="aspectFit" />
      <text class="guide-check-block__brand-text">
        SANI
      </text>
      <view
        v-if="ttsEnabled"
        class="guide-check-block__action-btn guide-check-block__brand-tts"
        data-share-poster-ignore
        @tap.stop="onTtsTap"
      >
        <view v-if="ttsLoading" class="guide-check-block__tts-spinner" />
        <view v-else-if="ttsPlaying" class="guide-check-block__tts-wave">
          <view
            v-for="index in 4"
            :key="index"
            class="guide-check-block__tts-wave-bar"
            :class="`guide-check-block__tts-wave-bar--${index}`"
          />
        </view>
        <image v-else :src="iconRadioOn" mode="aspectFit" class="guide-check-block__action-icon" />
      </view>
    </view>

    <view class="guide-check-block__header">
      <text class="guide-check-block__title">
        {{ headerTitle }}
      </text>
      <text v-if="showStep" class="guide-check-block__step">
        步骤{{ stepIndex }}/{{ stepTotal }}
      </text>
    </view>

    <!-- 进度：一根细线按步等分，只亮当前这一步（步骤1/4 → 第 1 段高亮），每段可点切步骤 -->
    <view v-if="showStep" class="guide-check-block__progress-wrap">
      <view class="guide-check-block__progress">
        <view class="guide-check-block__progress-fill" :style="progressStyle" />
      </view>
      <!-- 透明命中层：细线只有 4rpx，这里上下各撑开 24rpx 做可点区域 -->
      <view class="guide-check-block__progress-hits">
        <view
          v-for="index in stepTotal"
          :key="`hit-${index}`"
          class="guide-check-block__progress-hit"
          @tap.stop="onSelectStep(index)"
        />
      </view>
    </view>

    <!-- 这一小步的标题：设计稿里是加粗的一行，与顶部标题行分开 -->
    <text v-if="showStepTitle" class="guide-check-block__step-title">
      {{ stepTitle }}
    </text>

    <text v-if="content" class="guide-check-block__content">
      {{ content }}
    </text>

    <!-- 这一步的参考图：渲染在「参考来源」上方 -->
    <view v-if="images.length" class="guide-check-block__images">
      <view v-for="item in images" :key="item.url" class="guide-check-block__image-item">
        <image
          class="guide-check-block__image"
          :src="item.url"
          mode="widthFix"
          @tap.stop="previewImage(item.url)"
        />
        <text v-if="item.caption" class="guide-check-block__image-caption">
          {{ item.caption }}
        </text>
      </view>
    </view>

    <!-- 确认问题 + 选项：作业指导一步做完之后的三个出口（下一步 / 换个方式 / 其他问题）。
         最后一步确认完会 emit finish，由消息列表把这块整体换成「小结 + 推荐问题」，
         小结与推荐问题不渲染在步骤卡片内部。 -->
    <text v-if="question" class="guide-check-block__question">
      {{ question }}
    </text>
    <view v-if="options.length" class="guide-check-block__options">
      <view
        v-for="(label, index) in options"
        :key="label"
        class="guide-check-block__option"
        @tap.stop="onOptionTap(index)"
      >
        <text class="guide-check-block__option-letter">
          {{ optionLetter(index) }}
        </text>
        <view class="guide-check-block__option-divider" />
        <text class="guide-check-block__option-label">
          {{ label }}
        </text>
      </view>
    </view>

    <!-- 参考来源：与回答气泡里的参考资料同款（标题 + 条目）；精简版不展示 -->
    <GuideSourceBlock
      v-if="!compact && sources.length"
      class="guide-check-block__sources"
      :payload="{ evidence: sources }"
    />

    <text v-if="!compact && status" class="guide-check-block__status">
      {{ status }}
    </text>

    <!-- 动作区：复制 / 分享，与回答气泡的操作栏同一套图标与观感；精简版整块不画。
         播报按钮已上移到卡片左上角的 SANI 后面（与气泡完成态一致）；
         data-share-poster-ignore 让分享截图时把这一行摘掉，海报里只有卡片内容 -->
    <view v-if="showActions && !compact" class="guide-check-block__actions" data-share-poster-ignore>
      <view class="guide-check-block__action-btn" @tap.stop="onCopyTap">
        <image :src="iconCopy" mode="aspectFit" class="guide-check-block__action-icon" />
      </view>
      <view class="guide-check-block__action-btn" @tap.stop="onShareTap">
        <image :src="iconShare" mode="aspectFit" class="guide-check-block__action-icon" />
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 这一步的参考图：宽高自适应（widthFix），与对话框里的参考图同一套观感 */
.guide-check-block__images {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 24rpx;
}

.guide-check-block__image-item {
  overflow: hidden;
  border-radius: 16rpx;
  background: #f6f6f6;
}

.guide-check-block__image {
  display: block;
  width: 100%;
  min-height: 240rpx;
  background: #eeeeee;
}

.guide-check-block__image-caption {
  display: block;
  padding: 12rpx 16rpx 16rpx;
  color: #666666;
  font-size: 24rpx;
  line-height: 34rpx;
}

.guide-check-block__sources {
  margin-top: 24rpx;
}


/* 设计稿：这张卡不画白框，直接铺在对话背景上（与回答正文同一套字号 / 行距） */
.guide-check-block {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
}

/* 左上角品牌署名：sani logo + SANI + 播报按钮（与气泡完成态同一套观感） */
.guide-check-block__brand {
  display: flex;
  align-items: center;
  margin-bottom: 20rpx;
}

.guide-check-block__brand-icon {
  flex-shrink: 0;
  width: 52rpx;
  height: 52rpx;
}

.guide-check-block__brand-text {
  margin-left: 12rpx;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 26rpx;
  font-weight: 500;
  line-height: 36rpx;
  color: #1a1a1a;
}

.guide-check-block__brand-tts {
  margin-left: 12rpx;
}

.guide-check-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.guide-check-block__title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 30rpx;
  font-weight: 500;
  line-height: 42rpx;
  color: #1a1a1a;
}

.guide-check-block__step {
  flex-shrink: 0;
  margin-left: 16rpx;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 26rpx;
  font-weight: 400;
  line-height: 42rpx;
  color: #999999;
}

/* 进度：4rpx 实线轨道，按已完成步数连续填充（设计稿「步骤1/4」→ 填到 1/4，蓝色） */
.guide-check-block__progress-wrap {
  position: relative;
  width: 100%;
  margin-top: 16rpx;
}

.guide-check-block__progress {
  width: 100%;
  height: 4rpx;
  overflow: hidden;
  border-radius: 2rpx;
  background: #ededed;
}

.guide-check-block__progress-fill {
  height: 100%;
  border-radius: 2rpx;
  background: #2c6be4;
  transition: margin-left 0.24s ease;
}

/* 进度条的透明命中层：视觉仍是 4rpx 细条，可点区域上下各扩 24rpx；每段等宽 = 一步 */
.guide-check-block__progress-hits {
  position: absolute;
  top: -24rpx;
  right: 0;
  bottom: -24rpx;
  left: 0;
  display: flex;
}

.guide-check-block__progress-hit {
  flex: 1 1 0;
  min-width: 0;
}

/* 这一小步的标题：加粗一行，压在讲解正文上方 */
.guide-check-block__step-title {
  display: block;
  margin-top: 28rpx;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 34rpx;
  font-weight: 600;
  line-height: 50rpx;
  color: #1a1a1a;
}

.guide-check-block__content {
  display: block;
  margin-top: 16rpx;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 30rpx;
  font-weight: 400;
  line-height: 52rpx;
  color: #1a1a1a;
}

/* 确认问题：「请确认当前步骤是否学会？」 */
.guide-check-block__question {
  display: block;
  margin-top: 40rpx;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 30rpx;
  font-weight: 500;
  line-height: 48rpx;
  color: #1a1a1a;
}

/* 选项组：纵向排列、左对齐，胶囊按内容宽度收缩，不铺满整行 */
.guide-check-block__options {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-top: 24rpx;
}

.guide-check-block__option {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  max-width: 100%;
  padding: 18rpx 28rpx;
  border: 1px solid #e6e6e6;
  border-radius: 32rpx;
  background: #ffffff;
}

/* 段间距用 margin 而不是 flex gap：低端安卓 WebView 的 flex gap 支持不稳 */
.guide-check-block__option + .guide-check-block__option {
  margin-top: 20rpx;
}

.guide-check-block__option:active {
  opacity: 0.7;
}

.guide-check-block__option-letter {
  flex-shrink: 0;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 40rpx;
  color: #1a1a1a;
}

/* 字母与文案之间的细分隔线（设计稿里的「A|」） */
.guide-check-block__option-divider {
  flex-shrink: 0;
  width: 1px;
  height: 26rpx;
  margin: 0 16rpx;
  background: #dcdcdc;
}

.guide-check-block__option-label {
  min-width: 0;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
  color: #1a1a1a;
  white-space: normal;
  word-break: break-word;
}

.guide-check-block__status {
  display: block;
  margin-top: 24rpx;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 26rpx;
  font-weight: 400;
  line-height: 40rpx;
  color: #9e9e9e;
}

/* 动作区：与回答气泡的操作栏同款（上方 1px 分隔线 + 图标间距 8px） */
.guide-check-block__actions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 16rpx;
  margin-top: 24rpx;
  padding-top: 24rpx;
  border-top: 1px solid #e8e8e8;
}

.guide-check-block__action-btn {
  display: flex;
  width: 32rpx;
  height: 32rpx;
  align-items: center;
  justify-content: center;
}

.guide-check-block__action-icon {
  width: 32rpx;
  height: 32rpx;
}

.guide-check-block__tts-spinner {
  box-sizing: border-box;
  width: 24rpx;
  height: 24rpx;
  border: 3rpx solid rgba(136, 136, 136, 0.22);
  border-top-color: #888888;
  border-radius: 50%;
  animation: guide-check-tts-spin 0.8s linear infinite;
}

/* 播放中的语音图标：蓝色声波，四根条错峰起伏，视觉上从左往右推进 */
.guide-check-block__tts-wave {
  display: flex;
  width: 32rpx;
  height: 32rpx;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
}

.guide-check-block__tts-wave-bar {
  width: 4rpx;
  height: 24rpx;
  border-radius: 4rpx;
  background: #1a6dff;
  transform-origin: center center;
  animation: guide-check-tts-wave 0.9s ease-in-out infinite;
}

.guide-check-block__tts-wave-bar--1 { animation-delay: 0s; }
.guide-check-block__tts-wave-bar--2 { animation-delay: 0.12s; }
.guide-check-block__tts-wave-bar--3 { animation-delay: 0.24s; }
.guide-check-block__tts-wave-bar--4 { animation-delay: 0.36s; }

@keyframes guide-check-tts-spin {
  to { transform: rotate(360deg); }
}

@keyframes guide-check-tts-wave {
  0%,
  100% {
    transform: scaleY(0.35);
    opacity: 0.6;
  }

  50% {
    transform: scaleY(1);
    opacity: 1;
  }
}
</style>

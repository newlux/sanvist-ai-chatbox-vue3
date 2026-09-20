<script setup lang="ts">
import type { GuideStepItem, GuideStepPayload } from "@/api/chat/types";
import { computed, nextTick, ref, watch } from "vue";
import AiAttachmentPicker from "@/components/ai-attachment-picker/index.vue";
import { isNativeAttachmentPickerAvailable, type AttachmentSource } from "@/hooks/useComposerAttachments";
import closeIcon from "@/assets/img/icon-close.svg";

/**
 * 指导步骤卡片（COMPONENT scene=guide / type=step）。
 *
 * 字段取值（设计稿标注）：
 * - 左上灰色小标签 ← data.note
 * - 问题行 ← steps[].confirmation_question
 * - 主按钮 ← steps[].confirm_text；附件按钮 ← steps[].photo_text（两者样式一致）
 * - 末尾输入框的 placeholder ← steps[].question_text
 * 步骤本身的内容（title / action / images）不在这里，由对话里的详情卡展示。
 *
 * 交互：
 * - 「确认」：没到最后一步就翻到下一张（标签右侧 i/n 跟着走）；到最后一步说明整轮指导做完，
 *   直接收起卡片结束流程，不发对话（单步卡是多轮追问，仍会把这一步发出去换下一轮）；
 * - 「附件」：photo_text 非空时出现，点它弹附件来源弹窗（拍照 / 相册 / 文件，与输入栏
 *   「+」同一个组件；容器内直接走原生弹窗），选完由页面按附件流程发送；
 *   等弹窗弹出来的这段时间（bridge 判断最长 2 秒）会先盖一层中间蒙层挡住整页；
 * - 末尾输入框：placeholder 取 question_text，输入框右侧带「发送」图标（与原生输入栏 input-bar
 *   同款 icon-send.svg，与键盘回车等效，输入为空时置灰），用户自己写的问题按原样发出去。
 *
 * 视觉：白板贴底 + 向上阴影 + 灰色小标签 + 右上 ×，选项行默认 #f6f6f6；
 * 卡片高度通过 height-change 上报给页面，用于给消息列表让出底部间距。
 */
defineOptions({ name: "AiGuideStepSheet" });

const props = withDefaults(defineProps<{
  payload?: GuideStepPayload | null;
  visible?: boolean;
  /** 键盘高度（px）：末尾输入框聚焦时把卡片顶上去，别被键盘盖住 */
  keyboardHeight?: number;
}>(), {
  payload: null,
  visible: false,
  keyboardHeight: 0,
});

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "submit", query: string): void;
  /** 卡片实际高度（px）：页面拿它给消息列表留底部间距，最后一条回答不会被卡片盖住 */
  (e: "height-change", value: number): void;
  /** 当前步骤变化（展开 / 翻页）：页面据此把对话滚到该步骤对应的核对卡片 */
  (e: "step-change", value: GuideStepItem | null): void;
  /**
   * 附件按钮的产物：source 是用户在弹窗里选的来源（容器内原生弹窗恒为 native），
   * 页面据此选文件、上传，并按附件流程发送（photo_text 只用于卡片文案，不带进请求）。
   */
  (e: "photo", source: AttachmentSource): void;
}>();

const currentIndex = ref(0);
/** 末尾输入框：用户自己写的追问 */
const draftText = ref("");
/** 附件来源弹窗开关（前端三选项；容器内原生弹窗由原生自己弹） */
const isSourcePickerOpen = ref(false);
/** 选附件期间的中间蒙层：等 bridge 判断 / 弹来源弹窗的这段时间挡住整页，防止重复点其它按钮 */
const isPreparingAttachment = ref(false);

const steps = computed<GuideStepItem[]>(() => (Array.isArray(props.payload?.steps) ? props.payload.steps : []));
/** 灰色小标签取 data.note，老数据没有 note 时退回 data.title */
const cardTitle = computed(() => {
  const note = String(props.payload?.note || "").trim();
  return note || String(props.payload?.title || "").trim() || "操作步骤";
});
/** 多步骤模式：一张一张推进 */
const isMultiStep = computed(() => steps.value.length > 1);
const currentStep = computed<GuideStepItem | null>(() => steps.value[currentIndex.value] || null);
const isLastStep = computed(() => currentIndex.value >= steps.value.length - 1);
/** 问题行：这一步的确认问题，缺失时退回步骤标题（兼容旧数据） */
const question = computed(() => String(currentStep.value?.confirmation_question || "").trim()
  || String(currentStep.value?.title || "").trim());
const confirmText = computed(() => String(currentStep.value?.confirm_text || "").trim());
/** 末尾输入框的 placeholder */
const questionText = computed(() => String(currentStep.value?.question_text || "").trim());
/** 输入框有内容，「发送」按钮才是可用态 */
const canSubmitText = computed(() => Boolean(draftText.value.trim()));
const photoText = computed(() => String(currentStep.value?.photo_text || "").trim());

watch(() => props.visible, (visible) => {
  if (visible) currentIndex.value = 0;
  isSourcePickerOpen.value = false;
});

/** 把步骤标题按「、」拼成下一轮的提问（会话上下文里已有原问题，不再加前缀）。 */
function buildQuery(list: GuideStepItem[]) {
  return list.map(step => String(step.title || "").trim()).filter(Boolean).join("、");
}

function submitQuery(query: string) {
  if (!query) return;
  emit("submit", query);
  emit("update:visible", false);
}

function submitSteps(list: GuideStepItem[]) {
  submitQuery(buildQuery(list));
}

/**
 * 主选项：确认这一步。
 * - 单步（多轮追问）：把这一步发出去换下一轮；
 * - 多步：没到最后一张就翻页（标签右侧 i/n 跟着走）；
 * - 多步的最后一步（如「已经确认，完成本次指导」）：整轮指导结束，直接收起卡片，
 *   不再发对话（早先是把走过的步骤拼成提问回发，现在按产品要求只结束流程）。
 */
function onConfirm() {
  const step = currentStep.value;
  if (!step) return;
  if (!isMultiStep.value) {
    submitSteps([step]);
    return;
  }
  if (!isLastStep.value) {
    currentIndex.value += 1;
    return;
  }
  close();
}

/** 末尾输入框的回车发送：用户自己写的问题原样发出去 */
function onSubmitText() {
  const text = draftText.value.trim();
  if (!text) return;
  draftText.value = "";
  submitQuery(text);
}

/**
 * 附件按钮：容器内原生选择器自带「拍照 / 相册 / 文件」弹窗，直接用原生弹窗；
 * H5 弹同款三选项弹窗（与输入栏「+」共用一个组件）。选完由页面选文件并发送，
 * 这里不关卡片——用户取消时还能改选别的。
 *
 * 从点击到这里弹出弹窗要等 bridge 注入判断（最长 2 秒），期间先用中间蒙层挡住整页，
 * 防止用户以为没反应而重复点其它选项；弹窗一出现就撤掉蒙层，由弹窗自己的遮罩接管。
 */
async function onPhoto() {
  if (!currentStep.value || isPreparingAttachment.value) return;
  isPreparingAttachment.value = true;
  try {
    if (await isNativeAttachmentPickerAvailable()) {
      emit("photo", "native");
      return;
    }
    // 先开弹窗（它的遮罩立即生效），再在 finally 里撤掉中间蒙层，避免出现无遮挡的空档
    isSourcePickerOpen.value = true;
  } finally {
    isPreparingAttachment.value = false;
  }
}

function onPickAttachmentSource(source: "camera" | "album" | "file") {
  isSourcePickerOpen.value = false;
  emit("photo", source);
}

function close() {
  emit("update:visible", false);
}

/**
 * 卡片高度会随当前步骤的文案变化，显隐与翻页后都重新量一次交给页面。
 * 收起时回 0，页面据此撤掉底部间距。
 */
async function measureHeight() {
  if (!props.visible) {
    emit("height-change", 0);
    return;
  }
  await nextTick();
  uni.createSelectorQuery()
    .select(".guide-step-sheet")
    .boundingClientRect((rect) => {
      const measured = Array.isArray(rect) ? rect[0]?.height : rect?.height;
      emit("height-change", Number(measured) || 0);
    })
    .exec();
}

watch(() => [props.visible, currentIndex.value], () => {
  // 翻页后上一步的输入内容不该跟过来
  draftText.value = "";
  void measureHeight();
  emit("step-change", props.visible ? currentStep.value : null);
});
</script>

<template>
  <view
    v-if="visible && currentStep"
    class="guide-step-sheet"
    :style="keyboardHeight > 0 ? { bottom: `${keyboardHeight}px` } : undefined"
  >
    <view class="guide-step-sheet__header">
      <view class="guide-step-sheet__labels">
        <text class="guide-step-sheet__label">
          {{ cardTitle }}
        </text>
        <text v-if="isMultiStep" class="guide-step-sheet__progress">
          {{ currentIndex + 1 }}/{{ steps.length }}
        </text>
      </view>
      <view class="guide-step-sheet__close" @tap="close">
        <image class="guide-step-sheet__close-icon" :src="closeIcon" mode="aspectFit" />
      </view>
    </view>

    <text v-if="question" class="guide-step-sheet__question">
      {{ question }}
    </text>

    <view class="guide-step-sheet__options">
      <view class="guide-step-sheet__option" @tap="onConfirm">
        <text class="guide-step-sheet__option-label">
          {{ confirmText || currentStep.title }}
        </text>
      </view>
      <view v-if="photoText" class="guide-step-sheet__option" @tap="onPhoto">
        <text class="guide-step-sheet__option-label">
          {{ photoText }}
        </text>
      </view>
      <!-- 其他问题：placeholder 取 steps[].question_text；右侧「发送」图标与键盘回车等效 -->
      <view v-if="questionText" class="guide-step-sheet__input-row">
        <input
          v-model="draftText"
          class="guide-step-sheet__input"
          type="text"
          :placeholder="questionText"
          placeholder-style="color:#999999;"
          confirm-type="send"
          :confirm-hold="true"
          @confirm="onSubmitText"
        />
        <!-- touchstart 先拦一次（输入框聚焦时首点不会被键盘收起吞掉），tap 兜住桌面浏览器鼠标点：
             第一个事件发出后输入内容已清空，第二个事件会直接 return，不会重复发送 -->
        <view
          class="guide-step-sheet__send"
          :class="{ 'guide-step-sheet__send--disabled': !canSubmitText }"
          @touchstart.stop.prevent="onSubmitText"
          @tap="onSubmitText"
        >
          <image class="guide-step-sheet__send-icon" src="@/assets/img/icon-send.svg" mode="aspectFit" />
        </view>
      </view>
    </view>

    <text class="guide-step-sheet__hint">
      内容由AI生成，请核实重要信息
    </text>

    <!-- 选附件期间的中间蒙层：等原生 bridge 判断 / 弹来源弹窗最长要 2 秒，
         这期间挡住整页，避免用户重复点「确认」等按钮；来源弹窗遮罩出现后立刻撤掉 -->
    <view
      v-if="isPreparingAttachment"
      class="guide-step-sheet__mask"
      @touchstart.stop.prevent
      @tap.stop.prevent
    >
      <view class="guide-step-sheet__mask-spinner" />
    </view>

    <!-- 附件来源弹窗：拍照 / 相册 / 文件，与输入栏「+」同一个组件（其遮罩 z-index 更高，接管挡点击） -->
    <AiAttachmentPicker
      v-model:visible="isSourcePickerOpen"
      @pick="onPickAttachmentSource"
    />
  </view>
</template>

<style lang="scss" scoped>
/* 直角白板贴底，只留向上阴影；safe-area 留给底部 home indicator */
.guide-step-sheet {
  position: fixed;
  z-index: 1002;
  right: 0;
  bottom: 0;
  left: 0;
  border-radius: 22px 22px 0 0;
  box-sizing: border-box;
  padding: 42rpx 80rpx 24rpx;
  padding-bottom: calc(24rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
  background: #ffffff;
  box-shadow: 0 -4rpx 42rpx rgba(0, 0, 0, 0.06);
}

.guide-step-sheet__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36rpx;
}

/* 标签 + 进度同一行，进度紧跟标签右侧；× 固定在最右 */
.guide-step-sheet__labels {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
}

.guide-step-sheet__label {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 36rpx;
  color: #666666;
}

.guide-step-sheet__progress {
  flex-shrink: 0;
  margin-left: 18rpx;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  line-height: 36rpx;
  color: #999999;
}

.guide-step-sheet__close {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 48rpx;
  height: 36rpx;
  margin-right: -12rpx;
}

.guide-step-sheet__close-icon {
  width: 36rpx;
  height: 36rpx;
}

/* 问题行：steps[].confirmation_question */
.guide-step-sheet__question {
  display: block;
  margin-top: 32rpx;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
  color: #1a1a1e;
}

.guide-step-sheet__options {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 32rpx;
}

.guide-step-sheet__option {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  min-height: 72rpx;
  padding: 16rpx 32rpx;
  border-radius: 16rpx;
  background: #f6f6f6;
}

.guide-step-sheet__option-label {
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
  color: #000000;
}

/* 末尾输入行：整个容器就是输入框（与上方选项行同宽同款：#f6f6f6 / 16rpx 圆角 / 72rpx 高），
   发送图标包在框内右侧，左内边距与选项行文字对齐 */
.guide-step-sheet__input-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  box-sizing: border-box;
  min-height: 72rpx;
  padding: 0 16rpx 0 32rpx;
  border-radius: 16rpx;
  background: #f6f6f6;
}

/* 末尾输入框：只负责输入，外观由外层容器给，placeholder 取 steps[].question_text */
.guide-step-sheet__input {
  display: block;
  flex: 1 1 auto;
  box-sizing: border-box;
  min-width: 0;
  padding: 0;
  background: transparent;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
  color: #000000;
}

/* 发送图标：与原生输入栏 input-bar__send 同款（icon-send.svg，图标自带底色，不再加按钮底色） */
.guide-step-sheet__send {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 56rpx;
  height: 56rpx;
}

.guide-step-sheet__send:active {
  opacity: 0.7;
}

/* 未输入内容：图标置灰（点了也不会发），位置保留避免输入框宽窄跳动 */
.guide-step-sheet__send--disabled {
  opacity: 0.4;
}

.guide-step-sheet__send-icon {
  width: 56rpx;
  height: 56rpx;
}

.guide-step-sheet__hint {
  display: block;
  margin-top: 24rpx;
  text-align: center;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 30rpx;
  color: #bababa;
}

/* 选附件期间的中间蒙层：底色与来源弹窗遮罩一致，弹窗弹出时视觉上无缝衔接 */
.guide-step-sheet__mask {
  position: fixed;
  z-index: 1005;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}

/* 转圈：纯 CSS，不引额外资源 */
.guide-step-sheet__mask-spinner {
  width: 56rpx;
  height: 56rpx;
  border: 6rpx solid rgba(255, 255, 255, 0.3);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: guide-step-sheet-spin 0.8s linear infinite;
}

@keyframes guide-step-sheet-spin {
  to { transform: rotate(360deg); }
}
</style>

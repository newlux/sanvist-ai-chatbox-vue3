<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from "vue";

/**
 * 底部「回答卡片」：仿设计稿「开始匹配工况 / 追问半径」面板（2667:2674 等帧）。
 * 以全宽浮层盖住输入栏，不属于任何气泡。结构自上而下：
 * - 头部行：步骤标题（灰）+ 步骤计数（灰）+ 右侧关闭按钮；
 * - 副标题：AI 反问的问题（黑、Medium）；
 * - 选项列表：普通选项为灰底方条（圆角 0，见设计 Rectangle 24），点击即发送文本；
 *   输入型选项（如「其他半径」）静止态与普通选项同款灰条但文字为次级灰 #666，
 *   点击后在原位展开成输入框（占位同文案）+ 右侧发送箭头；
 *   选项中可带 active（黑底白字，设计稿中表示已点选，如 18M）；
 * - 底部居中安全提示（12px 灰 #BABABA）。
 *
 * payload 结构（透传 suggestion 块 payload）：
 * - title?: 步骤标题（如「开始匹配工况」）
 * - step?:  步骤计数（如「1/3」）
 * - subtitle?: 副标题问题
 * - items: [{ text 或 {type:"input", text, placeholder}, active? }]
 */
defineOptions({ name: "AiReplyCard" });

const props = defineProps({
  payload: { type: Object, default: () => ({}) },
});
const emit = defineEmits(["submit", "close", "height-change"]);

const DEFAULT_PLACEHOLDER = "请输入，回车或点箭头发送";

interface ReplyOption {
  id?: string | number;
  text?: string;
  label?: string;
  /** "input" 表示该项为可输入的补充框（如「其他半径」） */
  type?: string;
  input?: boolean;
  placeholder?: string;
  /** 默认选中态（黑底白字），如设计稿中的 18M */
  active?: boolean;
}

const title = computed(() => String(props.payload?.title || props.payload?.header || ""));
const step = computed(() => (props.payload?.step != null ? String(props.payload.step) : ""));
const subtitle = computed(() =>
  String(props.payload?.subtitle || props.payload?.question || ""),
);
const options = computed<ReplyOption[]>(() =>
  Array.isArray(props.payload?.items) ? props.payload.items : [],
);

function isInputOption(option: ReplyOption | null | undefined): boolean {
  return Boolean(option && (option.type === "input" || option.input === true));
}
function isActiveOption(option: ReplyOption | null | undefined): boolean {
  return Boolean(option?.active);
}
function optionKey(option: ReplyOption | null, index: number) {
  return option && option.id != null ? option.id : index;
}
function optionText(option: ReplyOption | null | undefined) {
  return String(option?.text || option?.label || "");
}
function optionPlaceholder(option: ReplyOption | null | undefined) {
  return String(option?.placeholder || optionText(option) || DEFAULT_PLACEHOLDER);
}

/** 输入型选项：静止为灰字方条，点击后在原位展开成输入框（一次仅展开一项） */
const editingIndex = ref<number | null>(null);
/** 展开后请求聚焦的选项下标，@focus 触发后复位，避免 focus prop 循环触发 */
const focusPendingIndex = ref<number | null>(null);
const inputValues = reactive<Record<string, string>>({});

function inputValueOf(option: ReplyOption | null, index: number) {
  const key = String(optionKey(option, index));
  return (inputValues[key] ||= "");
}

function onOptionTap(option: ReplyOption | null, index: number) {
  if (!isInputOption(option)) {
    // 选择普通选项时收起当前展开的输入框
    editingIndex.value = null;
    focusPendingIndex.value = null;
    emit("submit", optionText(option));
    return;
  }
  if (editingIndex.value === index) return; // 输入中：点击不收起，避免误触丢焦点
  editingIndex.value = index;
  focusPendingIndex.value = index;
}

function onInputChange(index: number, event: { detail?: { value?: string } }) {
  inputValues[String(optionKey(options.value[index], index))] = String(event?.detail?.value ?? "");
}

/** 点右侧箭头 / 键盘发送键：把输入内容作为下一条问题提交，随后收起并清空 */
function submitInput(index: number) {
  const text = inputValueOf(options.value[index], index).trim();
  if (!text) return;
  emit("submit", text);
  inputValues[String(optionKey(options.value[index], index))] = "";
  editingIndex.value = null;
  focusPendingIndex.value = null;
}


// 卡片固定盖在输入栏上，把自身高度上报给页面，由页面垫高消息列表底部，
// 避免最后几条消息被浮层挡住
onMounted(async () => {
  await nextTick();
  uni
    .createSelectorQuery()
    .select("#ai-reply-card")
    .boundingClientRect((rect) => {
      const height = Array.isArray(rect) ? rect[0]?.height : rect?.height;
      if (height) emit("height-change", Number(height));
    })
    .exec();
});

/**
 * 输入型选项输入时键盘会把卡片底部盖住：键盘高度回来时整卡上浮。
 * 小程序端走 onKeyboardHeightChange；H5 视口会随键盘收缩，无需处理。
 */
const keyboardHeight = ref(0);
function onKeyboardHeightChange(res: { height?: number }) {
  keyboardHeight.value = Number(res?.height) || 0;
}

// 存在输入型选项即存在输入框，卡片需随键盘上浮
const hasInputOptions = computed(() => options.value.some(isInputOption));
const cardBottomStyle = computed(() => {
  if (hasInputOptions.value && keyboardHeight.value > 0) {
    return { bottom: `${keyboardHeight.value}px` };
  }
  return {};
});

onMounted(() => {
  if (typeof uni.onKeyboardHeightChange === "function") {
    uni.onKeyboardHeightChange(onKeyboardHeightChange);
  }
});
onUnmounted(() => {
  if (typeof uni.offKeyboardHeightChange === "function") {
    uni.offKeyboardHeightChange(onKeyboardHeightChange);
  }
});
</script>

<template>
  <view id="ai-reply-card" class="ai-reply-card" :style="cardBottomStyle" @touchmove.stop.prevent>
    <!-- 头部行：步骤标题（灰）+ 计数 + 右侧关闭 -->
    <view class="ai-reply-card__header">
      <view class="ai-reply-card__header-titles">
        <text v-if="title" class="ai-reply-card__eyebrow">
          {{ title }}
        </text>
        <text v-if="step" class="ai-reply-card__step">
          {{ step }}
        </text>
      </view>
      <view class="ai-reply-card__close" @tap.stop="emit('close')">
        <image
          src="@/assets/img/icon-close.svg"
          mode="aspectFit"
          class="ai-reply-card__close-img"
        />
      </view>
    </view>

    <!-- 副标题：AI 追问的问题 -->
    <text v-if="subtitle" class="ai-reply-card__subtitle">
      {{ subtitle }}
    </text>

    <!-- 选项列表：灰底方条，点击即发送；active 为已点选（黑底白字） -->
    <view class="ai-reply-card__list">
      <template v-for="(option, index) in options" :key="optionKey(option, index)">
        <!-- 普通选项 -->
        <view
          v-if="!isInputOption(option)"
          class="ai-reply-card__row"
          :class="{ 'ai-reply-card__row--active': isActiveOption(option) }"
          @tap.stop="onOptionTap(option, index)"
        >
          <text class="ai-reply-card__text" :class="{ 'ai-reply-card__text--on-active': isActiveOption(option) }">
            {{ optionText(option) }}
          </text>
        </view>

        <!-- 输入型选项：静止为灰字方条，点击展开为输入框 + 发送箭头 -->
        <view
          v-else
          class="ai-reply-card__row"
          :class="{
            'ai-reply-card__row--editing': editingIndex === index,
            'ai-reply-card__row--secondary': editingIndex !== index,
          }"
          @tap.stop="onOptionTap(option, index)"
        >
          <template v-if="editingIndex === index">
            <input
              class="ai-reply-card__input"
              :value="inputValueOf(option, index)"
              :placeholder="optionPlaceholder(option)"
              placeholder-class="ai-reply-card__input-placeholder"
              :focus="focusPendingIndex === index"
              :adjust-position="false"
              confirm-type="send"
              @focus="focusPendingIndex = null"
              @input="onInputChange(index, $event)"
              @confirm="submitInput(index)"
            />
            <view
              class="ai-reply-card__send"
              :class="{ 'ai-reply-card__send--disabled': !inputValueOf(option, index).trim() }"
              @tap.stop="submitInput(index)"
            >
              <image src="@/assets/img/icon-send.svg" mode="aspectFit" class="ai-reply-card__send-img" />
            </view>
          </template>
          <text v-else class="ai-reply-card__text">
            {{ optionText(option) }}
          </text>
        </view>
      </template>
    </view>

    <!-- 底部安全提示 -->
    <text class="ai-reply-card__disclaimer">
      内容由AI生成，请核实重要信息
    </text>
  </view>
</template>

<style lang="scss" scoped>
.ai-reply-card {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 26;
  box-sizing: border-box;
  padding: 34rpx 80rpx calc(40rpx + env(safe-area-inset-bottom));
  background: #ffffff;
  border-radius: 40rpx 40rpx 0 0;
  box-shadow: 0 -6rpx 42rpx rgba(0, 0, 0, 0.06);
}

// 头部行：灰标题 + 计数靠左，关闭按钮靠右
.ai-reply-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48rpx;
}
.ai-reply-card__header-titles {
  display: flex;
  align-items: center;
  gap: 24rpx;
  min-width: 0;
}
.ai-reply-card__eyebrow {
  flex-shrink: 0;
  color: #999999;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
}
.ai-reply-card__step {
  flex-shrink: 0;
  color: #999999;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
}
.ai-reply-card__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52rpx;
  height: 48rpx;
}
.ai-reply-card__close-img {
  display: block;
  width: 40rpx;
  height: 40rpx;
  opacity: 0.5;
}

// 副标题问题：设计稿 14px Medium 黑（2667:2674 Status Label）
.ai-reply-card__subtitle {
  display: block;
  margin-top: 20rpx;
  color: #1a1a1e;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
}

// 选项列表
.ai-reply-card__list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 16rpx;
}
// 选项条：设计稿 Rectangle 24 圆角灰条，高 36px（截图核对圆角约 16rpx）
.ai-reply-card__row {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: 72rpx;
  padding: 0 24rpx;
  background: #f6f6f6;
  border-radius: 16rpx;
}
.ai-reply-card__row--active {
  background: #2f2b2b;
}
// 输入型选项（其他输入）静止态：文字用次级灰 #666 提示可点击展开
.ai-reply-card__row--secondary .ai-reply-card__text {
  color: #666666;
}
.ai-reply-card__row--editing {
  gap: 12rpx;
  padding-right: 10rpx;
  background: #f6f6f6;
  border-radius: 16rpx;
}
.ai-reply-card__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #000000;
  font-size: 28rpx;
  line-height: 40rpx;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.ai-reply-card__text--on-active {
  color: #ffffff;
}
.ai-reply-card__input {
  flex: 1;
  min-width: 0;
  height: 72rpx;
  color: #000000;
  font-size: 28rpx;
  line-height: 72rpx;
}
.ai-reply-card__input-placeholder {
  color: #666666;
  font-size: 28rpx;
}
.ai-reply-card__send {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52rpx;
  height: 52rpx;
  border-radius: 50%;
}
.ai-reply-card__send-img {
  display: block;
  width: 52rpx;
  height: 52rpx;
}
.ai-reply-card__send--disabled {
  opacity: 0.4;
  pointer-events: none;
}

// 底部安全提示
.ai-reply-card__disclaimer {
  display: block;
  margin-top: 32rpx;
  color: #bababa;
  font-size: 24rpx;
  line-height: 34rpx;
  text-align: center;
}
</style>

<script setup lang="ts">
import { computed, inject, reactive } from "vue";
import { stripOptionPrefix } from "@/utils/option-label";

defineOptions({ name: "SuggestionBlock" });

const props = defineProps({
  payload: { type: Object, default: () => ({}) },
});
const emit = defineEmits(["suggestion-tap"]);

/** 深色：跟随 AI 气泡主题（与 GuideSuggestionBlock / AskSlotBlock 同一套取法） */
const darkContainer = inject("ai-bubble-dark", computed(() => false));
const isDark = computed(() => Boolean(darkContainer?.value));

const DEFAULT_PLACEHOLDER = "其他情况，请补充描述";

interface SuggestionItem {
  id?: string | number;
  text?: string;
  label?: string;
  /** "input" 表示该项不是固定选项，而是一个可输入的补充框（如「其他 + 内容」） */
  type?: string;
  input?: boolean;
  placeholder?: string;
}

const items = computed<SuggestionItem[]>(() =>
  Array.isArray(props.payload?.items) ? props.payload.items : [],
);

function isInputItem(item: SuggestionItem | null | undefined): boolean {
  return Boolean(item && (item.type === "input" || item.input === true));
}
function itemKey(item: SuggestionItem | null, index: number) {
  return item && item.id != null ? item.id : index;
}
/** 选项序号：A / B / C…（与「身份选择」那组胶囊同一套写法） */
function optionLetter(index: number) {
  return String.fromCharCode(65 + index);
}
/** 文案：剥掉后端可能自带的「A |」序号，避免和前面渲染的字母重复 */
function itemText(item: SuggestionItem | null | undefined) {
  return stripOptionPrefix(String(item?.text || item?.label || ""));
}
function itemPlaceholder(item: SuggestionItem | null | undefined) {
  return String(item?.placeholder || itemText(item) || DEFAULT_PLACEHOLDER);
}

/**
 * 输入型选项的内部状态（按下标隔离，允许多个输入项并存）：
 * active=true 时展开为输入框 + 右侧发送箭头；失焦且无内容时收回成占位行。
 */
const inputStates = reactive<Record<number, { active: boolean; value: string }>>({});

function inputStateOf(index: number) {
  return (inputStates[index] ||= { active: false, value: "" });
}
function isEditing(index: number) {
  return Boolean(inputStates[index]?.active);
}

function onItemTap(item: SuggestionItem | null, index: number) {
  // 普通选项：点击即把选项文本作为下一条问题发送（与原有行为一致）
  if (!isInputItem(item)) {
    emit("suggestion-tap", itemText(item));
    return;
  }
  // 输入型选项：进入编辑态（input 以 v-if 重新挂载并 focus=true，自动唤起键盘）
  inputStateOf(index).active = true;
}

function onInputChange(index: number, event: { detail?: { value?: string } }) {
  inputStateOf(index).value = String(event?.detail?.value ?? "");
}

function onInputBlur(index: number) {
  const state = inputStates[index];
  // 没有任何输入时收回占位外观，避免留下一个空输入框
  if (state && !state.value.trim()) state.active = false;
}

function onInputConfirm(index: number) {
  submitInput(index);
}

/** 点右侧箭头发送：把输入内容作为下一条问题发出去，随后复位成占位行 */
function submitInput(index: number) {
  const state = inputStates[index];
  if (!state) return;
  const text = state.value.trim();
  if (!text) return;
  emit("suggestion-tap", text);
  state.value = "";
  state.active = false;
}
</script>

<template>
  <view v-if="items.length" class="suggestion-block" :class="{ 'suggestion-block--dark': isDark }">
    <template v-for="(item, index) in items" :key="itemKey(item, index)">
      <!-- 普通选项：与「身份选择」那组胶囊（GuideSuggestionBlock）同款 A｜文案，点击即发送 -->
      <view
        v-if="!isInputItem(item)"
        class="suggestion-block__item"
        @tap.stop="onItemTap(item, index)"
      >
        <text class="suggestion-block__letter">
          {{ optionLetter(index) }}
        </text>
        <view class="suggestion-block__divider" />
        <text class="suggestion-block__text">
          {{ itemText(item) }}
        </text>
      </view>

      <!-- 输入型选项 · 占位外观（如「其他 + 内容」，点击后输入）：与追问卡的「其他输入」同一套胶囊 -->
      <view
        v-else-if="!isEditing(index)"
        class="suggestion-block__item suggestion-block__item--input"
        @tap.stop="onItemTap(item, index)"
      >
        <text class="suggestion-block__text suggestion-block__text--placeholder">
          {{ itemPlaceholder(item) }}
        </text>
      </view>

      <!-- 输入型选项 · 编辑态：输入框 + 右侧发送箭头 -->
      <view
        v-else
        class="suggestion-block__item suggestion-block__item--editing"
        @tap.stop
      >
        <input
          class="suggestion-block__input"
          :value="inputStateOf(index).value"
          :placeholder="itemPlaceholder(item)"
          placeholder-class="suggestion-block__input-placeholder"
          :focus="true"
          :adjust-position="true"
          confirm-type="send"
          @input="onInputChange(index, $event)"
          @blur="onInputBlur(index)"
          @confirm="onInputConfirm(index)"
        >
        <view
          class="suggestion-block__send"
          :class="{
            'suggestion-block__send--disabled': !inputStateOf(index).value.trim(),
          }"
          @tap.stop="submitInput(index)"
        >
          <image src="@/assets/img/icon-send.svg" mode="aspectFit" class="suggestion-block__send-img" />
        </view>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
/* 追问 / 推荐问题胶囊：与「身份选择」那组胶囊（GuideSuggestionBlock，老板 / 设备管理员 / 操作手）
   同一套材质 —— 白底 + 1px #E6E6E6 描边 + 全圆角（999rpx），左侧 A｜文案，
   纵向排列、左对齐、间距 10px */
.suggestion-block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 20rpx; /* 10px：胶囊之间 */
  background: transparent;
}

.suggestion-block__item {
  display: flex;
  align-items: center;
  align-self: flex-start;
  box-sizing: border-box;
  max-width: 100%;
  padding: 18rpx 28rpx;
  border: 1px solid #e6e6e6;
  border-radius: 999rpx; /* 真胶囊：左右两端半圆 */
  background: #ffffff;
}

.suggestion-block__item:active {
  opacity: 0.7;
}

/* 输入型选项展开成整行胶囊：端头仍按胶囊留白，右侧留给发送箭头 */
.suggestion-block__item--editing {
  align-self: stretch;
  width: 100%;
  padding: 8rpx 12rpx 8rpx 28rpx;
  box-shadow: none;
}

/* 序号：A / B / C… 与身份选择胶囊逐项对齐 */
.suggestion-block__letter {
  flex-shrink: 0;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 40rpx;
  color: #1a1a1a;
}

/* 字母与文案之间的细分隔线（设计稿里的「A｜」） */
.suggestion-block__divider {
  flex-shrink: 0;
  width: 1px;
  height: 26rpx;
  margin: 0 16rpx;
  background: #dcdcdc;
}

.suggestion-block__text {
  min-width: 0;
  color: #1a1a1a;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
  white-space: normal;
  word-break: break-word;
}

.suggestion-block__text--placeholder {
  color: #666666;
}

.suggestion-block__input {
  flex: 1;
  min-width: 0;
  height: 56rpx;
  color: #1a1a1a;
  font-size: 28rpx;
  line-height: 56rpx;
}

.suggestion-block__input-placeholder {
  color: #666666;
  font-size: 28rpx;
}

.suggestion-block__send {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
}

.suggestion-block__send-img {
  width: 56rpx;
  height: 56rpx;
  display: block;
}

.suggestion-block__send--disabled {
  opacity: 0.4;
  pointer-events: none;
}

/* ===== 深色：与身份选择胶囊（GuideSuggestionBlock）同一套材质（块底 6% 白、正文 #E5E5E5） ===== */
.suggestion-block--dark {
  /* 描边走 1px 内描边线性渐变 #5A5A5A → #F7F7F7 → #5A5A5A：
     原生 border 只能单色，这里把 border 留作占位（透明），再用「渐变底 + mask 挖掉内容区」画 1px 环 */
  .suggestion-block__item {
    position: relative;
    border-color: transparent;
    background: rgba(255, 255, 255, 0.06);
  }

  .suggestion-block__item::before {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    padding: 1px;
    border-radius: 999rpx; /* 与胶囊半圆端一致 */
    background: linear-gradient(135deg, #5a5a5a 0%, #f7f7f7 50%, #5a5a5a 100%);
    content: "";
    pointer-events: none;
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
  }

  .suggestion-block__letter,
  .suggestion-block__text {
    color: #e5e5e5;
  }

  .suggestion-block__text--placeholder,
  .suggestion-block__input-placeholder {
    color: rgba(255, 255, 255, 0.45);
  }

  .suggestion-block__divider {
    background: rgba(255, 255, 255, 0.2);
  }

  .suggestion-block__input {
    color: #e5e5e5;
  }
}
</style>

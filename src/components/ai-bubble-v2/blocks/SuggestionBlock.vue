<script setup lang="ts">
import { computed, reactive } from "vue";

defineOptions({ name: "SuggestionBlock" });

const props = defineProps({
  payload: { type: Object, default: () => ({}) },
});
const emit = defineEmits(["suggestion-tap"]);

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
function itemText(item: SuggestionItem | null | undefined) {
  return String(item?.text || item?.label || "");
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
  <view v-if="items.length" class="suggestion-block">
    <template v-for="(item, index) in items" :key="itemKey(item, index)">
      <!-- 普通选项：点击即发送 -->
      <view
        v-if="!isInputItem(item)"
        class="suggestion-block__item"
        @tap.stop="onItemTap(item, index)"
      >
        <text class="suggestion-block__text">
          {{ itemText(item) }}
        </text>
      </view>

      <!-- 输入型选项 · 占位外观（如「其他 + 内容」，点击后输入） -->
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
.suggestion-block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16rpx;
  background: transparent;
}
.suggestion-block__item {
  display: flex;
  align-items: center;
  align-self: flex-start;
  width: fit-content;
  max-width: 100%;
  box-sizing: border-box;
  padding: 16rpx 24rpx;
  border: 1rpx solid #e3e3e3;
  border-radius: 16rpx;
  background: #ffffff;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.06);
}
.suggestion-block__item:active {
  background: #f7f7f7;
}
.suggestion-block__item--input {
  background: #ffffff;
}
.suggestion-block__item--editing {
  align-self: stretch;
  width: 100%;
  padding: 8rpx 12rpx 8rpx 24rpx;
  border: 2rpx solid #c8201e;
  background: #ffffff;
  box-shadow: none;
}
.suggestion-block__text {
  color: #333333;
  font-size: 28rpx;
  line-height: 40rpx;
  word-break: break-word;
}
.suggestion-block__text--placeholder {
  color: #b9bec7;
}
.suggestion-block__input {
  flex: 1;
  min-width: 0;
  height: 56rpx;
  color: #1a1a1a;
  font-size: 24rpx;
  line-height: 56rpx;
}
.suggestion-block__input-placeholder {
  color: #b9bec7;
  font-size: 24rpx;
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
</style>

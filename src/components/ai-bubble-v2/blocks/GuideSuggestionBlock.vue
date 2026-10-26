<script setup lang="ts">
import type { GuideSuggestionPayload } from "@/api/chat/types";
import { computed, onMounted, ref } from "vue";

defineOptions({ name: "GuideSuggestionBlock" });

const props = defineProps({
  payload: { type: Object as () => GuideSuggestionPayload, required: true },
});

const emit = defineEmits<{
  /** auto=true 表示卡片自动弹起，由页面决定延时；手动点击 auto=false */
  open: [payload: GuideSuggestionPayload, auto: boolean];
}>();

const options = computed(() => (Array.isArray(props.payload?.options) ? props.payload.options : []));
/** 纯文本展示问题本身；选项卡与「其他入口」输入框都在追问卡弹层里 */
const title = computed(() => String(props.payload?.question || "").trim()
  || String(props.payload?.note || "").trim()
  || "请选择");

const hasOpened = ref(false);

/**
 * 新消息里的追问卡自动弹起；历史消息点一下文本再打开。
 * 延时不能挂在这里：生成结束时气泡正文会被整体卸载（见 ai-bubble-v2 的 hideBody），
 * 定时器会跟着组件一起销毁，所以计时统一交给页面层。
 */
onMounted(() => {
  if (hasOpened.value || props.payload?.auto_open !== true || !options.value.length) return;
  hasOpened.value = true;
  emit("open", props.payload, true);
});

function open() {
  if (!options.value.length) return;
  hasOpened.value = true;
  emit("open", props.payload, false);
}
</script>

<template>
  <text v-if="options.length" class="guide-suggestion-block" @tap.stop="open">
    {{ title }}
  </text>
</template>

<style lang="scss" scoped>
/* 纯文本：不带卡片底纹与箭头，点文本仍能唤起追问卡 */
.guide-suggestion-block {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-top: 16rpx;
  font-family: "PingFang SC", sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 44rpx;
  color: #1a1a1a;
}
</style>

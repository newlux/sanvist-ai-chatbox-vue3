<script setup lang="ts">
import type { Ref } from "vue";
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import MarkdownRenderer from "@/components/markdown-renderer/index.vue";

defineOptions({ name: "VoiceBlock" });

const props = defineProps({
  payload: { type: Object, default: () => ({}) },
  embedded: { type: Boolean, default: false },
});

const text = computed(() => String(props.payload?.text || "").trim());

/**
 * 导语（`<COMPONENT type="voice">` 的正文）**不接打字机**：一行开场白，整句出现即可。
 * 逐字揭示只给真正的回答正文（AnswerBlock / GuideCheckBlock 的正文与小结），
 * 导语跟着逐字反而把「开场白 → 正文」的层次糊在一起。
 *
 * 但它要占用一段「展示时长」：导语后面常常紧跟选项（追问卡 / 推荐问题），
 * 两者同一帧挂载的话，用户还没读完导语，选项已经摆好了。这里在整段显示的同时
 * 往气泡的「正文展示中」计数里挂一个计时（按字数估 35ms/字，夹在 0.5s~2s），
 * 计时结束前选项不出现 —— 效果就是「导语先整段出来，停一拍，选项再淡入」。
 *
 * 只在本轮新生成（气泡 provide 了 ai-bubble-typewriter 且为 true）时计时；
 * 历史回看整段直出、选项立即显示，不会莫名多等。
 */
const PRESENT_CHAR_MS = 35;
const PRESENT_MIN_MS = 500;
const PRESENT_MAX_MS = 2000;

const typewriterOn = inject<Ref<boolean> | null>("ai-bubble-typewriter", null);
const presentingReporter = inject<Ref<number> | null>("ai-bubble-answer-typing", null);
const presenting = ref(false);
let presentTimer: ReturnType<typeof setTimeout> | null = null;

function releasePresenting() {
  if (presentTimer) {
    clearTimeout(presentTimer);
    presentTimer = null;
  }
  if (!presenting.value) return;
  presenting.value = false;
  if (presentingReporter) presentingReporter.value = Math.max(0, presentingReporter.value - 1);
}

function startPresenting() {
  const value = text.value;
  // 没拿到计数（听播 / 分享海报等）或不是本轮新生成：不需要给别人让节奏
  if (!presentingReporter || !typewriterOn?.value || !value) return;
  releasePresenting();
  const duration = Math.min(PRESENT_MAX_MS, Math.max(PRESENT_MIN_MS, value.length * PRESENT_CHAR_MS));
  presenting.value = true;
  presentingReporter.value += 1;
  presentTimer = setTimeout(releasePresenting, duration);
}

watch(
  () => [text.value, Boolean(typewriterOn?.value)] as const,
  () => startPresenting(),
  { immediate: true },
);

onBeforeUnmount(releasePresenting);
</script>

<template>
  <view class="voice-block" :class="{ 'voice-block--embedded': embedded }">
    <MarkdownRenderer :content="text" />
  </view>
</template>

<style lang="scss" scoped>
/**
 * 老师傅导语（voice 块）：一句普通正文，显示在回答内容顶部。
 * 与回答正文（answer-block）同一套排版：直接铺在页面上，不给灰底 / 圆角 / 内边距。
 */
.voice-block {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  background: transparent;
  border-radius: 0;
  padding: 0;
}
</style>

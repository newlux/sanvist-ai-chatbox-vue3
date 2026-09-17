<script setup lang="ts">
import type { GuideStepPayload } from "@/api/chat/types";
import { computed, onMounted, ref } from "vue";

defineOptions({ name: "GuideStepBlock" });

const props = defineProps({
  payload: { type: Object as () => GuideStepPayload, required: true },
});

const emit = defineEmits<{
  open: [payload: GuideStepPayload];
}>();

const steps = computed(() => (Array.isArray(props.payload?.steps) ? props.payload.steps : []));
const title = computed(() => String(props.payload?.title || "").trim() || "操作步骤");
const subtitle = computed(() => (steps.value.length > 1 ? `共 ${steps.value.length} 个步骤` : "继续追问"));

const hasOpened = ref(false);

/** 新消息里的步骤卡片自动弹起；历史消息只留入口，点一下再打开。 */
onMounted(() => {
  if (hasOpened.value || props.payload?.auto_open !== true || !steps.value.length) return;
  hasOpened.value = true;
  emit("open", props.payload);
});

function open() {
  if (!steps.value.length) return;
  hasOpened.value = true;
  emit("open", props.payload);
}
</script>

<template>
  <view v-if="steps.length" class="guide-step-block" @tap.stop="open">
    <view class="guide-step-block__main">
      <text class="guide-step-block__title">
        {{ title }}
      </text>
      <text class="guide-step-block__subtitle">
        {{ subtitle }}
      </text>
    </view>
    <text class="guide-step-block__arrow">
      ›
    </text>
  </view>
</template>

<style lang="scss" scoped>
.guide-step-block {
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
  width: 100%;
  padding: 24rpx 32rpx;
  margin-top: 24rpx;
  border: 1rpx solid #eeeeee;
  border-radius: 20rpx;
  background: #fafafa;
}

.guide-step-block__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.guide-step-block__title {
  font-family: "PingFang SC", sans-serif;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
  color: #1a1a1a;
}

.guide-step-block__subtitle {
  margin-top: 4rpx;
  font-family: "PingFang SC", sans-serif;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 34rpx;
  color: #999999;
}

.guide-step-block__arrow {
  flex-shrink: 0;
  margin-left: 16rpx;
  font-size: 36rpx;
  line-height: 40rpx;
  color: #cccccc;
}
</style>

<script setup lang="ts">
import type { Ref } from "vue";
import type { GuideStepPayload } from "@/api/chat/types";
import { computed, inject, onMounted, ref, unref } from "vue";

defineOptions({ name: "GuideStepBlock" });

const props = defineProps({
  payload: { type: Object as () => GuideStepPayload, required: true },
});

const emit = defineEmits<{
  /** auto=true 表示卡片自动弹起，由页面决定延时；手动点击 auto=false */
  open: [payload: GuideStepPayload, auto: boolean];
}>();
/** 深色：这张卡在气泡内渲染，跟随气泡 provide 的主题（与 GuideLeadBlock 同一套取法） */
const bubbleDark = inject<Ref<boolean> | null>("ai-bubble-dark", null);
const isDark = computed(() => Boolean(bubbleDark ? unref(bubbleDark) : false));
/** PC 车机版：用 px 覆盖字号 / 圆角 / 内边距（默认关） */
const bubblePc = inject<Ref<boolean> | null>("ai-bubble-pc", null);
const isPc = computed(() => Boolean(bubblePc ? unref(bubblePc) : false));

const steps = computed(() => (Array.isArray(props.payload?.steps) ? props.payload.steps : []));
const title = computed(() => String(props.payload?.title || "").trim() || "操作步骤");
const subtitle = computed(() => (steps.value.length > 1 ? `共 ${steps.value.length} 个步骤` : "继续追问"));

const hasOpened = ref(false);

/**
 * 新消息里的步骤卡片自动弹起；历史消息只留入口，点一下再打开。
 * 延时不能挂在这里：生成结束时气泡正文会被整体卸载（见 ai-bubble-v2 的 hideBody），
 * 定时器会跟着组件一起销毁，所以计时统一交给页面层。
 */
onMounted(() => {
  if (hasOpened.value || props.payload?.auto_open !== true || !steps.value.length) return;
  hasOpened.value = true;
  emit("open", props.payload, true);
});

function open() {
  if (!steps.value.length) return;
  hasOpened.value = true;
  emit("open", props.payload, false);
}
</script>

<template>
  <view
    v-if="steps.length"
    class="guide-step-block"
    :class="{ 'guide-step-block--dark': isDark, 'guide-step-block--pc': isPc }"
    @tap.stop="open"
  >
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

/* ===== 深色：与其它块同一套材质（正文 #E5E5E5、次要 45% 白、块底 6% 白） ===== */
.guide-step-block--dark {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);

  .guide-step-block__title {
    color: #fff;
  }

  .guide-step-block__subtitle {
    color: rgba(255, 255, 255, 0.45);
  }

  .guide-step-block__arrow {
    color: rgba(255, 255, 255, 0.3);
  }
}

/* ===== PC 车机版：px 覆盖 ===== */
.guide-step-block--pc {
  padding: 18px 24px;
  margin-top: 18px;
  border-radius: 16px;
  .guide-step-block__title {
    font-size: 28px;
    line-height: 38px;
  }
  .guide-step-block__subtitle {
    font-size: 24px;
    line-height: 32px;
  }
  .guide-step-block__arrow {
    font-size: 32px;
  }
}
</style>

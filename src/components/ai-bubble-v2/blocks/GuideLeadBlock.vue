<script setup lang="ts">
import type { Ref } from "vue";
import { computed, inject, ref, watch } from "vue";
import { useTypewriter } from "@/hooks/useTypewriter";

defineOptions({ name: "GuideLeadBlock" });

const props = defineProps({
  payload: { type: Object, default: () => ({}) },
});

const emit = defineEmits<{
  /** 点某一条（如设备型号）就把它当作用户问题发出去，与 suggestion 的交互一致 */
  pick: [text: string];
}>();

/**
 * 深色：跟随 AI 气泡主题（由 ai-bubble-v2 provide），没有 provide 的场景默认浅色。
 * 与 TableBlock / GuideSourceBlock 同一套取法。
 */
const darkContainer = inject("ai-bubble-dark", computed(() => false));
const isDark = computed(() => Boolean(darkContainer?.value));

/** 开场白：协议里带 \n，渲染时按 pre-line 保留换行 */
const text = computed(() => String(props.payload?.text || "").trim());
/** 选项上方的引导语（「可以和我说选择哪个设备（单选）」） */
const leadText = computed(() => String(props.payload?.lead_text || "").trim());
const options = computed(() => (Array.isArray(props.payload?.options) ? props.payload.options : [])
  .map(item => String(item ?? "").trim())
  .filter(Boolean));

/**
 * 开场白逐字 + 选项后置（与回答正文同一套手感）。
 *
 * 这张卡是进页面时的「自我介绍」：正文和选项都在同一个块里、同一帧挂载，
 * 不处理的话一进来就是「一大段话 + 三个选项」同时铺开，用户还没读完正文就能点，
 * 节奏和随后的真实回答（正文逐字 → 选项淡入）也对不上。
 *
 * 开关走气泡 provide 的 ai-bubble-typewriter（页面级开关 && 本轮新生成）：
 * 历史会话回看拿到的是 false，正文整段直出、选项立即显示。
 * 打开后锁存：本轮收尾时开关会翻 false，不锁的话最后一段会被「唰」地整段顶出来。
 */
const typewriterOn = inject<Ref<boolean> | null>("ai-bubble-typewriter", null);
const typewriterLatched = ref(false);
watch(
  () => Boolean(typewriterOn?.value),
  (on) => {
    if (on) typewriterLatched.value = true;
  },
  { immediate: true },
);
const { visible: typedText, typing } = useTypewriter(() => text.value, {
  enabled: () => typewriterLatched.value,
});

function pick(option: string) {
  emit("pick", option);
}
</script>

<template>
  <!--
    开场引导卡（COMPONENT scene=guide / type=lead）：
    一段开场白 + 一轮单选。之前协议解析里没有 lead 分支，整块被当成未知类型丢掉，
    表现就是这条 answer 什么都不渲染；这里把它就地铺成「正文 + 可点的选项行」。
  -->
  <view v-if="text || options.length" class="guide-lead" :class="{ 'guide-lead--dark': isDark }">
    <text v-if="text" class="guide-lead__text">
      {{ typedText }}
    </text>
    <!-- 选项等正文打完再出现（见上面 typing 的说明），挂载时补一次淡入上移 -->
    <view v-if="options.length && !typing" class="guide-lead__options">
      <text v-if="leadText" class="guide-lead__label">
        {{ leadText }}
      </text>
      <view
        v-for="option in options"
        :key="option"
        class="guide-lead__option"
        @tap.stop="pick(option)"
      >
        <text class="guide-lead__option-text">
          {{ option }}
        </text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.guide-lead {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  margin-top: 16rpx;
}

/* 开场白：与气泡正文同一档字号 / 行高，保留协议里的换行 */
.guide-lead__text {
  display: block;
  font-family: "PingFang SC", sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 44rpx;
  color: #1a1a1a;
  white-space: pre-line;
}

/* 选项组：与首页追问卡（AskSlotBlock）一致 —— 纵向排列、左对齐、间距 8px，
   胶囊按内容宽度收缩，不铺满整行。
   选项是在正文打完那一刻才挂载的，补一次淡入上移，避免整块「啪」地插到正文末尾 */
.guide-lead__options {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16rpx;
  margin-top: 16rpx;
  animation: guide-lead-options-in 0.26s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

@keyframes guide-lead-options-in {
  from {
    opacity: 0;
    transform: translateY(8rpx);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 引导语：灰色小标签，压在选项列表上方 */
.guide-lead__label {
  display: block;
  font-family: "PingFang SC", sans-serif;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 34rpx;
  // color: #999999;
}

/* 选项胶囊：与首页追问卡（blocks/AskSlotBlock）同一套 —— 白底 + 20px 圆角，
   边框是 #CDCAD2 → #F7F7F7 → #CDCAD2 的竖向渐变（双层背景法：内层白底裁到 padding-box，
   外层渐变裁到 border-box，只露出 2rpx 的边框环）。
   宽度按内容自适应（align-items: flex-start），机型名太长时在弹丸内折行 */
.guide-lead__option {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  max-width: 100%;
  padding: 16rpx 32rpx;
  border: 2rpx solid #efefef;
  border-radius: 40rpx;
  background-color: transparent;
  background-image:
    linear-gradient(#ffffff, #ffffff),
    linear-gradient(180deg, #cdcad2 0%, #f7f7f7 50%, #cdcad2 100%);
  background-origin: border-box;
  background-clip: padding-box, border-box;
}

.guide-lead__option:active {
  opacity: 0.7;
}

.guide-lead__option-text {
  min-width: 0;
  font-family: "PingFang SC", sans-serif;
  font-size: 28rpx; // 14px
  font-weight: 400;
  line-height: 40rpx;
  color: #0d0d0d;
  white-space: normal;
  word-break: break-word;
}

/* ===== 深色：与其它块同一套材质（正文 #FFF、次要 45% 白、块底 6% 白） ===== */
.guide-lead--dark {
  .guide-lead__text {
    color: #fff;
  }

  .guide-lead__label {
    color: #fff;
  }

  /* 胶囊：深色下不再用渐变边框（浅色渐变在深底上会发亮），改成 16% 白描边 + 6% 白底 */
  .guide-lead__option {
    border-color: rgba(255, 255, 255, 0.16);
    background-color: rgba(255, 255, 255, 0.06);
    background-image: none;
  }

  .guide-lead__option-text {
    color: #fff;
  }
}
</style>

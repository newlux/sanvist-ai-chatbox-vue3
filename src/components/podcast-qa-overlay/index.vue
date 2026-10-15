<script setup lang="ts">
import { computed } from "vue";
import AiChatInput from "@/components/ai-chat-input/index.vue";
import MarkdownRenderer from "@/components/markdown-renderer/index.vue";

/**
 * 听播页异常列表里发起的问答全屏覆盖层。
 *
 * 设计要点：
 * 1. 作为独立组件承载整个问答「页面」：标题/正文/按住说话，状态由父组件通过 props 传入，
 *    事件通过透传 emit 回父组件，不在内部持有任何业务状态、不直接访问父组件的 store。
 * 2. 正文区域水平居中、垂直靠上：识别中态与答案态都从顶部（header 下方留一点间距）开始排布。
 * 3. 底部沿用与首页同款的 AiChatInput，事件原样上抛。
 */
const props = defineProps({
  /** 整层覆盖层是否可见。父组件按 `insightVisible && reportQaFromInsight && (loading || answer)` 控制。 */
  visible: { type: Boolean, default: false },
  /** 识别中态：与答案态互斥。 */
  loading: { type: Boolean, default: false },
  /** 答案正文（已 `stripMarkdownTables` 后的 Markdown 文本）。 */
  answer: { type: String, default: "" },
  /** AiChatInput 双向绑定的输入文本。 */
  inputText: { type: String, default: "" },
  /** AiChatInput 的「正在生成」态。 */
  isLoading: { type: Boolean, default: false },
  /** AiChatInput：键盘高度（用于抬高输入栏）。 */
  keyboardHeight: { type: Number, default: 0 },
  /** AiChatInput：语音面板高度。 */
  voiceKeyboardHeight: { type: Number, default: 0 },
  /** 顶部安全区像素值，header 定位用。 */
  safeTopPx: { type: Number, default: 0 },
});

const emit = defineEmits([
  /** 顶部 ← 返回：父组件应同时停 TTS、清问答状态、保留异常列表。 */
  "confirm",
  /** AiChatInput 原样透传。 */
  "update:inputText",
  "send",
  "stop",
  "voice-start",
  "voice-restart",
  "voice-cancel",
  "recognize-begin",
  "recognize-fail",
  "input-focus",
  "input-blur",
  "voice-input-focus",
  "voice-input-blur",
  "dock-height-change",
  "toggle-quick-list",
]);

const headerTopStyle = computed(() => ({ top: `calc(${props.safeTopPx}px + 8rpx)` }));
</script>

<template>
  <view v-if="visible" class="podcast-qa-overlay" aria-modal="true">
    <view class="podcast-qa-overlay__header" :style="headerTopStyle">
      <view
        class="podcast-qa-overlay__back"
        hover-class="podcast-qa-overlay__back--active"
        hover-stay-time="80"
        @tap="emit('confirm')"
      >
        <text class="podcast-qa-overlay__back-icon">
          ‹
        </text>
      </view>
      <text class="podcast-qa-overlay__title">
        问答
      </text>
      <!-- 占位：与返回按钮对称，避免标题偏左 -->
      <view class="podcast-qa-overlay__back podcast-qa-overlay__back--placeholder" aria-hidden="true" />
    </view>

    <!--
      正文容器：水平居中、垂直靠上。
      - justify-content: flex-start 让识别中态 / 答案块贴着顶部排布，不再上下居中
      - align-items: center + 内部块 max-width 让水平方向居中
      - 顶部留出 header 高度 + 一点间距，避免文字贴着导航栏
    -->
    <view class="podcast-qa-overlay__body">
      <!-- 识别中态：与播报视图内的「正在理解你的内容」同一套文案与版式 -->
      <view v-if="loading" class="podcast-qa-overlay__loading">
        <text class="podcast-qa-overlay__loading-title">
          正在理解你的内容
        </text>
        <text class="podcast-qa-overlay__loading-subtitle">
          我会结合当前听播内容直接回答
        </text>
      </view>
      <!-- 答案态：与首页同款 MarkdownRenderer，去掉表格；正文统一居中 -->
      <scroll-view
        v-else-if="answer"
        class="podcast-qa-overlay__scroll"
        scroll-y
      >
        <MarkdownRenderer
          class="podcast-qa-overlay__answer"
          :content="answer"
        />
      </scroll-view>
    </view>

    <!--
      底部保留按住说话组件：用户看完答案可继续追问，无需先返回异常列表。
      与页面上 AiChatInput 共用同一组 send/voice 事件，行为完全一致；
      顶部 ← 承担「确认后回到异常列表」的作用。
    -->
    <view class="podcast-qa-overlay__footer">
      <AiChatInput
        :model-value="inputText"
        :attachment-disabled="true"
        :compact-voice-listening="true"
        :is-loading="isLoading"
        :keyboard-height="keyboardHeight"
        :voice-keyboard-height="voiceKeyboardHeight"
        @update:model-value="emit('update:inputText', $event)"
        @send="emit('send', $event)"
        @stop="emit('stop')"
        @voice-start="emit('voice-start')"
        @voice-restart="emit('voice-restart')"
        @voice-cancel="emit('voice-cancel')"
        @recognize-begin="emit('recognize-begin')"
        @recognize-fail="emit('recognize-fail')"
        @input-focus="emit('input-focus')"
        @input-blur="emit('input-blur')"
        @voice-input-focus="emit('voice-input-focus')"
        @voice-input-blur="emit('voice-input-blur')"
        @dock-height-change="emit('dock-height-change', $event)"
        @toggle-quick-list="emit('toggle-quick-list')"
      />
    </view>
  </view>
</template>

<style scoped lang="scss">
/* ==========================================================================
   全屏问答覆盖层（独立页面观感）
   - z-index 5：盖在异常列表之上，但低于 AiChatInput 内部弹层与 Teleport 的语音面板
   - 白底全屏：与原异常列表形成清晰的页面切换观感
   ========================================================================== */
.podcast-qa-overlay {
  position: absolute;
  z-index: 5;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  background: #ffffff;
}

.podcast-qa-overlay__header {
  position: absolute;
  right: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 88rpx;
  padding: 0 16rpx;
  box-sizing: border-box;
}

.podcast-qa-overlay__back {
  display: flex;
  width: 64rpx;
  height: 64rpx;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: background-color 0.15s ease;
}

.podcast-qa-overlay__back--active {
  background: #f0f0f0;
}

.podcast-qa-overlay__back--placeholder {
  visibility: hidden;
}

.podcast-qa-overlay__back-icon {
  font-family:
    "PingFang SC",
    "Noto Sans SC",
    "Microsoft YaHei",
    -apple-system,
    sans-serif;
  font-size: 56rpx;
  font-weight: 300;
  line-height: 1;
  color: #1a1a1a;
}

.podcast-qa-overlay__title {
  font-family:
    "PingFang SC",
    "Noto Sans SC",
    "Microsoft YaHei",
    -apple-system,
    sans-serif;
  font-size: 32rpx;
  font-weight: 600;
  line-height: 40rpx;
  color: #1a1a1a;
  text-align: center;
}

/* 正文容器：水平居中、垂直靠上。
   - flex 1 1 auto 占满 header 与 footer 之间的空间
   - min-height 0 配合 scroll-view 的滚动
   - align-items: center 让子块（loading 块、scroll-view）水平居中
   - justify-content: flex-start 让子块从顶部开始排布，不再上下居中
   - padding-top = 安全区 + 200rpx（header 88rpx + 顶部偏移 8rpx，再留 104rpx 间距） */
.podcast-qa-overlay__body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: calc(env(safe-area-inset-top) + 200rpx) 32rpx 32rpx;
  box-sizing: border-box;
  overflow: hidden;
}

.podcast-qa-overlay__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
}

.podcast-qa-overlay__loading-title {
  font-family:
    "PingFang SC",
    "Noto Sans SC",
    "Microsoft YaHei",
    -apple-system,
    sans-serif;
  font-size: 36rpx;
  font-weight: 400;
  line-height: 48rpx;
  color: #1a1a1a;
  text-align: center;
}

.podcast-qa-overlay__loading-subtitle {
  font-family:
    "PingFang SC",
    "Noto Sans SC",
    "Microsoft YaHei",
    -apple-system,
    sans-serif;
  font-size: 26rpx;
  font-weight: 400;
  line-height: 36rpx;
  color: #999999;
  text-align: center;
}

/* 答案滚动区：限定最大宽度让水平居中有意义，超长内容在内部滚动 */
.podcast-qa-overlay__scroll {
  flex: 0 1 auto;
  width: 100%;
  max-width: 640rpx;
  max-height: 100%;
  padding-bottom: 24rpx;
  box-sizing: border-box;
}

/* 答案正文统一居中：让 Markdown 渲染出来的标题/段落/列表都在水平方向居中 */
.podcast-qa-overlay__answer {
  display: block;
  text-align: center;
}

/* footer：容纳 AiChatInput 的简单容器，仅留底部安全区 */
.podcast-qa-overlay__footer {
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom);
  box-sizing: border-box;
}
</style>

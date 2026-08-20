<script setup lang="ts">
import { onLoad, onUnload } from "@dcloudio/uni-app";
import { storeToRefs } from "pinia";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AiChatInput from "@/components/ai-chat-input/index.vue";
import AiMessageList from "@/components/ai-message-list/index.vue";
import { useChatFeedback } from "@/hooks/useChatFeedback";
import { useChatSend } from "@/hooks/useChatSend";
import { useChatTts } from "@/hooks/useChatTts";
import { useChatViewport } from "@/hooks/useChatViewport";
import { useSafeArea } from "@/hooks/useSafeArea";
import { provideChatScope, useChatStore, useUserStore } from "@/stores";

/**
 * 智能体会话页（听汇报 / 任务协同）。
 *
 * 复用首页那套消息列表与底部输入栏，区别只在于：进页面先起一轮干净的会话，
 * 并把 subagent 挂进 chatStore —— 发送时由 useChatSend 塞进 inputs 透传给算法侧。
 */
defineOptions({ name: "SubagentChatPage" });

const { t } = useI18n();
// 智能体会话独立成域：与首页各持一份消息，来回切换互不干扰
const chatScope = provideChatScope("subagent");
const chatStore = useChatStore(chatScope);
const userStore = useUserStore();

const {
  messages,
  inputText,
  isLoading,
  aiSessionId,
  scrollIntoView,
  pinnedToBottom,
} = storeToRefs(chatStore);

const { chatViewportStyle, keyboardHeight, syncWindowHeight, resetKeyboardHeight } = useChatViewport();
const { sendMessage, sendQuickPrompt, stopGenerating, cancelActiveStream } = useChatSend();
const { onFeedbackChange } = useChatFeedback();
const { onTtsClick } = useChatTts();
const { safeTopPx } = useSafeArea();

const pageTitle = ref("");
const localizedQuickPrompts = computed(() => chatStore.quickPrompts.map(item => t(item)));
const headerStyle = computed(() => ({ paddingTop: `${safeTopPx.value}px` }));

watch(() => chatStore.messages.length, () => nextTick(() => chatStore.scrollToBottom()));

onLoad((query?: Record<string, string>) => {
  syncWindowHeight();
  pageTitle.value = String(query?.title || "AI 助手");
  // 每次进来都是全新一轮
  chatStore.resetConversation();
  chatStore.showQuickPrompts = false;
  chatStore.showQuickList = false;
  chatStore.setSubagent(String(query?.subagent || ""));
});

onUnload(() => {
  cancelActiveStream();
  chatStore.setSubagent("");
});

onBeforeUnmount(cancelActiveStream);

function onBack() {
  uni.navigateBack({ delta: 1 });
}

function onScrollTop() {
  // 预留：加载更多历史消息
}
</script>

<template>
  <view class="subagent-page">
    <view class="subagent-page__chat" :style="chatViewportStyle">
      <view class="subagent-header" :style="headerStyle">
        <view class="subagent-header__back" @tap="onBack">
          <text class="subagent-header__back-text">
            ‹
          </text>
        </view>
        <text class="subagent-header__title">
          {{ pageTitle }}
        </text>
        <view class="subagent-header__placeholder" />
      </view>

      <AiMessageList
        :key="aiSessionId || 'subagent-conversation'"
        :messages="messages"
        :quick-prompts="localizedQuickPrompts"
        :show-quick-prompts="false"
        :show-quick-list="false"
        :scroll-into-view="scrollIntoView"
        :awakening="userStore.awakeningPrompt"
        :pinned-to-bottom="pinnedToBottom"
        @quick-prompt="sendQuickPrompt"
        @suggestion-tap="sendQuickPrompt"
        @tts-click="onTtsClick"
        @feedback-change="onFeedbackChange"
        @scroll-top="onScrollTop"
        @pinned-change="chatStore.setPinnedToBottom"
      />

      <AiChatInput
        v-model="inputText"
        :is-loading="isLoading"
        :keyboard-height="keyboardHeight"
        @send="sendMessage"
        @stop="stopGenerating"
        @input-blur="resetKeyboardHeight"
      />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.subagent-page {
  min-height: 100vh;
  height: 100%;
  box-sizing: border-box;
  background: #f2f4f8;
  font-family: PingFang SC;
  overflow: hidden;
}

.subagent-page__chat {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: #ffffff;
  overflow: hidden;
}

.subagent-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 32rpx;
  // 顶部安全区由内联样式给，这里再兜一层刘海高度
  padding-top: constant(safe-area-inset-top);
  padding-top: env(safe-area-inset-top);
  min-height: 96rpx;
}

.subagent-header__back,
.subagent-header__placeholder {
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.subagent-header__back-text {
  font-size: 56rpx;
  line-height: 56rpx;
  color: #1a1a1a;
}

.subagent-header__title {
  flex: 1;
  min-width: 0;
  font-size: 32rpx;
  font-weight: 600;
  color: #1a1a1a;
  text-align: center;
}
</style>

<script setup lang="ts">
import type { ListenBroadcastStyle, PlayListenBroadcastParams } from "@/api/listen-broadcast/types";
import type { ReportVoiceOption } from "@/config/report-voices";
import { onLoad, onUnload } from "@dcloudio/uni-app";
import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, ref } from "vue";
import AiChatInput from "@/components/ai-chat-input/index.vue";
import ReportBroadcastPlayer from "@/components/report-broadcast-player/index.vue";
import ReportVoiceSelector from "@/components/report-voice-selector/index.vue";
import { useChatSend } from "@/hooks/useChatSend";
import { useChatViewport } from "@/hooks/useChatViewport";
import { loadReportStyle } from "@/hooks/useReportStyle";
import { loadReportVoice } from "@/hooks/useReportVoice";
import { useSafeArea } from "@/hooks/useSafeArea";
import { provideChatScope, useChatStore } from "@/stores";

/**
 * 智能体会话页（听汇报 / 任务协同）。
 *
 * 复用首页那套消息列表与底部输入栏，区别只在于：进页面先起一轮干净的会话，
 * 并把 subagent 挂进 chatStore —— 发送时由 useChatSend 塞进 inputs 透传给算法侧。
 */
defineOptions({ name: "SubagentChatPage" });

// 智能体会话独立成域：底部输入栏仍使用独立会话状态。
const chatScope = provideChatScope("subagent");
const chatStore = useChatStore(chatScope);
const { inputText, isLoading } = storeToRefs(chatStore);
const { safeAreaStyle, safeTopPx } = useSafeArea();

// 顶部状态栏占位：高度随真实机型状态栏高度，避免内容被顶到状态栏底下
const statusbarStyle = computed(() => ({
  height: `${safeTopPx.value}px`,
}));

const {
  chatViewportStyle,
  keyboardHeight,
  voiceKeyboardHeight,
  composerDockOffset,
  syncWindowHeight,
  setInputDockHeight,
  setTextInputFocused,
  setVoiceInputFocused,
} = useChatViewport();
const { sendMessage, beginAsrPlaceholder, discardAsrPlaceholder, stopGenerating, cancelActiveStream } = useChatSend();

const isReport = ref(false);
const showReportVoiceSelector = ref(false);
const reportBroadcastParams = ref<PlayListenBroadcastParams | null>(null);
const reportBroadcastPortrait = ref("");

function restoreReportBroadcast() {
  const voice = loadReportVoice();
  const style = loadReportStyle();
  if (!voice || !style || !style.moduleCodes.length) {
    showReportVoiceSelector.value = true;
    return;
  }
  reportBroadcastParams.value = {
    voice: voice.id,
    styleCode: style.styleCode,
    checkedModules: style.moduleCodes,
  };
  reportBroadcastPortrait.value = voice.hero;
  showReportVoiceSelector.value = false;
}

function closeReportVoiceSelector() {
  showReportVoiceSelector.value = false;
  uni.navigateBack({ delta: 1 });
}

function confirmReportVoice(voice: ReportVoiceOption, style: ListenBroadcastStyle, moduleCodes: string[]) {
  reportBroadcastParams.value = {
    voice: voice.id,
    styleCode: style.code,
    checkedModules: moduleCodes,
  };
  reportBroadcastPortrait.value = voice.hero;
  showReportVoiceSelector.value = false;
}

function closeReportBroadcast() {
  reportBroadcastParams.value = null;
  onBack();
}

onLoad((query?: Record<string, string>) => {
  syncWindowHeight();
  isReport.value = String(query?.subagent || "") === "report";
  if (isReport.value) restoreReportBroadcast();
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
</script>

<template>
  <view class="subagent-page" :style="safeAreaStyle">
    <!-- 状态栏占位：动态读取真实机型状态栏高度 -->
    <view class="chat-header__statusbar" :style="statusbarStyle" />
    <ReportVoiceSelector
      v-if="isReport && showReportVoiceSelector"
      @confirm="confirmReportVoice"
      @close="closeReportVoiceSelector"
    />
    <view v-else class="subagent-page__chat" :style="chatViewportStyle">
      <!-- 听汇报专用 SSE 播放视图，不复用普通对话消息列表 -->
      <ReportBroadcastPlayer
        v-if="isReport && reportBroadcastParams"
        :params="reportBroadcastParams"
        :portrait="reportBroadcastPortrait"
        :dock-offset="composerDockOffset"
        @close="closeReportBroadcast"
      />
      <AiChatInput
        v-model="inputText"
        :is-loading="isLoading"
        :keyboard-height="keyboardHeight"
        :voice-keyboard-height="voiceKeyboardHeight"
        @send="sendMessage"
        @stop="stopGenerating"
        @recognize-begin="beginAsrPlaceholder"
        @recognize-fail="discardAsrPlaceholder"
        @input-focus="setTextInputFocused(true)"
        @input-blur="setTextInputFocused(false)"
        @voice-input-focus="setVoiceInputFocused(true)"
        @voice-input-blur="setVoiceInputFocused(false)"
        @dock-height-change="setInputDockHeight"
      />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.subagent-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  height: 100%;
  box-sizing: border-box;
  background: #ffffff;
  font-family: PingFang SC;
  overflow: hidden;
}

/* 顶部状态栏占位：撑开安全区，避免页面内容顶到状态栏底下 */
.chat-header__statusbar {
  width: 100%;
  flex: 0 0 auto;
  background: transparent;
}

.subagent-page__chat {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  background: #ffffff;
  overflow: hidden;
}

:deep(.chat-input) {
  background: #ffffff;
}
</style>

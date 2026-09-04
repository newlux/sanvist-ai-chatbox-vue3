<script setup lang="ts">
import { onLoad, onShow, onUnload } from "@dcloudio/uni-app";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getTodayAwakeningPrompt } from "@/api/user-role";
import AiBadFeedbackSheet from "@/components/ai-bad-feedback-sheet/index.vue";
import AiChatHeader from "@/components/ai-chat-header/index.vue";
import AiChatInput from "@/components/ai-chat-input/index.vue";
import AiChatNav from "@/components/ai-chat-nav/index.vue";
import AiMessageList from "@/components/ai-message-list/index.vue";
import ShareConversationPoster from "@/components/ai-share-poster/index.vue";
import { useChatFeedback } from "@/hooks/useChatFeedback";
import { useChatSend } from "@/hooks/useChatSend";
import { useChatShare } from "@/hooks/useChatShare";
import { useChatTts } from "@/hooks/useChatTts";
import { useChatViewport } from "@/hooks/useChatViewport";
import { useRealtimeTts } from "@/hooks/useRealtimeTts";
import { provideChatScope, useChatStore, useSessionStore, useUserStore } from "@/stores";
import { createLogger } from "@/utils/logger";

/**
 * 任务协同页（基于首页 index 的聊天 UI：Header 历史会话 + 消息列表 + 快捷入口 + 输入栏）。
 *
 * 与首页 / 听汇报的区别：
 * - 独立会话域 "task"，不与首页主会话互相污染；
 * - 复用首页 useChatSend 对话链路，发送时固定透传 inputs.scene=TASK；
 * - 每次进入起一轮干净会话（与作业指导一致），返回再进时重新开一轮。
 */
defineOptions({ name: "AiTaskPage" });

/** 任务协同对应的导航项 key（与 ai-chat-nav 默认数据一致），本页内导航高亮该项 */
const TASK_NAV_KEY = "ai-form";
const logger = createLogger("task-page");
const { t } = useI18n();

const chatScope = provideChatScope("task");
const userStore = useUserStore();
const chatStore = useChatStore(chatScope);
const sessionStore = useSessionStore();
const chatHeader = ref<{ reloadSessions?: () => Promise<void> } | null>(null);
const sharePosterWrap = ref<unknown>(null);
const shareSheetBottomInset = ref("");

const {
  messages,
  inputText,
  isLoading,
  aiSessionId,
  showQuickPrompts,
  showQuickList,
  awakeningLoading,
  scrollIntoView,
  pinnedToBottom,
} = storeToRefs(chatStore);
const { sessions, isSessionSwitching } = storeToRefs(sessionStore);

const {
  chatViewportStyle,
  keyboardHeight,
  voiceKeyboardHeight,
  composerBottomInset,
  composerDockOffset,
  syncWindowHeight,
  setInputDockHeight,
  setTextInputFocused,
  setVoiceInputFocused,
} = useChatViewport();
const { sendMessage, sendQuickPrompt, beginAsrPlaceholder, discardAsrPlaceholder, stopGenerating, cancelActiveStream } = useChatSend(chatScope, {
  scene: "TASK",
});
const {
  iconCopyImage,
  iconSaveImage,
  shareSheetVisible,
  shareSelectedIndexes,
  shareSuppressHighlight,
  sharePosterVisible,
  sharePosterDataUrl,
  sharePosterGenerating,
  shareSheetOptions,
  shareSelectAllDisabled,
  shareSelectedRoundCount,
  shareAllChecked,
  onShareClick,
  onShareSelectToggle,
  onShareSelectAll,
  closeShareSheet,
  onShareSheetOption,
  onCopyMessage,
  closeSharePosterModal,
  onSaveSharePoster,
  onCopySharePoster,
} = useChatShare(sharePosterWrap, chatScope);
const { badFeedbackSheetVisible, onFeedbackChange, onBadFeedbackConfirm, onBadFeedbackClose } = useChatFeedback(chatScope);
const { onTtsClick: onHistoryTtsClick, releaseAudio: stopHistoryTts, activeMessageId: historyTtsMessageId } = useChatTts(chatScope);
const realtimeTts = useRealtimeTts(chatScope);

const messageBottomInset = computed(() => {
  if (shareSheetVisible.value) return shareSheetBottomInset.value;
  // 导航、输入栏都是 fixed，列表要用 padding 把最后一条抬到它们上方
  if (showQuickPrompts.value) return `calc(${composerBottomInset.value} + 72rpx)`;
  return composerBottomInset.value;
});
const navOffsetStyle = computed(() => ({ bottom: composerDockOffset.value }));

/** 点击追问后先移除它所属回答的追问列表，再按普通问题走完整发送链路。 */
function onTaskSuggestionTap(suggestion: string, messageIndex: number) {
  const message = chatStore.messages[messageIndex];
  if (message?.role === "ai" && Array.isArray(message.blocks)) {
    const blockIndex = message.blocks.findIndex(block => block.type === "suggestion");
    if (blockIndex >= 0) message.blocks.splice(blockIndex, 1);
  }
  sendQuickPrompt(suggestion);
}
/** 新生成消息实时播放，历史消息播放已合成的整段语音。 */
function onTtsClick(index: number) {
  const msg = chatStore.messages[index];
  const messageId = msg?.messageId;
  if (messageId == null || msg?.sessionId == null) return;

  if (realtimeTts.playingMessageId.value === messageId) {
    realtimeTts.stop();
    return;
  }
  if (historyTtsMessageId.value === messageId) {
    stopHistoryTts();
    return;
  }

  realtimeTts.stop();
  stopHistoryTts();
  if (msg.ttsPlaybackMode === "realtime") {
    void realtimeTts.togglePlay(msg);
    return;
  }
  void onHistoryTtsClick(index);
}

const localizedQuickPrompts = computed(() => chatStore.quickPrompts.map(item => t(item)));

watch(() => chatStore.messages.length, () => nextTick(() => chatStore.scrollToBottom()));

watch(shareSheetVisible, async (visible) => {
  if (!visible) {
    shareSheetBottomInset.value = "";
    return;
  }

  await nextTick();
  uni.createSelectorQuery()
    .select(".share-sheet")
    .boundingClientRect((rect) => {
      const height = Array.isArray(rect) ? rect[0]?.height : rect?.height;
      shareSheetBottomInset.value = height ? `${height}px` : "";
    })
    .exec();
});

function startNewConversation() {
  // 已经是一轮空白会话就别再重置了，重复点击给个明确反馈
  if (!chatStore.messages.length && !chatStore.aiSessionId) {
    uni.showToast({ title: t("already-new-conversation"), icon: "none" });
    return;
  }
  // 正在生成时切走：先掐掉在途请求，否则回包会继续往新会话里写
  cancelActiveStream();
  chatStore.resetConversation();
  nextTick(() => chatStore.scrollToBottom(true));
}

/**
 * 快捷入口：听汇报 / 作业指导各自另开一个会话页；
 * 任务协同已在当前页（高亮），点了不重复入栈。
 */
function onNavItemClick(item: { key?: string; title?: string; subagent?: string; url?: string }) {
  const subagent = String(item?.subagent || "");
  if (subagent === "task") return;

  const targetUrl = String(item?.url || "");
  if (targetUrl) {
    uni.navigateTo({ url: targetUrl });
    return;
  }
  if (!subagent) return;

  uni.navigateTo({
    url: `/pages/chat/index?subagent=${encodeURIComponent(subagent)}&title=${encodeURIComponent(item?.title || "")}`,
  });
}

function onBack() {
  uni.navigateBack({ delta: 1 });
}

/**
 * 历史抽屉分页取数。z-paging 每翻一页回调一次，实现落在 sessionStore 里。
 */
function getAISessionList(pageNo = 1, pageSize = 20) {
  return sessionStore.loadSessions(pageNo, pageSize);
}

function toggleQuickList(show: boolean) {
  if (chatStore.messages.length > 0 && show) return;
  chatStore.showQuickList = show;
}

async function onSessionClick(session: { sessionId?: string | number; id?: string | number }) {
  const id = session?.sessionId || session?.id;
  if (!id || chatStore.aiSessionId === id) return;
  cancelActiveStream();
  chatStore.showQuickPrompts = false;
  chatStore.showQuickList = false;
  chatStore.messages = [];
  sessionStore.isSessionSwitching = true;
  chatStore.aiSessionId = id;
  try {
    await sessionStore.loadHistory(id, chatStore);
  } catch (error) {
    logger.error("caught error", error);
    uni.showToast({ title: t("load-history-failed"), icon: "none" });
  } finally {
    sessionStore.isSessionSwitching = false;
  }
}

async function confirmModal(title: string, content: string) {
  return new Promise<boolean>((resolve) => {
    uni.showModal({
      title,
      content,
      confirmColor: "#F8315E",
      success: res => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    });
  });
}

async function onSessionDelete(session: { id?: string | number }) {
  const id = session?.id;
  if (!id) return;
  if (!await confirmModal("删除此对话？", "删除后，这条对话记录将无法找回。确定删除此对话？")) return;
  try {
    await sessionStore.removeSession(id);
    await chatHeader.value?.reloadSessions?.();
    if (String(chatStore.aiSessionId) === String(id)) chatStore.resetConversation();
    uni.showToast({ title: t("delete-success"), icon: "none" });
  } catch (error) {
    logger.error("caught error", error);
    uni.showToast({ title: t("delete-failed"), icon: "none" });
  }
}

async function onSessionDeleteBatch(ids: Array<string | number>) {
  const uniqueIds = Array.from(new Set((ids || []).map(id => String(id))));
  if (!uniqueIds.length) return;
  if (!await confirmModal("批量删除选中对话？", "删除后，选中对话记录将无法找回。确定删除选中对话？")) return;
  try {
    await sessionStore.removeSessions(uniqueIds);
    await chatHeader.value?.reloadSessions?.();
    if (chatStore.aiSessionId && uniqueIds.includes(String(chatStore.aiSessionId))) {
      chatStore.resetConversation();
    }
    uni.showToast({ title: t("delete-success"), icon: "none" });
  } catch (error) {
    logger.error("caught error", error);
    uni.showToast({ title: t("batch-delete-failed"), icon: "none" });
  }
}

async function onSessionRename(session: { id?: string | number; name?: string }) {
  const id = session?.id;
  const name = (session?.name || "").trim();
  if (!id || !name) return;
  try {
    await sessionStore.renameSession(id, name);
    uni.showToast({ title: t("rename-success"), icon: "none" });
  } catch (error) {
    logger.error("caught error", error);
    uni.showToast({ title: t("rename-failed"), icon: "none" });
  }
}

async function loadAwakeningPrompt() {
  if (!userStore.visitorRole || userStore.awakeningPrompt) return;
  chatStore.awakeningLoading = true;
  try {
    userStore.setAwakeningPrompt(await getTodayAwakeningPrompt() ?? null);
  } catch (error) {
    logger.warn("failed to load awakening prompt", error);
    userStore.setAwakeningPrompt(null);
  } finally {
    chatStore.awakeningLoading = false;
  }
}

async function onScrollTop() {
  if (!chatStore.aiSessionId) return;
  try {
    await sessionStore.loadMoreHistory(chatStore);
  } catch (error) {
    logger.error("failed to load more history", error);
    uni.showToast({ title: t("load-history-failed"), icon: "none" });
  }
}

onLoad(() => {
  syncWindowHeight();
  // 进入即起一轮干净会话（返回首页再进会重新开一轮）；发送场景由 useChatSend 固定为 TASK。
  chatStore.resetConversation();
  chatStore.showQuickPrompts = false;
  chatStore.showQuickList = false;
});

onMounted(() => {
  syncWindowHeight();
  loadAwakeningPrompt();
});

onShow(() => {
  syncWindowHeight();
});

onUnload(() => {
  cancelActiveStream();
});
</script>

<template>
  <view class="ai-page">
    <view class="ai-page__chat" :style="chatViewportStyle">
      <view class="ai-chat-glow ai-chat-glow--blue" />
      <view class="ai-chat-glow ai-chat-glow--red" />
      <!-- Header -->
      <AiChatHeader
        ref="chatHeader"
        v-model:sessions="sessions"
        class="ai-page__header"
        :load-sessions="getAISessionList"
        :selected-session-id="aiSessionId"
        :generating="isLoading"
        :share-mode="shareSheetVisible"
        :share-select-all-disabled="shareSelectAllDisabled"
        :share-all-checked="shareAllChecked"
        :share-selected-round-count="shareSelectedRoundCount"
        back-only
        @back="onBack"
        @new-conversation="startNewConversation"
        @session-click="onSessionClick"
        @session-delete="onSessionDelete"
        @session-delete-batch="onSessionDeleteBatch"
        @session-rename="onSessionRename"
        @share-select-all="onShareSelectAll"
      />
      <AiMessageList
        :key="aiSessionId || 'new-conversation'"
        :messages="messages"
        :quick-prompts="localizedQuickPrompts"
        :show-quick-prompts="showQuickPrompts"
        :show-business-overview="false"
        :scroll-into-view="scrollIntoView"
        :show-quick-list="showQuickList"
        :selected-indexes="shareSelectedIndexes"
        :select-mode="shareSheetVisible"
        :suppress-highlight="shareSuppressHighlight"
        :bottom-inset="messageBottomInset"
        :awakening="userStore.awakeningPrompt"
        :awakening-loading="awakeningLoading"
        :pinned-to-bottom="pinnedToBottom"
        :realtime-tts-message-key="realtimeTts.playingMessageKey.value"
        :realtime-tts-playing="realtimeTts.playing.value"
        @quick-prompt="sendQuickPrompt"
        @suggestion-tap="onTaskSuggestionTap"
        @tts-click="onTtsClick"
        @feedback-change="onFeedbackChange"
        @share-click="onShareClick"
        @copy-click="onCopyMessage"
        @select-toggle="onShareSelectToggle"
        @scroll-top="onScrollTop"
        @pinned-change="chatStore.setPinnedToBottom"
      />
      <AiChatNav
        :visible="showQuickPrompts"
        :active-key="TASK_NAV_KEY"
        :style="navOffsetStyle"
        @item-click="onNavItemClick"
      />
      <view v-if="isSessionSwitching" class="session-loading">
        <view class="session-loading__spinner" />
      </view>

      <view v-if="shareSheetVisible" class="share-sheet-modal">
        <view class="share-sheet" @tap.stop>
          <text class="share-sheet__title">
            分享到：
          </text>
          <view class="share-sheet__options">
            <view
              v-for="item in shareSheetOptions"
              :key="item.key"
              class="share-sheet__option"
              :class="{
                'share-sheet__option--disabled':
                  item.key === 'share-image' && shareSelectedIndexes.length === 0,
              }"
              @tap="
                item.key === 'share-image' && shareSelectedIndexes.length === 0
                  ? null
                  : onShareSheetOption(item)
              "
            >
              <view class="share-sheet__option-icon">
                <image :src="item.icon" mode="aspectFit" class="share-sheet__option-icon-img" />
              </view>
              <text class="share-sheet__option-label">
                {{ item.label }}
              </text>
            </view>
          </view>
          <view class="share-sheet__divider" />
          <view class="share-sheet__cancel-btn" @tap="closeShareSheet">
            <text class="share-sheet__cancel-text">
              {{ $t("cancel") }}
            </text>
          </view>
        </view>
      </view>

      <!-- 分享图片预览/生成 -->
      <view v-else-if="sharePosterVisible" class="share-poster-modal">
        <view class="share-poster-modal__mask" @tap="closeSharePosterModal" />
        <view class="share-poster-modal__card" @tap.stop>
          <view class="share-poster-modal__content">
            <view v-if="sharePosterGenerating" class="share-poster-modal__loading">
              <view class="share-poster-modal__loading-content">
                <view class="session-loading__spinner share-poster-modal__loading-spinner" />
                <text class="share-poster-modal__loading-text">
                  图片生成中
                </text>
              </view>
            </view>
            <scroll-view
              v-else-if="sharePosterDataUrl"
              class="share-poster-modal__scroll-img"
              scroll-y
              :scroll-with-animation="true"
            >
              <view class="share-poster-modal__img-center">
                <image class="share-poster-modal__img" :src="sharePosterDataUrl" mode="widthFix" />
              </view>
            </scroll-view>
          </view>

          <view class="share-poster-modal__bottom">
            <view class="share-poster-modal__bottom-action-wrap">
              <view class="share-poster-modal__option" @tap="onSaveSharePoster">
                <view class="share-poster-modal__option-icon">
                  <image class="share-poster-modal__option-icon-img" :src="iconSaveImage" mode="aspectFit" />
                </view>
                <text class="share-poster-modal__option-label">
                  保存图片
                </text>
              </view>
              <view class="share-poster-modal__option" @tap="onCopySharePoster">
                <view class="share-poster-modal__option-icon">
                  <image class="share-poster-modal__option-icon-img" :src="iconCopyImage" mode="aspectFit" />
                </view>
                <text class="share-poster-modal__option-label">
                  复制图片
                </text>
              </view>
            </view>
            <view class="share-poster-modal__divider" />
            <view class="share-poster-modal__cancel" @tap="closeSharePosterModal">
              <text class="share-poster-modal__cancel-text">
                取消
              </text>
            </view>
          </view>
        </view>

        <view id="share-poster-wrap" ref="sharePosterWrap" class="share-poster-hidden">
          <ShareConversationPoster :messages="messages" :selected-indexes="shareSelectedIndexes" />
        </view>
      </view>

      <AiChatInput
        v-else
        v-model="inputText"
        :is-loading="isLoading"
        :keyboard-height="keyboardHeight"
        :voice-keyboard-height="voiceKeyboardHeight"
        @send="sendMessage"
        @stop="stopGenerating"
        @recognize-begin="beginAsrPlaceholder"
        @recognize-fail="discardAsrPlaceholder"
        @toggle-quick-list="toggleQuickList"
        @input-focus="setTextInputFocused(true)"
        @input-blur="setTextInputFocused(false)"
        @voice-input-focus="setVoiceInputFocused(true)"
        @voice-input-blur="setVoiceInputFocused(false)"
        @dock-height-change="setInputDockHeight"
      />

      <AiBadFeedbackSheet
        :visible="badFeedbackSheetVisible"
        @close="onBadFeedbackClose"
        @confirm="onBadFeedbackConfirm"
      />
    </view>
  </view>
</template>

<style lang="scss" scoped>
$color-text-primary: #1a1a1a;
$color-text-secondary: #6b6b6b;
$color-text-muted: #bababa;
$color-red-accent: #ff0000;
$color-red-btn: #fe0000;
$color-bg-phone: #fafafa;
$color-bg-voice: #f5f5f5;
$color-border-light: #efefef;
$color-white: #ffffff;

.ai-page {
  min-height: 100vh;
  height: 100%;
  box-sizing: border-box;
  background: #fafafa;
  font-family: PingFang SC;
  overflow: hidden;
  overscroll-behavior: none;
}

.ai-page__chat {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: #fafafa;
  overflow: hidden;
  position: relative;
}

// 头部要盖住消息列表和输入栏：历史抽屉、操作菜单都挂在它的层叠上下文里，
// 留在 z-index:1 会被后面的兄弟节点盖掉（气泡压在抽屉上就是这个原因）
.ai-page__chat > .ai-page__header {
  z-index: 30;
}

.ai-chat-glow {
  position: absolute;
  z-index: 0;
  pointer-events: none;
  border-radius: 0;
  filter: none;
}

.ai-chat-glow--blue {
  top: 0;
  left: 0;
  width: 392rpx;
  height: 234rpx;
  background: radial-gradient(
    ellipse 196rpx 117rpx at 0 0,
    rgba(123, 167, 217, 0.12) 0%,
    rgba(123, 167, 217, 0) 100%
  );
}

.ai-chat-glow--red {
  top: 0;
  right: 0;
  width: 602rpx;
  height: 234rpx;
  background: radial-gradient(
    ellipse 301rpx 117rpx at 100% 0,
    rgba(254, 0, 0, 0.1) 0%,
    rgba(254, 0, 0, 0) 100%
  );
}

.session-loading {
  position: absolute;
  left: 0;
  right: 0;
  top: 180rpx;
  bottom: 200rpx;
  z-index: 15;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.session-loading__spinner {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  border: 6rpx solid rgba(95, 103, 117, 0.2);
  border-top-color: #c8201e;
  animation: session-spin 0.9s linear infinite;
}

@keyframes session-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Share sheet */
.share-sheet-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  pointer-events: none;
}

.share-sheet {
  position: absolute;
  pointer-events: auto;
  right: 0;
  bottom: 0;
  left: 0;
  box-sizing: border-box;
  border-top: 2rpx solid #eeeeee;
  border-radius: 32rpx 32rpx 0 0;
  background: #ffffff;
  box-shadow: 0 -12rpx 32rpx rgba(0, 0, 0, 0.1);
  padding: 40rpx 60rpx 32rpx;
}

.share-sheet__title {
  display: block;
  height: 40rpx;
  font-family: "PingFang SC";
  font-size: 28rpx;
  font-weight: 700;
  line-height: 40rpx;
  color: #1a1a1a;
}

.share-sheet__options {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-top: 40rpx;
}

.share-sheet__option {
  width: 112rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18rpx;
}

.share-sheet__option--disabled {
  opacity: 0.35;
  pointer-events: none;
}

.share-sheet__option-icon {
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  background: #f2f2f2;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-sheet__option-icon-img {
  width: 56rpx;
  height: 56rpx;
}

.share-sheet__option-label {
  height: 40rpx;
  font-family: "PingFang SC";
  font-size: 26rpx;
  font-weight: 700;
  line-height: 40rpx;
  color: #1a1a1a;
  text-align: center;
  white-space: nowrap;
}

.share-sheet__divider {
  height: 2rpx;
  margin-top: 34rpx;
  background: #e4e4e4;
}

.share-sheet__cancel-btn {
  height: 40rpx;
  margin-top: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-sheet__cancel-text {
  font-family: "PingFang SC";
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
  color: #999999;
}

/* Share Poster Modal */
.share-poster-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-poster-modal__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
}

.share-poster-modal__card {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
}

.share-poster-modal__content {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 30rpx 42rpx 0;
  box-sizing: border-box;
  overflow: hidden;
}

.share-poster-modal__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.share-poster-modal__loading-content {
  width: 200rpx;
  height: 200rpx;
  border-radius: 30rpx;
  background: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
}

.share-poster-modal__loading-spinner {
  border-top-color: #c8201e;
}

.share-poster-modal__loading-text {
  font-size: 24rpx;
  line-height: 32rpx;
  color: #5f6775;
}

.share-poster-modal__bottom {
  padding: 40rpx 60rpx 32rpx;
  background: #fff;
  box-shadow: 0 -4rpx 42rpx rgba(0, 0, 0, 0.0601);
  display: flex;
  flex-direction: column;
  border-radius: 32rpx 32rpx 0 0;
}

.share-poster-modal__bottom-action-wrap {
  display: flex;
  align-items: flex-start;
  gap: 61.333rpx;
}

.share-poster-modal__option {
  width: 112rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18rpx;
}

.share-poster-modal__option-icon {
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  background: #f2f2f2;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-poster-modal__option-icon-img {
  width: 56rpx;
  height: 56rpx;
}

.share-poster-modal__option-label {
  height: 40rpx;
  font-family: "PingFang SC";
  font-size: 26rpx;
  font-weight: 700;
  line-height: 40rpx;
  color: #1a1a1a;
  text-align: center;
  white-space: nowrap;
}

.share-poster-modal__divider {
  height: 2rpx;
  margin-top: 34rpx;
  background: #e4e4e4;
}

.share-poster-modal__cancel {
  height: 40rpx;
  margin-top: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-poster-modal__cancel-text {
  font-family: "PingFang SC";
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
  color: #999999;
}

.share-poster-modal__img {
  width: 100%;
  max-width: 656rpx;
  height: auto;
  display: block;
  margin: 0 auto;
  border-radius: 24rpx;
}

.share-poster-modal__scroll-img {
  flex: 1;
  width: 100%;
  height: 100%;
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.share-poster-modal__scroll-img ::v-deep ::-webkit-scrollbar {
  display: none;
}

.share-poster-modal__img-center {
  display: flex;
  min-height: 100%;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  padding: 32rpx 0;
}
.share-poster-hidden {
  position: fixed;
  z-index: -1;
  top: 0;
  left: -9999px;
  pointer-events: none;
}
</style>

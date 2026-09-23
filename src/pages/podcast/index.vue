<script setup lang="ts">
import type { ListenBroadcastStyle, PlayListenBroadcastParams } from "@/api/listen-broadcast/types";
import type { ReportVoiceOption } from "@/config/report-voices";
import type { ReportInsightItem } from "@/hooks/useReportInsights";
import { onLoad, onUnload } from "@dcloudio/uni-app";
import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, ref } from "vue";
import AiChatInput from "@/components/ai-chat-input/index.vue";
import ReportBroadcastPlayer from "@/components/report-broadcast-player/index.vue";
import ReportInsight from "@/components/report-broadcast-player/report-insight.vue";
import ReportVoiceSelector from "@/components/report-voice-selector/index.vue";
import { useChatSend } from "@/hooks/useChatSend";
import { useChatViewport } from "@/hooks/useChatViewport";
import { useIframeMinimize } from "@/hooks/useIframeMinimize";
import { useReportAdjustmentActions } from "@/hooks/useReportAdjustmentActions";
import { useReportInsights } from "@/hooks/useReportInsights";
import { loadReportStyle, saveReportStyle } from "@/hooks/useReportStyle";
import { loadReportVoice } from "@/hooks/useReportVoice";
import { useSafeArea } from "@/hooks/useSafeArea";
import { provideChatScope, useChatStore, useUserStore } from "@/stores";
import { getCurrentListenReportDate, isListenReportListened, markListenReportListened } from "@/utils/listen-report";
import { createLogger } from "@/utils/logger";
import { backFromScene, isSceneWindowRoot } from "@/utils/scene-navigation";

/**
 * 听汇报页（播报播放器 + 底部输入栏）。
 *
 * 独立会话域 "podcast"；发送时固定透传 inputs.scene=PODCAST。
 * 进页即按听汇报处理，不再依赖 query 参数。
 */
defineOptions({ name: "AiPodcastPage" });

const logger = createLogger("podcast-page");

const chatScope = provideChatScope("podcast");
const chatStore = useChatStore(chatScope);
const userStore = useUserStore();
const { inputText, isLoading } = storeToRefs(chatStore);
const { safeAreaStyle, safeTopPx } = useSafeArea();
/** PC 端内嵌时播报头部露出「最小化」 */
const { canMinimize, onMinimize } = useIframeMinimize();

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
const reportQaAnswer = ref("");
const reportQaLoading = ref(false);
/** 本轮问答是否从异常列表发起：确认或取消后必须回到异常列表。 */
const reportQaFromInsight = ref(false);
const reportBroadcastPlayerRef = ref<InstanceType<typeof ReportBroadcastPlayer> | null>(null);
const showReportVoiceSelector = ref(false);
/** 是否由播报页「偏好设置」进入配置流程：决定关闭配置页时回播报页还是退出页面。 */
const preferenceEntry = ref(false);
const reportBroadcastParams = ref<PlayListenBroadcastParams | null>(null);
const reportBroadcastPortrait = ref("");
const reportBizDate = ref("");
/** 播报结束后改为页内展示洞察，不再跳转独立路由。 */
const insightVisible = ref(false);
/** 洞察层退场中：等还原动画走完再卸载，期间不接受重复重播。 */
const insightLeaving = ref(false);
/** 异常列表入场是否播放过渡动画：仅播报结束与语音跳转需要。 */
const insightAnimated = ref(true);
/** 播报播放态，由播放器上抛，用于收起态重播按钮的图标切换。 */
const broadcastPlaying = ref(false);
/** 退场定时器句柄，卸载或让位给 QA 时必须清掉。 */
let insightLeaveTimer: ReturnType<typeof setTimeout> | null = null;
/** 洞察列表本次页面访问只加载一次，避免重播后再次收起时又闪骨架屏。 */
let insightLoaded = false;
/** 退场时长，略大于最长一段 0.42s 的还原动画。 */
const INSIGHT_LEAVE_DURATION = 440;
const canToggleInsightUrgent = computed(() => userStore.visitorRole === "OWNER");
/** 本次页面访问一旦展示过闪鉴，后续问答均携带当前异常列表。 */
let hasShownInsight = false;
/** 本轮识别是否已给出 qa answer：有 answer 时视图必须留给 answer。 */
let qaAnswerShown = false;
const {
  rawItems: rawInsightItems,
  visibleItems: visibleInsightItems,
  loading: insightLoading,
  loadingMore: insightLoadingMore,
  hasMore: insightHasMore,
  pendingUrgentTarget: pendingInsightUrgentTarget,
  urgentToastVisible: insightUrgentToastVisible,
  urgentToastMessage: insightUrgentToastMessage,
  loadInitial: loadInsights,
  loadMore: loadMoreInsights,
  setCurrentFilter: setInsightFilter,
  clearCurrentFilter: clearInsightFilter,
  requestUrgentConfirmation: requestInsightUrgentConfirmation,
  executeUrgent: executeInsightUrgent,
  cancelUrgent: cancelInsightUrgent,
  confirmUrgent: confirmInsightUrgent,
  onLightningTap: onInsightUrgentToggle,
  dispose: disposeInsights,
} = useReportInsights();
const reportAdjustmentActions = useReportAdjustmentActions({
  getParams: () => reportBroadcastParams.value,
  setParams: (params) => { reportBroadcastParams.value = params; },
  saveReportStyle,
  getPlayer: () => reportBroadcastPlayerRef.value,
  openInsight: () => { showInsight(); },
  clearInsightFilter() {
    logger.info("[filter_list] podcast.clearInsightFilter 触发");
    clearInsightFilter();
  },
  filterInsightList(action) {
    logger.info("[filter_list] podcast.filterInsightList 入参", { filter: action.filter });
    setInsightFilter(action.filter);
  },
  requestUrgentConfirmation(action) {
    requestInsightUrgentConfirmation(action.target);
    promptUrgentConfirmation(action.message);
  },
  executeUrgent(action) {
    void executeInsightUrgent(action);
  },
  cancelUrgent(action) {
    void cancelInsightUrgent(action);
  },
  updateUrgentConfirmation(action) {
    void confirmInsightUrgent(action.confirmed, action.target);
  },
});
const { sendMessage, beginAsrPlaceholder, discardAsrPlaceholder, stopGenerating, cancelActiveStream } = useChatSend(chatScope, {
  scene: "PODCAST",
  getPodcastExceptions() {
    return hasShownInsight ? rawInsightItems.value : null;
  },
  onReportQa(answer) {
    qaAnswerShown = true;
    reportQaLoading.value = false;
    reportQaAnswer.value = answer;
  },
  onReportAdjustment(action) {
    reportQaLoading.value = false;
    reportQaAnswer.value = "";
    // 走 workflow 通路做兜底：正常调整动作行为不变，万一加急/取消加急被打上 adjustment，也能落到正确分支。
    reportAdjustmentActions.executeWorkflow(action);
    returnToInsightSource();
  },
  onReportNavigation(action) {
    reportQaLoading.value = false;
    reportQaAnswer.value = "";
    reportAdjustmentActions.executeNavigation(action);
    returnToInsightSource();
  },
  onReportWorkflowAction(action) {
    reportQaLoading.value = false;
    reportQaAnswer.value = "";
    reportAdjustmentActions.executeWorkflow(action);
    returnToInsightSource();
  },
  onReportBlockingComplete() {
    reportQaLoading.value = false;
    // 没产出 answer 也没带动作的回合，同样要回到刚才的异常列表。
    if (!qaAnswerShown) returnToInsightSource();
  },
});

function startReportVoiceSelection() {
  preferenceEntry.value = false;
  reportBroadcastParams.value = null;
  reportBroadcastPortrait.value = "";
  showReportVoiceSelector.value = true;
}

function restoreReportBroadcast() {
  // 游客首次收听必须重新选择；已收听状态允许直接复用上次配置。
  if (userStore.isVisitor === true && !isListenReportListened(reportBizDate.value)) {
    startReportVoiceSelection();
    return;
  }

  const voice = loadReportVoice();
  const style = loadReportStyle();
  if (!voice || !style || !style.moduleCodes.length) {
    startReportVoiceSelection();
    return;
  }
  reportBroadcastParams.value = {
    voice: voice.id,
    styleCode: style.styleCode,
    checkedModules: style.moduleCodes,
    bizDate: reportBizDate.value,
  };
  reportBroadcastPortrait.value = voice.hero;
  showReportVoiceSelector.value = false;
}

/**
 * 播报页「偏好设置」入口：复用同一套「选助手 → 选汇报内容」两步流程。
 * 这里刻意不调用 startReportVoiceSelection()——那条路会清空 params，
 * 而本入口需要在用户中途退出时原样退回原来那一轮播报。
 */
function openReportPreference() {
  reportBroadcastPlayerRef.value?.pause();
  preferenceEntry.value = true;
  showReportVoiceSelector.value = true;
}

function closeReportVoiceSelector() {
  showReportVoiceSelector.value = false;
  // 从偏好设置进来的：params 一直保留着，直接退回播报页，不退出整个页面。
  if (preferenceEntry.value) {
    preferenceEntry.value = false;
    return;
  }
  backFromScene();
}

function confirmReportVoice(voice: ReportVoiceOption, style: ListenBroadcastStyle, moduleCodes: string[]) {
  preferenceEntry.value = false;
  reportBroadcastParams.value = {
    voice: voice.id,
    styleCode: style.code,
    checkedModules: moduleCodes,
    bizDate: reportBizDate.value,
  };
  reportBroadcastPortrait.value = voice.hero;
  showReportVoiceSelector.value = false;
}

function markCurrentReportListened(): boolean {
  if (!reportBroadcastParams.value) return false;
  markListenReportListened(getCurrentListenReportDate());
  return true;
}

function closeReportBroadcast() {
  reportAdjustmentActions.dispose();
  if (markCurrentReportListened()) uni.$emit("listen-report-marked");
  reportBroadcastParams.value = null;
  if (isSceneWindowRoot()) {
    backFromScene();
    return;
  }
  const homeUrl = userStore.isVisitor ? "/pages/index/index?mode=demo" : "/pages/index/index";
  uni.redirectTo({ url: homeUrl });
}

function pauseReportBroadcast() {
  reportBroadcastPlayerRef.value?.pause();
}

function clearInsightLeaveTimer() {
  if (insightLeaveTimer === null) return;
  clearTimeout(insightLeaveTimer);
  insightLeaveTimer = null;
}

/**
 * 播报播放结束或收到 open_insight 导航时，页内切换为洞察视图；仅首次加载列表。
 * animated 只在这两个入口传 true，异常处理回到列表时直接呈现，不做过渡。
 */
function showInsight(animated = false) {
  hasShownInsight = true;
  if (insightVisible.value) return;
  clearInsightLeaveTimer();
  insightLeaving.value = false;
  insightAnimated.value = animated;
  insightVisible.value = true;
  if (insightLoaded) return;
  insightLoaded = true;
  void loadInsights();
}

/**
 * 回到本轮交互的来源：只要这一轮问答/动作起始于异常列表，收尾都要留在该列表。
 * 列表已经可见（如语音跳转）时 showInsight() 直接返回，不会覆盖入场过渡。
 * 标记不在这里清：同一轮里 answer 关闭、blocking 收尾等回调还要用它兜底，
 * 只有用户主动回听播（replayInsightBroadcast）或重进页面才重置。
 */
function returnToInsightSource() {
  if (!reportQaFromInsight.value) return;
  showInsight();
}

function promptUrgentConfirmation(message?: string) {
  const target = pendingInsightUrgentTarget.value;
  if (!target) return;
  uni.showModal({
    title: "确认加急",
    content: message || `确认加急处理${target.title || "该异常"}？`,
    confirmText: "确认",
    cancelText: "取消",
    success(result) {
      void confirmInsightUrgent(Boolean(result.confirm));
    },
    fail() {
      void confirmInsightUrgent(false);
    },
  });
}

/**
 * 收起态点击头像下方的播放按钮：与播报页那颗按钮同一套语义
 * （播放中则暂停、暂停中则继续、已播完则从头重播），同时洞察层逆向还原
 * （头像放大归位、声纹与字幕淡回、异常列表向下抽走），动画走完再卸载洞察层。
 */
function replayInsightBroadcast() {
  if (insightLeaving.value) return;
  // 用户主动回听播：后续问答不再回退到异常列表。
  reportQaFromInsight.value = false;
  insightLeaving.value = true;
  reportBroadcastPlayerRef.value?.togglePlayback();
  clearInsightLeaveTimer();
  insightLeaveTimer = setTimeout(() => {
    insightLeaveTimer = null;
    insightVisible.value = false;
    insightLeaving.value = false;
  }, INSIGHT_LEAVE_DURATION);
}

function onBroadcastPlaybackChange(payload: { playing: boolean }) {
  broadcastPlaying.value = payload.playing;
}

function openInsightItem(item: ReportInsightItem) {
  uni.navigateTo({
    url: `/pages/task/index?eventId=${encodeURIComponent(item.id)}&title=${encodeURIComponent(item.title)}`,
  });
}

function dismissReportQa() {
  reportQaLoading.value = false;
  reportQaAnswer.value = "";
  // answer 被关闭、识别失败或录音取消：这一轮同样要回到来源列表。
  returnToInsightSource();
}

function enterReportQaLoading() {
  // QA 答案只在播报视图内渲染，提问时先让出洞察层。
  // 本轮从哪发起就从哪回去：answer 里继续说“确认/取消”时来源保持不变。
  reportQaFromInsight.value = reportQaFromInsight.value || insightVisible.value;
  qaAnswerShown = false;
  clearInsightLeaveTimer();
  insightLeaving.value = false;
  insightVisible.value = false;
  reportQaAnswer.value = "";
  reportQaLoading.value = true;
}

function sendPodcastMessage(payload?: Parameters<typeof sendMessage>[0]) {
  enterReportQaLoading();
  pauseReportBroadcast();
  return sendMessage(payload);
}

function onVoiceStart() {
  pauseReportBroadcast();
}

function onRecognizeBegin() {
  enterReportQaLoading();
  beginAsrPlaceholder();
}

function onRecognizeFail() {
  dismissReportQa();
  discardAsrPlaceholder();
}

onLoad(() => {
  syncWindowHeight();
  reportBizDate.value = getCurrentListenReportDate();
  reportQaAnswer.value = "";
  reportQaLoading.value = false;
  reportQaFromInsight.value = false;
  qaAnswerShown = false;
  insightVisible.value = false;
  insightLeaving.value = false;
  insightLoaded = false;
  hasShownInsight = false;
  broadcastPlaying.value = false;
  restoreReportBroadcast();
  // 每次进来都是全新一轮；发送场景由 useChatSend 固定为 PODCAST。
  chatStore.resetConversation();
  chatStore.showQuickPrompts = false;
  chatStore.showQuickList = false;
});

onUnload(() => {
  if (markCurrentReportListened()) uni.$emit("listen-report-marked");
  cancelActiveStream();
});

onBeforeUnmount(() => {
  clearInsightLeaveTimer();
  reportAdjustmentActions.dispose();
  disposeInsights();
  cancelActiveStream();
});
</script>

<template>
  <view class="podcast-page" :style="safeAreaStyle">
    <!-- 所有页面共用宿主安全区；系统状态栏由手机原生绘制。 -->
    <view class="chat-header__statusbar" :style="statusbarStyle" />
    <ReportVoiceSelector
      v-if="showReportVoiceSelector"
      @confirm="confirmReportVoice"
      @close="closeReportVoiceSelector"
    />
    <view v-else class="podcast-page__chat" :style="chatViewportStyle">
      <!-- 听汇报专用播放视图：QA 仅替换其内部主体区域，不替换页面根结构。 -->
      <ReportBroadcastPlayer
        v-if="reportBroadcastParams"
        ref="reportBroadcastPlayerRef"
        class="podcast-page__broadcast"
        :class="{
          'podcast-page__broadcast--hidden': insightVisible && !insightLeaving,
          'podcast-page__broadcast--restoring': insightLeaving,
          'podcast-page__broadcast--instant': insightVisible && !insightLeaving && !insightAnimated,
        }"
        :params="reportBroadcastParams"
        :portrait="reportBroadcastPortrait"
        :dock-offset="composerDockOffset"
        :qa-loading="reportQaLoading"
        :qa-answer="reportQaAnswer"
        :can-minimize="canMinimize"
        @dismiss-qa="dismissReportQa"
        @minimize="onMinimize"
        @exit-report="closeReportBroadcast"
        @open-preference="openReportPreference"
        @broadcast-finished="showInsight(true)"
        @playback-change="onBroadcastPlaybackChange"
      />
      <!-- 播报结束后页内原地形变出的洞察层：透明容器，不做整层位移 -->
      <view v-if="insightVisible" class="podcast-page__insight">
        <ReportInsight
          embedded
          :items="visibleInsightItems"
          :loading="insightLoading"
          :can-toggle-urgent="canToggleInsightUrgent"
          :urgent-toast-visible="insightUrgentToastVisible"
          :urgent-toast-message="insightUrgentToastMessage"
          :loading-more="insightLoadingMore"
          :has-more="insightHasMore"
          :playing="broadcastPlaying"
          :leaving="insightLeaving"
          :animated="insightAnimated"
          @close="closeReportBroadcast"
          @operator-item-open="openInsightItem"
          @urgent-toggle="onInsightUrgentToggle"
          @load-more="loadMoreInsights"
          @replay="replayInsightBroadcast"
        />
      </view>
      <AiChatInput
        v-model="inputText"
        :attachment-disabled="true"
        :is-loading="isLoading"
        :keyboard-height="keyboardHeight"
        :voice-keyboard-height="voiceKeyboardHeight"
        @send="sendPodcastMessage"
        @stop="stopGenerating"
        @voice-start="onVoiceStart"
        @recognize-begin="onRecognizeBegin"
        @recognize-fail="onRecognizeFail"
        @voice-cancel="onRecognizeFail"
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
.podcast-page {
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

.podcast-page__chat {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  background: #ffffff;
  overflow: hidden;
}

/* 切到洞察时，播报内容原地淡出：只改透明度，保证头像形变起点不位移 */
.podcast-page__broadcast--hidden {
  pointer-events: none;
  animation: podcast-broadcast-hide 0.24s ease-out forwards;
}

/* 非过渡入场：播报层直接让位，不做淡出。
   注意不能只写 animation: none —— 让位靠的就是 podcast-broadcast-hide 的末帧 opacity: 0，
   播报层 z-index: 2 高于洞察层的 0，少了这条透明度就会整层盖住异常列表。 */
.podcast-page__broadcast--hidden.podcast-page__broadcast--instant {
  animation: none;
  opacity: 0;
}

/* 重播时播报内容原地淡回（声纹、字幕、大头像一起回来）。
   延迟 0.2s：此时洞察层头像已放大到接近播报头像的尺寸，两层不会明显重影；
   from 段由 both 保持全透明，避免透明洞察层后面提前露出播报内容。
   0.2 + 0.2 = 0.4s 收尾，早于 0.44s 的卸载时刻，末帧即为基态。 */
.podcast-page__broadcast--restoring {
  animation: podcast-broadcast-restore 0.2s ease-out 0.2s both;
}

/* 洞察层：仅作为定位容器，背景透明，与播报内容在同一白底上交叉过渡 */
.podcast-page__insight {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  overflow: hidden;
  background: transparent;
}

@keyframes podcast-broadcast-hide {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

@keyframes podcast-broadcast-restore {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

:deep(.chat-input) {
  background: #ffffff;
}
</style>

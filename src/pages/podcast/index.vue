<script setup lang="ts">
import type { TtsStreamHandle } from "@/api/chat/tts-stream";
import type {
  AskSlotPayload,
  AskSlotSubmitPayload,
  AssistantNavigationPayload,
  GuideStepPayload,
  GuideSuggestionPayload,
  RealtimeTtsChunk,
} from "@/api/chat/types";
import type { ListenBroadcastStyle, PlayListenBroadcastParams } from "@/api/listen-broadcast/types";
import type { ReportVoiceOption } from "@/config/report-voices";
import type { ReportInsightItem } from "@/hooks/useReportInsights";
import type { ThinkStep } from "@/utils/ai-stream";
import type { AsrStreamSession } from "@/utils/asr/asr-stream-session";
import type { PcmCapture } from "@/utils/asr/pcm-capture";
import { onHide, onLoad, onUnload } from "@dcloudio/uni-app";
import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { recognizeSpeechByBase64, recognizeSpeechByUpload, recognizeSpeechByUrl } from "@/api/chat";
import { consumeTextToSpeechStream } from "@/api/chat/tts-stream";
import { getListenBroadcastConfig, getListenBroadcastPreference } from "@/api/listen-broadcast";
import AiAssistantNavigationSheet from "@/components/ai-assistant-navigation-sheet/index.vue";
import AiGuideStepSheet from "@/components/ai-guide-step-sheet/index.vue";
import AiGuideSuggestionSheet from "@/components/ai-guide-suggestion-sheet/index.vue";
import AiSlotDrawer from "@/components/ai-slot-drawer/index.vue";
import PodcastQaOverlay from "@/components/podcast-qa-overlay/index.vue";
import ReportBroadcastPlayer from "@/components/report-broadcast-player/index.vue";
import ReportInsight from "@/components/report-broadcast-player/report-insight.vue";
import ReportInsightDetail from "@/components/report-insight-detail/index.vue";
import ReportVoiceSelector from "@/components/report-voice-selector/index.vue";
import { REPORT_VOICE_OPTIONS } from "@/config/report-voices";
import { useChatSend } from "@/hooks/useChatSend";
import { useChatViewport } from "@/hooks/useChatViewport";
import { useIframeMinimize } from "@/hooks/useIframeMinimize";
import { useReportAdjustmentActions } from "@/hooks/useReportAdjustmentActions";
import { useReportInsights } from "@/hooks/useReportInsights";
import { loadReportStyle, saveReportStyle } from "@/hooks/useReportStyle";
import { loadReportVoice, resolveReportVoiceId } from "@/hooks/useReportVoice";
import { useSafeArea } from "@/hooks/useSafeArea";
import { provideChatScope, useChatStore, useSystemStore, useUserStore } from "@/stores";
import { stripMarkdownTables } from "@/utils/ai-stream";
import { isAsrStreamSupported, openAsrStreamSession } from "@/utils/asr/asr-stream-session";
import { isNativePcmStreamSupported, startNativePcmCapture } from "@/utils/asr/native-pcm-stream";
import { isPcmCaptureSupported, startPcmCapture } from "@/utils/asr/pcm-capture";
import { resolveTtsLanguage } from "@/utils/asr/voice-language";
import { getCurrentListenReportDate, getCurrentListenReportLanguage, isListenReportListened, markListenReportListened } from "@/utils/listen-report";
import { createLogger } from "@/utils/logger";
import { ensureNativePermission, getMicrophoneVolume, isMpaasReady, permissionDeniedMessage } from "@/utils/platform/mpaas";
import { openRepairAssistant } from "@/utils/repair-h5";
import { stashPendingRepairNavigationContext } from "@/utils/repair-navigation";
import { backFromScene, isSceneWindowRoot } from "@/utils/scene-navigation";
import VoiceRecorder from "@/utils/voiceRecorder.js";

/**
 * 听汇报页（播报播放器 + 底部输入栏）。
 *
 * 独立会话域 "podcast"；发送时固定透传 inputs.scene=PODCAST。
 * 进页即按听汇报处理，不再依赖 query 参数。
 */
defineOptions({ name: "AiPodcastPage" });

const logger = createLogger("podcast-page");
const { locale, t } = useI18n();

const chatScope = provideChatScope("podcast");
const chatStore = useChatStore(chatScope);
const userStore = useUserStore();
const { inputText, isLoading } = storeToRefs(chatStore);
const { safeAreaStyle, safeTopPx } = useSafeArea();
/** PC 端内嵌时播报头部露出「最小化」 */
const { canMinimize, onMinimize } = useIframeMinimize();
/**
 * 折叠屏识别：优先匹配小米 Mix Fold 18 的 model / UA / platform；
 * H5 / 桌面浏览器调试时 model 字段可能为空，但 UA 里通常仍带 Xiaomi / Fold 关键字。
 */
const isMixFold18 = computed(() => {
  try {
    const info = uni.getSystemInfoSync();
    const model = String(info?.model || "");
    const platform = String(info?.platform || "");
    const ua = typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "";
    const combined = `${model} ${platform} ${ua}`;
    return /mix\s*fold\s*18|xiaomi.*mix.*fold|xiaomi.*fold\s*18|xiaomi.*fold/i.test(combined);
  } catch {
    return false;
  }
});

// 顶部状态栏占位：高度随真实机型状态栏高度，避免内容被顶到状态栏底下
const statusbarStyle = computed(() => ({
  height: `${safeTopPx.value}px`,
}));

const {
  chatViewportStyle,
  keyboardHeight,
  voiceKeyboardHeight,
  syncWindowHeight,
  setInputDockHeight,
  setTextInputFocused,
  setVoiceInputFocused,
} = useChatViewport();
const reportQaAnswer = ref("");
const reportQaLoading = ref(false);
/** 思考态小标题：直接展示接口 chat-messages 下发的 subtitle 文案。 */
const reportQaSubtitle = ref("");
/** 录音中（点击说话）：字幕区先隐藏播报文字，实时转写/回答结果随后接管。 */
const voiceRecording = ref(false);
/** 本轮问答的追问卡（首页同款「弹出确认」）：整组题目按顺序入队。 */
const reportQaSlots = ref<AskSlotPayload[]>([]);
const reportQaSlotVisible = ref(false);
/** 指导追问卡（并行分支，选一项即下一轮提问）。 */
const reportQaGuideSuggestion = ref<GuideSuggestionPayload | null>(null);
const reportQaGuideSuggestionVisible = ref(false);
/** 指导步骤卡（多步确认 / 逐轮追问）。 */
const reportQaGuideStep = ref<GuideStepPayload | null>(null);
const reportQaGuideStepVisible = ref(false);
/** 听播页没有对话区核对卡，步骤卡固定从第 1 步打开。 */
const reportQaGuideStepIndex = ref(0);
/** 跳转确认（维修助理）。 */
const reportQaNavigation = ref<AssistantNavigationPayload | null>(null);
const reportQaNavigationVisible = ref(false);
/** 本轮问答是否从异常列表发起：确认或取消后必须回到异常列表。 */
const reportQaFromInsight = ref(false);
const reportBroadcastPlayerRef = ref<InstanceType<typeof ReportBroadcastPlayer> | null>(null);
const showReportVoiceSelector = ref(false);
/**
 * 偏好选择流程（选助手 → 选汇报内容）期间的深色态：
 * 选择器本身只占安全区以下的高度，顶部状态栏是页面级的透明占位，
 * 深色下必须把页面底色一起压成 #0D0D0D（Ardot 1193:1657 画布），否则会留一条白条。
 * 只在选择器开启时生效，播放态 / 聊天态不受影响。
 */
const systemStore = useSystemStore();
const preferenceDark = computed(() => showReportVoiceSelector.value && systemStore.isDark);
/**
 * 是否「直接起播」（`?direct=1`）：对话里命中 <WORK_REPORT> 标签、首页概览卡「去收听」、
 * 底部胶囊「听汇报」这些入口都带它，跳过「选助手 → 选汇报内容」两步，
 * 直接按服务端偏好 / 本机记忆 / 默认配置起播（也就是不再经过风格设置页）。
 */
let directBroadcast = false;
/**
 * 进页拉取听播偏好过程中的 loading 态：
 * 进页不再走 localStorage / 默认值兜底，必须等服务端的偏好回包后再决定展示播报还是选择页，
 * 期间用一个轻量 loading 占位，避免在 rpx 放大屏型下出现"空白一闪"。
 */
const preferenceLoading = ref(true);
const reportBroadcastParams = ref<PlayListenBroadcastParams | null>(null);
const reportBroadcastPortrait = ref("");
const reportBizDate = ref("");
/**
 * 播报语言：来自对话里 `<WORK_REPORT language="…">` 标签，进页从 storage 取，
 * 随 `/listen-broadcast/play` 的入参下发。标签没带 language 时为空，
 * 入参里就不出现该字段，由后端按默认语言处理。
 */
const reportTagLanguage = ref("");
/** 播报结束后改为页内展示洞察，不再跳转独立路由。 */
const insightVisible = ref(false);
/**
 * 听播页深色：外观选深色或跟随系统且系统为深色时命中。
 * 对应暗色稿 1193:2708「正在播放」/ 1193:3357「正在回答」/ 1193:1864「点击功能件-中途提问」/
 * 1193:1773「闪鉴-异常列表」。异常详情弹窗（11101:714）没有暗色稿，仍是浅色浮层。
 */
const pageDark = computed(() => systemStore.isDark);
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

/**
 * 异常列表里发起的问答改用全屏覆盖层展示「正在理解 / 回答结果」。
 * 条件：当前在异常列表 + 本轮问答来自异常列表 + 问答进行中（录音中 / 识别中 / 已返回答案）。
 * 录音中也要保持覆盖层挂载，否则点下「点击说话」的瞬间层会被收起，
 * 底部录音条会落到下面的异常列表上。
 */
const qaOverlayVisible = computed(
  () =>
    insightVisible.value
    && reportQaFromInsight.value
    && (voiceQueryActive.value || reportQaLoading.value || Boolean(reportQaAnswer.value)),
);
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
const { sendMessage, sendAskSlotSelection, beginAsrPlaceholder, discardAsrPlaceholder, stopGenerating, cancelActiveStream } = useChatSend(chatScope, {
  /**
   * 场景按当前所处的视图现取：
   * - 从异常列表发起（汇报结束自动进入的洞察页 / 点「消异常」进入的列表）：必须走 PODCAST，
   *   加急、取消加急、筛选列表这类语音动作由后端 PODCAST 分支下发协议体，否则只会得到一句普通回答；
   * - 播报视图里的提问：沿用与首页问问一致的口径。
   */
  scene: () => (reportQaFromInsight.value ? "PODCAST" : "ASK"),
  getPodcastExceptions() {
    return hasShownInsight ? rawInsightItems.value : null;
  },
  /** 思考态小标题跟随接口 subtitle 事件（如「目标 Dify 工作流已开始。」）实时刷新。 */
  onProcessSubtitle(subtitle) {
    // 空白一律跳过、沿用上一句：快收尾时接口会补一条空文案，
    // 那一拍回答气泡还没渲染出来，置空会让思考态下面这行字突然空白。
    // 新一轮开始时 enterReportQaLoading 会主动清空，不会串到下一轮。
    const text = subtitle == null ? "" : String(subtitle).trim();
    if (!text) return;
    reportQaSubtitle.value = text;
  },
  onReportQa(answer) {
    qaAnswerShown = true;
    reportQaLoading.value = false;
    // 表格不进听播：正文里的 Markdown 表格先摘掉，展示与朗读都不带表格。
    const text = stripMarkdownTables(answer);
    reportQaAnswer.value = text;
    // 答案里带追问卡 / 步骤卡 / 跳转确认时，按首页同款逻辑自动弹起对应弹层。
    openReportQaOverlays();
    // 答案回来了：用 TTS 把回答朗读出来，播报已经处于暂停态，无需再切。
    playAnswerTts(text);
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

// —— 回答 TTS：发问得到答案后，用停播 + TTS 朗读把结果播出来 ——
// 流式合成（POST /speech/tts/v2/stream）支持任意文本，不必依赖 chat/tts 的 messageId。
interface AnswerTtsAudioItem {
  dataUrl?: string | null;
  audioBase64?: string | null;
  format?: string | null;
}
let answerTtsSeq = 0;
let answerTtsStream: TtsStreamHandle | null = null;
let answerTtsActiveAudio: ReturnType<typeof uni.createInnerAudioContext> | null = null;
let answerTtsQueue: AnswerTtsAudioItem[] = [];
let answerTtsStreamFinished = false;
/** 是否正在播放问答 TTS，供 UI 展示「正在朗读…」状态。 */
const answerTtsPlaying = ref(false);

function guessAnswerTtsMime(base64: string) {
  return base64.startsWith("UklGR") ? "audio/wav" : "audio/mpeg";
}

/**
 * 把后端返回的回答文本清洗成自然连贯的中文口播文本：
 * 去掉残留的协议块、markdown 符号与多余换行，避免 TTS 把 * # 这类符号读出来。
 */
function cleanAnswerText(raw: string): string {
  let text = String(raw || "");
  text = text.replace(/<(SANVIST|ASK|GUIDE|COMPONENT|PODCAST)>[\s\S]*?<\/\1>/g, "");
  text = text.replace(/```[\s\S]*?```/g, "");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2");
  text = text.replace(/[*_~`#>\-]/g, "");
  text = text.replace(/\n+/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  if (text && !/[。！？!?；;]$/.test(text)) text += "。";
  return text;
}

/**
 * 问答回答的播报语言：优先本轮语音识别出来的语言（ASR 回传的 language），
 * 没识别过才退回界面语言。
 */
function resolveAnswerTtsLanguage() {
  return resolveTtsLanguage(locale.value);
}

function playNextAnswerTtsChunk(seq: number) {
  if (seq !== answerTtsSeq) return;
  if (answerTtsActiveAudio) return;
  const item = answerTtsQueue.shift();
  if (!item) {
    if (answerTtsStreamFinished) {
      answerTtsPlaying.value = false;
    }
    return;
  }
  const dataUrl = String(item.dataUrl || "").trim();
  const base64 = String(item.audioBase64 || "").trim();
  // 占位/失败帧直接跳过
  if (!dataUrl && !base64) {
    playNextAnswerTtsChunk(seq);
    return;
  }
  const audio = uni.createInnerAudioContext();
  answerTtsActiveAudio = audio;
  if (dataUrl) {
    audio.src = dataUrl;
  } else if (base64.startsWith("data:")) {
    audio.src = base64;
  } else {
    audio.src = `data:${guessAnswerTtsMime(base64)};base64,${base64}`;
  }
  audio.onEnded(() => {
    if (answerTtsActiveAudio !== audio) return;
    answerTtsActiveAudio = null;
    audio.destroy?.();
    playNextAnswerTtsChunk(seq);
  });
  audio.onError((error) => {
    if (answerTtsActiveAudio !== audio) return;
    logger.warn("回答 TTS 单句播放失败", error);
    answerTtsActiveAudio = null;
    audio.destroy?.();
    playNextAnswerTtsChunk(seq);
  });
  audio.autoplay = true;
}

function stopAnswerTts() {
  answerTtsSeq += 1;
  answerTtsStream?.cancel();
  answerTtsStream = null;
  answerTtsStreamFinished = true;
  answerTtsQueue = [];
  if (answerTtsActiveAudio) {
    try {
      answerTtsActiveAudio.stop();
      answerTtsActiveAudio.destroy?.();
    } catch (error) {
      logger.warn("停止回答 TTS 失败", error);
    }
    answerTtsActiveAudio = null;
  }
  answerTtsPlaying.value = false;
}

function playAnswerTts(answer: string) {
  stopAnswerTts();
  const text = cleanAnswerText(answer);
  if (!text) return;
  const seq = ++answerTtsSeq;
  answerTtsStreamFinished = false;
  answerTtsPlaying.value = true;
  const language = resolveAnswerTtsLanguage();
  // 音色现取本机记忆（可能刚被「<VOICE_STYLE style="…">」标签改过），没有再退回本轮听播参数；
  // 都没取到就不带这个字段，由后端按默认音色合成
  const voice = resolveReportVoiceId() || String(reportBroadcastParams.value?.voice || "").trim();
  try {
    answerTtsStream = consumeTextToSpeechStream(
      { text, language, ...(voice ? { voice } : {}) },
      (payload) => {
        if (seq !== answerTtsSeq) return;
        if (!payload || typeof payload !== "object") return;
        const chunk = payload as RealtimeTtsChunk;
        if (chunk.event === "done") return;
        if (typeof chunk.seq === "number") {
          answerTtsQueue.push({
            dataUrl: chunk.dataUrl ?? null,
            audioBase64: chunk.audioBase64 ?? null,
            format: chunk.format ?? null,
          });
          playNextAnswerTtsChunk(seq);
        }
      },
      (error) => {
        if (seq !== answerTtsSeq) return;
        logger.warn("回答 TTS 请求失败", error);
        answerTtsStreamFinished = true;
        playNextAnswerTtsChunk(seq);
      },
      () => {
        if (seq !== answerTtsSeq) return;
        answerTtsStreamFinished = true;
        playNextAnswerTtsChunk(seq);
      },
    );
  } catch (error) {
    if (seq !== answerTtsSeq) return;
    logger.warn("启动回答 TTS 失败", error);
    answerTtsStreamFinished = true;
    answerTtsPlaying.value = false;
  }
}

/**
 * 还原进页流程：先进偏好选择（选助手 → 选汇报内容），确认后才进播报页。
 */
function startReportVoiceSelection() {
  reportBroadcastParams.value = null;
  reportBroadcastPortrait.value = "";
  // 偏好选择器优先于「正在加载偏好」骨架屏：两者都打开时先看选择器
  preferenceLoading.value = false;
  showReportVoiceSelector.value = true;
}

function restoreReportBroadcast() {
  // 带 ?direct=1 进来（<WORK_REPORT> 标签 / 去收听 / 听汇报入口）：中间不要偏好选择，直接起播
  if (directBroadcast) {
    showReportVoiceSelector.value = false;
    loadPreferenceBroadcastParams();
    return;
  }
  // 游客首次收听必须重新选择；已收听状态允许直接复用上次配置。
  if (userStore.isVisitor === true && !isListenReportListened(reportBizDate.value)) {
    startReportVoiceSelection();
    return;
  }
  // 本机没存过音色 / 风格 → 同样先进偏好选择，不替用户拿默认值决定。
  // 风格码在、模块为空（`<REPORT_STYLE>` 标签只下发风格码）不算没配过：模块由服务端偏好 /
  // 该风格的默认模块补齐（见 applyDefaultBroadcastParams），别把用户拽回选择器。
  const savedVoice = loadReportVoice();
  const savedStyle = loadReportStyle();
  if (!savedVoice || !savedStyle) {
    startReportVoiceSelection();
    return;
  }
  showReportVoiceSelector.value = false;
  loadPreferenceBroadcastParams();
}

/** 已选过偏好时进页：拉服务端偏好命中就按偏好起播，否则退回本机记忆 / 默认配置 */
function loadPreferenceBroadcastParams() {
  // 进页先拉服务端偏好：
  //   - 偏好按「风格」分条返回：每条风格独立带音色 / 模块 / 时间
  //   - 先确定「当前活跃的 styleCode」：用户本机上次选过的 → 没有才退而求其次取数组首条
  //   - 在 preference.styles 里按 styleCode 命中同一条，把同条上的 voiceCode / checkedModules
  //     一起拿出来赋给音色 / 风格 / 汇报模块
  //   - 没命中 / voiceCode 解析不到 / 接口异常 → 落到默认配置
  preferenceLoading.value = true;
  void getListenBroadcastPreference()
    .then((preference) => {
      const styles = Array.isArray(preference?.styles) ? preference.styles : [];
      const targetStyleCode = String(
        loadReportStyle()?.styleCode
        || styles[0]?.styleCode
        || "",
      ).trim();
      const matched = targetStyleCode
        ? styles.find(item => String(item?.styleCode || "").trim() === targetStyleCode)
        : null;
      if (matched) {
        const voiceCode = String(matched.voiceCode || "").trim();
        const modules = Array.isArray(matched.checkedModules) ? matched.checkedModules : [];
        const voice = voiceCode
          ? REPORT_VOICE_OPTIONS.find(item => item.id === voiceCode)
          : null;
        if (voice) {
          applyReportBroadcastParams(voice, matched.styleCode, modules);
          return;
        }
        // styleCode 命中但 voiceCode 解析不到：音色退回本机记忆 / 兜底第一项，风格/模块仍按偏好赋上
        // （避免页面卡在默认配置、把用户已选过的汇报模块丢掉）
        const fallbackVoice = loadReportVoice() || REPORT_VOICE_OPTIONS[0];
        logger.warn("unknown voiceCode in preference style, fall back to default voice", { voiceCode });
        applyReportBroadcastParams(fallbackVoice, matched.styleCode, modules);
        return;
      }
      logger.warn("no matching style in preference, fall back to defaults", { targetStyleCode });
      applyDefaultBroadcastParams();
    })
    .catch((error) => {
      logger.warn("failed to load listen broadcast preference, fall back to defaults", error);
      applyDefaultBroadcastParams();
    })
    .finally(() => {
      preferenceLoading.value = false;
    });
}

/**
 * 服务端没有偏好时的默认配置：与首版进页行为保持一致。
 * 优先用 localStorage 里用户上次选过的音色 / 风格；都没有再拉一次 config 接口取第一个风格的默认模块。
 */
function applyDefaultBroadcastParams() {
  const voice = loadReportVoice() || REPORT_VOICE_OPTIONS[0];
  const savedStyle = loadReportStyle();
  if (savedStyle && savedStyle.moduleCodes.length) {
    applyReportBroadcastParams(voice, savedStyle.styleCode, savedStyle.moduleCodes);
    return;
  }
  /**
   * 只知道风格码、不知道汇报模块（`<REPORT_STYLE style="…">` 标签只下发风格）：
   * 按该风格的默认模块补一次；标签指定的风格码即使不在 config 列表里也原样保留 ——
   * /listen-broadcast/play 的 styleCode 以它为准，只是拿不到该风格的默认模块（交给服务端按风格处理）。
   * 没有风格码（首次进页）才退回配置第一条。
   */
  const savedStyleCode = String(savedStyle?.styleCode || "").trim();
  void getListenBroadcastConfig()
    .then((config) => {
      const styles = Array.isArray(config?.styles) ? config.styles : [];
      const matched = savedStyleCode
        ? styles.find(item => String(item?.code || "") === savedStyleCode)
        : styles[0];
      const styleCode = savedStyleCode || String(matched?.code || "").trim();
      if (!styleCode) return;
      const nextVoice = loadReportVoice() || REPORT_VOICE_OPTIONS[0];
      applyReportBroadcastParams(nextVoice, styleCode, matched?.defaultModules || []);
    })
    .catch((error) => {
      logger.warn("failed to load listen broadcast config for default style", error);
    });
  // 接口返回前先按空 modules 启动，让播放器先出现；模块到位后由 store 拉取刷新。
  applyReportBroadcastParams(voice, savedStyleCode || "operation-overview", []);
}

function applyReportBroadcastParams(voice: ReportVoiceOption, styleCode: string, moduleCodes: string[]) {
  reportBroadcastParams.value = {
    voice: voice.id,
    styleCode,
    checkedModules: moduleCodes,
    bizDate: reportBizDate.value,
    // 对话里 <WORK_REPORT language="…"> 指定的播报语言，原样交给 /listen-broadcast/play
    ...(reportTagLanguage.value ? { language: reportTagLanguage.value } : {}),
  };
  reportBroadcastPortrait.value = voice.hero;
  showReportVoiceSelector.value = false;
}

function closeReportVoiceSelector() {
  showReportVoiceSelector.value = false;
  // 选择器只在进页偏好流程里出现，关掉即退出场景
  backFromScene();
}

function confirmReportVoice(voice: ReportVoiceOption, style: ListenBroadcastStyle, moduleCodes: string[]) {
  reportBroadcastParams.value = {
    voice: voice.id,
    styleCode: style.code,
    checkedModules: moduleCodes,
    bizDate: reportBizDate.value,
    // 沿用本轮从 <WORK_REPORT> 标签带进来的播报语言（手动改偏好不该把它丢掉）
    ...(reportTagLanguage.value ? { language: reportTagLanguage.value } : {}),
  };
  reportBroadcastPortrait.value = voice.hero;
  showReportVoiceSelector.value = false;
}

function markCurrentReportListened(): boolean {
  if (!reportBroadcastParams.value) return false;
  markListenReportListened(getCurrentListenReportDate());
  return true;
}

/**
 * 播报自然播完后的自动回跳：回到发起问答页（首页 / 关闭场景窗口）。
 * 跳转不要太快 —— 播完先停 500ms，让结束态（声波停、字幕落定）过一拍再走。
 */
const BROADCAST_FINISH_REDIRECT_DELAY_MS = 500;
let broadcastFinishRedirectTimer: ReturnType<typeof setTimeout> | null = null;

function clearBroadcastFinishRedirectTimer() {
  if (broadcastFinishRedirectTimer === null) return;
  clearTimeout(broadcastFinishRedirectTimer);
  broadcastFinishRedirectTimer = null;
}

function onBroadcastFinished() {
  clearBroadcastFinishRedirectTimer();
  broadcastFinishRedirectTimer = setTimeout(() => {
    broadcastFinishRedirectTimer = null;
    // 等待期间用户已切到异常列表 / 问答覆盖层 / 录音态，就不再自动跳页
    if (insightVisible.value || qaOverlayVisible.value || voiceQueryActive.value) return;
    closeReportBroadcast();
  }, BROADCAST_FINISH_REDIRECT_DELAY_MS);
}

function closeReportBroadcast() {
  clearBroadcastFinishRedirectTimer();
  // 退出播报（回问问 / 关场景窗口）前先收尾：页面对应的卸载回调在跳转后才执行，
  // 这里主动停一次，避免过渡期间答案还在念。
  stopPlaybackOnLeave();
  reportAdjustmentActions.dispose();
  if (markCurrentReportListened()) uni.$emit("listen-report-marked");
  reportBroadcastParams.value = null;
  if (isSceneWindowRoot()) {
    backFromScene();
    return;
  }
  /**
   * 回到「发起听汇报」的那个页面实例：栈里有上一页就 navigateBack ——
   * 那个实例的会话、入口卡（音频卡片「去收听」等）原样保留。
   * 不能再用 redirectTo 新建首页：那会重造一个 index 实例，
   * 表现为「回来没有之前的听汇报卡片、直接变成新对话」。
   * 只有没有上一页（直接用 url 打开）时才 redirectTo 兜底首页。
   */
  backFromScene(userStore.isVisitor ? "/pages/index/index?mode=demo" : "/pages/index/index");
}

function pauseReportBroadcast() {
  reportBroadcastPlayerRef.value?.pause();
}

/**
 * 离开播报视图前的统一收尾：正在朗读的答案 TTS 与播报一起停。
 *
 * 答案朗读是一次性的，直接 stop（回来不会再响）；
 * 播报走 pause，返回本页时还能从当前句继续。
 */
function stopPlaybackOnLeave() {
  stopAnswerTts();
  pauseReportBroadcast();
}

function clearInsightLeaveTimer() {
  if (insightLeaveTimer === null) return;
  clearTimeout(insightLeaveTimer);
  insightLeaveTimer = null;
}

/**
 * 收到 open_insight 导航或用户主动看异常时，页内切换为洞察视图；仅首次加载列表。
 * 播报自然结束不再自动切过来，停留在播报视图的结束态（可重播 / 退出）。
 * animated 目前没有入口传 true，异常处理回到列表时直接呈现，不做过渡。
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
    title: t("podcast-urgent-confirm-title"),
    // message 来自工作流动作（后端下发），有值时原样展示
    content: message || t("podcast-urgent-confirm-content", {
      target: target.title || t("podcast-urgent-confirm-target"),
    }),
    confirmText: t("confirm"),
    cancelText: t("cancel"),
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

function onBroadcastPlaybackChange(payload: { playing: boolean; loading: boolean }) {
  broadcastPlaying.value = payload.playing;
}

// 继续播报：字幕区从问答态还原回播报文字，同时停掉答案朗读。
watch(broadcastPlaying, (isPlaying) => {
  if (!isPlaying) return;
  if (!reportQaLoading.value && !reportQaAnswer.value && !voiceRecording.value) return;
  stopAnswerTts();
  reportQaLoading.value = false;
  reportQaAnswer.value = "";
  reportQaSubtitle.value = "";
  voiceRecording.value = false;
});

function openInsightItem(item: ReportInsightItem) {
  // 点异常条目跳任务页：先把播报和答案朗读停掉，别跟着跳过去还在念
  stopPlaybackOnLeave();
  uni.navigateTo({
    url: `/pages/task/index?eventId=${encodeURIComponent(item.id)}&title=${encodeURIComponent(item.title)}`,
  });
}

/**
 * 异常详情弹窗（设计稿 11101:714）：汇报结束后点击异常条目正文触发。
 * 父组件只持有当前选中的条目，弹窗自身管理显隐（v-if="detailItem"）。
 */
const detailItem = ref<ReportInsightItem | null>(null);

function openInsightDetail(item: ReportInsightItem) {
  detailItem.value = item;
}

function closeInsightDetail() {
  detailItem.value = null;
}

/**
 * 弹窗「加急处理」按钮：OWNER 走加急 toggle（与列表里的闪电按钮同语义，无需二次确认），
 * 非 OWNER 则回退到跳任务页的原有路径。处理后顺手关闭弹窗。
 */
async function onInsightDetailUrgent(item: ReportInsightItem) {
  if (canToggleInsightUrgent.value) {
    await onInsightUrgentToggle(item);
  } else {
    openInsightItem(item);
  }
  closeInsightDetail();
}

/**
 * 开一轮新的听播问答：与输入栏提问保持同一套交互
 * （先停答案朗读 → 问答区回到「正在理解」→ 暂停播报，等新答案回来）。
 */
function beginReportQaTurn() {
  stopAnswerTts();
  enterReportQaLoading();
  pauseReportBroadcast();
}

/**
 * 答案里需要弹层的块自动弹起：语义与首页各 Block 的 auto_open 完全一致
 * （追问卡 / 指导追问卡 / 指导步骤卡 / 跳转确认），数据直接取本轮流式消息里
 * 已解析好的 blocks —— 与首页共用同一份协议解析结果，不另做一套解析。
 */
function openReportQaOverlays() {
  const message = [...chatStore.messages].reverse().find(item => item.role === "ai");
  const blocks = Array.isArray(message?.blocks) ? message.blocks : [];

  blocks.forEach((block) => {
    if (block.payload?.auto_open !== true) return;

    if (block.type === "ask-slot") {
      const slot = block.payload as AskSlotPayload;
      // 作业协同式多步骤表单会一次带来整组题目，拆开按顺序入队（与首页一致）
      const incoming = Array.isArray(slot.slots) && slot.slots.length ? [...slot.slots] : [slot];
      reportQaSlots.value = incoming;
      reportQaSlotVisible.value = true;
      return;
    }
    if (block.type === "guide-suggestion") {
      reportQaGuideSuggestion.value = block.payload as GuideSuggestionPayload;
      reportQaGuideSuggestionVisible.value = true;
      return;
    }
    if (block.type === "guide-step") {
      const payload = block.payload as GuideStepPayload;
      // 听播页不提供附件入口（输入栏已关闭上传）：清掉附件按钮文案，避免出现点了没反应的按钮
      const steps = Array.isArray(payload.steps)
        ? payload.steps.map(step => ({ ...step, photo_text: "" }))
        : [];
      reportQaGuideStep.value = { ...payload, steps };
      reportQaGuideStepIndex.value = 0;
      reportQaGuideStepVisible.value = true;
      return;
    }
    if (block.type === "assistant-navigation") {
      const payload = block.payload as AssistantNavigationPayload;
      if (payload.target !== "maintenance_assistant") return;
      reportQaNavigation.value = payload;
      reportQaNavigationVisible.value = true;
    }
  });
}

function closeReportQaSlot() {
  reportQaSlotVisible.value = false;
}

/** 提交追问卡：作答拼成一句提问继续发送（与首页同一条 sendAskSlotSelection）。 */
function onReportQaSlotSubmit(payload: AskSlotSubmitPayload) {
  reportQaSlotVisible.value = false;
  reportQaSlots.value = [];
  beginReportQaTurn();
  sendAskSlotSelection(payload);
}

/** 指导追问卡 / 步骤卡选完或填完的问题：按普通提问发出去，交互与输入栏一致。 */
function onReportQaQuerySubmit(query: string) {
  reportQaGuideSuggestionVisible.value = false;
  reportQaGuideStepVisible.value = false;
  const text = String(query || "").trim();
  if (!text) return;
  beginReportQaTurn();
  void sendMessage({ text });
}

/** 跳转确认：与首页同一套口径 —— pushWindow 直达三方维修 H5，本地壳页只做兜底。 */
function onReportQaNavigationConfirm(payload: AssistantNavigationPayload) {
  if (payload.target !== "maintenance_assistant") return;
  // 回调摘要轮询只保留在首页：听播页不写 pending，避免残留数据被首页误消费
  // 跳到维修助理前收尾：别把播报 / 答案朗读带过去
  stopPlaybackOnLeave();
  void openRepairAssistant({
    sessionId: String(payload.sessionId || ""),
    conversationId: String(payload.conversationId || ""),
    // 三方页进来会 query_question 来要这句提问（另一个 webview，走通知通道回给它）
    question: String(payload.context?.query || ""),
    // 上下文只在降级回本地壳页时才落盘（直连三方页走 URL 参数）
    onFallback: () => {
      stashPendingRepairNavigationContext({
        ...payload.context,
        userId: userStore.userId,
        sessionId: payload.sessionId,
        conversationId: payload.conversationId,
      });
    },
  });
}

function dismissReportQa() {
  // 用户主动关闭：把正在朗读的 TTS 也停掉，避免空场继续播音。
  stopAnswerTts();
  voiceRecording.value = false;
  reportQaLoading.value = false;
  reportQaAnswer.value = "";
  reportQaSubtitle.value = "";
  // answer 被关闭、识别失败或录音取消：这一轮同样要回到来源列表。
  returnToInsightSource();
}

/**
 * 异常列表发起的问答：用户在覆盖层上点确认 / 返回。
 * 关闭覆盖层、停掉 TTS、清空问答状态，异常列表原地保留。
 */
function confirmReportQaOverlay() {
  stopAnswerTts();
  voiceRecording.value = false;
  reportQaLoading.value = false;
  reportQaAnswer.value = "";
  reportQaSubtitle.value = "";
  reportQaFromInsight.value = false;
  // 顺手关闭可能仍开着的追问/导航弹层，避免遮住异常列表
  reportQaSlotVisible.value = false;
  reportQaSlots.value = [];
  reportQaGuideSuggestionVisible.value = false;
  reportQaGuideStepVisible.value = false;
  reportQaGuideStepIndex.value = 0;
  reportQaNavigationVisible.value = false;
  reportQaNavigation.value = null;
}

/**
 * 问答进行中点击输入栏的停止按钮（思考中 / 正在朗读答案都算）。
 * 原来只调 stopGenerating()：它仅在流式回答还没结束时生效，一旦答案已经到达、
 * TTS 正在朗读，它就是空操作 —— 页面因此停在问答态：播报一直暂停、
 * 字幕还挂在上一轮答案上。这里补齐后半段收尾：
 * 掐断本轮回答 → 停朗读 → 清问答态 → 回到异常列表（列表发起的）
 * 或把字幕还原成播报文字，并从暂停处继续播报。
 */
function stopPodcastAnswer() {
  stopGenerating();
  if (reportQaFromInsight.value) {
    // 异常列表发起的问答：与覆盖层「←」返回同一套收尾，原地停在列表上
    confirmReportQaOverlay();
    return;
  }
  stopAnswerTts();
  voiceRecording.value = false;
  reportQaLoading.value = false;
  reportQaAnswer.value = "";
  reportQaSubtitle.value = "";
  // 从暂停处继续播报；本轮播报若已读完，resume 不会动作，字幕仍回到播报文字
  reportBroadcastPlayerRef.value?.resume();
}

function enterReportQaLoading() {
  // 本轮从哪发起就从哪回去：answer 里继续说“确认/取消”时来源保持不变。
  reportQaFromInsight.value = reportQaFromInsight.value || insightVisible.value;
  qaAnswerShown = false;
  clearInsightLeaveTimer();
  // 从异常列表发起的问答：保留 insightVisible，全屏覆盖层会盖在异常列表上展示问答内容。
  // 仅在非异常列表来源（播报视图发起）时，才让出洞察层、回到播报视图内展示。
  if (!reportQaFromInsight.value) {
    insightLeaving.value = false;
    insightVisible.value = false;
  }
  reportQaAnswer.value = "";
  reportQaSubtitle.value = "";
  reportQaLoading.value = true;
}

function sendPodcastMessage(payload?: Parameters<typeof sendMessage>[0]) {
  // 新一轮提问：先停掉上一轮可能还在朗读的 TTS，避免答案串台。
  stopAnswerTts();
  enterReportQaLoading();
  pauseReportBroadcast();
  return sendMessage(payload);
}

// ——————————————————————————————————————————————————————————————
// 点击说话：与首页同一套语音提问链路（WebSocket 流式 ASR + 底部录音条）
//
// 听播页原来走的是 AiChatInput 内置的「按住说话」长按手势（松手后整段录音上传识别），
// 这里整体换成首页的点击说话：点一下即开始录音，边说边出字，静音 1.5s 自动收尾，
// 定稿后原地发问。识别结果写在字幕区（首页是长在提问气泡里），
// 录音期间底部换成 AiVoiceQueryBar（取消 / 声纹 / 计时 / 发送）。
// ——————————————————————————————————————————————————————————————
const voiceQueryActive = ref(false);
/** 本轮实时转写文本：录音中占用字幕区，逐字刷新 */
const voiceTranscript = ref("");
/** 实时音量 0~1（已平滑）：驱动底部录音条的声纹长短 */
const voiceLevel = ref(0);
/** 已录秒数：底部录音条右侧那枚 4s */
const voiceSeconds = ref(0);
/** 已发过 finish、正在等 final：静音检测 / 手动发送都可能触发，用它防重 */
const voiceFinishing = ref(false);
/** 本轮 ASR 占位气泡的 id：partial / final 按 id 回填，不用下标 */
const voicePlaceholderId = ref("");
let voiceSession: AsrStreamSession | null = null;
let voiceCapture: PcmCapture | null = null;
/** 每轮一个序号：重置 / 重开时让旧回调自行作废 */
let voiceSeq = 0;
let voiceTickTimer: ReturnType<typeof setInterval> | null = null;
/** 静音收尾：连续这么久没声音就认为说完了（与首页同一口径） */
const VOICE_SILENCE_MS = 1500;
/** 一直没听到人声的兜底：别让麦克风空转 */
const VOICE_NO_SPEECH_MS = 8000;
/** 判定「有声音」的 RMS 阈值，低于它按静音算 */
const VOICE_LEVEL_THRESHOLD = 0.015;
let voiceNoSpeechTimer: ReturnType<typeof setTimeout> | null = null;
let voiceSilenceSince = 0;
let voiceHeard = false;
/**
 * 本轮走哪条录音链路：
 * - stream：WebAudio 采集 + 流式 ASR，能逐字出文字（iOS / 普通浏览器）；
 * - native：mPaaS 原生录音 + 整段识别，Android WebView 这类拿不到可用音频的容器里用它兜底。
 */
let voiceBackend: "stream" | "native" = "stream";
/** 原生录音器：只有降级后才创建 */
let nativeVoiceRecorder: VoiceRecorderInstance | null = null;
/** 原生通道的音量轮询：没有 partial，声纹和静音收尾全靠它 */
let nativeLevelTimer: ReturnType<typeof setInterval> | null = null;
/** 每轮只降级一次，避免两条链路互相打架 */
let voiceDegraded = false;
/** 原生通道整段识别的最长等待：超时就当没识别到，别把录音条一直挂在「识别中」 */
const NATIVE_RECOGNIZE_TIMEOUT_MS = 30_000;
/** 原生录音的硬上限：只做兜底，正常收尾靠用户点发送（↑） */
const NATIVE_MAX_RECORD_MS = 60_000;
/** 原生通道这一轮听到的最大音量：排查「有没有真的收到声音」时打日志用 */
let nativePeakLevel = 0;

/** 原生录音回传的音频形态：容器里一般给 audioUrl，也有的直接回 base64 */
interface NativeRecorderAudio {
  audioUrl?: string;
  audioBase64?: string;
  mimeType?: string;
  tempFilePath?: string;
}

/**
 * VoiceRecorder 在 utils 下是 .js（构造时按环境返回原生 / 浏览器实现），
 * 声明文件里看不到实例方法，这里补一份本地结构，免得整页用 any。
 */
interface VoiceRecorderInstance {
  start: (options?: { sampleRate?: number; timeSlice?: number }) => Promise<{ success?: boolean; error?: string; data?: NativeRecorderAudio } | undefined>;
  stop: () => Promise<{ success?: boolean; error?: string; data?: NativeRecorderAudio } | undefined>;
  cancel?: () => void;
  release?: () => void;
}

/** 停掉原生通道的音量轮询 */
function stopNativeLevelPolling() {
  if (nativeLevelTimer) {
    clearInterval(nativeLevelTimer);
    nativeLevelTimer = null;
  }
}

/**
 * keepPlaceholder：final 已经回来、准备发问时置 true —— 占位气泡要留给 sendMessage 原地替换成正式提问，
 * 这里不能删，否则会先撤掉再 push 一条新的。
 */
function resetVoiceQuery(options?: { keepPlaceholder?: boolean }) {
  // 序号自增：正在 await 权限 / 采集的启动流程据此自行作废
  voiceSeq += 1;
  voiceQueryActive.value = false;
  voiceTranscript.value = "";
  voiceFinishing.value = false;
  voiceLevel.value = 0;
  voiceSeconds.value = 0;
  voiceSilenceSince = 0;
  voiceHeard = false;
  // 字幕区还原成播报文字（录音态结束）
  voiceRecording.value = false;
  if (voiceNoSpeechTimer) {
    clearTimeout(voiceNoSpeechTimer);
    voiceNoSpeechTimer = null;
  }
  if (voiceTickTimer) {
    clearInterval(voiceTickTimer);
    voiceTickTimer = null;
  }
  voiceCapture?.stop();
  voiceCapture = null;
  voiceSession?.close();
  voiceSession = null;
  // 降级到原生录音的那一轮：停轮询、放掉录音器（正常收尾时 finishNativeVoiceQuery 已经置空）
  stopNativeLevelPolling();
  if (nativeVoiceRecorder) {
    try {
      (nativeVoiceRecorder.release ?? nativeVoiceRecorder.cancel)?.call(nativeVoiceRecorder);
    }
    catch (error) {
      logger.warn("native recorder release failed", error);
    }
    nativeVoiceRecorder = null;
  }
  voiceBackend = "stream";
  voiceDegraded = false;
  // 没走到 final（取消 / 通道失败 / 权限被拒）：占位气泡已经没有内容可回填，撤掉
  if (!options?.keepPlaceholder) discardAsrPlaceholder();
}

function failVoiceQuery(title: string) {
  resetVoiceQuery();
  uni.showToast({ title, icon: "none" });
}

async function startVoiceQuery() {
  if (voiceQueryActive.value || isLoading.value) return;
  /**
   * 点下「点击说话」的第一件事：把正在播的东西掐掉。
   * 一是用户要开口了，播报继续响会盖住他；二是外放的声音会被麦克风原样收进 ASR，
   * 识别结果里就会混进上一段回答。
   */
  stopAnswerTts();
  pauseReportBroadcast();
  voiceRecording.value = true;

  const seq = ++voiceSeq;
  voiceFinishing.value = false;
  voiceLevel.value = 0;
  voiceSeconds.value = 0;
  voiceSilenceSince = 0;
  voiceHeard = false;
  voiceTranscript.value = "";
  voiceQueryActive.value = true;

  // 先落一条「识别中」占位：final 回来后 sendMessage 按 asrPending 找到它原地替换，不会塞出两条提问
  beginAsrPlaceholder();
  voicePlaceholderId.value = chatStore.messages.find(item => item.role === "user" && item.asrPending)?.id || "";

  // 底部录音条的计时：点下去就开始走，和真实录音时长对齐
  if (voiceTickTimer) clearInterval(voiceTickTimer);
  voiceTickTimer = setInterval(() => {
    voiceSeconds.value += 1;
  }, 1000);

  /**
   * 音频从哪来（与首页同一口径，Android / iOS 一致）：
   * - 容器里有 `pcmStreamStart`（mPaaS bridge 已注入）用宿主原生推流（16k 裸 PCM 由原生抛过来），
   *   后面的 WebSocket 流式 ASR 不变 —— 实时文字照常；
   * - 没有 bridge（浏览器 / 宿主未注入）才用 WebAudio 自己采；
   * - 两条都不行（没有 WebSocket / 没有 WebAudio 且没有原生推流）才退到整段识别。
   */
  const useNativePcm = isNativePcmStreamSupported();
  logger.warn("[voice] 开始一轮录音", {
    seq,
    backend: useNativePcm ? "native-pcm-stream" : "web-audio",
    asrStream: isAsrStreamSupported(),
    pcmSupported: isPcmCaptureSupported(),
    mpaasReady: isMpaasReady(),
  });
  if (!isAsrStreamSupported() || (!useNativePcm && !isPcmCaptureSupported())) {
    void startNativeVoiceQuery(seq);
    return;
  }

  try {
    // 容器里要先向原生申请麦克风权限，否则浏览器那层会被静默拒绝
    const granted = await ensureNativePermission("record_audio");
    if (seq !== voiceSeq) return;
    if (!granted) {
      logger.warn("[voice] 录音权限被拒", { seq });
      failVoiceQuery(permissionDeniedMessage("record_audio"));
      return;
    }
    logger.info("[voice] 录音权限已授予，开始建 ASR 会话", { seq });

    const session = openAsrStreamSession({
      onPartial(text) {
        if (seq !== voiceSeq) return;
        // partial 是「完整文本的当前版本」：整体替换，不要自己拼接
        voiceTranscript.value = text;
        if (voicePlaceholderId.value) chatStore.patchMessageById(voicePlaceholderId.value, { content: text });
      },
      onFinal(text) {
        if (seq !== voiceSeq) return;
        const query = String(text).trim();
        logger.info("[voice] 拿到定稿文本", {
          seconds: voiceSeconds.value,
          chars: query.length,
          text: query,
        });
        // 占位气泡先留着：sendMessage 按 asrPending 找到它，原地改成正式提问
        resetVoiceQuery({ keepPlaceholder: true });
        // 静音 / 误触时服务端回空串：撤掉占位，提示重说，别拿空问题去提问
        if (!query) {
          discardAsrPlaceholder();
          uni.showToast({ title: t("no-speech-recognized"), icon: "none" });
          return;
        }
        // 与输入栏提问同一条出口：停答案朗读 → 进问答 loading → 暂停播报
        void sendPodcastMessage({ text: query });
      },
      onError() {
        // 通道层失败（握手被网关拦、服务未部署）和「没听清」要分开提示
        if (seq === voiceSeq) failVoiceQuery(t("welcome-voice-unavailable"));
      },
    });
    voiceSession = session;

    const capture = useNativePcm
      ? await startNativePcmCapture({
        onFrame: frame => session.pushFrame(frame),
        onLevel: onVoiceLevel,
        // 原生推流中途报错：换整段识别那条线，别让这一轮白说
        onError: message => degradeToNativeVoice(`pcm-stream:${message}`),
      })
      : await startPcmCapture({
        onFrame: frame => session.pushFrame(frame),
        onLevel: onVoiceLevel,
        // 采集起来了但拿不到可用音频（没回调 / 采到静音）：这一轮降到原生录音，别让用户白说一句
        onUnavailable: reason => degradeToNativeVoice(reason),
      });
    if (seq !== voiceSeq) {
      capture.stop();
      return;
    }
    voiceCapture = capture;
    logger.info("[voice] 采集通道已就绪，等待实时字幕", {
      seq,
      backend: useNativePcm ? "native-pcm-stream" : "web-audio",
    });

    /**
     * 8s 没人说话就自己收尾，别让麦克风空转。
     * 原生 PCM 推流这条不启用：宿主给的是哪一档音量不确定（可能偏小），
     * 一旦电平没过阈值就会被判成「没人说话」、在你还在说的时候把录音掐掉。
     * 这条通道的收尾交给「说过话后静音 1.5s」和用户点 ↑。
     */
    if (!useNativePcm) {
      voiceNoSpeechTimer = setTimeout(() => {
        voiceNoSpeechTimer = null;
        if (!voiceHeard) stopVoiceQuery();
      }, VOICE_NO_SPEECH_MS);
    }
  }
  catch (error) {
    // getUserMedia 三档全挂（Android WebView 常见）：不掉到「录音启动失败」，先换原生录音
    logger.warn("voice query start failed, fallback to native recorder", error);
    if (seq === voiceSeq) degradeToNativeVoice("capture-failed");
  }
}

/**
 * 流式这条路走不通时，把这一轮原地换成原生录音。
 * 不撤占位、不重置序号：用户看到的就是字幕区继续在等字，声纹继续跳，说完照样出文本。
 */
function degradeToNativeVoice(reason: string) {
  if (voiceDegraded || !voiceQueryActive.value) return;
  voiceDegraded = true;
  const seq = voiceSeq;
  logger.warn("[voice] 流式采集不可用，降级到原生录音", { reason, mpaasReady: isMpaasReady() });
  // 流式那一路彻底扔掉：采集停掉、WebSocket 关掉，否则两边一起抢麦克风
  voiceCapture?.stop();
  voiceCapture = null;
  voiceSession?.close();
  voiceSession = null;
  // 重新计时：原生录音是从现在才开始收的
  if (voiceTickTimer) {
    clearInterval(voiceTickTimer);
    voiceTickTimer = null;
  }
  voiceSeconds.value = 0;
  voiceLevel.value = 0;
  voiceSilenceSince = 0;
  voiceHeard = false;
  voiceTickTimer = setInterval(() => {
    voiceSeconds.value += 1;
  }, 1000);
  void startNativeVoiceQuery(seq);
}

/** 原生录音通道：mPaaS microphoneStart/End + 整段识别（没有 partial，说完才出文本） */
async function startNativeVoiceQuery(seq: number) {
  voiceBackend = "native";
  voiceSilenceSince = 0;
  voiceHeard = false;
  try {
    const granted = await ensureNativePermission("record_audio");
    if (seq !== voiceSeq) return;
    if (!granted) {
      failVoiceQuery(permissionDeniedMessage("record_audio"));
      return;
    }

    const recorder = new VoiceRecorder() as unknown as VoiceRecorderInstance;
    const started = await recorder.start();
    if (seq !== voiceSeq) {
      (recorder.release ?? recorder.cancel)?.call(recorder);
      return;
    }
    if (!started?.success) {
      logger.warn("[voice-native] 录音启动失败", started);
      failVoiceQuery(t("record-start-failed"));
      return;
    }

    nativeVoiceRecorder = recorder;
    nativePeakLevel = 0;
    logger.warn("[voice-native] 录音已开始", { seq, mpaasReady: isMpaasReady() });
    /**
     * 原生录音拿不到 partial，电平只用来驱动声纹。
     * 不能喂给 onVoiceLevel：那里面带了「静音 1.5s 自动收尾」，
     * 而 microphoneVolume 在部分容器里恒为 0 / 拿不到，一喂就等于用户话没说完就被掐掉。
     * 收尾统一交给用户点发送（↑ → stopVoiceQuery）。
     */
    stopNativeLevelPolling();
    voiceLevel.value = 0;
    let polling = false;
    nativeLevelTimer = setInterval(() => {
      if (seq !== voiceSeq || polling) return;
      polling = true;
      void getMicrophoneVolume()
        .then((level) => {
          if (seq !== voiceSeq || typeof level !== "number") return;
          if (level > nativePeakLevel) nativePeakLevel = level;
          const normalized = Math.min(1, Math.max(0, level / 0.15));
          voiceLevel.value += (normalized - voiceLevel.value) * 0.35;
        })
        .catch(() => {})
        .finally(() => {
          polling = false;
        });
    }, 120);

    // 只留一个硬上限兜底：用户忘了点发送时别让麦克风一直开着
    if (voiceNoSpeechTimer) clearTimeout(voiceNoSpeechTimer);
    voiceNoSpeechTimer = setTimeout(() => {
      voiceNoSpeechTimer = null;
      stopVoiceQuery();
    }, NATIVE_MAX_RECORD_MS);
  }
  catch (error) {
    logger.warn("native voice query start failed", error);
    if (seq === voiceSeq) failVoiceQuery(t("record-start-failed"));
  }
}

/** 带超时的整段识别：接口挂了也要把录音条收掉，不能一直挂在「识别中」 */
function requestNativeRecognition(audio: NativeRecorderAudio) {
  const request = audio.audioUrl
    ? recognizeSpeechByUrl({ audioUrl: audio.audioUrl })
    : audio.audioBase64
      ? recognizeSpeechByBase64({ audioBase64: audio.audioBase64, mimeType: audio.mimeType })
      : audio.tempFilePath
        ? recognizeSpeechByUpload({ filePath: audio.tempFilePath, timeout: NATIVE_RECOGNIZE_TIMEOUT_MS })
        : Promise.reject(new Error("no audio"));

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("recognize timeout")), NATIVE_RECOGNIZE_TIMEOUT_MS);
  });
  return Promise.race([request, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** 原生录音是异步启动的：用户手快点发送时会赶上"还没 start 完"，等一下它 */
async function waitNativeRecorderReady(timeoutMs = 800) {
  const deadline = Date.now() + timeoutMs;
  while (!nativeVoiceRecorder && Date.now() < deadline) {
    await new Promise<void>(resolve => setTimeout(resolve, 50));
  }
  return nativeVoiceRecorder;
}

/** 原生通道收尾：停录音 → 整段识别 → 直接发问 */
async function finishNativeVoiceQuery() {
  const seq = voiceSeq;
  const recorder = nativeVoiceRecorder ?? await waitNativeRecorderReady();
  nativeVoiceRecorder = null;
  stopNativeLevelPolling();
  if (!recorder) {
    resetVoiceQuery();
    return;
  }

  let audio: NativeRecorderAudio = {};
  try {
    const stopped = await recorder.stop();
    if (seq !== voiceSeq) return;
    if (!stopped?.success) {
      logger.warn("native recorder stop failed", stopped?.error);
      failVoiceQuery(t("no-audio-recorded"));
      return;
    }
    audio = stopped.data || {};
  }
  catch (error) {
    logger.warn("native recorder stop threw", error);
    if (seq === voiceSeq) failVoiceQuery(t("no-audio-recorded"));
    return;
  }

  try {
    const result = await requestNativeRecognition(audio);
    if (seq !== voiceSeq) return;
    const query = String(result?.text || "").trim();
    // 和流式那条线保持一致：占位气泡先留着，sendMessage 按 asrPending 原地替换成正式提问
    resetVoiceQuery({ keepPlaceholder: true });
    if (!query) {
      discardAsrPlaceholder();
      uni.showToast({ title: t("no-speech-recognized"), icon: "none" });
      return;
    }
    void sendPodcastMessage({ text: query });
  }
  catch (error) {
    logger.warn("native recognition failed", error);
    if (seq === voiceSeq) failVoiceQuery(t("asr-no-content-retry"));
  }
}

/** 说完了：先停采集再发 finish，等 final 回来才落成提问 */
function stopVoiceQuery() {
  if (!voiceQueryActive.value || voiceFinishing.value) return;
  voiceFinishing.value = true;
  // 计时停在这里：底部条要显示「最终录了几秒」，不要再涨
  if (voiceTickTimer) {
    clearInterval(voiceTickTimer);
    voiceTickTimer = null;
  }
  // 原生通道：停录音 → 整段识别 → 发问（没有 finish/final 那套）
  if (voiceBackend === "native") {
    void finishNativeVoiceQuery();
    return;
  }
  voiceCapture?.stop();
  voiceCapture = null;
  voiceSession?.finish();
}

/** 取消这一轮：直接断流，不发 finish、不发问 */
function cancelVoiceQuery() {
  if (!voiceQueryActive.value) return;
  resetVoiceQuery();
}

/** 静音检测：说过话之后连续 1.5s 没声音就自动收尾，用户不用再点一次 */
function onVoiceLevel(level: number) {
  // 声纹用的音量：RMS 0.15 已经算大声，再乘一次平滑，跳动才跟得上 100ms 的采样
  const normalized = Math.min(1, Math.max(0, level / 0.15));
  voiceLevel.value += (normalized - voiceLevel.value) * 0.35;

  if (level >= VOICE_LEVEL_THRESHOLD) {
    voiceHeard = true;
    voiceSilenceSince = 0;
    return;
  }
  if (!voiceHeard) return;
  if (!voiceSilenceSince) {
    voiceSilenceSince = performance.now();
    return;
  }
  if (performance.now() - voiceSilenceSince < VOICE_SILENCE_MS) return;
  stopVoiceQuery();
}

onLoad((options) => {
  // ?direct=1 = 直接进播报页：<WORK_REPORT> 标签 / 概览卡「去收听」/ 底部「听汇报」都走它，
  // 跳过「选助手 → 选汇报内容」的风格设置页
  directBroadcast = String(options?.direct || "") === "1";
  syncWindowHeight();
  reportBizDate.value = getCurrentListenReportDate();
  // 对话里 <WORK_REPORT language="…"> 指定的播报语言（没被标签设置过就是空，play 入参里就不带）
  reportTagLanguage.value = getCurrentListenReportLanguage();
  reportQaAnswer.value = "";
  reportQaSubtitle.value = "";
  reportQaLoading.value = false;
  reportQaFromInsight.value = false;
  qaAnswerShown = false;
  insightVisible.value = false;
  insightLeaving.value = false;
  insightLoaded = false;
  hasShownInsight = false;
  broadcastPlaying.value = false;
  // 进页立刻进入拉取偏好的 loading 态；restoreReportBroadcast 内部会在 finally 里关闭
  preferenceLoading.value = true;
  showReportVoiceSelector.value = false;
  restoreReportBroadcast();
  // 每次进来都是全新一轮；发送场景由 useChatSend 固定为 PODCAST。
  chatStore.resetConversation();
  chatStore.showQuickPrompts = false;
  chatStore.showQuickList = false;
});

onHide(() => {
  // 页面被别处盖住 / 切后台（点异常条目跳任务页、切宿主 tab、后台切换等）：
  // 播报与答案朗读都停掉，别在看不见的页面上继续念；返回本页播报可从当前句继续。
  stopPlaybackOnLeave();
  // 麦克风同理：看不见的页面上不能继续收音
  cancelVoiceQuery();
});

onUnload(() => {
  if (markCurrentReportListened()) uni.$emit("listen-report-marked");
  cancelActiveStream();
  // 离开页面时把回答 TTS 也停掉，避免后台还在朗读。
  stopAnswerTts();
  resetVoiceQuery();
});

onBeforeUnmount(() => {
  clearInsightLeaveTimer();
  clearBroadcastFinishRedirectTimer();
  reportAdjustmentActions.dispose();
  disposeInsights();
  cancelActiveStream();
  stopAnswerTts();
  resetVoiceQuery();
});
</script>

<template>
  <view
    class="podcast-page"
    :class="{
      'podcast-page--mix-fold-18': isMixFold18,
      'podcast-page--preference-dark': preferenceDark,
      'podcast-page--dark': pageDark,
    }"
    :style="safeAreaStyle"
  >
    <!-- 所有页面共用宿主安全区；系统状态栏由手机原生绘制。 -->
    <view class="chat-header__statusbar" :style="statusbarStyle" />
    <!-- 进页拉取听播偏好的 loading 占位：只留转圈，不再配文字（避免服务端返回前空白闪烁） -->
    <view v-if="preferenceLoading" class="podcast-page__preference-loading">
      <view class="preference-loading__indicator" />
    </view>
    <ReportVoiceSelector
      v-else-if="showReportVoiceSelector"
      @confirm="confirmReportVoice"
      @close="closeReportVoiceSelector"
    />
    <!-- 聊天态 -->
    <view
      v-else
      class="podcast-page__chat"
      :style="chatViewportStyle"
    >
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
        dock-offset="0px"
        :qa-loading="reportQaLoading"
        :qa-subtitle="reportQaSubtitle"
        :qa-answer="reportQaAnswer"
        :voice-recording="voiceRecording"
        :voice-transcript="voiceTranscript"
        :can-minimize="canMinimize"
        @dismiss-qa="dismissReportQa"
        @minimize="onMinimize"
        @exit-report="closeReportBroadcast"
        @broadcast-finished="onBroadcastFinished"
        @playback-change="onBroadcastPlaybackChange"
      />
      <!-- 播报结束后页内原地形变出的洞察层：透明容器，不做整层位移 -->
      <view v-if="insightVisible" class="podcast-page__insight">
        <ReportInsight
          embedded
          :portrait="reportBroadcastPortrait"
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
          @item-open="openInsightDetail"
          @load-more="loadMoreInsights"
          @replay="replayInsightBroadcast"
        />
      </view>
      <!-- 追问卡（首页同款弹层）：答案要求补充/确认时自动弹起，作答后按同一链路继续提问 -->
      <AiSlotDrawer
        :slots="reportQaSlots"
        :visible="reportQaSlotVisible"
        @close="closeReportQaSlot"
        @submit="onReportQaSlotSubmit"
      />
      <!-- 指导追问卡（并行分支）：选一项即作为下一轮提问 -->
      <AiGuideSuggestionSheet
        v-model:visible="reportQaGuideSuggestionVisible"
        :payload="reportQaGuideSuggestion"
        :keyboard-height="keyboardHeight"
        @submit="onReportQaQuerySubmit"
      />
      <!-- 指导步骤卡（多步确认 / 逐轮追问）：听播页没有核对卡，固定从第 1 步打开 -->
      <AiGuideStepSheet
        v-model:visible="reportQaGuideStepVisible"
        :payload="reportQaGuideStep"
        :step-index="reportQaGuideStepIndex"
        :keyboard-height="keyboardHeight"
        @submit="onReportQaQuerySubmit"
      />
      <!-- 跳转确认：进入维修助理 -->
      <AiAssistantNavigationSheet
        v-model:visible="reportQaNavigationVisible"
        :payload="reportQaNavigation"
        @confirm="onReportQaNavigationConfirm"
      />
    </view>

    <!--
      异常列表里发起的问答全屏覆盖层（独立组件，状态/事件由父组件透传）：
      盖在异常列表之上展示「正在理解 / 回答结果」，点 ← 回到异常列表原地保留；
      组件内自带 AiChatInput，可在覆盖层内继续追问。
    -->
    <PodcastQaOverlay
      v-model:input-text="inputText"
      :visible="qaOverlayVisible"
      :loading="reportQaLoading"
      :qa-subtitle="reportQaSubtitle"
      :answer="reportQaAnswer"
      :is-loading="isLoading"
      :keyboard-height="keyboardHeight"
      :voice-keyboard-height="voiceKeyboardHeight"
      :safe-top-px="safeTopPx"
      :voice-query-active="voiceQueryActive"
      :voice-transcript="voiceTranscript"
      :voice-level="voiceLevel"
      :voice-seconds="voiceSeconds"
      :voice-finishing="voiceFinishing"
      @confirm="confirmReportQaOverlay"
      @send="sendPodcastMessage"
      @stop="stopPodcastAnswer"
      @voice-query-start="startVoiceQuery"
      @voice-cancel="cancelVoiceQuery"
      @voice-submit="stopVoiceQuery"
      @input-focus="setTextInputFocused(true)"
      @input-blur="setTextInputFocused(false)"
      @voice-input-focus="setVoiceInputFocused(true)"
      @voice-input-blur="setVoiceInputFocused(false)"
      @dock-height-change="setInputDockHeight"
    />

    <!--
      异常详情弹窗（设计稿 11101:714「异常弹窗-未加急」）：
      点击异常条目正文打开；标题用 deviceNo，异常类型用 eventCategory+eventType，
      发生时间用 eventTime，事件摘要用 description。点 X / 遮罩 / 加急处理后关闭。
    -->
    <ReportInsightDetail
      :item="detailItem"
      @close="closeInsightDetail"
      @urgent="onInsightDetailUrgent"
    />
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

/* 偏好选择流程的深色态（Ardot 1193:1657）：把状态栏安全区一起铺成 #0D0D0D，
   否则选择器下方是深色、顶上的安全区仍是白底。仅选择器开启且深色时命中。 */
.podcast-page--preference-dark {
  background: #0d0d0d;
}

/* ===== 深色主题：听播页（Ardot 1193:2708「听播-正在播放」/ 1193:1773「闪鉴-异常列表」）=====
   暗色稿画布 #0D0D0D，浅色稿的页面底 #FFF 一一对应；状态栏安全区是页面级占位，
   不一起压深就会在顶部留一条白边，所以底色放在页面根节点上。
   - 底部快捷导航（消异常 / 回问问）1193:2813 Toolbar：底 #212121
   - 输入栏与页面同色，键盘抬起时不能透出下方的深色字幕 */
.podcast-page--dark {
  background: #0d0d0d;

  .podcast-page__chat {
    background: #0d0d0d;
  }

  :deep(.chat-input) {
    background: #0d0d0d;
  }

  /* 进页拉取偏好的 loading 占位是一整屏实底色：深色下不跟着压深，
     进页那一下就是"白屏过渡"（等偏好回包可能好几百毫秒）。 */
  .podcast-page__preference-loading {
    background: #0d0d0d;
  }
}

/* —— 进页拉取偏好的 loading 占位（只有转圈） —— */
.podcast-page__preference-loading {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  background: #ffffff;
}

/* 转圈改用播报页左右声波的同一套渐变（#3D21CD → #1999FE → #C067FA → #FD90C4）：
   用 padding 留出环宽，再用 mask 挖空中间；外径保持原来的 56rpx（48 + 4×2 边框） */
.preference-loading__indicator {
  width: 56rpx;
  height: 56rpx;
  padding: 4rpx;
  box-sizing: border-box;
  border-radius: 50%;
  background-image: linear-gradient(90deg, #3d21cd 0%, #1999fe 48.72%, #c067fa 76%, #fd90c4 100%);
  animation: podcast-preference-loading-spin 0.9s linear infinite;
  /* 先写标准属性、再用 -webkit- 兜底：老 WebView 只认前缀版本 */
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
}

@keyframes podcast-preference-loading-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 顶部状态栏占位：撑开安全区，避免页面内容顶到状态栏底下 */
.chat-header__statusbar {
  width: 100%;
  flex: 0 0 auto;
  background: #fafafa;
}

/* 安全区自身有底色，不能只修改页面根节点，否则深色下仍会留下白带。 */
.podcast-page--dark .chat-header__statusbar,
.podcast-page--preference-dark .chat-header__statusbar {
  background: #0d0d0d;
}

.podcast-page__chat {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  /* 浅色稿 195:1927 画板底色 #FAFAFA */
  background: #fafafa;
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

/* 键盘弹起时输入栏要抬到播报层之上：播报层 z-index 为 2 且是不透明底。
   底色保持不透明 —— 播报字幕从输入栏上方经过时不能透出来；
   底部按钮区与页面同色 #FAFAFA（浅色稿 195:1927 画板底色），不再留一条白带；
   底部不叠「浅蓝向上淡出」的氛围渐变 */
:deep(.chat-input) {
  z-index: 3;
  background: #fafafa;
}

/* —— 折叠屏适配 (小米 Mix Fold 18) ——
   听播内容 (report-broadcast-content) 已经在自身样式里开启 overflow-y: auto，
   内屏竖/横任何短视口状态都能纵向滚动看到完整的人物 + transcript，不再用 scale 强行压。
   这里只处理外屏 21:9 横向溢出（portrait 画布 360rpx 接近屏宽 360rpx，scale 是唯一不掉质量的方案），
   以及 voice selector 在窄屏的尺寸上限。常规 16:9 / 19.5:9 / 20:9 完全不受影响。 */

/* 外屏 (21:9 ≈ 0.43，竖屏)：极窄，必须按机型匹配，避免误伤 19.5:9 / 20:9 手机。
   JS 检测把 isMixFold18 挂到根节点 .podcast-page--mix-fold-18。 */
.podcast-page--mix-fold-18 {
  :deep(.report-voice-selector) {
    --vs-hero-size: min(420rpx, calc(100vw - 60rpx)) !important;
    --vs-car-size: min(300rpx, calc(100vw - 60rpx)) !important;
  }
  :deep(.report-broadcast-content__portrait-stage) {
    /* 只缩横向：保持 stage 高度 510rpx 让 transcript 有空间，portrait 视觉 360*0.5=180rpx 放进 360rpx 屏宽 */
    transform: scale(0.5);
    transform-origin: center top;
  }
}
</style>

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
import { onHide, onLoad, onUnload } from "@dcloudio/uni-app";
import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { consumeTextToSpeechStream } from "@/api/chat/tts-stream";
import { getListenBroadcastConfig, getListenBroadcastPreference } from "@/api/listen-broadcast";
import quickNavAskIcon from "@/assets/img/report-broadcast/quick-nav-ask.svg";
import quickNavExceptionIcon from "@/assets/img/report-broadcast/quick-nav-exception.svg";
import AiAssistantNavigationSheet from "@/components/ai-assistant-navigation-sheet/index.vue";
import AiChatInput from "@/components/ai-chat-input/index.vue";
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
import { loadReportVoice } from "@/hooks/useReportVoice";
import { useSafeArea } from "@/hooks/useSafeArea";
import { provideChatScope, useChatStore, useUserStore } from "@/stores";
import { stripMarkdownTables } from "@/utils/ai-stream";
import { getCurrentListenReportDate, isListenReportListened, markListenReportListened } from "@/utils/listen-report";
import { createLogger } from "@/utils/logger";
import { stashPendingRepairNavigationContext } from "@/utils/repair-navigation";
import { backFromScene, isSceneWindowRoot, navigateToScene } from "@/utils/scene-navigation";

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
  composerDockOffset,
  syncWindowHeight,
  setInputDockHeight,
  setTextInputFocused,
  setVoiceInputFocused,
} = useChatViewport();
/**
 * 播报主体高度避让：除输入栏高度外再减去键盘高度。
 * 键盘弹起时播报内容整体留在键盘上方，避免字幕被键盘压住、输入栏被播报层遮挡。
 */
const broadcastDockOffset = computed(() =>
  `calc(${composerDockOffset.value} + ${Math.max(0, Number(keyboardHeight.value) || 0)}px)`,
);
/** 快捷导航贴在输入栏正上方，键盘弹起时随输入栏一起抬升。 */
const quickNavStyle = computed(() => ({ bottom: `calc(${composerDockOffset.value} + 4px)` }));
const reportQaAnswer = ref("");
const reportQaLoading = ref(false);
/** 思考态小标题：直接展示接口 chat-messages 下发的 subtitle 文案。 */
const reportQaSubtitle = ref("");
/** 按住说话录音中：字幕区先隐藏播报文字，识别态/回答结果随后接管。 */
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
/** 跳转确认（维修助手）。 */
const reportQaNavigation = ref<AssistantNavigationPayload | null>(null);
const reportQaNavigationVisible = ref(false);
/** 本轮问答是否从异常列表发起：确认或取消后必须回到异常列表。 */
const reportQaFromInsight = ref(false);
const reportBroadcastPlayerRef = ref<InstanceType<typeof ReportBroadcastPlayer> | null>(null);
const showReportVoiceSelector = ref(false);
/** 是否由播报页「偏好设置」进入配置流程：决定关闭配置页时回播报页还是退出页面。 */
const preferenceEntry = ref(false);
/**
 * 进页拉取听播偏好过程中的 loading 态：
 * 进页不再走 localStorage / 默认值兜底，必须等服务端的偏好回包后再决定展示播报还是选择页，
 * 期间用一个轻量 loading 占位，避免在 rpx 放大屏型下出现"空白一闪"。
 */
const preferenceLoading = ref(true);
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
/** 播报内容加载中（准备中/字幕骨架屏）：期间隐藏底部消异常、回问问快捷导航。 */
const broadcastPreparing = ref(false);
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
 * 条件：当前在异常列表 + 本轮问答来自异常列表 + 问答进行中（识别中或已返回答案）。
 */
const qaOverlayVisible = computed(
  () =>
    insightVisible.value
    && reportQaFromInsight.value
    && (reportQaLoading.value || Boolean(reportQaAnswer.value)),
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
    reportQaSubtitle.value = subtitle ? String(subtitle) : "";
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

function resolveAnswerTtsLanguage(): "zh" | "en" {
  const raw = String(locale.value || "zh").toLowerCase();
  if (raw.startsWith("zh")) return "zh";
  if (raw.startsWith("en")) return "en";
  return "zh";
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
  // 音色跟随本轮听播所选音色（偏好设置 / 已验证过的 params），没取到就不带这个字段
  const voice = String(reportBroadcastParams.value?.voice || "").trim();
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
  preferenceEntry.value = false;
  reportBroadcastParams.value = null;
  reportBroadcastPortrait.value = "";
  // 偏好选择器优先于「正在加载偏好」骨架屏：两者都打开时先看选择器
  preferenceLoading.value = false;
  showReportVoiceSelector.value = true;
}

function restoreReportBroadcast() {
  // 游客首次收听必须重新选择；已收听状态允许直接复用上次配置。
  if (userStore.isVisitor === true && !isListenReportListened(reportBizDate.value)) {
    startReportVoiceSelection();
    return;
  }
  // 本机没存过音色 / 风格（含汇报模块）→ 同样先进偏好选择，不替用户拿默认值决定
  const savedVoice = loadReportVoice();
  const savedStyle = loadReportStyle();
  if (!savedVoice || !savedStyle || !savedStyle.moduleCodes.length) {
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
  void getListenBroadcastConfig()
    .then((config) => {
      const firstStyle = config?.styles?.[0];
      if (!firstStyle) return;
      const nextVoice = loadReportVoice() || REPORT_VOICE_OPTIONS[0];
      applyReportBroadcastParams(nextVoice, firstStyle.code, firstStyle.defaultModules || []);
    })
    .catch((error) => {
      logger.warn("failed to load listen broadcast config for default style", error);
    });
  // 接口返回前先按空 modules 启动，让播放器先出现；模块到位后由 store 拉取刷新。
  applyReportBroadcastParams(voice, "operation-overview", []);
}

function applyReportBroadcastParams(voice: ReportVoiceOption, styleCode: string, moduleCodes: string[]) {
  reportBroadcastParams.value = {
    voice: voice.id,
    styleCode,
    checkedModules: moduleCodes,
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
  stopPlaybackOnLeave();
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
  const homeUrl = userStore.isVisitor ? "/pages/index/index?mode=demo" : "/pages/index/index";
  uni.redirectTo({ url: homeUrl });
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
 * 点「消异常」进异常列表：先把播报与答案朗读都停下来再切洞察层，
 * 否则列表已经铺出来了，耳朵里还在念。
 */
function openInsightFromQuickNav() {
  stopPlaybackOnLeave();
  showInsight();
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
  broadcastPreparing.value = payload.loading;
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

/** 跳转确认：与首页同一套上下文落盘 + 场景跳转。 */
function onReportQaNavigationConfirm(payload: AssistantNavigationPayload) {
  if (payload.target !== "maintenance_assistant") return;
  stashPendingRepairNavigationContext({
    ...payload.context,
    userId: userStore.userId,
    sessionId: payload.sessionId,
    conversationId: payload.conversationId,
  });
  // 回调摘要轮询只保留在首页：听播页不写 pending，避免残留数据被首页误消费
  // 跳到维修助手前收尾：别把播报 / 答案朗读带过去
  stopPlaybackOnLeave();
  void navigateToScene("/pages/repair/index");
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

function onVoiceStart() {
  // 按下瞬间上一轮答案的 TTS 可能还在朗读：立即停，避免盖住用户说话、被录进 ASR，
  // 也不必等识别确认发送（sendPodcastMessage）才停 —— 那已经是几秒之后了。
  stopAnswerTts();
  voiceRecording.value = true;
  pauseReportBroadcast();
}

function onRecognizeBegin() {
  voiceRecording.value = false;
  enterReportQaLoading();
  beginAsrPlaceholder();
}

function onRecognizeFail() {
  voiceRecording.value = false;
  dismissReportQa();
  discardAsrPlaceholder();
}

onLoad(() => {
  syncWindowHeight();
  reportBizDate.value = getCurrentListenReportDate();
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
});

onUnload(() => {
  if (markCurrentReportListened()) uni.$emit("listen-report-marked");
  cancelActiveStream();
  // 离开页面时把回答 TTS 也停掉，避免后台还在朗读。
  stopAnswerTts();
});

onBeforeUnmount(() => {
  clearInsightLeaveTimer();
  reportAdjustmentActions.dispose();
  disposeInsights();
  cancelActiveStream();
  stopAnswerTts();
});
</script>

<template>
  <view
    class="podcast-page"
    :class="{ 'podcast-page--mix-fold-18': isMixFold18 }"
    :style="safeAreaStyle"
  >
    <!-- 所有页面共用宿主安全区；系统状态栏由手机原生绘制。 -->
    <view class="chat-header__statusbar" :style="statusbarStyle" />
    <!-- 进页拉取听播偏好的 loading 占位：避免服务端返回前出现空白闪烁 -->
    <view v-if="preferenceLoading" class="podcast-page__preference-loading">
      <view class="preference-loading__indicator" />
      <text class="preference-loading__text">
        {{ t("podcast-loading-preference") }}
      </text>
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
        :dock-offset="broadcastDockOffset"
        :qa-loading="reportQaLoading"
        :qa-subtitle="reportQaSubtitle"
        :qa-answer="reportQaAnswer"
        :voice-recording="voiceRecording"
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
      <!-- 播报视图底部快捷导航：消异常 → 异常列表，回问问 → 回首页；洞察态隐藏避免盖住列表；
           进页偏好加载中（骨架屏）与播报准备中（字幕骨架屏）也隐藏 -->
      <view
        v-if="!insightVisible && !preferenceLoading && !broadcastPreparing"
        class="podcast-page__quick-nav"
        :style="quickNavStyle"
      >
        <view class="podcast-page__quick-nav-button" @tap="openInsightFromQuickNav">
          <image class="podcast-page__quick-nav-icon" :src="quickNavExceptionIcon" mode="aspectFit" />
          <text class="podcast-page__quick-nav-text">
            {{ t("podcast-quick-nav-alerts") }}
          </text>
        </view>
        <view class="podcast-page__quick-nav-button" @tap="closeReportBroadcast">
          <image class="podcast-page__quick-nav-icon" :src="quickNavAskIcon" mode="aspectFit" />
          <text class="podcast-page__quick-nav-text">
            {{ t("podcast-quick-nav-ask") }}
          </text>
        </view>
      </view>
      <AiChatInput
        v-model="inputText"
        :attachment-disabled="true"
        :compact-voice-listening="true"
        :speaking="broadcastPlaying || answerTtsPlaying"
        :is-loading="isLoading"
        :keyboard-height="keyboardHeight"
        :voice-keyboard-height="voiceKeyboardHeight"
        @send="sendPodcastMessage"
        @voice-restart="onVoiceStart"
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
      <!-- 跳转确认：进入维修助手 -->
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
      :speaking="broadcastPlaying || answerTtsPlaying"
      @confirm="confirmReportQaOverlay"
      @send="sendPodcastMessage"
      @stop="stopGenerating"
      @voice-start="onVoiceStart"
      @voice-restart="onVoiceStart"
      @voice-cancel="onRecognizeFail"
      @recognize-begin="onRecognizeBegin"
      @recognize-fail="onRecognizeFail"
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

/* —— 进页拉取偏好的 loading 占位 —— */
.podcast-page__preference-loading {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24rpx;
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

/* 文字色与转圈渐变的起始色保持一致，避免红棕字配紫蓝环 */
.preference-loading__text {
  color: #3d21cd;
  font-size: 26rpx;
  font-weight: 500;
  line-height: 36rpx;
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

/* —— 播报视图底部快捷导航 —— */
.podcast-page__quick-nav {
  position: absolute;
  left: 40rpx;
  z-index: 3;
  display: flex;
  gap: 20rpx;
}

.podcast-page__quick-nav-button {
  display: flex;
  height: 64rpx;
  align-items: center;
  gap: 8rpx;
  padding: 0 32rpx;
  border: 1px solid #e8e8e8;
  border-radius: 999px;
  box-sizing: border-box;
  background: #fff;
}

.podcast-page__quick-nav-button:active {
  background: #f6f6f6;
}

/* 按钮左侧图标（消异常 / 回问问），尺寸与文字同高，色值 #6B6B6B */
.podcast-page__quick-nav-icon {
  width: 32rpx;
  height: 32rpx;
  flex: 0 0 32rpx;
}

.podcast-page__quick-nav-text {
  color: #333333;
  font-size: 26rpx;
  font-weight: 400;
  line-height: 36rpx;
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

/* 键盘弹起时输入栏要抬到播报层之上：播报层 z-index 为 2 且是不透明白底 */
:deep(.chat-input) {
  z-index: 3;
  /* 底部氛围：底部浅蓝向上淡出到白（设计稿渐变色），仅听播页使用。
     起色用不透明白，避免播报字幕从输入栏上方透出来 */
  background: linear-gradient(
    180deg,
    #ffffff 0%,
    #ffffff 32%,
    #e6efff 76%,
    #d7e5ff 100%
  );
}

/* —— 折叠屏适配 (小米 Mix Fold 18) ——
   听播内容 (report-broadcast-content) 已经在自身样式里开启 overflow-y: auto，
   内屏竖/横任何短视口状态都能纵向滚动看到完整的人物 + transcript，不再用 scale 强行压。
   这里只处理外屏 21:9 横向溢出（portrait 470rpx > 屏宽 360rpx，scale 是唯一不掉质量的方案），
   以及 voice selector 在窄屏的尺寸上限。常规 16:9 / 19.5:9 / 20:9 完全不受影响。 */

/* 外屏 (21:9 ≈ 0.43，竖屏)：极窄，必须按机型匹配，避免误伤 19.5:9 / 20:9 手机。
   JS 检测把 isMixFold18 挂到根节点 .podcast-page--mix-fold-18。 */
.podcast-page--mix-fold-18 {
  :deep(.report-voice-selector) {
    --vs-hero-size: min(420rpx, calc(100vw - 60rpx)) !important;
    --vs-car-size: min(300rpx, calc(100vw - 60rpx)) !important;
  }
  :deep(.report-broadcast-content__portrait-stage) {
    /* 只缩横向：保持 stage 高度 510rpx 让 transcript 有空间，portrait 视觉 470*0.5=235rpx 放进 360rpx 屏宽 */
    transform: scale(0.5);
    transform-origin: center top;
  }
}
</style>

<script setup lang="ts">
import type {
  ListenBroadcastHistoryItem,
  PlayListenBroadcastParams,
} from "@/api/listen-broadcast/types";
import type { ReportPlaybackRate } from "@/config/report-playback-rate";
import type { ThinkStep } from "@/utils/ai-stream";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getListenBroadcastHistory } from "@/api/listen-broadcast";
import { useListenBroadcastPlayer } from "@/hooks/useListenBroadcastPlayer";
import ReportBroadcastContent from "./report-broadcast-content.vue";
import ReportBroadcastHeader from "./report-broadcast-header.vue";
import ReportBroadcastHistory from "./report-broadcast-history.vue";
import ReportBroadcastRate from "./report-broadcast-rate.vue";

const props = defineProps<{
  params: PlayListenBroadcastParams;
  portrait: string;
  dockOffset: string;
  qaLoading: boolean;
  /** 本轮问答的执行步骤：识别中态在标题下方逐步展示。 */
  qaSteps?: ThinkStep[];
  /** 识别中的过程说明：接口下发的当前执行文案（如「目标 Dify 工作流已开始。」）。 */
  qaSubtitle?: string;
  qaAnswer: string;
  /** 按住说话录音中：字幕区先隐藏播报文字，等识别态接管。 */
  voiceRecording?: boolean;
  /** iframe 内嵌（from=sanvist_pc）时，头部露出「最小化」 */
  canMinimize?: boolean;
}>();

const emit = defineEmits<{
  "dismiss-qa": [];
  "exit-report": [];
  minimize: [];
  "broadcast-finished": [];
  "playback-change": [payload: { playing: boolean; loading: boolean }];
  "open-preference": [];
}>();

const {
  play,
  pause,
  resume,
  stop,
  setPlaybackRate,
  playbackRate,
  loading,
  playing,
  paused,
  finished,
  currentSeq,
  playbackProgress,
  seekToSegment,
  nextText,
  transcriptSegments,
  error,
} = useListenBroadcastPlayer();
const showHistory = ref(false);
const showRatePanel = ref(false);
const historyLoading = ref(false);
const historyItems = ref<ListenBroadcastHistoryItem[]>([]);
const activeHistoryBizDate = ref("");
const currentBizDate = ref("");
let finishedNotified = false;

const { t } = useI18n();

const isQaVisible = computed(() => props.qaLoading || Boolean(props.qaAnswer));
const statusText = computed(() => {
  if (props.qaLoading) return t("broadcast-status-thinking");
  if (props.qaAnswer) return t("broadcast-status-answering");
  if (paused.value) return t("broadcast-status-paused");
  if (loading.value) return t("broadcast-status-preparing");
  if (playing.value) return t("broadcast-status-playing");
  if (error.value) return t("broadcast-status-failed");
  return t("broadcast-status-finished");
});

// 播放态同步给宿主页：洞察收起态的重播按钮沿用这里同一套播放/暂停图标映射。
watch([playing, loading], ([isPlaying, isLoading]) => {
  emit("playback-change", { playing: isPlaying, loading: isLoading });
}, { immediate: true });

// 播放自然结束后只上抛一次，交给页面切换到洞察视图。
watch(finished, (value) => {
  if (!value) {
    finishedNotified = false;
    return;
  }
  if (finishedNotified) return;
  finishedNotified = true;
  emit("broadcast-finished");
});

async function openHistory() {
  showRatePanel.value = false;
  showHistory.value = true;
  if (historyItems.value.length || historyLoading.value) return;
  historyLoading.value = true;
  try {
    historyItems.value = await getListenBroadcastHistory("daily");
  } catch {
    historyItems.value = [];
  } finally {
    historyLoading.value = false;
  }
}

function openRatePanel() {
  showHistory.value = false;
  showRatePanel.value = true;
}

function onSelectRate(rate: ReportPlaybackRate) {
  setPlaybackRate(rate);
  showRatePanel.value = false;
}

function playHistory(item: ListenBroadcastHistoryItem) {
  activeHistoryBizDate.value = item.bizDate;
  currentBizDate.value = item.bizDate;
  showHistory.value = false;
  play({ ...props.params, bizDate: item.bizDate });
}

/**
 * 播放 / 暂停 / 重播三态合一：播报页头像下方的控件与洞察收起态那颗按钮
 * 共用同一套语义——播完再点即为从头重播。
 */
function togglePlayback() {
  if (loading.value) return;
  if (playing.value) {
    pause();
    return;
  }
  if (paused.value) {
    resume();
    return;
  }
  play({ ...props.params, bizDate: currentBizDate.value || props.params.bizDate });
}

function exitReport() {
  stop();
  emit("exit-report");
}

onMounted(() => {
  currentBizDate.value = props.params.bizDate || "";
  play(props.params);
});
defineExpose({ pause, resume, restart: play, togglePlayback, stop });
</script>

<template>
  <view
    class="report-broadcast-player"
    :class="{ 'report-broadcast-player--overlay': showHistory || showRatePanel }"
    :style="{ height: `calc(100% - ${dockOffset})` }"
  >
    <ReportBroadcastHeader
      :status="statusText"
      :qa-visible="isQaVisible"
      :active="playing"
      :can-minimize="props.canMinimize"
      @dismiss-qa="emit('dismiss-qa')"
      @exit-report="exitReport"
      @minimize="emit('minimize')"
      @open-history="openHistory"
      @open-preference="emit('open-preference')"
      @open-rate="openRatePanel"
    />
    <ReportBroadcastContent
      :portrait="portrait"
      :playing="playing"
      :loading="loading"
      :current-seq="currentSeq"
      :next-text="nextText"
      :transcript-segments="transcriptSegments"
      :progress="playbackProgress"
      :qa-loading="qaLoading"
      :qa-steps="qaSteps"
      :qa-subtitle="qaSubtitle"
      :qa-answer="qaAnswer"
      :voice-recording="voiceRecording"
      @play-pause="togglePlayback"
      @seek="seekToSegment"
    />
    <ReportBroadcastHistory
      v-if="showHistory"
      :loading="historyLoading"
      :items="historyItems"
      :active-biz-date="activeHistoryBizDate"
      @close="showHistory = false"
      @select="playHistory"
    />
    <ReportBroadcastRate
      v-if="showRatePanel"
      :current-rate="playbackRate"
      @close="showRatePanel = false"
      @select="onSelectRate"
    />
  </view>
</template>

<style scoped lang="scss">
.report-broadcast-player {
  position: relative;
  z-index: 2;
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  overflow: visible;
  box-sizing: border-box;
  background: #fff;
}

/**
 * 历史列表 / 语速面板等播放器内全屏弹层打开时，把整层抬到页面底部快捷导航
 * （.podcast-page__quick-nav，z-index: 3）之上。
 * 弹窗自身虽是 fixed + 高层级，但会被本层 z-index: 2 的层叠上下文锁住，
 * 对外只按 2 参与比较，不抬升就会露出「消异常 / 回问问」浮在弹窗之上。
 */
.report-broadcast-player--overlay {
  z-index: 4;
}
</style>

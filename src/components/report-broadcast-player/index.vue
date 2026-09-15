<script setup lang="ts">
import type {
  ListenBroadcastHistoryItem,
  PlayListenBroadcastParams,
} from "@/api/listen-broadcast/types";
import type { ReportPlaybackRate } from "@/config/report-playback-rate";
import { computed, onMounted, ref, watch } from "vue";
import { getListenBroadcastHistory, getListenBroadcastLikeStatus, toggleListenBroadcastLike } from "@/api/listen-broadcast";
import ReportQaAnswer from "@/components/report-qa-answer/index.vue";
import { useListenBroadcastPlayer } from "@/hooks/useListenBroadcastPlayer";
import { createLogger } from "@/utils/logger";
import ReportBroadcastContent from "./report-broadcast-content.vue";
import ReportBroadcastHeader from "./report-broadcast-header.vue";
import ReportBroadcastHistory from "./report-broadcast-history.vue";
import ReportBroadcastRate from "./report-broadcast-rate.vue";

const props = defineProps<{
  params: PlayListenBroadcastParams;
  portrait: string;
  dockOffset: string;
  qaLoading: boolean;
  qaAnswer: string;
}>();

const emit = defineEmits<{
  "dismiss-qa": [];
  "exit-report": [];
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
  nextText,
  transcriptSegments,
  error,
} = useListenBroadcastPlayer();
const logger = createLogger("report-broadcast-player");
const showHistory = ref(false);
const showRatePanel = ref(false);
const historyLoading = ref(false);
const historyItems = ref<ListenBroadcastHistoryItem[]>([]);
const activeHistoryBizDate = ref("");
const currentBizDate = ref("");
const liked = ref(false);
const likeLoading = ref(false);
let finishedNotified = false;

const isQaVisible = computed(() => props.qaLoading || Boolean(props.qaAnswer));
const statusText = computed(() => {
  if (props.qaLoading) return "识别中";
  if (props.qaAnswer) return "Sanii 说..";
  if (paused.value) return "已暂停";
  if (loading.value) return "准备中";
  if (playing.value) return "播报中";
  if (error.value) return "播报失败";
  return "播报完成";
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

async function loadLikeStatus(bizDate: string) {
  if (!bizDate) {
    liked.value = false;
    return;
  }
  try {
    const result = await getListenBroadcastLikeStatus({ bizDate, module: null });
    if (currentBizDate.value === bizDate) liked.value = Boolean(result?.liked);
  } catch (error) {
    if (currentBizDate.value === bizDate) liked.value = false;
    logger.warn("failed to load listen broadcast like status", error);
  }
}

async function onToggleLike() {
  const bizDate = currentBizDate.value;
  if (!bizDate || likeLoading.value) return;
  likeLoading.value = true;
  try {
    const result = await toggleListenBroadcastLike({ bizDate, module: null });
    liked.value = Boolean(result?.liked);
  } catch (error) {
    logger.error("failed to toggle listen broadcast like", error);
    uni.showToast({ title: "操作失败，请稍后重试", icon: "none" });
  } finally {
    likeLoading.value = false;
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
  void loadLikeStatus(item.bizDate);
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
  void loadLikeStatus(currentBizDate.value);
  play(props.params);
});
defineExpose({ pause, resume, restart: play, togglePlayback, stop });
</script>

<template>
  <view class="report-broadcast-player" :style="{ height: `calc(100% - ${dockOffset})` }">
    <ReportBroadcastHeader
      :status="statusText"
      :qa-visible="isQaVisible"
      :active="playing"
      @dismiss-qa="emit('dismiss-qa')"
      @exit-report="exitReport"
      @open-history="openHistory"
      @open-preference="emit('open-preference')"
      @open-rate="openRatePanel"
    />
    <ReportQaAnswer v-if="isQaVisible" :loading="qaLoading" :answer="qaAnswer" />
    <ReportBroadcastContent
      v-else
      :portrait="portrait"
      :playing="playing"
      :loading="loading"
      :current-seq="currentSeq"
      :next-text="nextText"
      :transcript-segments="transcriptSegments"
      :liked="liked"
      :like-loading="likeLoading"
      @play-pause="togglePlayback"
      @like="onToggleLike"
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
</style>

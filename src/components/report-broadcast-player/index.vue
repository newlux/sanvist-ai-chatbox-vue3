<script setup lang="ts">
import type {
  ListenBroadcastHistoryItem,
  PlayListenBroadcastParams,
} from "@/api/listen-broadcast/types";
import { computed, onMounted, ref } from "vue";
import { getListenBroadcastHistory } from "@/api/listen-broadcast";
import ReportQaAnswer from "@/components/report-qa-answer/index.vue";
import { useListenBroadcastPlayer } from "@/hooks/useListenBroadcastPlayer";
import ReportBroadcastContent from "./report-broadcast-content.vue";
import ReportBroadcastHeader from "./report-broadcast-header.vue";
import ReportBroadcastHistory from "./report-broadcast-history.vue";

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
}>();

const {
  play,
  pause,
  resume,
  stop,
  loading,
  playing,
  paused,
  currentSeq,
  nextText,
  transcriptSegments,
  error,
} = useListenBroadcastPlayer();
const showHistory = ref(false);
const historyLoading = ref(false);
const historyItems = ref<ListenBroadcastHistoryItem[]>([]);
const activeHistoryBizDate = ref("");

const isQaVisible = computed(() => props.qaLoading || Boolean(props.qaAnswer));
const statusText = computed(() => {
  if (props.qaLoading) return "识别中...";
  if (props.qaAnswer) return "Noii 说..";
  if (paused.value) return "已暂停";
  if (loading.value) return "准备中...";
  if (playing.value) return "播报中...";
  if (error.value) return "播报失败";
  return "播报完成";
});

async function openHistory() {
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

function playHistory(item: ListenBroadcastHistoryItem) {
  activeHistoryBizDate.value = item.bizDate;
  showHistory.value = false;
  play({ ...props.params, bizDate: item.bizDate });
}

function onPlayPause() {
  if (loading.value) return;
  if (playing.value) {
    pause();
  } else if (paused.value) {
    resume();
  } else {
    play(props.params);
  }
}

function exitReport() {
  stop();
  emit("exit-report");
}

onMounted(() => play(props.params));
defineExpose({ pause, resume, restart: play, stop });
</script>

<template>
  <view class="report-broadcast-player" :style="{ height: `calc(100% - ${dockOffset})` }">
    <ReportBroadcastHeader
      :status="statusText"
      :qa-visible="isQaVisible"
      @dismiss-qa="emit('dismiss-qa')"
      @exit-report="exitReport"
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
      @open-history="openHistory"
      @play-pause="onPlayPause"
    />
    <ReportBroadcastHistory
      v-if="showHistory"
      :loading="historyLoading"
      :items="historyItems"
      :active-biz-date="activeHistoryBizDate"
      @close="showHistory = false"
      @select="playHistory"
    />
  </view>
</template>

<style scoped lang="scss">
.report-broadcast-player {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  background: #fff;
}
</style>

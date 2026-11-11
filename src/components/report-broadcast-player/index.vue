<script setup lang="ts">
import type { PlayListenBroadcastParams } from "@/api/listen-broadcast/types";
import type { ThinkStep } from "@/utils/ai-stream";
import { computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useListenBroadcastPlayer } from "@/hooks/useListenBroadcastPlayer";
import { useSystemStore } from "@/stores";
import ReportBroadcastContent from "./report-broadcast-content.vue";
import ReportBroadcastHeader from "./report-broadcast-header.vue";

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
  /** 录音中：字幕区先隐藏播报文字，等实时转写/识别态接管。 */
  voiceRecording?: boolean;
  /** 录音中的实时转写文本（点击说话走流式 ASR）。 */
  voiceTranscript?: string;
  /** iframe 内嵌（from=sanvist_pc）时，头部露出「最小化」 */
  canMinimize?: boolean;
}>();

const emit = defineEmits<{
  "dismiss-qa": [];
  "exit-report": [];
  minimize: [];
  "broadcast-finished": [];
  "playback-change": [payload: { playing: boolean; loading: boolean }];
}>();

const {
  play,
  pause,
  resume,
  stop,
  loading,
  playing,
  paused,
  finished,
  currentSeq,
  playbackProgress,
  seekToSegment,
  transcriptSegments,
  error,
} = useListenBroadcastPlayer();
let finishedNotified = false;

const { t } = useI18n();
/**
 * 外观：深色走 C 方案暗色稿 1193:2708「听播-正在播放」（画布 #0D0D0D）。
 * 只换播放层的底色，头部 / 内容 / 历史 / 语速各自按同一套暗色梯度改自己的材质。
 */
const systemStore = useSystemStore();
const isDark = computed(() => systemStore.isDark);

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
  play(props.params);
}

function exitReport() {
  stop();
  emit("exit-report");
}

onMounted(() => {
  play(props.params);
});
defineExpose({ pause, resume, restart: play, togglePlayback, stop });
</script>

<template>
  <view
    class="report-broadcast-player"
    :class="{
      'report-broadcast-player--dark': isDark,
    }"
    :style="{ height: `calc(100% - ${dockOffset})` }"
  >
    <!-- 准备中（loading）也带品牌图标，与「已暂停」形态一致；流光只跟 active=playing 走，准备中无动效 -->
    <ReportBroadcastHeader
      :status="statusText"
      :qa-visible="isQaVisible"
      :active="playing"
      :with-icon="playing || paused || error || loading"
      :can-minimize="props.canMinimize"
      @dismiss-qa="emit('dismiss-qa')"
      @exit-report="exitReport"
      @minimize="emit('minimize')"
    />
    <ReportBroadcastContent
      :portrait="portrait"
      :playing="playing"
      :loading="loading"
      :current-seq="currentSeq"
      :transcript-segments="transcriptSegments"
      :progress="playbackProgress"
      :qa-loading="qaLoading"
      :qa-steps="qaSteps"
      :qa-subtitle="qaSubtitle"
      :qa-answer="qaAnswer"
      :voice-recording="voiceRecording"
      :voice-transcript="voiceTranscript"
      @play-pause="togglePlayback"
      @seek="seekToSegment"
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
  /* 浅色稿 195:1927 画板底色 #FAFAFA */
  background: #fafafa;
}

/* ===== 深色主题：听播播放层（Ardot 1193:2708「日常运营助手-听播-正在播放」）=====
   暗色稿画布 = #0D0D0D，浅色稿的 #FFF 一一对应；其余尺寸 / 间距 / 层级不动。
   头部胶囊、字幕、进度条、播放按钮分别在各自组件里换材质。 */
.report-broadcast-player--dark {
  background: #0d0d0d;
}
</style>

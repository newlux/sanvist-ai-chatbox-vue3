import type { ListenBroadcastStreamHandle } from "@/api/listen-broadcast/play-stream";
import type {
  ListenBroadcastAudioChunk,
  PlayListenBroadcastParams,
} from "@/api/listen-broadcast/types";
import type { ReportPlaybackRate } from "@/config/report-playback-rate";
import { Howl } from "howler";
import { computed, onBeforeUnmount, ref } from "vue";
import { consumeListenBroadcastStream } from "@/api/listen-broadcast/play-stream";
import { loadReportPlaybackRate, saveReportPlaybackRate } from "@/hooks/useReportPlaybackRate";
import { createLogger } from "@/utils/logger";

const logger = createLogger("listen-broadcast-player");

/** 相邻播报分句之间留出自然气口，避免上句刚落音就立刻接下一句。 */
const CHUNK_GAP_MS = 800;

/** 解析音频源并输出诊断摘要，用于定位「格式不匹配」还是「数据不完整」。 */
function inspectAudioSource(source: string, chunk: ListenBroadcastAudioChunk) {
  const isDataUrl = source.startsWith("data:");
  const mime = isDataUrl ? source.slice(5, source.indexOf(";")) : "";
  const base64Body = isDataUrl ? source.slice(source.indexOf(",") + 1) : source;
  const base64 = String(chunk.audioBase64 || "").trim();

  let bytes = 0;
  let validBase64 = false;
  try {
    bytes = atob(base64Body).length;
    validBase64 = /^[a-z0-9+/]*={0,2}$/i.test(base64Body) && bytes > 0;
  } catch {
    bytes = 0;
  }

  return {
    format: String(chunk.format || ""),
    mime,
    base64Length: base64.length,
    decodedBytes: bytes,
    validBase64,
    looksWav: base64.startsWith("UklGR"),
    id3Header: /^data:audio\/mpeg/.test(source),
  };
}

function resolveAudioSource(chunk: ListenBroadcastAudioChunk) {
  const dataUrl = String(chunk.dataUrl || "").trim();
  if (dataUrl) return dataUrl;

  const base64 = String(chunk.audioBase64 || "").trim();
  if (!base64 || base64.startsWith("data:")) return base64;

  const format = String(chunk.format || "").toLowerCase();
  const mime = format.includes("wav") || base64.startsWith("UklGR") ? "audio/wav" : "audio/mpeg";
  return `data:${mime};base64,${base64}`;
}

function resolveAudioFormat(source: string, chunk: ListenBroadcastAudioChunk) {
  const format = String(chunk.format || "").toLowerCase();
  if (
    format.includes("wav") ||
    source.includes("audio/wav") ||
    String(chunk.audioBase64 || "").startsWith("UklGR")
  ) {
    return ["wav"];
  }
  return ["mp3"];
}

export function useListenBroadcastPlayer() {
  const loading = ref(false);
  const playing = ref(false);
  const paused = ref(false);
  const finished = ref(false);
  const currentSeq = ref<number | null>(null);
  const previousText = ref("");
  const currentText = ref("");
  const nextText = ref("");
  const transcriptSegments = ref<Array<{ seq: number; text: string }>>([]);
  const error = ref<Error | null>(null);
  const playbackRate = ref(loadReportPlaybackRate());
  const active = computed(() => loading.value || playing.value);
  /**
   * 归一化播报进度（0~1）：流式分句没有总时长，按
   * 「已完成句数 + 当前句内播放比例」/「已收到总句数」估算，供进度条展示。
   */
  const playbackProgress = ref(0);

  let sessionId = 0;
  let nextSeq = 1;
  let streamFinished = false;
  let activeStream: ListenBroadcastStreamHandle | null = null;
  /**
   * 切倍速时被顶掉的旧 SSE 连接。
   * 语速由后端合成，切倍速必须重新拉流；但若立刻 abort 旧连接，部分后端会把「连接断开」
   * 当成「取消本次播报任务」，紧接着的新请求就只拿到空流 / 提前结束——用户会看到刚切完倍速
   * 就跳到汇报结束页。所以旧连接先挂在这里，等新流真的回音频了再释放。
   */
  let staleStream: ListenBroadcastStreamHandle | null = null;
  let activeAudio: Howl | null = null;
  let gapTimer: ReturnType<typeof setTimeout> | null = null;
  let readyQueue: ListenBroadcastAudioChunk[] = [];
  const pendingChunks = new Map<number, ListenBroadcastAudioChunk>();
  /** 全量分句缓存：往回 seek 时已播分句不在队列里了，用它重建待播队列。 */
  const allChunks = new Map<number, ListenBroadcastAudioChunk>();
  /** 最近一次播报请求参数：切倍速时语速由后端合成，需要拿同一篇内容按新语速重新拉流。 */
  let lastPlayParams: PlayListenBroadcastParams | null = null;
  /** 重新拉流的起播分句：序号小于它的分句直接丢弃，避免切倍速后从头重念。 */
  let startFromSeq = 1;
  /**
   * 本轮会话是否由「切换倍速」触发。
   * 语速由后端合成，切倍速必须重新拉流；而这一轮流只要没形成播放（一句都没播出去），
   * 就说明后端没有按新语速给出音频，绝不能当成「播完了」把用户甩到汇报结束页。
   */
  let sessionFromRateChange = false;
  /** 本轮会话是否已经播出过至少一句，用于区分「真的播完」与「拿不到音频」。 */
  let sessionHasPlayed = false;
  /** 切换倍速前那一档已生效的倍速：新一轮拿不到音频时回滚用。 */
  let previousPlaybackRate: ReportPlaybackRate | null = null;
  /** 切倍速拿不到音频时只回滚一次，避免反复重拉。 */
  let rateFallbackUsed = false;
  /** 进度估算 tick 句柄，卸载时清理。 */
  let progressTimer: ReturnType<typeof setInterval> | null = null;
  /** 单调化开关：分句陆续到达会让分母变大、估算值回退，正常播放只涨不跌；seek 时临时关闭允许回落。 */
  let progressMonotonic = true;
  let progressMonotonicTimer: ReturnType<typeof setTimeout> | null = null;

  function clearGapTimer() {
    if (!gapTimer) return;
    clearTimeout(gapTimer);
    gapTimer = null;
  }

  function releaseAudio() {
    clearGapTimer();
    if (!activeAudio) return;
    try {
      activeAudio.stop();
      activeAudio.unload();
    } catch {
      // Ignore container-specific cleanup failures.
    }
    activeAudio = null;
  }

  function completeIfDrained(id: number) {
    if (
      id !== sessionId ||
      paused.value ||
      !streamFinished ||
      activeAudio ||
      gapTimer ||
      readyQueue.length ||
      pendingChunks.size
    ) {
      return;
    }
    // 兜底：这才是关键的一条。切倍速重播必须重新拉流，而这一轮流如果一句都没播出去就结束了，
    // 说明后端没有按新语速返回音频（空流 / 提前收流 / 分句口径不一致），
    // 绝不能在这里判「已播完」，否则用户会直接被甩到汇报结束页。
    if (sessionFromRateChange && !sessionHasPlayed) {
      const rollback = previousPlaybackRate;
      const failedRate = playbackRate.value;
      if (!rateFallbackUsed && rollback !== null && lastPlayParams) {
        rateFallbackUsed = true;
        logger.warn("切倍速重播未收到可播音频，回滚到上一档倍速重新播报", {
          failedRate,
          rollbackRate: rollback,
          receivedChunks: allChunks.size,
        });
        playbackRate.value = rollback;
        saveReportPlaybackRate(rollback);
        previousPlaybackRate = null;
        startStream({ ...lastPlayParams, ttsSpeechRate: rollback }, 1, true);
        return;
      }
      logger.warn("切倍速重播仍未收到可播音频，按播放失败处理", {
        failedRate,
        receivedChunks: allChunks.size,
      });
      sessionFromRateChange = false;
      loading.value = false;
      playing.value = false;
      currentSeq.value = null;
      error.value = new Error("播报音频重新合成失败");
      return;
    }
    loading.value = false;
    playing.value = false;
    finished.value = !error.value;
    currentSeq.value = null;
  }

  function schedulePlayNext(id: number) {
    clearGapTimer();
    if (id !== sessionId || paused.value) return;
    gapTimer = setTimeout(() => {
      gapTimer = null;
      playNext(id);
    }, CHUNK_GAP_MS);
  }

  function playNext(id: number) {
    if (id !== sessionId || paused.value || activeAudio || gapTimer) return;

    let chunk = readyQueue.shift();
    // 切倍速重新拉流时，新流会从第 1 句重新下发：丢弃起播点之前的分句，保证无缝接续。
    while (chunk && typeof chunk.seq === "number" && chunk.seq < startFromSeq) {
      chunk = readyQueue.shift();
    }
    if (!chunk) {
      nextText.value = "";
      completeIfDrained(id);
      return;
    }

    nextText.value = String(readyQueue[0]?.text || "");
    // 续播点已找到：置回 1，后续分句无需再按序号过滤。
    startFromSeq = 1;
    const source = resolveAudioSource(chunk);
    if (!source) {
      logger.warn("跳过缺少音频数据的听播分片", { seq: chunk.seq });
      playNext(id);
      return;
    }

    loading.value = false;
    playing.value = true;
    sessionHasPlayed = true;
    previousText.value = currentText.value;
    currentSeq.value = chunk.seq ?? null;
    currentText.value = String(chunk.text || "");
    const text = String(chunk.text || "");
    if (
      typeof chunk.seq === "number" &&
      text &&
      !transcriptSegments.value.some(segment => segment.seq === chunk.seq)
    ) {
      transcriptSegments.value.push({ seq: chunk.seq, text });
    }

    let audio: Howl | null = null;
    function skipBrokenChunk(audioError: unknown) {
      if (id !== sessionId || !audio || activeAudio !== audio) return;
      logger.warn("跳过无法播放的听播分片", {
        audioError,
        seq: chunk.seq,
        ...inspectAudioSource(source, chunk),
      });
      activeAudio = null;
      audio.unload();
      playNext(id);
    }

    audio = new Howl({
      src: [source],
      html5: true,
      autoplay: true,
      format: resolveAudioFormat(source, chunk),
      onend() {
        if (id !== sessionId || !audio || activeAudio !== audio) return;
        activeAudio = null;
        audio.unload();
        schedulePlayNext(id);
      },
      onloaderror: (_soundId, audioError) => skipBrokenChunk(audioError),
      onplayerror: (_soundId, audioError) => skipBrokenChunk(audioError),
    });
    activeAudio = audio;
  }

  function drainContiguousChunks(id: number) {
    while (pendingChunks.has(nextSeq)) {
      const chunk = pendingChunks.get(nextSeq);
      pendingChunks.delete(nextSeq);
      nextSeq += 1;
      if (chunk) {
        readyQueue.push(chunk);
        const text = String(chunk.text || "");
        if (
          typeof chunk.seq === "number" &&
          text &&
          !transcriptSegments.value.some(segment => segment.seq === chunk.seq)
        ) {
          transcriptSegments.value.push({ seq: chunk.seq, text });
        }
      }
    }
    if (activeAudio) nextText.value = String(readyQueue[0]?.text || "");
    playNext(id);
  }

  function flushRemainingChunks(id: number) {
    const chunks = [...pendingChunks.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    pendingChunks.clear();
    readyQueue.push(...chunks);
    playNext(id);
  }

  function handleEvent(payload: unknown, id: number) {
    if (id !== sessionId || !payload || typeof payload !== "object") return;
    // 新流已经真实回数据：这时再断开切倍速顶掉的旧连接，既不会打断后端任务，也不长期占着连接。
    releaseStaleStream();
    const chunk = payload as ListenBroadcastAudioChunk;
    if (chunk.event === "done") {
      streamFinished = true;
      flushRemainingChunks(id);
      return;
    }
    if (typeof chunk.seq !== "number" || pendingChunks.has(chunk.seq)) return;
    pendingChunks.set(chunk.seq, chunk);
    allChunks.set(chunk.seq, chunk);
    drainContiguousChunks(id);
  }

  function finishStream(id: number, streamError?: Error) {
    if (id !== sessionId) return;
    activeStream = null;
    streamFinished = true;
    if (streamError) {
      error.value = streamError;
      logger.warn("听播播报请求失败", streamError);
    }
    flushRemainingChunks(id);
  }

  /**
   * 切换倍速：语速由后端按 ttsSpeechRate 合成，前端不对已合成音频做二次变速，
   * 所以会话进行中必须用新语速重新拉流，并从当前分句续播（当前句会从头重念）。
   * 未在播报时只记录，等下次 play 时随参数生效。
   */
  function setPlaybackRate(rate: ReportPlaybackRate) {
    if (rate === playbackRate.value) return;

    const resumeSeq = typeof currentSeq.value === "number" ? currentSeq.value : 1;
    const wasPaused = paused.value;
    const inSession = !finished.value && (loading.value || playing.value || paused.value);
    const params = lastPlayParams;
    const rollbackRate = playbackRate.value;

    previousPlaybackRate = rollbackRate;
    rateFallbackUsed = false;
    playbackRate.value = rate;
    saveReportPlaybackRate(rate);

    if (!inSession || !params) return;

    logger.info("切换听播倍速，按新语速重新拉流", { rate, resumeSeq, rollbackRate });
    startStream({ ...params, ttsSpeechRate: rate }, resumeSeq, true);
    // 暂停中切倍速：新流按暂停态挂起，用户点继续时从起播点接上。
    if (wasPaused) pause();
  }

  /** 周期估算播放进度：已完成句数 + 当前句内比例，再除以已收到的总句数。 */
  function updateProgress() {
    const total = transcriptSegments.value.length;
    if (!total || currentSeq.value == null) return;
    const index = transcriptSegments.value.findIndex(segment => segment.seq === currentSeq.value);
    if (index < 0) return;
    let fraction = 0;
    if (activeAudio) {
      try {
        const seekValue = activeAudio.seek();
        const duration = activeAudio.duration();
        const position = typeof seekValue === "number" ? seekValue : 0;
        if (duration > 0) fraction = Math.min(1, Math.max(0, position / duration));
      } catch {
        fraction = 0;
      }
    }
    const progress = (index + fraction) / total;
    playbackProgress.value = progressMonotonic
      ? Math.max(playbackProgress.value, progress)
      : progress;
  }

  /**
   * 跳到指定分句播放（拖动进度条）：用全量缓存重建该句及之后的待播队列。
   * 暂停中仅换队列、恢复时从新位置继续；播完态拖动等同从该句重播；流还在收时不打断。
   */
  function seekToSegment(seq: number) {
    const index = transcriptSegments.value.findIndex(segment => segment.seq === seq);
    if (index < 0) return;
    clearGapTimer();
    if (activeAudio) {
      const audio = activeAudio;
      activeAudio = null;
      try {
        audio.stop();
        audio.unload();
      } catch {
        // 忽略容器差异
      }
    }
    const upcoming = [...allChunks.values()]
      .filter(chunk => (chunk.seq ?? Number.MAX_SAFE_INTEGER) >= seq)
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    pendingChunks.clear();
    readyQueue = upcoming;
    nextSeq = (upcoming.length ? (upcoming[upcoming.length - 1].seq ?? seq) : seq) + 1;
    finished.value = false;
    playbackProgress.value = index / Math.max(1, transcriptSegments.value.length);
    progressMonotonic = false;
    if (progressMonotonicTimer) clearTimeout(progressMonotonicTimer);
    progressMonotonicTimer = setTimeout(() => {
      progressMonotonicTimer = null;
      progressMonotonic = true;
    }, 600);
    playNext(sessionId);
  }

  function pause() {
    if (paused.value || finished.value) return;
    paused.value = true;
    loading.value = false;
    playing.value = false;
    clearGapTimer();
    try {
      activeAudio?.pause();
    } catch {
      logger.warn("暂停听播音频失败");
    }
    logger.info("听播已暂停");
  }

  function resume() {
    if (!paused.value) return;
    paused.value = false;
    finished.value = false;
    logger.info("听播继续播放");

    if (activeAudio) {
      playing.value = true;
      try {
        activeAudio.play();
      } catch {
        playing.value = false;
        logger.warn("继续听播音频失败");
      }
      return;
    }

    if (!streamFinished && !readyQueue.length && !pendingChunks.size) loading.value = true;
    playNext(sessionId);
  }

  /** 本地播放状态复位：只动内存与 UI 状态，不碰任何网络连接。 */
  function resetPlaybackState() {
    releaseAudio();
    readyQueue = [];
    pendingChunks.clear();
    nextSeq = 1;
    streamFinished = true;
    loading.value = false;
    playing.value = false;
    paused.value = false;
    finished.value = false;
    currentSeq.value = null;
    previousText.value = "";
    currentText.value = "";
    nextText.value = "";
    transcriptSegments.value = [];
    error.value = null;
    allChunks.clear();
    playbackProgress.value = 0;
    progressMonotonic = true;
    if (progressMonotonicTimer) {
      clearTimeout(progressMonotonicTimer);
      progressMonotonicTimer = null;
    }
  }

  /** 真正放掉「切倍速顶掉的旧连接」：新流已经产出音频，或本次播报彻底结束。 */
  function releaseStaleStream() {
    if (!staleStream) return;
    try {
      staleStream.cancel();
    } catch {
      // 忽略容器差异
    }
    staleStream = null;
  }

  function stop() {
    sessionId += 1;
    activeStream?.cancel();
    activeStream = null;
    releaseStaleStream();
    resetPlaybackState();
    logger.info("听播已终止");
  }

  /** 播报全流程入口：从第 1 句开始拉流。 */
  function play(params: PlayListenBroadcastParams) {
    startStream(params, 1);
  }

  /** 拉流并播报：fromSeq > 1 时用于切倍速续播，新流里更早的分句会被丢弃。 */
  function startStream(params: PlayListenBroadcastParams, fromSeq: number, fromRateChange = false) {
    lastPlayParams = params;
    if (fromRateChange && activeStream) {
      // 切倍速的软切换：只自增会话号让旧回调失效，旧连接挂成 stale 稍后再放。
      // 直接 abort 可能被后端当成「取消本次播报」，新请求就只拿到空流，用户会立刻被甩到汇报结束页。
      sessionId += 1;
      releaseStaleStream();
      staleStream = activeStream;
      activeStream = null;
      resetPlaybackState();
    } else {
      stop();
    }
    startFromSeq = fromSeq;
    // stop()/resetPlaybackState() 会把 streamFinished 置为 true；新一轮流在 done / close 之前必须回到
    // 「接收中」，否则续播时被丢弃的旧分句会让队列瞬间排空，被 completeIfDrained 误判成「已播完」。
    streamFinished = false;
    sessionFromRateChange = fromRateChange;
    sessionHasPlayed = false;
    if (!fromRateChange) rateFallbackUsed = false;
    const id = sessionId;
    loading.value = true;
    logger.info("听播拉流开始", {
      fromSeq,
      fromRateChange,
      ttsSpeechRate: params.ttsSpeechRate,
    });
    activeStream = consumeListenBroadcastStream(
      // 当前播放倍速一并交给后端做 TTS 合成：显式传值优先，其次取用户选定的倍速，
      // 都没有时由接口层兜底成正常倍速。
      { ...params, ttsSpeechRate: params.ttsSpeechRate ?? playbackRate.value },
      payload => handleEvent(payload, id),
      streamError => finishStream(id, streamError),
      () => finishStream(id),
    );
  }

  progressTimer = setInterval(updateProgress, 250);

  onBeforeUnmount(() => {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    stop();
  });

  return {
    play,
    pause,
    resume: () => resume(),
    stop,
    setPlaybackRate,
    playbackRate,
    active,
    loading,
    playing,
    paused,
    finished,
    currentSeq,
    playbackProgress,
    seekToSegment,
    previousText,
    currentText,
    nextText,
    transcriptSegments,
    error,
  };
}

import type { ListenBroadcastStreamHandle } from "@/api/listen-broadcast/play-stream";
import type { ListenBroadcastAudioChunk, PlayListenBroadcastParams } from "@/api/listen-broadcast/types";
import { computed, onBeforeUnmount, ref } from "vue";
import { consumeListenBroadcastStream } from "@/api/listen-broadcast/play-stream";
import { createLogger } from "@/utils/logger";

const logger = createLogger("listen-broadcast-player");

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
  const active = computed(() => loading.value || playing.value);

  let sessionId = 0;
  let nextSeq = 1;
  let streamFinished = false;
  let activeStream: ListenBroadcastStreamHandle | null = null;
  let activeAudio: ReturnType<typeof uni.createInnerAudioContext> | null = null;
  let readyQueue: ListenBroadcastAudioChunk[] = [];
  const pendingChunks = new Map<number, ListenBroadcastAudioChunk>();

  function releaseAudio() {
    if (!activeAudio) return;
    try {
      activeAudio.stop();
      activeAudio.destroy?.();
    } catch {
      // Ignore container-specific cleanup failures.
    }
    activeAudio = null;
  }

  function completeIfDrained(id: number) {
    if (id !== sessionId || paused.value || !streamFinished || activeAudio || readyQueue.length || pendingChunks.size) return;
    loading.value = false;
    playing.value = false;
    finished.value = !error.value;
    currentSeq.value = null;
  }

  function playNext(id: number) {
    if (id !== sessionId || paused.value || activeAudio) return;

    const chunk = readyQueue.shift();
    if (!chunk) {
      nextText.value = "";
      completeIfDrained(id);
      return;
    }

    nextText.value = String(readyQueue[0]?.text || "");
    const source = resolveAudioSource(chunk);
    if (!source) {
      logger.warn("跳过缺少音频数据的听播分片", { seq: chunk.seq });
      playNext(id);
      return;
    }

    loading.value = false;
    playing.value = true;
    previousText.value = currentText.value;
    currentSeq.value = chunk.seq ?? null;
    currentText.value = String(chunk.text || "");
    const text = String(chunk.text || "");
    if (typeof chunk.seq === "number" && text && !transcriptSegments.value.some(segment => segment.seq === chunk.seq)) {
      transcriptSegments.value.push({ seq: chunk.seq, text });
    }

    const audio = uni.createInnerAudioContext();
    activeAudio = audio;
    audio.onEnded(() => {
      if (id !== sessionId || activeAudio !== audio) return;
      activeAudio = null;
      audio.destroy?.();
      playNext(id);
    });
    audio.onError((audioError) => {
      if (id !== sessionId || activeAudio !== audio) return;
      logger.warn("跳过无法播放的听播分片", {
        audioError,
        seq: chunk.seq,
        ...inspectAudioSource(source, chunk),
      });
      activeAudio = null;
      audio.destroy?.();
      playNext(id);
    });
    audio.src = source;
    audio.autoplay = true;
  }

  function drainContiguousChunks(id: number) {
    while (pendingChunks.has(nextSeq)) {
      const chunk = pendingChunks.get(nextSeq);
      pendingChunks.delete(nextSeq);
      nextSeq += 1;
      if (chunk) {
        readyQueue.push(chunk);
        const text = String(chunk.text || "");
        if (typeof chunk.seq === "number" && text && !transcriptSegments.value.some(segment => segment.seq === chunk.seq)) {
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
    const chunk = payload as ListenBroadcastAudioChunk;
    if (chunk.event === "done") {
      streamFinished = true;
      flushRemainingChunks(id);
      return;
    }
    if (typeof chunk.seq !== "number" || pendingChunks.has(chunk.seq)) return;
    pendingChunks.set(chunk.seq, chunk);
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

  function pause() {
    if (paused.value || finished.value) return;
    paused.value = true;
    loading.value = false;
    playing.value = false;
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

  function stop() {
    sessionId += 1;
    activeStream?.cancel();
    activeStream = null;
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
    logger.info("听播已终止");
  }

  function play(params: PlayListenBroadcastParams) {
    stop();
    const id = sessionId;
    loading.value = true;
    activeStream = consumeListenBroadcastStream(
      params,
      payload => handleEvent(payload, id),
      streamError => finishStream(id, streamError),
      () => finishStream(id),
    );
  }

  onBeforeUnmount(stop);

  return {
    play,
    pause,
    resume: () => resume(),
    stop,
    active,
    loading,
    playing,
    paused,
    finished,
    currentSeq,
    previousText,
    currentText,
    nextText,
    transcriptSegments,
    error,
  };
}

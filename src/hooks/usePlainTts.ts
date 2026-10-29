import type { RealtimeTtsChunk } from "@/api/chat/types";
import type { TtsStreamHandle } from "@/api/chat/tts-stream";
import { onBeforeUnmount, ref } from "vue";
import { consumeTextToSpeechStream } from "@/api/chat/tts-stream";
import { createLogger } from "@/utils/logger";

const logger = createLogger("plain-tts");

/**
 * 把一帧 SSE 音频转成可播地址。
 * 后端可能给 dataUrl，也可能只给裸 base64；wav 的 base64 一定以 UklGR（RIFF）开头。
 */
function resolveAudioSource(chunk: RealtimeTtsChunk) {
  const dataUrl = String(chunk.dataUrl || "").trim();
  if (dataUrl) return dataUrl;

  const base64 = String(chunk.audioBase64 || "").trim();
  if (!base64) return "";
  if (base64.startsWith("data:")) return base64;

  const format = String(chunk.format || "").toLowerCase();
  const mime = format.includes("wav") || base64.startsWith("UklGR") ? "audio/wav" : "audio/mpeg";
  return `data:${mime};base64,${base64}`;
}

/**
 * 任意文案的实时 TTS 播报（POST /speech/tts/v2/stream）。
 *
 * 和 useRealtimeTts 的区别：不挂在聊天消息上、不写 chat store，
 * 只把分句音频按到达顺序排队播完，供欢迎页这类「页面自带一段话」的场景使用。
 *
 * 另有 play()：直接播一段现成的音频地址（本地录音欢迎语音），跳过 TTS 接口，
 * 但共用同一个播放队列与 playing / started，播完推进的逻辑不用改。
 */
export function usePlainTts(language = "zh") {
  /** 当前是否有音频在播 */
  const playing = ref(false);
  /** 是否成功播出过至少一句：WebView 拦截自动播放时，调用方据此决定要不要在手势里补播 */
  const started = ref(false);

  let session = 0;
  let stream: TtsStreamHandle | null = null;
  let streamFinished = true;
  let queue: RealtimeTtsChunk[] = [];
  let audio: ReturnType<typeof uni.createInnerAudioContext> | null = null;

  function releaseAudio() {
    if (!audio) return;
    try {
      audio.stop();
      audio.destroy?.();
    } catch {
      // 个别容器停止失败，忽略
    }
    audio = null;
  }

  function playNext(id: number) {
    if (id !== session || audio) return;

    const chunk = queue.shift();
    if (!chunk) {
      if (streamFinished) playing.value = false;
      return;
    }

    const source = resolveAudioSource(chunk);
    // 后端合成失败时推的是占位帧：跳过这句，继续播下一句
    if (!source) {
      playNext(id);
      return;
    }

    const player = uni.createInnerAudioContext();
    audio = player;
    player.src = source;
    player.onPlay(() => {
      if (audio !== player) return;
      started.value = true;
      playing.value = true;
    });
    player.onEnded(() => {
      if (audio !== player) return;
      audio = null;
      player.destroy?.();
      playNext(id);
    });
    player.onError((error) => {
      if (audio !== player) return;
      logger.warn("跳过无法播放的播报分片", error);
      audio = null;
      player.destroy?.();
      playNext(id);
    });
    player.autoplay = true;
  }

  function handleEvent(payload: unknown, id: number) {
    if (id !== session || !payload || typeof payload !== "object") return;
    const chunk = payload as RealtimeTtsChunk;
    if (chunk.event === "done") return;
    queue.push(chunk);
    playNext(id);
  }

  function finish(id: number) {
    if (id !== session) return;
    stream = null;
    streamFinished = true;
    playNext(id);
  }

  /** 打断当前播报并清空待播队列 */
  function stop() {
    session += 1;
    try {
      stream?.cancel();
    } catch {
      // 连接已断开时 cancel 可能抛错，忽略
    }
    stream = null;
    streamFinished = true;
    queue = [];
    releaseAudio();
    playing.value = false;
  }

  /**
   * 直接播一段打包进项目的本地音频（不走 TTS 接口）。
   * 欢迎页这类固定口播用它：进入页面就能出声，不用等接口合成，
   * playing / started / stop 的语义与 speak 一致，调用方的「播完再往下走」不受影响。
   */
  function playFile(source: string) {
    const src = String(source || "").trim();
    if (!src) return;

    // 先清 started 再 stop：stop 会把 playing 打回 false，
    // 调用方的 watch 若在这一刻读到旧的 started 会误判成「上一段播完了」
    started.value = false;
    stop();

    const player = uni.createInnerAudioContext();
    audio = player;
    player.src = src;
    player.onPlay(() => {
      if (audio !== player) return;
      started.value = true;
      playing.value = true;
    });
    player.onEnded(() => {
      if (audio !== player) return;
      audio = null;
      player.destroy?.();
      playing.value = false;
    });
    player.onError((error) => {
      if (audio !== player) return;
      logger.warn("本地音频播放失败", error);
      audio = null;
      player.destroy?.();
      playing.value = false;
    });
    player.autoplay = true;
  }

  /** 播报一段纯文本；重复调用会打断上一次 */
  function speak(text: string) {
    const content = String(text || "").trim();
    if (!content) return;

    stop();
    // started 按「这一次播报」重置：调用方靠它判断这次有没有真的出声
    started.value = false;
    const id = session;
    streamFinished = false;
    try {
      stream = consumeTextToSpeechStream(
        { text: content, language },
        payload => handleEvent(payload, id),
        (error) => {
          logger.warn("播报请求失败", error);
          finish(id);
        },
        () => finish(id),
      );
    } catch (error) {
      logger.warn("播报请求异常", error);
      finish(id);
    }
  }

  /**
   * 直接播放一个现成的音频地址（本地欢迎语音这类录音文件），不走 TTS 接口。
   *
   * 实现上只是把这条地址当成唯一一段「分片」丢进同一个播放队列，
   * 所以 playing / started / stop / 播完回调（onEnded）与 speak 完全一致：
   * 调用方既可以用它驱动波浪动画，也能继续靠「播报结束」推进页面。
   */
  function play(source: string) {
    const src = String(source || "").trim();
    if (!src) return;

    stop();
    // started 按「这一次播放」重置，与 speak 同一口径
    started.value = false;
    const id = session;
    streamFinished = true;
    queue = [{ dataUrl: src }];
    playNext(id);
  }

  onBeforeUnmount(stop);

  return {
    speak,
    playFile,
    stop,
    playing,
    started,
  };
}

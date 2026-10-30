import type { RealtimeTtsChunk } from "@/api/chat/types";
import type { TtsStreamHandle } from "@/api/chat/tts-stream";
import { onBeforeUnmount, ref } from "vue";
import { consumeTextToSpeechStream } from "@/api/chat/tts-stream";
import { createLogger } from "@/utils/logger";

const logger = createLogger("plain-tts");

/** 中文句末标点：见到就断句（含换行，兼容列表式文案） */
const HARD_BREAK_CHARS = "。！？\n";
/** 英文半角标点：只有后面跟空白或到结尾才断，避免把 1.5 / e.g. 这种切断 */
const SOFT_BREAK_CHARS = ".!?";

/**
 * 按句切分播报文本：一句一次请求，逐句拼起来播。
 *
 * 切句保留句末标点（把标点交给 TTS，断句的停顿更自然）；
 * 空串、纯标点这类念不出声的片段不单独发请求。
 */
export function splitTtsSentences(text: string) {
  const source = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!source) return [];

  const result: string[] = [];
  let buffer = "";
  const flush = () => {
    const sentence = buffer.trim();
    buffer = "";
    // 纯标点 / 纯符号合成不出内容，直接丢掉
    if (/[0-9A-Z\u3400-\u4DBF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/i.test(sentence)) result.push(sentence);
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    buffer += char;
    if (HARD_BREAK_CHARS.includes(char)) {
      flush();
      continue;
    }
    if (SOFT_BREAK_CHARS.includes(char)) {
      const next = source[index + 1];
      if (next === undefined || /\s/.test(next)) flush();
    }
  }
  flush();

  return result;
}

/**
 * 同时最多发几条分句请求。
 * 2 条够用：上一句还在播时下一句已经在合成，句与句之间不留明显空档；
 * 又不至于把整段话一次性打满后端。
 */
const MAX_IN_FLIGHT = 2;

/** 一句待播文本＝一次 tts/v2/stream 请求；chunks 按到达顺序排队，done 表示这句的流已结束 */
interface SentenceJob {
  text: string;
  chunks: RealtimeTtsChunk[];
  done: boolean;
}

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
 * 只把音频按到达顺序排队播完，供欢迎页这类「页面自带一段话」的场景使用。
 *
 * 播报接口一次只接一小段文本最稳，所以 speak() 会先把文案按句号切开，
 * 每句单独发一次 tts/v2/stream，收到的音频进同一个队列顺序播出：
 * 效果上就是「一句一句合成、连起来念」，句子之间不会互相截断。
 *
 * 另有 play()：直接播一段现成的音频地址（本地录音欢迎语音），跳过 TTS 接口，
 * 但共用同一个播放队列与 playing / started，播完推进的逻辑不用改。
 */
export function usePlainTts(language = "zh") {
  /** 当前是否有音频在播（整段播完才回落 false） */
  const playing = ref(false);
  /** 是否成功播出过至少一句：WebView 拦截自动播放时，调用方据此决定要不要在手势里补播 */
  const started = ref(false);

  /** 播报代次：切句 / 打断都会 +1，旧回包一律丢弃 */
  let session = 0;
  /** 已发出请求、按文本顺序排列的句子 */
  let jobs: SentenceJob[] = [];
  /** 还没发请求的句子 */
  let pending: string[] = [];
  /** 在途请求数 */
  let inFlight = 0;
  /** 在途的 SSE 句柄，stop 时统一取消 */
  let streams: TtsStreamHandle[] = [];
  let audio: ReturnType<typeof uni.createInnerAudioContext> | null = null;

  /**
   * 补一次显式 play()。
   *
   * uni 的 InnerAudioContext 在 H5 上只把 autoplay 透传给 <audio autoplay>，
   * 个别 WebView 不认这个属性（声音不出来也不报错，onPlay 永远不触发），
   * 必须显式 play() 才会出声（同 qrcode 页开场视频的处理）。
   * 没有用户手势时 play() 会被自动播放策略拒绝，这里把拒绝吞掉，
   * 由调用方按 started 判断要不要在第一次手势里补播。
   */
  function startPlayback(player: ReturnType<typeof uni.createInnerAudioContext>) {
    try {
      const result = player.play?.() as unknown;
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch(() => {});
      }
    }
    catch {
      // 容器不支持显式 play 时忽略，autoplay 属性仍然生效
    }
  }

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

  /** 播一段音频地址：播完（或播失败）后继续从队列里取下一句 */
  function playSource(source: string, id: number) {
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
    startPlayback(player);
  }

  /**
   * 从队首按句、按到达顺序取一段音频播。
   * 队首这句的音频还没到就等它的流；已经收完就换下一句。
   * 整个队列空了且没有在途请求，才算这一段播报结束。
   */
  function playNext(id: number) {
    if (id !== session || audio) return;

    while (jobs.length) {
      const job = jobs[0];
      const chunk = job.chunks.shift();
      if (!chunk) {
        if (!job.done) return;
        jobs.shift();
        continue;
      }
      const source = resolveAudioSource(chunk);
      // 后端合成失败时推的是占位帧：跳过这句，继续播下一句
      if (!source) continue;
      playSource(source, id);
      return;
    }

    // 还有没发出去的句子 / 在途请求就接着等，别提前把 playing 打回 false
    if (!pending.length && inFlight === 0) playing.value = false;
  }

  /** 为一句文本发一次 tts/v2/stream，音频进这句自己的队列 */
  function startSentence(job: SentenceJob, id: number) {
    let handle: TtsStreamHandle | null = null;
    let settled = false;

    const settle = (error?: Error) => {
      if (error) logger.warn("播报请求失败", { text: job.text, error });
      if (settled) return;
      settled = true;

      if (handle) {
        const index = streams.indexOf(handle);
        if (index >= 0) streams.splice(index, 1);
      }
      if (id !== session) return;

      job.done = true;
      inFlight -= 1;
      pump(id);
    };

    try {
      handle = consumeTextToSpeechStream(
        { text: job.text, language },
        (payload) => {
          if (id !== session || !payload || typeof payload !== "object") return;
          const chunk = payload as RealtimeTtsChunk;
          if (chunk.event === "done") return;
          job.chunks.push(chunk);
          playNext(id);
        },
        error => settle(error),
        () => settle(),
      );
      streams.push(handle);
    } catch (error) {
      logger.warn("播报请求异常", error);
      settle();
    }
  }

  /** 按在途上限补发后续句子，再让播放队列继续 */
  function pump(id: number) {
    if (id !== session) return;

    while (inFlight < MAX_IN_FLIGHT && pending.length) {
      const text = pending.shift();
      if (!text) break;
      const job: SentenceJob = { text, chunks: [], done: false };
      // 顺序必须按文本来：后面的句子先合成完也不能抢到前面播
      jobs.push(job);
      inFlight += 1;
      startSentence(job, id);
    }

    playNext(id);
  }

  /** 打断当前播报并清空待播队列 */
  function stop() {
    session += 1;

    const active = streams;
    streams = [];
    for (const handle of active) {
      try {
        handle.cancel();
      } catch {
        // 连接已断开时 cancel 可能抛错，忽略
      }
    }

    jobs = [];
    pending = [];
    inFlight = 0;
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
    startPlayback(player);
  }

  /**
   * 播报一段纯文本：先按句号切句，每句单独走 tts/v2/stream，再顺序拼接播放。
   * 重复调用会打断上一次（切步骤 / 切页面时天然满足「播最新一句」）。
   */
  function speak(text: string) {
    const content = String(text || "").trim();
    if (!content) return;

    const sentences = splitTtsSentences(content);
    if (!sentences.length) return;

    stop();
    // started 按「这一次播报」重置：调用方靠它判断这次有没有真的出声
    started.value = false;
    const id = session;
    pending = sentences;
    pump(id);
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
    jobs = [{ text: "", chunks: [{ dataUrl: src }], done: true }];
    playNext(id);
  }

  onBeforeUnmount(stop);

  return {
    speak,
    // ⚠️ play / playFile 都必须导出：作业指导初始化页的自我介绍帧用 play() 播本地录音，
    // 漏掉它这句就是个运行期 TypeError（语音直接不响，也没有报错提示）
    play,
    playFile,
    stop,
    playing,
    started,
  };
}

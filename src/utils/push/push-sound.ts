import { readonly, ref } from "vue";
import notice01 from "@/assets/task-notice/01.wav";
import notice02 from "@/assets/task-notice/02.wav";
import notice03 from "@/assets/task-notice/03.wav";
import notice04 from "@/assets/task-notice/04.wav";
import notice05 from "@/assets/task-notice/05.wav";
import { createLogger } from "@/utils/logger";

const logger = createLogger("push-sound");

/**
 * 任务下发通知的提示音。
 *
 * 素材放在 `src/assets/task-notice/`，一共 5 段，每次收到新通知随机挑一段播，
 * 避免同一辆车连续收到多条时听感单调。
 *
 * 试听点击时启动 Web Audio。后续通知复用已启动的 AudioContext 播放，
 * 避免每条 MQTT 消息都走一次媒体元素的自动播放检查。
 */

/** 可随机挑选的提示音（构建期由 Vite 转成最终 URL） */
export const PUSH_NOTICE_SOUNDS: string[] = [notice01, notice02, notice03, notice04, notice05].filter(Boolean);

let player: HTMLAudioElement | null = null;
let context: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
const buffers = new Map<string, AudioBuffer>();
let playbackId = 0;
const playing = ref(false);
export const pushNoticeSoundPlaying = readonly(playing);

export type PushSoundResult = "played" | "blocked" | "failed" | "superseded";

const PLAYBACK_TIMEOUT_MS = 4000;

function createMediaPlayer() {
  const audio = new Audio();
  const updatePlaying = (event: Event) => {
    if (player === audio && !source) {
      playing.value = event.type === "playing" && !audio.paused && !audio.ended;
    }
  };
  for (const event of ["playing", "waiting", "pause", "ended", "error"]) {
    audio.addEventListener(event, updatePlaying);
  }
  return audio;
}

async function waitForPlayback<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("提示音启动超时")), PLAYBACK_TIMEOUT_MS);
      }),
    ]);
  }
  finally {
    clearTimeout(timer);
  }
}

/** 随机挑一段提示音播放（同一时刻只响一段） */
export async function playPushNoticeSound(fromGesture = false): Promise<PushSoundResult> {
  const id = ++playbackId;
  const src = PUSH_NOTICE_SOUNDS[Math.floor(Math.random() * PUSH_NOTICE_SOUNDS.length)];
  if (!src) return "failed";

  source?.stop();
  source = null;
  player?.pause();
  playing.value = false;

  try {
    if (fromGesture && !context && typeof window !== "undefined") {
      const AudioContextClass = window.AudioContext
        ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        const audioContext = new AudioContextClass();
        audioContext.onstatechange = () => {
          if (context === audioContext && source) {
            playing.value = audioContext.state === "running";
          }
        };
        context = audioContext;
      }
    }
    const audioContext = context;
    if (audioContext && (fromGesture || audioContext.state === "running")) {
      if (audioContext.state !== "running") await waitForPlayback(audioContext.resume());
      let buffer = buffers.get(src);
      if (!buffer) {
        buffer = await waitForPlayback(fetch(src).then(async (response) => {
          if (!response.ok) throw new Error(`提示音读取失败（HTTP ${response.status}）`);
          return audioContext.decodeAudioData(await response.arrayBuffer());
        }));
        if (id !== playbackId) return "superseded";
        buffers.set(src, buffer);
      }
      if (id !== playbackId) return "superseded";
      if (audioContext.state !== "running") return "blocked";
      const node = audioContext.createBufferSource();
      node.buffer = buffer;
      node.connect(audioContext.destination);
      node.onended = () => {
        node.disconnect();
        if (source === node) {
          source = null;
          playing.value = false;
        }
      };
      node.start();
      source = node;
      playing.value = true;
      return "played";
    }
  }
  catch (error) {
    if (id !== playbackId) return "superseded";
    logger.warn("Web Audio 提示音播放失败", error);
  }

  try {
    if (typeof Audio !== "undefined") {
      const audio = player ?? (player = createMediaPlayer());
      if (audio.getAttribute("src") === src) {
        audio.currentTime = 0;
      }
      else {
        audio.src = src;
      }
      await waitForPlayback(audio.play());
      return id === playbackId ? "played" : "superseded";
    }
  }
  catch (error) {
    if (id !== playbackId) return "superseded";
    player?.pause();
    playing.value = false;
    logger.warn("媒体播放器提示音播放失败", error);
    return (error as Error | undefined)?.name === "NotAllowedError" ? "blocked" : "failed";
  }

  return "failed";
}

/** 页面卸载时释放音频通道 */
export function disposePushNoticeSound() {
  playbackId += 1;
  playing.value = false;
  source?.stop();
  source = null;
  const audioContext = context;
  context = null;
  buffers.clear();
  if (audioContext) void audioContext.close().catch(error => logger.debug("关闭提示音通道失败", error));
  const audio = player;
  player = null;
  if (!audio) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

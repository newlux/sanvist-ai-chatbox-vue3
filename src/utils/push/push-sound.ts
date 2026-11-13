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
 * 播放器复用同一个 `uni.createInnerAudioContext`：
 * 频繁创建会同时占多条音频通道，低端车机上表现为「播到一半卡住」；
 * 连续来消息时先 stop 再换 src，保证只有最后一条在响。
 *
 * H5 的自动播放策略会拦「无用户手势」的声音：页面是用户点进来的（已发生交互），
 * 正常不会被拦；万一被拦，onError 里只记 warn，不影响通知展示。
 */

/** 可随机挑选的提示音（构建期由 Vite 转成最终 URL） */
export const PUSH_NOTICE_SOUNDS: string[] = [notice01, notice02, notice03, notice04, notice05].filter(Boolean);

let player: ReturnType<typeof uni.createInnerAudioContext> | null = null;

function ensurePlayer() {
  if (player) return player;
  try {
    const audio = uni.createInnerAudioContext();
    // 提示音不参与「声音设置」里的语音倍率，保持素材原速
    audio.onError((error) => {
      logger.warn("提示音播放失败（浏览器可能拦截了自动播放）", error);
    });
    player = audio;
    return audio;
  }
  catch (error) {
    logger.warn("当前环境不支持音频播放", error);
    return null;
  }
}

/** 随机挑一段提示音播放（同一时刻只响一段） */
export function playPushNoticeSound() {
  if (!PUSH_NOTICE_SOUNDS.length) return;
  const audio = ensurePlayer();
  if (!audio) return;

  const src = PUSH_NOTICE_SOUNDS[Math.floor(Math.random() * PUSH_NOTICE_SOUNDS.length)];
  try {
    audio.stop();
    audio.src = src;
    audio.play();
    logger.debug("播放提示音", src);
  }
  catch (error) {
    logger.warn("提示音播放异常", error);
  }
}

/** 页面卸载时释放音频通道 */
export function disposePushNoticeSound() {
  const audio = player;
  player = null;
  if (!audio) return;
  try {
    audio.stop();
    audio.destroy();
  }
  catch (error) {
    logger.debug("释放提示音播放器异常", error);
  }
}

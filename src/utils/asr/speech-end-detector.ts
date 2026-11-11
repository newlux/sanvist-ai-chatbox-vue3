/** 流式录音结束检测：音频确认静音后独立计时，字幕变化用于确认/续接人声。 */
export function createSpeechEndDetector(options: {
  onSilence: () => void;
  isPaused?: () => boolean;
  silenceMs?: number;
}) {
  const silenceMs = options.silenceMs ?? 1500;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heard = false;
  let ended = false;
  let peak = 0;
  let lastLevel: number | undefined;
  let transcript = '';

  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  // 相对本轮人声音量识别底噪；保留下限，并限制突发大音量对后续轻声的影响。
  const threshold = () => Math.max(0.015, Math.min(0.06, peak * 0.45));
  function schedule() {
    if (timer !== undefined || !heard || ended || options.isPaused?.()) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (ended || options.isPaused?.()) return;
      ended = true;
      options.onSilence();
    }, silenceMs);
  }
  function observeLevel(level: number) {
    if (!Number.isFinite(level) || level < 0 || ended) return heard;
    lastLevel = level;
    peak = Math.max(peak, level);
    if (options.isPaused?.()) {
      clearTimer();
      return heard;
    }
    if (level >= threshold()) {
      heard = true;
      clearTimer();
    } else {
      schedule();
    }
    return heard;
  }
  function observeTranscript(value: string) {
    const text = value.trim();
    if (!text || text === transcript || ended) return;
    transcript = text;
    heard = true;
    clearTimer();
    // 字幕停止变化不能单独当作静音，必须同时拿到过低电平音频。
    if (lastLevel !== undefined && lastLevel < threshold()) schedule();
  }
  function reset() {
    clearTimer();
    heard = false;
    ended = false;
    peak = 0;
    lastLevel = undefined;
    transcript = '';
  }
  return { observeLevel, observeTranscript, reset };
}

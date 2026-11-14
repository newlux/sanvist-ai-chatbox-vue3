import { onBeforeUnmount, ref, watch } from 'vue';
import { onHide, onUnload } from '@dcloudio/uni-app';
import { useI18n } from 'vue-i18n';
import { openAsrStreamSession, isAsrStreamSupported } from '@/utils/asr/asr-stream-session';
import { isNativePcmStreamSupported, startNativePcmCapture } from '@/utils/asr/native-pcm-stream';
import { isPcmCaptureSupported, startPcmCapture } from '@/utils/asr/pcm-capture';
import { createDuplexVoiceRuntime } from '@/utils/asr/duplex-runtime';
import { ensureNativePermission, permissionDeniedMessage } from '@/utils/platform/mpaas';

export function useDuplexVoice(options: {
  cancelManual: () => unknown;
  submit: (text: string) => void;
  setGain: (gain: number) => void;
  playbackText: () => string;
  playbackActive: () => boolean;
  sessionId: () => unknown;
}) {
  const { locale, t } = useI18n();
  const active = ref(false);
  const starting = ref(false);
  const listening = ref(false);
  const transcript = ref('');
  const ios = uni.getSystemInfoSync().platform === "ios";
  const audioSession = typeof navigator === "undefined" ? undefined
    : (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  let previousAudioType: string | undefined;
  let activation = 0;
  let manualReleased: Promise<unknown> = Promise.resolve();
  const runtime = createDuplexVoiceRuntime({
    recoverCapture: ios,
    openSession: handlers => openAsrStreamSession(handlers, { language: String(locale.value).startsWith('en') ? 'en' : 'zh' }),
    async startCapture(handlers) {
      await manualReleased;
      if (!handlers.isCurrent()) throw new Error("cancelled");
      if (!isAsrStreamSupported()) throw new Error(t('duplex-unavailable'));
      if (!await ensureNativePermission('record_audio')) throw new Error(permissionDeniedMessage('record_audio'));
      if (!handlers.isCurrent()) throw new Error("cancelled");
      const startWebCapture = () => startPcmCapture({
        ...handlers,
        continuous: true,
        onUnavailable: () => handlers.onError(t('duplex-unavailable')),
      });
      // iOS 优先让机器人的播报和麦克风采集共用 WebView 音频会话。
      if (ios && isPcmCaptureSupported()) {
        try { return await startWebCapture(); }
        catch { /* 容器未开放浏览器麦克风时尝试原生 PCM。 */ }
      }
      if (!handlers.isCurrent()) throw new Error("cancelled");
      if (isNativePcmStreamSupported()) {
        try { return await startNativePcmCapture(handlers); }
        catch { /* 未实现原生推流的宿主交给浏览器尝试。 */ }
      }
      if (!handlers.isCurrent()) throw new Error("cancelled");
      return startWebCapture();
    },
    submit: options.submit,
    setGain: options.setGain,
    onState(state) {
      active.value = state.active;
      starting.value = state.starting;
      listening.value = state.listening;
      transcript.value = state.transcript;
    },
    onError(message, released) {
      void restoreAudioSession(released);
      uni.showToast({ title: message, icon: 'none' });
    },
  });
  watch(options.playbackText, runtime.setPlaybackText, { flush: "sync", immediate: true });
  watch(options.playbackActive, runtime.setPlaybackActive, { flush: "sync", immediate: true });
  function restoreAudioSession(released: Promise<unknown>) {
    const id = ++activation;
    return released.finally(() => {
      if (activation !== id || !audioSession || previousAudioType === undefined) return;
      try { audioSession.type = previousAudioType; }
      catch { /* 部分 WebView 只暴露只读会话。 */ }
      previousAudioType = undefined;
    });
  }
  function stop() { return restoreAudioSession(runtime.stop()); }
  function toggle() {
    if (active.value || starting.value) { stop(); return; }
    activation += 1;
    if (ios && audioSession) {
      try {
        previousAudioType ??= audioSession.type;
        audioSession.type = "play-and-record";
      }
      catch { /* 不支持的 WebView 继续使用现有 PCM 通道。 */ }
    }
    manualReleased = Promise.resolve(options.cancelManual());
    void runtime.start();
  }
  // 首次获得会话 ID 不关闭双工；切换已有会话时释放旧录音。
  watch(options.sessionId, (next, previous) => { if (previous && next !== previous) stop(); });
  const onVisibility = () => { if (document.hidden) stop(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  onHide(stop);
  onUnload(stop);
  onBeforeUnmount(() => {
    stop();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  });
  return { active, starting, listening, transcript, toggle, stop };
}

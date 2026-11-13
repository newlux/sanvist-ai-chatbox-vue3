import { onBeforeUnmount, ref, watch } from 'vue';
import { onHide, onUnload } from '@dcloudio/uni-app';
import { useI18n } from 'vue-i18n';
import { openAsrStreamSession, isAsrStreamSupported } from '@/utils/asr/asr-stream-session';
import { isNativePcmStreamSupported, startNativePcmCapture } from '@/utils/asr/native-pcm-stream';
import { startPcmCapture } from '@/utils/asr/pcm-capture';
import { createDuplexVoiceRuntime } from '@/utils/asr/duplex-runtime';
import { ensureNativePermission, permissionDeniedMessage } from '@/utils/platform/mpaas';

export function useDuplexVoice(options: {
  cancelManual: () => unknown;
  submit: (text: string) => void;
  setGain: (gain: number) => void;
  sessionId: () => unknown;
}) {
  const { locale, t } = useI18n();
  const active = ref(false);
  const starting = ref(false);
  const listening = ref(false);
  const transcript = ref('');
  let manualReleased: Promise<unknown> = Promise.resolve();
  const runtime = createDuplexVoiceRuntime({
    openSession: handlers => openAsrStreamSession(handlers, { language: String(locale.value).startsWith('en') ? 'en' : 'zh' }),
    async startCapture(handlers) {
      await manualReleased;
      if (!handlers.isCurrent()) throw new Error("cancelled");
      if (!isAsrStreamSupported()) throw new Error(t('duplex-unavailable'));
      if (!await ensureNativePermission('record_audio')) throw new Error(permissionDeniedMessage('record_audio'));
      if (!handlers.isCurrent()) throw new Error("cancelled");
      // 原生通道失败时尝试 WebAudio；不降级为会停止播报的整段录音。
      if (isNativePcmStreamSupported()) {
        try { return await startNativePcmCapture(handlers); }
        catch { /* 未实现原生推流的宿主交给浏览器尝试。 */ }
      }
      if (!handlers.isCurrent()) throw new Error("cancelled");
      return startPcmCapture({ ...handlers, onUnavailable: () => handlers.onError(t('duplex-unavailable')) });
    },
    submit: options.submit,
    setGain: options.setGain,
    onState(state) {
      active.value = state.active;
      starting.value = state.starting;
      listening.value = state.listening;
      transcript.value = state.transcript;
    },
    onError(message) { uni.showToast({ title: message, icon: 'none' }); },
  });
  function stop() { return runtime.stop(); }
  function toggle() {
    if (active.value || starting.value) { stop(); return; }
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

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, toRefs, watch } from "vue";
import { GCPAPI } from "@/common/api/gcp";
import { useSystemStore } from "@/stores/modules/system";
import VoiceRecorder from "@/utils/voiceRecorder.js";

const props = defineProps({
  modelValue: { type: String, default: "" },
  isLoading: { type: Boolean, default: false },
});

const emit = defineEmits([
  "send",
  "update:modelValue",
  "voice-start",
  "voice-cancel",
  "voice-send",
  "voice-restart",
  "toggle-quick-list",
  "keyboard-height-change",
]);

const MIC_GRANTED_STORAGE_KEY = "wvpn_sany_ai_mic_ok";

function writeMicGrantedPersisted() {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(MIC_GRANTED_STORAGE_KEY, "1");
    }
  } catch {
    /* 无痕模式等 */
  }
}

function clearMicGrantedPersisted() {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(MIC_GRANTED_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

function canUseMediaDevicesMic() {
  return (
    typeof navigator !== "undefined" &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

const systemStore = useSystemStore();
const state = reactive({
  inputMode: "text", // text | voice（组件内部维护）
  voicePhase: "idle", // idle | pressing | recording | finished | editing
  voiceInputFocused: false,
  keyboardHeightPx: 0,
  initialWindowHeightPx: 0,
  keyboardHeightTimer: null,
  _pressTimer: null,
  _typingTimer: null,
  _typingIndex: 0,
  recorder: null,
  _voiceJobId: 0,
  _voicePressStartedAt: 0,
  _onVisualViewportResize: null,
  recognizedTextFull: "",
  recognizedText: "",
  draftText: "",
  _isRecognizing: false,
  _keepOldRecognizedText: false,
  _micPermissionReady: false,
  _micPermissionRequesting: false,
});
const {
  inputMode,
  voicePhase,
  keyboardHeightPx,
  initialWindowHeightPx,
} = toRefs(state);

const isIOS = computed(() => Boolean(systemStore.isIOS));
const voiceTextValue = computed(() => {
  if (state.voicePhase === "finished") {
    return state.draftText || state.recognizedText;
  }
  return state.recognizedText;
});
const voiceKeyboardOpen = computed(() =>
  Boolean(state.inputMode === "voice" && (state.voiceInputFocused || state.keyboardHeightPx > 0)),
);
function _getViewportHeightPx() {
  if (typeof window !== "undefined" && window.innerHeight) {
    return Number(window.innerHeight) || 0;
  }
  try {
    const info = uni?.getSystemInfoSync?.();
    return Number(info?.windowHeight) || 0;
  } catch (e) {
    console.error("[AiChatInput] getSystemInfoSync failed", e);
    return 0;
  }
}

function _updateKeyboardHeightByViewport() {
  if (!state.initialWindowHeightPx) return;
  const now = _getViewportHeightPx();
  if (!now) return;
  const delta = Math.max(0, state.initialWindowHeightPx - now);
  // 有些端会有轻微波动，忽略过小值
  _setKeyboardHeightPx(delta > 20 ? delta : 0);
}

function _setKeyboardHeightPx(heightPx) {
  if (state.inputMode === "text") return;
  const h = Number(heightPx) || 0;
  const maxH = 600;
  const clamped = Math.max(0, Math.min(h, maxH));
  if (state.keyboardHeightTimer) clearTimeout(state.keyboardHeightTimer);
  state.keyboardHeightTimer = setTimeout(() => {
    const prev = Number(state.keyboardHeightPx) || 0;
    if (Math.abs(clamped - prev) < 20) return;
    state.keyboardHeightPx = clamped;
    console.log("[kbd] keyboardHeightPx updated to", clamped);
  }, 100);
}

function onVoiceTextareaFocus() {
  state.voiceInputFocused = true;
  // 键盘弹起后把三个操作按钮滚到可视区域
  // 用 visualViewport resize 事件触发，时机比固定延时更准确
  _scrollVoiceActionsIntoView(600);
  // 再兜底一次，确保键盘完全弹出后仍然可见
  // _scrollVoiceActionsIntoView(1200);
}
function _scrollVoiceActionsIntoView(delay) {
  setTimeout(() => {
    if (!state.voiceInputFocused || state.inputMode !== "voice") return;
    try {
      // 直接用 getElementById 拿真实 DOM，避免 uni-app ref 返回 Vue 实例的问题
      const el =
        typeof document !== "undefined" ? document.getElementById("voice-actions-anchor") : null;
      if (!el) {
        console.log("[scroll] el not found");
        return;
      }
      console.log("[scroll] scrollIntoView called");
      el.scrollIntoView({ block: "end", behavior: "smooth" });
    } catch (e) {
      console.log("[scroll] error", String(e));
    }
  }, delay || 600);
}
function onVoiceTextareaBlur() {
  state.voiceInputFocused = false;
  if (state.keyboardHeightTimer) clearTimeout(state.keyboardHeightTimer);
  // 键盘抬起阶段不要立刻把 bottom 归零：否则会出现“抖一下”的回弹
  state.keyboardHeightTimer = setTimeout(() => {
    state.keyboardHeightPx = 0;
    state.keyboardHeightTimer = null;
  }, 180);
}

function onTrySend() {
  const text = String(props.modelValue || "").trim();
  if (!text) return;
  emit("send");
}

function _ensureRecorder() {
  if (!state.recorder) {
    state.recorder = new VoiceRecorder();
  }
  return state.recorder;
}
async function _requestMicrophonePermission() {
  if (state._micPermissionReady) return true;

  const hasAlipayBridge = typeof window !== "undefined" && window.AlipayJSBridge?.call;
  if (hasAlipayBridge) {
    console.info("[voice] native permission request", { permissions: "record_audio" });
    const granted = await new Promise((resolve) => {
      window.AlipayJSBridge.call("requestPermission", { permissions: "record_audio" }, (result) => {
        console.info("[voice] native permission result", result);
        resolve(String(result?.result) === "1" || result?.status === "granted");
      });
    });
    if (!granted) {
      uni.showToast({ title: "请允许使用麦克风", icon: "none", duration: 3000 });
      return false;
    }
    state._micPermissionReady = true;
    return true;
  }

  try {
    if (typeof navigator !== "undefined" && navigator.permissions?.query) {
      const status = await navigator.permissions.query({
        name: "microphone",
      });
      if (status.state === "granted") {
        state._micPermissionReady = true;
        writeMicGrantedPersisted();
        return true;
      }
    }
  } catch {
    /* 部分 WebView 不支持 Permissions API */
  }

  if (canUseMediaDevicesMic()) {
    try {
      const recorder = _ensureRecorder();
      const res = await recorder.requestPermission?.();
      console.log("requestPermission res", res);
      if (res && res.success) {
        state._micPermissionReady = true;
        writeMicGrantedPersisted();
        return true;
      }
      if (res) {
        clearMicGrantedPersisted();
        uni.showToast({
          title: res.notAllowed ? "请在弹窗中允许使用麦克风" : "当前浏览器不支持语音输入",
          icon: "none",
          duration: 3000,
        });
      }
    } catch (e) {
      clearMicGrantedPersisted();
      const message =
        e?.name === "NotAllowedError" || e?.name === "SecurityError"
          ? "请在弹窗中允许使用麦克风"
          : "当前浏览器不支持语音输入";
      uni.showToast({ title: message, icon: "none", duration: 3000 });
    }
    return false;
  }

  try {
    if (typeof uni !== "undefined" && uni && typeof uni.authorize === "function") {
      const getSettingOnce = () =>
        new Promise((resolve) => {
          if (typeof uni.getSetting !== "function") {
            resolve(null);
            return;
          }
          uni.getSetting({
            success: resolve,
            fail: () => resolve(null),
          });
        });

      const settingRes = await getSettingOnce();
      const authed = Boolean(settingRes?.authSetting?.["scope.record"]);
      if (authed) {
        state._micPermissionReady = true;
        writeMicGrantedPersisted();
        return true;
      }

      const ok = await new Promise((resolve) => {
        uni.authorize({
          scope: "scope.record",
          success: () => resolve(true),
          fail: () => resolve(false),
        });
      });
      if (ok) {
        state._micPermissionReady = true;
        writeMicGrantedPersisted();
        return true;
      }

      await new Promise(r => setTimeout(r, 80));
      const afterAuthSetting = await getSettingOnce();
      if (afterAuthSetting?.authSetting?.["scope.record"]) {
        state._micPermissionReady = true;
        writeMicGrantedPersisted();
        return true;
      }
    }
  } catch (e) {
    // ignore
  }
  return false;
}
function _resetVoiceText() {
  state.recognizedText = "";
  state.draftText = "";
  state._typingIndex = 0;
  if (state._typingTimer) clearInterval(state._typingTimer);
  state._typingTimer = null;
}
function onVoiceClose() {
  // 立即重置键盘状态，避免第二次进入语音模式时 voice-sheet 高度异常
  state.voiceInputFocused = false;
  state.keyboardHeightPx = 0;
  if (state.keyboardHeightTimer) {
    clearTimeout(state.keyboardHeightTimer);
    state.keyboardHeightTimer = null;
  }
  state.voicePhase = "idle";
  state.inputMode = "text";
  state.recognizedText = "";
  emit("toggle-quick-list", true);
}
async function onVoiceIconTap() {
  if (props.isLoading || state._micPermissionRequesting) return;
  state._micPermissionRequesting = true;
  try {
    const ok = await _requestMicrophonePermission();
    console.log("onVoiceIconTap ok", ok);
    if (!ok) return;

    state.inputMode = "voice";
    state.voicePhase = "pressing";
    emit("toggle-quick-list", false);
  } finally {
    state._micPermissionRequesting = false;
  }
}
function switchToVoice() {
  if (props.isLoading) return;
  state.inputMode = "voice";
  state.voicePhase = "pressing";
  state._voiceJobId = Date.now();
  _resetVoiceText();
}
function switchToText() {
  if (props.isLoading) return;
  state.inputMode = "text";
  state.voicePhase = "idle";
  if (state._typingTimer) clearInterval(state._typingTimer);
  state._typingTimer = null;
}
function enterEditing() {
  if (state.voicePhase !== "finished") return;
  state.draftText = state.recognizedText;
  state.voicePhase = "editing";
}

function onVoiceTextTap() {
  enterEditing();
}
function onDraftInput(e) {
  state.draftText = e.detail.value;
}
function onVoiceTextareaInput(e) {
  if (state.voicePhase !== "finished") return;
  state.draftText = e.detail.value;
}
function onVoiceTouchStart(e) {
  console.info("[voice] press start", { phase: state.voicePhase, isLoading: props.isLoading });
  if (props.isLoading || state.voicePhase === "editing") return;
  // iOS Safari：避免默认手势/选择导致 touch 流程被打断
  try {
    if (e && e.cancelable) e.preventDefault();
  } catch (err) {
    // ignore
  }

  // 再次说话时：只要已有识别文本就保留，等新识别覆盖
  state._keepOldRecognizedText = !!state.recognizedText;

  state.inputMode = "voice";
  state.voicePhase = "pressing";
  if (state._pressTimer) clearTimeout(state._pressTimer);
  state._voiceJobId = Date.now();
  // _resetVoiceText();

  state._voicePressStartedAt = Date.now();
  state.voicePhase = "recording";
  _startVoiceRecorder();
  emit("voice-start");
}
function onVoiceTouchEnd() {
  console.info("[voice] press end", { phase: state.voicePhase });
  if (state._pressTimer) {
    clearTimeout(state._pressTimer);
    state._pressTimer = null;
  }
  if (state.voicePhase === "pressing") {
    // 短按：保持语音面板，不退出语音模式（否则“点击就退出”）
    state.voicePhase = "pressing";
    state.inputMode = "voice";
    return;
  }
  if (state.voicePhase === "recording") {
    if (state._typingTimer) clearInterval(state._typingTimer);
    state._typingTimer = null;
    state._typingIndex = 0;
    if (Date.now() - state._voicePressStartedAt < 300) {
      _stopVoiceRecorder(true);
      state.voicePhase = "pressing";
      return;
    }
    _stopVoiceRecorderAndRecognize();
  }
}
function onVoiceTouchCancel() {
  if (state._pressTimer) {
    clearTimeout(state._pressTimer);
    state._pressTimer = null;
  }
  if (state._typingTimer) clearInterval(state._typingTimer);
  state._typingTimer = null;
  state._typingIndex = 0;
  // _resetVoiceText();
  state._voiceJobId = Date.now();
  _stopVoiceRecorder(true);
  state.voicePhase = "pressing";
  emit("voice-cancel");
}
function onVoiceCancel() {
  if (state._typingTimer) clearInterval(state._typingTimer);
  state._typingTimer = null;
  state._typingIndex = 0;
  _resetVoiceText();
  state._voiceJobId = Date.now();
  _stopVoiceRecorder(true);
  state.voicePhase = "pressing";
  emit("voice-cancel");
}
function onVoiceSend() {
  // 立即重置键盘状态，避免后续再进入语音模式时高度异常
  state.voiceInputFocused = false;
  state.keyboardHeightPx = 0;
  if (state.keyboardHeightTimer) {
    clearTimeout(state.keyboardHeightTimer);
    state.keyboardHeightTimer = null;
  }
  const payload = state.draftText || state.recognizedText;
  const finalPayload = String(payload || "").trim();
  if (!finalPayload) return;
  state.voicePhase = "idle";
  state.inputMode = "text";
  if (state._typingTimer) clearInterval(state._typingTimer);
  state._typingTimer = null;

  // 对齐父组件：更新 v-model 并触发 send
  emit("update:modelValue", finalPayload);
  onTrySend();
  nextTick(() => {
    emit("send");
  });
  emit("voice-send", finalPayload);
}
function onVoiceRestart() {
  state.voicePhase = "pressing";
  if (state._typingTimer) clearInterval(state._typingTimer);
  state._typingTimer = null;
  _resetVoiceText();
  state._voiceJobId = Date.now();
  if (state._pressTimer) clearTimeout(state._pressTimer);
  state._pressTimer = setTimeout(() => {
    if (state.voicePhase === "pressing") {
      state.voicePhase = "recording";
      _startVoiceRecorder();
      emit("voice-start");
    }
  }, 200);
  emit("voice-restart");
}

// 语音识别完成后：切换回语音初始（pressing），允许继续长按录音
function onVoiceInitialMode() {
  if (state._pressTimer) {
    clearTimeout(state._pressTimer);
    state._pressTimer = null;
  }
  if (state._typingTimer) {
    clearInterval(state._typingTimer);
    state._typingTimer = null;
  }
  state._typingIndex = 0;
  state.voicePhase = "pressing";
  state.inputMode = "voice";
  state._voiceJobId = Date.now();
  emit("toggle-quick-list", false);
}
async function _startVoiceRecorder() {
  const recorder = _ensureRecorder();
  // 录音中不再展示“模拟识别文本”，避免出现前置占位文案
  state._typingIndex = 0;
  if (!state._keepOldRecognizedText) {
    state.recognizedText = "";
  }
  // 录音期间编辑草稿无意义，清空 draft
  state.draftText = "";
  state._typingTimer = null;
  state._keepOldRecognizedText = false;

  // 开始录音并在 stop 后触发识别
  const jobId = state._voiceJobId;
  const result = await recorder.start(
    { sampleRate: 16000, timeSlice: 1000 },
    null,
    async (blob) => {
      // 忽略旧任务的回调
      if (jobId !== state._voiceJobId) return;
      await _recognizeFromBlob(blob, jobId);
    },
  );
  if (!result || result.success === false) {
    if (result?.notAllowed) {
      clearMicGrantedPersisted();
      state._micPermissionReady = false;
    }
    // 录音失败：回到 pressing
    if (state._typingTimer) clearInterval(state._typingTimer);
    state._typingTimer = null;
    state.voicePhase = "pressing";
  }
}
async function _stopVoiceRecorder(forceCancel = false) {
  try {
    const recorder = _ensureRecorder();
    if (!recorder) return;
    if (forceCancel) {
      // 作废当前识别任务（避免 onStop 异步回调覆盖 UI）
      state._voiceJobId = Date.now();
      await recorder.cancel?.();
      return;
    }
    await recorder.stop?.();
  } catch (e) {
    // ignore
  }
}
async function _stopVoiceRecorderAndRecognize() {
  const recorder = _ensureRecorder();
  try {
    // stop 会触发 recorder onStop(blob) -> _recognizeFromBlob
    await recorder.stop?.();
  } catch (e) {
    state.voicePhase = "finished";
  }
}
async function _recognizeFromBlob(blob, jobId) {
  if (jobId !== state._voiceJobId) return;
  if (!blob) {
    // 取消/失败场景：直接回到 pressing，避免错误切换
    state.voicePhase = "pressing";
    return;
  }
  if (jobId !== state._voiceJobId) return;

  const prevText = String(state.recognizedText || "");

  state._isRecognizing = true;
  try {
    if (jobId !== state._voiceJobId) return;
    const audioBlob =
      typeof blob === "string"
        ? await (async () => {
            console.info("[voice] download native audio", { url: blob });
            const response = await fetch(blob);
            console.info("[voice] native audio response", {
              ok: response.ok,
              status: response.status,
              type: response.type,
            });
            return response.blob();
          })()
        : blob;
    const audioBase64 = await _blobToAudioBase64(audioBlob);
    console.info("[voice] audio converted to Base64", {
      audioSize: audioBase64.length,
    });
    if (!audioBase64) {
      // 无音频：保持旧识别结果
      state.recognizedText = prevText;
      state.draftText = prevText;
      state.voicePhase = "pressing";
      return;
    }
    if (jobId !== state._voiceJobId) return;

    console.info("[voice] ASR request", { audioSize: audioBase64.length });
    const text = await _recognizeSpeechWithBase64(audioBase64);
    console.info("[voice] ASR response", { text });
    // 识别完成：在已有旧文字基础上拼接新识别结果
    const nextText = prevText ? `${prevText}${text}` : text;
    state.recognizedText = nextText;
    state.draftText = nextText;
    state.voicePhase = "finished";
  } catch (e) {
    if (jobId !== state._voiceJobId) return;
    // 识别失败：保持旧识别结果
    state.recognizedText = prevText;
    state.draftText = prevText;
    state.voicePhase = "pressing";
  } finally {
    state._isRecognizing = false;
    if (state._typingTimer) clearInterval(state._typingTimer);
    state._typingTimer = null;
  }
}

async function _blobToAudioBase64(blob) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = String(reader.result || "");
        const base64 = result.includes(",") ? result.split(",")[1] : "";
        if (!base64) return resolve("");
        // 按你提供示例：data:audioBase64;base64,xxxx
        resolve(`data:audioBase64;base64,${base64}`);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    } catch (e) {
      reject(e);
    }
  });
}

function _extractAsrText(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  // 常见：{ success: true, text: '...' }
  if (data.text && typeof data.text === "string") return data.text;
  // 后端可能包了一层 data/result
  if (data.data && typeof data.data.text === "string") return data.data.text;
  if (data.result && typeof data.result.text === "string") return data.result.text;
  if (data.data && typeof data.data.Result === "string") return data.data.Result;
  if (data.Result && typeof data.Result === "string") return data.Result;
  return "";
}

async function _recognizeSpeechWithBase64(audioBase64) {
  console.info("[voice] ASR request", {
    audioSize: audioBase64.length,
  });
  const resp = await GCPAPI.fetchASRBase64({ audioBase64 });
  console.info("[voice] ASR response", resp);
  const payload = resp?.data ? resp.data : resp;
  const text = _extractAsrText(payload);
  return text || state.recognizedTextFull;
}
watch(voiceKeyboardOpen, (isOpen) => {
  if (state.inputMode !== "voice") return;
  emit("keyboard-height-change", isOpen ? state.keyboardHeightPx || 0 : 0);
});

watch(keyboardHeightPx, (height) => {
  if (state.inputMode === "voice" && voiceKeyboardOpen.value) {
    emit("keyboard-height-change", height || 0);
  }
});

onMounted(() => {
  try {
    state.initialWindowHeightPx =
      (typeof window !== "undefined" && window.innerHeight) ||
      Number(uni?.getSystemInfoSync?.()?.windowHeight) ||
      0;
    if (typeof window !== "undefined" && window.visualViewport) {
      state._onVisualViewportResize = () => {
        const delta = Math.max(0, state.initialWindowHeightPx - window.visualViewport.height);
        _setKeyboardHeightPx(delta > 60 ? delta : 0);
      };
      window.visualViewport.addEventListener("resize", state._onVisualViewportResize);
    }
    if (typeof uni !== "undefined" && typeof uni.onKeyboardHeightChange === "function") {
      uni.onKeyboardHeightChange((event) => {
        const height =
          Number(event?.height ?? event?.keyboardHeight ?? event?.detail?.height ?? 0) || 0;
        _setKeyboardHeightPx(height);
      });
    }
  } catch {
    // 忽略不支持的 WebView API。
  }
});

onBeforeUnmount(() => {
  try {
    if (typeof window !== "undefined" && window.visualViewport && state._onVisualViewportResize) {
      window.visualViewport.removeEventListener("resize", state._onVisualViewportResize);
    }
    if (typeof uni !== "undefined" && typeof uni.offKeyboardHeightChange === "function") {
      uni.offKeyboardHeightChange();
    }
    if (state.keyboardHeightTimer) clearTimeout(state.keyboardHeightTimer);
    if (state._pressTimer) clearTimeout(state._pressTimer);
    if (state._typingTimer) clearInterval(state._typingTimer);
  } catch {
    // 忽略不支持的 WebView API。
  }
});
</script>

<template>
  <view
    class="chat-input"
    :class="{ 'chat-input--keyboard-open': voiceKeyboardOpen }"
    :style="{
      '--kbd-height': `${keyboardHeightPx || 0}px`,
      '--kbd-extra': `${isIOS ? 8 : 0}px`,
      '--window-height': `${initialWindowHeightPx || 0}px`,
    }"
  >
    <!-- 语音模式：按住 / 录音中 / 已完成 / 编辑（顶起页面而不是浮层） -->
    <view
      v-if="inputMode === 'voice' && voicePhase !== 'idle'"
      class="voice-sheet"
      :class="{ 'voice-sheet--keyboard-open': voiceKeyboardOpen }"
    >
      <!-- 41167:414 正在说话：波纹动画 -->
      <view class="voice-recording">
        <view class="voice-recording__header">
          <text v-if="voicePhase === 'recording'" class="voice-recording__listening">
            {{ $t("voice-listening") }}
          </text>
          <text v-if="voicePhase === 'finished'" class="voice-recording__listening">
            {{ $t("voice-recognition-completed") }}
          </text>
          <view v-else class="voice-recording__close" @tap="onVoiceClose">
            <image class="voice-recording__close-img" src="@/assets/img/icon-close.svg" />
          </view>
        </view>
        <view
          class="voice-recording__stream"
          :class="{
            'voice-recording__stream--pressing': voicePhase === 'pressing',
          }"
        >
          <textarea
            class="voice-recording__textarea"
            :value="voiceTextValue"
            :disabled="voicePhase !== 'finished'"
            :maxlength="500"
            placeholder=""
            :adjust-position="false"
            confirm-type="send"
            @input="onVoiceTextareaInput"
            @focus="onVoiceTextareaFocus"
            @blur="onVoiceTextareaBlur"
          />
        </view>
        <view class="voice-recording__body">
          <view class="voice-recording__content">
            <view class="voice-recording__top">
              <view v-if="voicePhase === 'pressing'" class="voice-tip__header">
                <text class="voice-tip__text">
                  {{ $t("voice-press-and-speak") }}
                </text>
              </view>
            </view>
            <view
              v-if="voicePhase === 'finished'"
              id="voice-actions-anchor"
              class="voice-finished-actions"
            >
              <view
                class="voice-actions__btn voice-actions__btn--gray"
                :class="{
                  'voice-finished-actions--keyboard-open': voiceKeyboardOpen,
                }"
                @touchstart.stop.prevent="onVoiceClose"
                @tap="onVoiceClose"
              >
                <image
                  src="@/assets/img/icon-close.svg"
                  mode="aspectFit"
                  class="voice-finished-actions__icon"
                />
              </view>
              <view
                class="voice-actions__btn-send voice-actions__btn--red"
                :class="{
                  'voice-finished-actions--keyboard-open': voiceKeyboardOpen,
                }"
                @touchstart.stop.prevent="onVoiceSend"
                @tap="onVoiceSend"
              >
                <image
                  src="@/assets/img/icon-post.svg"
                  mode="aspectFit"
                  class="voice-finished-actions__icon"
                />
              </view>

              <view
                class="voice-actions__btn voice-actions__btn--gray"
                :class="{
                  'voice-finished-actions--keyboard-open': voiceKeyboardOpen,
                }"
                @touchstart.stop.prevent="onVoiceInitialMode"
                @tap="onVoiceInitialMode"
              >
                <image
                  src="@/assets/img/icon-voice-fill.svg"
                  mode="aspectFit"
                  class="voice-finished-actions__icon"
                />
              </view>
            </view>
            <view
              v-else
              class="voice-recording__rings"
              @mousedown="onVoiceTouchStart"
              @mouseup="onVoiceTouchEnd"
              @mouseleave="onVoiceTouchCancel"
              @contextmenu.prevent
              @touchstart.stop="onVoiceTouchStart"
              @touchend.stop="onVoiceTouchEnd"
              @touchcancel.stop="onVoiceTouchCancel"
            >
              <view v-if="voicePhase === 'recording'" class="voice-ring voice-ring--outer" />
              <view v-if="voicePhase === 'recording'" class="voice-ring voice-ring--middle" />
              <view class="voice-ring voice-ring--inner">
                <image
                  mode="aspectFit"
                  class="voice-ring--inner-img"
                  src="@/assets/img/icon-microphone.svg"
                />
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>
    <!-- 输入单元：两种模式（voicePhase!=idle 时隐藏，但按住期间保留触摸区域） -->
    <view v-if="inputMode === 'text'" class="chat-input__unit">
      <!-- 文本输入模式（Figma: 40852:4584） -->

      <template v-if="inputMode === 'text'">
        <textarea
          class="chat-input__field chat-input__field--text"
          :value="modelValue"
          :placeholder="$t('ai-input-placeholder')"
          :auto-height="true"
          :maxlength="500"
          :adjust-position="false"
          confirm-type="send"
          placeholder-class="chat-input__placeholder chat-input__placeholder--text"
          @input="emit('update:modelValue', $event.detail.value)"
          @confirm="onTrySend"
        />
        <view v-if="modelValue" class="chat-input__icon-btn" @tap="onTrySend">
          <image src="@/assets/img/icon-send.svg" mode="aspectFit" class="chat-input__icon-send" />
        </view>
        <view
          v-else
          class="chat-input__icon-btn"
          @touchstart.stop="onVoiceIconTap"
          @tap="onVoiceIconTap"
        >
          <image src="@/assets/img/icon-voice.svg" mode="aspectFit" class="chat-input__icon-send" />
        </view>
      </template>
    </view>

    <!-- 输入单元下提示（Figma: 41116:6071） -->
    <view v-if="inputMode === 'text'" class="chat-input__footer">
      <text class="chat-input__footer-text">
        {{ $t("ai-generated-content") }}
      </text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.chat-input {
  background: transparent;
  padding-bottom: env(safe-area-inset-bottom);
  box-sizing: border-box;
  position: relative;
}

.chat-input--keyboard-open {
  // 键盘弹起时保持普通文档流，WebView 会自动将页面上移露出输入区
  // 不使用 fixed/transform，避免整体上移遮挡输入框
  position: relative;
}

.voice-sheet {
  background: #fafafa;
  border-radius: 24rpx 24rpx 0 0;
  overflow: hidden;
  box-sizing: border-box;
  width: 100%;
  height: 828rpx; // 414px * 2 (1rpx ~= 2px when base width=375)
  display: flex;
  flex-direction: column;
}

.voice-sheet--keyboard-open {
  height: auto;
  max-height: none;
  overflow: visible;
  display: flex;
  flex-direction: column;
}

.voice-sheet--keyboard-open .voice-recording {
  // 占满 voice-sheet 全部高度，按钮用 margin-top:auto 推到底部
  flex: 1;
  justify-content: flex-start;
  align-items: stretch;
  padding: 0;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.voice-sheet--keyboard-open .voice-recording__header {
  height: 56rpx;
  flex-shrink: 0;
}

.voice-sheet--keyboard-open .voice-recording__top {
  display: none;
}

.voice-sheet--keyboard-open .voice-recording__stream {
  flex: 1;
  height: auto;
  min-height: 80rpx;
  padding: 0 36rpx;
  box-sizing: border-box;
  overflow: hidden;
}

.voice-sheet--keyboard-open .voice-recording__textarea {
  height: 100% !important;
}

.voice-sheet--keyboard-open .voice-recording__body {
  // 裸 wrapper，用 margin-top: auto 将按钮区推到底部
  margin-top: auto;
  flex-shrink: 0;
}

.voice-sheet--keyboard-open .voice-recording__content {
  padding-top: 0;
}

.voice-sheet--keyboard-open .voice-finished-actions {
  flex-shrink: 0;
  padding-top: 20rpx;
  padding-bottom: 32rpx;
  gap: 64rpx;
}

.voice-sheet--keyboard-open .voice-recording__rings {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  width: 100%;
  height: auto;
  margin-top: 0;
  padding: 16rpx 0 32rpx;
}

.voice-sheet__home {
  display: flex;
  justify-content: center;
  padding: 0 0 16rpx;
  margin-top: auto;
}

.voice-sheet__home-bar {
  width: 134rpx; // 67px
  height: 10rpx; // 5px
  border-radius: 100rpx;
  background: #000;
}

.voice-tip {
  background: transparent;
  border-radius: 0;
  overflow: visible;
}
.voice-recording__top {
  height: 32rpx;
  display: flex;
  justify-content: center;
  align-items: center;
}
.voice-recording__content {
  padding-top: 0;
}
.voice-tip__header {
  display: flex;
  line-height: 32px;
  justify-content: center;
}

.voice-tip__text {
  font-size: 24rpx;
  color: #1f2937;
}

.voice-tip__mic-wrap {
  padding: 0 0 96rpx;
  display: flex;
  justify-content: center;
}

.voice-mic {
  width: 160rpx;
  height: 160rpx;
  border-radius: 80rpx;
  background: #f12832;
}

.voice-tip__home {
  padding: 32rpx 242rpx 16rpx;
}

.voice-tip__home-bar {
  height: 10rpx;
  border-radius: 100rpx;
  background: #000;
}

.voice-recording {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 0 40rpx;
}

.voice-recording__listening {
  font-size: 24rpx;
  color: #9a9a9a;
  line-height: 32rpx;
}

.voice-recording__stream {
  width: 100%;
  height: 300rpx; // 150px
  padding: 0 36rpx 48rpx; // 0 18px 24px
  border-bottom: 1rpx solid #e5e7ea;
  box-sizing: border-box;
  overflow: hidden;
}
.voice-recording__stream--pressing {
  border-bottom: none;
}

.voice-recording__stream-text {
  display: block;
  font-size: 26rpx;
  color: #2f323c;
  line-height: 40rpx;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.voice-recording__textarea {
  width: 100%;
  height: 100%;
  padding: 0;
  margin: 0;
  font-size: 26rpx;
  color: #2f323c;
  line-height: 40rpx;
  background: transparent;
  overflow: hidden;
}

.voice-finished {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.voice-finished__top {
  flex-shrink: 0;
}

.voice-finished__text {
  flex: 0 0 auto;
  height: 300rpx; // 150px
  padding: 0 36rpx 48rpx; // 0 18px 24px
  border-bottom: 1rpx solid #e5e7ea;
  box-sizing: border-box;
  overflow: hidden;
}

.voice-finished__text-content {
  height: 100%;
  width: 100%;
  display: block;
}

.voice-editing {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.voice-editing__top {
  flex-shrink: 0;
}

.voice-editing__textarea {
  flex: 0 0 auto;
  height: 132rpx; // 66px
  padding: 0 36rpx 30rpx; // 0 18px 15px
  box-sizing: border-box;
  overflow: hidden;
}

.voice-recording__rings {
  position: relative;
  width: 280rpx;
  height: 280rpx;
  margin-top: -10rpx;
  // margin-top: -40rpx;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  cursor: pointer;
}

.voice-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
}

.voice-ring--outer {
  width: 280rpx;
  height: 280rpx;
  background: rgba(241, 40, 50, 0.05);
  animation: voice-pulse 2.4s ease-out infinite;
}

.voice-ring--middle {
  width: 200rpx;
  height: 200rpx;
  background: rgba(241, 40, 50, 0.16);
  animation: voice-pulse 1.8s ease-out infinite;
}

.voice-ring--inner {
  width: 160rpx;
  height: 160rpx;
  background: #f12832;
  display: flex;
  justify-content: center;
  align-items: center;
}
.voice-ring--inner-img {
  width: 40rpx;
  height: 56rpx;
}
@keyframes voice-pulse {
  0% {
    opacity: 0.8;
    transform: translate(-50%, -50%) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(1.3);
  }
}

.voice-actions {
  display: flex;
  justify-content: center;
  gap: 32rpx;
  padding: 48rpx 0;
}

.voice-finished__top {
  display: flex;
  justify-content: center;
  padding-top: 96rpx;
}

.voice-finished__title {
  font-size: 24rpx;
  color: #9a9a9a;
}

.voice-finished__text {
  padding: 0 36rpx 48rpx; // 0 18px 24px
  height: 300rpx; // 150px
  border-bottom: 1rpx solid #e5e7ea;
  box-sizing: border-box;
  display: flex;
  justify-content: center;
}

.voice-finished__text-content {
  width: 100%;
  padding: 0;
  font-size: 28rpx;
  color: #2f323c;
  line-height: 40rpx;
  overflow: hidden;
  height: 100%;
}

.voice-editing__top {
  display: flex;
  justify-content: center;
  padding-top: 96rpx;
}

.voice-editing__textarea {
  width: 100%;
  height: 132rpx; // 66px
  padding: 0 36rpx 30rpx; // 0 18px 15px
  font-size: 28rpx;
  color: #2f323c;
  box-sizing: border-box;
  overflow: hidden;
}

.voice-actions__btn {
  width: 116rpx;
  height: 116rpx;
  border-radius: 58rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f3f3f3;

  &:active {
    opacity: 0.8;
  }
}
.voice-finished-actions {
  .voice-finished-actions--keyboard-open {
    width: 200rpx;
    height: 84rpx;
    border-radius: 46rpx;
  }
}

.voice-actions__btn--send {
  border-radius: 94rpx;
  background: #f12832;
  width: 160rpx;
  height: 160rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.voice-actions__btn--red {
  background: #f12832;
}
.voice-actions__btn-send {
  width: 160rpx;
  height: 160rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f12832;
  border-radius: 94rpx;
}

.voice-actions__btn-text {
  font-size: 24rpx;
  color: #5f6775;
}

.voice-finished-actions {
  width: 100%;
  flex: 0 0 auto;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 84rpx;
  padding-top: 48rpx;
}

.voice-finished-actions__icon {
  width: 52rpx;
  height: 52rpx;
}

.voice-actions__btn--red .voice-actions__btn-text {
  color: #ffffff;
}

.chat-input__unit {
  background: #fff;
  margin: 0 32rpx;
  border-radius: 38rpx; // 19px
  padding: 32rpx;
  display: flex;
  align-items: center;
  gap: 32rpx;
  box-shadow:
    4rpx 0 18.6rpx rgba(107, 90, 90, 0.06),
    0 12rpx 18.6rpx rgba(107, 90, 90, 0.09);
}

.chat-input__field {
  flex: 1;
  background: transparent;
  min-height: 44rpx;
  max-height: 220rpx;
  line-height: 44rpx;
  box-sizing: border-box;
}

.chat-input__field--text {
  font-size: 32rpx; // 16px
  color: #171c25;
  text-align: left;
}

.chat-input__placeholder--text {
  color: #bbc0c9;
  font-size: 32rpx;
  text-align: left;
}

.chat-input__icon-btn {
  width: 40rpx; // 20px
  height: 40rpx; // 20px
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &:active {
    opacity: 0.75;
  }
}

.chat-input__icon-send {
  width: 40rpx;
  height: 40rpx;
}

.chat-input__hold {
  flex: 1;
  font-size: 32rpx; // 16px
  line-height: 44rpx;
  color: #232323;
  text-align: center;
}

.chat-input__icon-mic {
  width: 40rpx;
  height: 40rpx;
  background: #000;
  border-radius: 20rpx;
}

.chat-input__footer {
  padding-top: 12rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}

.chat-input__footer-text {
  width: 100%;
  font-size: 24rpx; // 12px
  line-height: 32rpx;
  color: #bbc0c9;
  text-align: center;
  margin-bottom: 12rpx; // 6px
}

.chat-input__home-indicator-wrap {
  width: 100%;
  padding: 0 240rpx 16rpx;
  box-sizing: border-box;
}
.voice-recording__header {
  height: 96rpx;
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  width: 100%;
}
.voice-recording__close {
  position: absolute;
  right: 48rpx;
  top: 24rpx;
  width: 40rpx;
  height: 40rpx;
  display: flex;
  justify-content: center;
  align-items: center;
  &:active {
    opacity: 0.8;
  }
}
.voice-recording__close-img {
  width: 40rpx;
  height: 40rpx;
}
</style>

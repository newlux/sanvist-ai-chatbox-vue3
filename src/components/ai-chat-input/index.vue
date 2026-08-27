<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AiChatAttachments from "@/components/ai-chat-attachments/index.vue";
import { useComposerAttachments } from "@/hooks/useComposerAttachments";
import { useVoiceInput } from "@/hooks/useVoiceInput";

const props = defineProps({
  modelValue: { type: String, default: "" },
  isLoading: { type: Boolean, default: false },
  /** 键盘高度(px)。 */
  keyboardHeight: { type: Number, default: 0 },
  /** 语音识别结果编辑时的键盘高度。 */
  voiceKeyboardHeight: { type: Number, default: 0 },
});

const emit = defineEmits([
  "send",
  "stop",
  "update:modelValue",
  "voice-start",
  "voice-cancel",
  "voice-send",
  "voice-restart",
  "toggle-quick-list",
  "input-focus",
  "input-blur",
  "voice-input-focus",
  "voice-input-blur",
  "dock-height-change",
  "recognize-begin",
  "recognize-fail",
]);

const { t } = useI18n();

/**
 * 输入框的本地副本。父组件清空 v-model 是异步的（发送链路里还要过一次 store），
 * 这里保留一份本地值，发送时立即置空，保证输入框肉眼可见地被清干净。
 */
const draft = ref(String(props.modelValue || ""));
watch(() => props.modelValue, (value) => {
  const next = String(value || "");
  if (next !== draft.value) draft.value = next;
});

const textTextareaHeight = computed(() => {
  const maxCharsPerLine = 15;
  const lineCount = String(draft.value || "")
    .split("\n")
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / maxCharsPerLine)), 0);
  return `${Math.min(Math.max(lineCount, 1), 4) * 40}rpx`;
});

const {
  attachments,
  hasAttachments,
  hasIncompleteAttachments,
  hasFailedAttachments,
  openAttachmentPicker,
  removeAttachment,
  retryAttachment,
  takeUploadedFiles,
} = useComposerAttachments();

const canSend = computed(() => Boolean(draft.value.trim() || hasAttachments.value));
/** 有东西可发才显示发送按钮，此时让位给它的是语音/键盘切换按钮 */
const showSendButton = computed(() => !props.isLoading && canSend.value);

const keyboardOpen = computed(() => props.keyboardHeight > 0);
const voiceKeyboardOpen = computed(() => props.voiceKeyboardHeight > 0);
const inputLiftStyle = computed(() => {
  const lift = Math.max(0, Number(props.keyboardHeight || props.voiceKeyboardHeight) || 0);
  return lift > 0 ? { bottom: `${lift}px` } : {};
});

const dockRef = ref<unknown>(null);
const voiceSheetRef = ref<unknown>(null);
let composerResizeObserver: ResizeObserver | null = null;

function readEl(raw: unknown): HTMLElement | null {
  if (!raw) return null;
  if (typeof HTMLElement !== "undefined" && raw instanceof HTMLElement) return raw;
  const el = (raw as { $el?: unknown }).$el;
  if (typeof HTMLElement !== "undefined" && el instanceof HTMLElement) return el;
  return null;
}

function measureComposerHeight() {
  const dock = readEl(dockRef.value);
  const sheet = readEl(voiceSheetRef.value);
  const height = Math.round(Math.max(dock?.offsetHeight || 0, sheet?.offsetHeight || 0));
  if (height > 0) emit("dock-height-change", height);
}

function observeComposer() {
  composerResizeObserver?.disconnect();
  composerResizeObserver = null;
  measureComposerHeight();
  if (typeof ResizeObserver === "undefined") return;
  const dock = readEl(dockRef.value);
  const sheet = readEl(voiceSheetRef.value);
  if (!dock && !sheet) return;
  composerResizeObserver = new ResizeObserver(() => measureComposerHeight());
  if (dock) composerResizeObserver.observe(dock);
  if (sheet) composerResizeObserver.observe(sheet);
}

/**
 * 收键盘后遮罩多留一会儿：键盘落下的过程中输入栏会跟着往下移动，
 * 遮罩要是立刻消失，这一次触摸的 tap 会落到刚好移过来的加号上，凭空弹出附件面板。
 */
const maskLingering = ref(false);
let maskLingerTimer = null;
const showKeyboardMask = computed(() => keyboardOpen.value || voiceKeyboardOpen.value || maskLingering.value);

/** 点击面板以外的区域收起键盘：识别结果编辑态下这是唯一的退出口 */
function onDismissKeyboard() {
  uni.hideKeyboard();
  emit("input-blur");
  if (voiceKeyboardOpen.value) emit("voice-input-blur");
  maskLingering.value = true;
  if (maskLingerTimer) clearTimeout(maskLingerTimer);
  maskLingerTimer = setTimeout(() => {
    maskLingerTimer = null;
    maskLingering.value = false;
  }, 400);
}

/** 遮罩上的 tap 只做拦截，避免透传到下面的按钮 */
function onMaskTap() {}

/**
 * 统一的发送出口（文本回车 / 发送按钮 / 语音识别结果确认）。
 * 附件与文本一起提交，随后立刻清空输入框与附件栏。
 */
function submitMessage(rawText?: string) {
  if (props.isLoading) return;
  const text = String(rawText ?? draft.value).trim();
  if (!text && !hasAttachments.value) return;

  if (hasIncompleteAttachments.value) {
    uni.showToast({
      title: hasFailedAttachments.value ? t("attachment-retry-or-remove") : t("attachment-uploading-wait"),
      icon: "none",
    });
    return;
  }

  const { files, meta } = takeUploadedFiles();
  draft.value = "";
  emit("update:modelValue", "");
  emit("send", { text, files, attachments: meta });
}

// 语音输入（录音手势、权限、识别、确认面板）整体收在 useVoiceInput 里
const {
  inputMode,
  voicePhase,
  voiceTextValue,
  isVoiceConfirmationOpen,
  voiceTextareaRef,
  state: voice,
  onToggleInputMode,
  onVoiceClose,
  onVoiceSend,
  onVoiceTextareaInput,
  focusVoiceTextarea,
  updateVoiceGesture,
  onVoicePillTouchStart,
  onVoicePillTouchEnd,
  onVoicePillTouchCancel,
  onVoiceTouchStart,
  onVoiceTouchEnd,
  onVoiceTouchCancel,
  onVoiceRestartStart,
  onVoiceRestartEnd,
  onVoiceRestartCancel,
} = useVoiceInput({
  isLoading: () => props.isLoading,
  submit: text => submitMessage(text),
  onRecognizeBegin: () => emit("recognize-begin"),
  onRecognizeFail: () => emit("recognize-fail"),
  toggleQuickList: () => emit("toggle-quick-list", true),
  dismissKeyboard: onDismissKeyboard,
  emitVoiceEvent: (event, payload) => emit(event, payload),
});

function onDraftInput(e: { detail: { value: string } }) {
  draft.value = e.detail.value;
  emit("update:modelValue", draft.value);
}

function onTextareaFocus() {
  emit("input-focus");
}

function onTextareaBlur() {
  // 失焦即键盘收起：个别基础库不会再回调高度 0，这里主动复位，
  // 否则可视区会一直停在被压缩的高度上
  emit("input-blur");
}

function resetVoiceKeyboardState() {
  emit("voice-input-blur");
}

/** 收起语音编辑键盘只退出编辑焦点，保留识别草稿和语音确认态。 */
function onVoiceTextareaBlur() {
  resetVoiceKeyboardState();
}

/**
 * 点击识别结果进入编辑：先同步把「语音编辑」标志置位（早于浏览器 focusin），
 * 避免 onFocusIn 从 DOM 判定失败而把普通输入栏弹起；随后再聚焦。
 */
function prepareVoiceTextareaFocus() {
  emit("voice-input-focus");
  focusVoiceTextarea();
}

function onVoiceCloseUi() {
  resetVoiceKeyboardState();
  onVoiceClose();
}

function onVoiceSendUi() {
  resetVoiceKeyboardState();
  onVoiceSend();
}

function onVoiceRestartStartUi(e: unknown) {
  uni.hideKeyboard();
  resetVoiceKeyboardState();
  onVoiceRestartStart(e);
}

function onToggleInputModeUi() {
  uni.hideKeyboard();
  emit("input-blur");
  resetVoiceKeyboardState();
  onToggleInputMode();
}

function onTrySend() {
  submitMessage();
}

function onOpenAttachmentPicker() {
  if (props.isLoading || voice.isRecognizing) return;
  openAttachmentPicker();
}

watch(
  () => [
    keyboardOpen.value,
    voiceKeyboardOpen.value,
    inputMode.value,
    voicePhase.value,
    isVoiceConfirmationOpen.value,
    attachments.value.length,
    textTextareaHeight.value,
  ],
  () => nextTick(observeComposer),
);

onMounted(() => nextTick(observeComposer));

onBeforeUnmount(() => {
  if (maskLingerTimer) clearTimeout(maskLingerTimer);
  composerResizeObserver?.disconnect();
  composerResizeObserver = null;
});
</script>

<template>
  <view
    class="chat-input"
    :class="{ 'chat-input--keyboard-open': keyboardOpen || voiceKeyboardOpen }"
    :style="inputLiftStyle"
  >
    <!-- 键盘弹起时的空白区兜底：点一下收键盘，否则编辑识别结果时没有退出口 -->
    <view
      v-if="showKeyboardMask"
      class="chat-input__keyboard-mask"
      @touchstart.stop.prevent="onDismissKeyboard"
      @click.stop="onDismissKeyboard"
      @tap.stop="onMaskTap"
    />

    <!-- 监听态挂到 body，避免父级层叠上下文让导航和浮动按钮露在遮罩上方 -->
    <Teleport to="body">
      <view
        v-if="inputMode === 'voice' && voicePhase === 'recording'"
        class="voice-sheet voice-sheet--listening"
      >
        <view class="voice-listening">
          <view
            class="voice-listening__header"
            :class="{ 'voice-listening__header--cancelling': voice.cancelling }"
          >
            <text class="voice-listening__title">
              {{ voice.cancelling ? '松开取消语音' : 'Noyi正在听，请说话' }}
            </text>
            <text class="voice-listening__hint">
              {{ voice.cancelling ? '松开手指取消识别' : '说完松手' }}
            </text>
          </view>

          <!-- 对称圆点声纹 -->
          <view v-if="voicePhase === 'recording'" class="voice-wave" aria-hidden="true">
            <view class="voice-wave__dots voice-wave__dots--left">
              <view v-for="i in 9" :key="`l${i}`" class="voice-wave__dot" />
            </view>
            <view class="voice-wave__center" />
            <view class="voice-wave__dots voice-wave__dots--right">
              <view v-for="i in 9" :key="`r${i}`" class="voice-wave__dot" />
            </view>
          </view>

          <!-- 麦克风（按住说话） -->
          <view
            class="voice-listening__mic"
            @touchstart.prevent="onVoiceTouchStart"
            @touchmove.prevent="updateVoiceGesture"
            @touchend.prevent="onVoiceTouchEnd"
            @touchcancel.prevent="onVoiceTouchCancel"
          >
            <image src="@/assets/img/icon-mic-red.svg" mode="aspectFit" class="voice-listening__mic-img" />
          </view>
        </view>
      </view>
    </Teleport>

    <!-- 识别完成 / 编辑态：底部面板（设计稿 495:589 / 495:656） -->
    <view
      v-if="inputMode === 'voice' && voicePhase !== 'idle' && isVoiceConfirmationOpen"
      ref="voiceSheetRef"
      class="voice-sheet"
      :class="{ 'voice-sheet--keyboard-open': voiceKeyboardOpen }"
    >
      <view class="voice-confirm">
        <view
          class="voice-confirm__box"
          :class="{ 'voice-confirm__box--recognizing': voice.isRecognizing }"
        >
          <textarea
            ref="voiceTextareaRef"
            class="voice-confirm__textarea"
            data-voice-confirm-input="true"
            :value="voiceTextValue"
            :disabled="voice.isRecognizing"
            placeholder=""
            confirm-type="send"
            :adjust-position="false"
            :cursor-spacing="0"
            :show-confirm-bar="false"
            @input="onVoiceTextareaInput"
            @confirm="onVoiceSendUi"
            @focus="emit('voice-input-focus')"
            @blur="onVoiceTextareaBlur"
            @touchstart.stop="prepareVoiceTextareaFocus"
          />
          <view v-if="voice.isRecognizing" class="voice-confirm__recognizing" aria-label="语音识别中">
            <view class="voice-confirm__spinner" />
            <text class="voice-confirm__recognizing-text">
              语音识别中...
            </text>
          </view>
          <view v-else-if="voice.restartRecording" class="voice-confirm__recognizing" aria-label="正在录音">
            <text class="voice-confirm__recognizing-text">
              {{ voice.cancelling ? '松开取消' : '正在录音，松开识别' }}
            </text>
          </view>
        </view>

        <view
          v-if="!voiceKeyboardOpen"
          class="voice-confirm__actions"
          :class="{ 'voice-confirm__actions--recognizing': voice.isRecognizing }"
        >
          <!-- 关闭 -->
          <view
            class="voice-action voice-action--ghost"
            @touchstart.stop.prevent="onVoiceCloseUi"
            @tap="onVoiceCloseUi"
          >
            <image src="@/assets/img/icon-close-lg.svg" mode="aspectFit" class="voice-action__icon" />
          </view>
          <!-- 发送 -->
          <view
            class="voice-action voice-action--send"
            @touchstart.stop.prevent="onVoiceSendUi"
            @tap="onVoiceSendUi"
          >
            <image src="@/assets/img/icon-send-2.svg" mode="aspectFit" class="voice-action__icon voice-action__icon--send" />
          </view>
          <!-- 重新识别 -->
          <view
            class="voice-action voice-action--ghost"
            :class="{ 'voice-action--recording': voice.restartRecording }"
            @touchstart.prevent="onVoiceRestartStartUi"
            @touchmove.prevent="updateVoiceGesture"
            @touchend.prevent="onVoiceRestartEnd"
            @touchcancel.prevent="onVoiceRestartCancel"
          >
            <image src="@/assets/img/icon-voice-sm.svg" mode="aspectFit" class="voice-action__icon" />
          </view>
        </view>
      </view>
    </view>
    <!-- 始终 fixed 贴底；键盘弹起时用 bottom 抬到键盘上方 -->
    <view
      v-if="!voiceKeyboardOpen"
      ref="dockRef"
      class="chat-input__dock"
    >
      <!-- 附件预览栏：选中的文件在输入栏上方排开 -->
      <AiChatAttachments
        v-if="attachments.length"
        :attachments="attachments"
        @remove="removeAttachment"
        @retry="retryAttachment"
      />

      <!-- 底部输入栏：默认语音、键盘文本、发送和生成中状态 -->
      <view
        class="input-bar"
        :class="{ 'input-bar--text': inputMode === 'text' }"
      >
        <!-- 左侧：附件入口 -->
        <view
          class="input-bar__plus"
          :class="{ 'input-bar__plus--disabled': isLoading || voice.isRecognizing }"
          @tap="onOpenAttachmentPicker"
        >
          <image src="@/assets/img/icon-plus.svg" mode="aspectFit" />
        </view>

        <view
          v-if="inputMode === 'voice'"
          class="input-bar__voice-pill"
          :class="{ 'input-bar__voice-pill--disabled': isLoading || voice.isRecognizing }"
          @touchstart.prevent="onVoicePillTouchStart"
          @touchmove.prevent="updateVoiceGesture"
          @touchend.prevent="onVoicePillTouchEnd"
          @touchcancel.prevent="onVoicePillTouchCancel"
        >
          <text class="input-bar__voice-hint">
            {{ isLoading ? '回答生成中...' : voice.isRecognizing ? '识别中...' : '按住 说话' }}
          </text>
        </view>
        <view v-else class="input-bar__text-field">
          <textarea
            class="input-bar__textarea"
            :value="draft"
            :style="{ height: textTextareaHeight }"
            placeholder="发消息"
            :disabled="isLoading"
            :auto-height="false"
            :adjust-position="false"
            :cursor-spacing="0"
            :hold-keyboard="true"
            :maxlength="-1"
            confirm-type="send"
            placeholder-class="input-bar__placeholder"
            @input="onDraftInput"
            @confirm="onTrySend"
            @focus="onTextareaFocus"
            @blur="onTextareaBlur"
          />
        </view>

        <!-- 语音/键盘切换与发送互斥：没有可发内容时才占这个位置。
             生成回答期间同样保留，用户可以先把下一条消息的输入方式切好 -->
        <view
          v-if="!showSendButton"
          class="input-bar__mode"
          :class="{ 'input-bar__mode--disabled': voice.gesture.active || voice.isRecognizing }"
          @tap="onToggleInputModeUi"
        >
          <image
            v-if="inputMode === 'voice'"
            src="@/assets/img/icon-keyboard.svg"
            mode="aspectFit"
          />
          <image v-else src="@/assets/img/icon-voice.svg" mode="aspectFit" />
        </view>

        <!-- 生成中只给停止按钮，不给发送 -->
        <view v-if="isLoading" class="input-bar__stop" @tap="emit('stop')">
          <image src="@/assets/img/icon-stop.svg" mode="aspectFit" />
        </view>
        <view
          v-else-if="showSendButton"
          class="input-bar__send"
          @touchstart.stop.prevent="onTrySend"
        >
          <image src="@/assets/img/icon-send.svg" mode="aspectFit" />
        </view>
      </view>

      <!-- 输入单元下提示（Figma: 41116:6071）。跟着输入栏一起上移，键盘弹起时同样要看得见 -->
      <view class="chat-input__footer">
        <text class="chat-input__footer-text">
          内容由AI生成，请核实重要信息
        </text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.chat-input {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1;
  box-sizing: border-box;
  background: #fafafa;
  uni-image {
    width: 100%;
    height: 100%;
  }
}

.voice-sheet {
  position: relative;
  z-index: 2;
  box-sizing: border-box;
  // 识别完成/编辑态：设计稿中的窄幅底部面板
  border-radius: 64rpx 64rpx 0 0;
  background: #ffffff;
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
  box-shadow: 0 -0.5rem 1.5rem rgba(51, 51, 51, 0.14);
}

// 监听态：全屏对焦（设计稿 495:543）
.voice-sheet--listening {
  position: fixed;
  z-index: 100000;
  top: 0;
  right: 0;
  bottom: auto;
  left: 0;
  height: 100%;
  border-radius: 0;
  background:
    radial-gradient(ellipse 196rpx 117rpx at 0 0, rgba(123, 167, 217, 0.06) 50%, transparent 100%),
    radial-gradient(ellipse 301rpx 117rpx at 100% 0, rgba(254, 0, 0, 0.07) 0%, transparent 100%),
    #ffffff;
  box-shadow: none;
}

/* ---------- 监听态 ---------- */
.voice-listening {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  height: 100%;
  padding-bottom: calc(env(safe-area-inset-bottom) + 60rpx);
  box-sizing: border-box;
}

.voice-listening__header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  margin-top: auto;
}

.voice-listening__title {
  font-family: 'Sarasa Gothic SC', 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei',
    -apple-system, 'Helvetica Neue', sans-serif;
  font-size: 28rpx; // 14px
  font-weight: 600;
  color: #333333;
  line-height: 34rpx;
  text-align: center;
}

.voice-listening__hint {
  font-family: 'Sarasa Gothic SC', 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei',
    -apple-system, 'Helvetica Neue', sans-serif;
  font-size: 24rpx; // 12px
  font-weight: 400;
  color: #999999;
  line-height: 30rpx;
  text-align: center;
}

.voice-listening__header--cancelling {
  .voice-listening__title,
  .voice-listening__hint {
    color: #c8201e;
  }
}

/* 对称圆点声纹（中心点 + 左右各 9 点，透明度渐隐） */
.voice-wave {
  display: flex;
  align-items: center;
  margin-top: 48rpx;
}

.voice-wave__dots {
  display: flex;
  align-items: center;
  gap: 16rpx; // 8px
}

.voice-wave__dots--left {
  flex-direction: row-reverse;
}

.voice-wave__center {
  flex: 0 0 auto;
  width: 12rpx; // 6px
  height: 12rpx;
  margin: 0 16rpx;
  border-radius: 50%;
  background: #c8201e;
}

.voice-wave__dot {
  flex: 0 0 auto;
  width: 8rpx; // 4px
  height: 8rpx;
  border-radius: 50%;
  background: #c8201e;
  animation: voice-wave-breathe 1.1s ease-in-out infinite;
}

.voice-wave__dot:nth-child(1) { opacity: 1; animation-delay: 0s; }
.voice-wave__dot:nth-child(2) { opacity: 0.8; animation-delay: 0.05s; }
.voice-wave__dot:nth-child(3) { opacity: 0.6; animation-delay: 0.1s; }
.voice-wave__dot:nth-child(4) { opacity: 0.4; animation-delay: 0.15s; }
.voice-wave__dot:nth-child(5) { opacity: 0.3; animation-delay: 0.2s; }
.voice-wave__dot:nth-child(6) { opacity: 0.2; animation-delay: 0.25s; }
.voice-wave__dot:nth-child(7) { opacity: 0.1; animation-delay: 0.3s; }
.voice-wave__dot:nth-child(8) { opacity: 0.05; animation-delay: 0.35s; }
.voice-wave__dot:nth-child(9) { opacity: 0.02; animation-delay: 0.4s; }

@keyframes voice-wave-breathe {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(1.7); }
}

/* 麦克风（按住说话） */
.voice-listening__mic {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 168rpx; // 84px 触达区，视觉 42px
  height: 168rpx;
  margin-top: 96rpx;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}

.voice-listening__mic-img {
  display: block;
  flex: 0 0 84rpx;
  width: 84rpx !important; // 42px
  height: 84rpx !important;

  img {
    width: 84rpx !important;
    height: 84rpx !important;
  }
}

/* ---------- 识别完成 / 编辑态 ---------- */
.voice-confirm {
  padding: 50rpx 32rpx 0;
}

.voice-sheet--keyboard-open {
  border-radius: 32rpx 32rpx 0 0;
  padding-bottom: 0;
  background: #ffffff;
  box-shadow: 0 -16rpx 48rpx rgba(51, 51, 51, 0.14);

  .voice-confirm {
    padding: 32rpx;
  }
}

.voice-confirm__box {
  position: relative;
  height: 256rpx; // 128px
  padding: 32rpx 28rpx;
  border-radius: 24rpx; // 12px
  background: #f6f6f6;
  box-sizing: border-box;
}

.voice-confirm__textarea {
  width: 100%;
  height: 192rpx;
  padding: 0;
  margin: 0;
  font-family: 'Inter', 'Sarasa Gothic SC', 'PingFang SC', 'Noto Sans SC', -apple-system,
    'Helvetica Neue', 'Microsoft YaHei', sans-serif;
  font-size: 28rpx; // 14px
  font-weight: 600;
  color: #333333;
  line-height: 40rpx; // 20px
  background: transparent;
}

.voice-confirm__recognizing {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  border-radius: 24rpx;
  background: rgba(246, 246, 246, 0.88);
}

.voice-confirm__spinner {
  width: 30rpx;
  height: 30rpx;
  border: 4rpx solid rgba(200, 32, 30, 0.2);
  border-top-color: #c8201e;
  border-radius: 50%;
  animation: voice-confirm-spin 0.8s linear infinite;
}

@keyframes voice-confirm-spin {
  to { transform: rotate(360deg); }
}

.voice-confirm__recognizing-text {
  color: #999999;
  font-size: 24rpx;
}

.voice-confirm__actions {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 142rpx 72rpx 74rpx;
}

.voice-confirm__actions--recognizing {
  pointer-events: none;
  opacity: 0.45;
}

.voice-action {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;

  &:active {
    opacity: 0.8;
  }
}

.voice-action--ghost {
  width: 72rpx; // 36px
  height: 72rpx;
}

.voice-action--send {
  width: 96rpx; // 48px
  height: 96rpx;
}

.voice-action--recording {
  opacity: 0.6;
}

.voice-action__icon {
  display: block;
  width: 72rpx;
  height: 72rpx;
}

.voice-action__icon--send {
  width: 100rpx;
  height: 100rpx;
  transform: translateY(-32rpx);
}

 // 整条输入栏就是那颗胶囊：加号、语音、发送都收在里面
.input-bar {
  display: flex;
  align-items: center;
  gap: 16rpx;
  min-height: 112rpx;
  margin: 0 32rpx 12rpx;
  padding: 10rpx 12rpx;
  box-sizing: border-box;
  border-radius: 56rpx;
  background: #ffffff;
  box-shadow: 0 8rpx 28rpx rgba(32, 42, 60, 0.08);
}

.input-bar__mode {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.input-bar__mode--disabled {
  opacity: 0.4;
}

.input-bar__voice-pill,
.input-bar__text-field {
  flex: 1;
  min-width: 0;
  min-height: 76rpx;
  // 背景交给外层胶囊，这里只负责排版
  background: transparent;
  box-sizing: border-box;
}

.input-bar__voice-pill {
  display: flex;
  align-items: center;
  justify-content: center;
}

.input-bar__voice-pill--disabled {
  opacity: 0.6;
  pointer-events: none;
}

.input-bar__voice-hint {
  font-size: 24rpx; // 12px
  font-weight: 400;
  color: #999999;
  line-height: 34rpx;
}

.input-bar__text-field {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 12rpx 8rpx;
  overflow: hidden;
}

.input-bar__textarea {
  width: 100%;
  min-height: 40rpx;
  max-height: 176rpx;
  overflow-y: auto;
  line-height: 40rpx;
  font-size: 28rpx; // 1p4x
  color: #1a1a1a;
  background: transparent;
  box-sizing: border-box;
}

.input-bar__placeholder {
  font-size: 24rpx;
  color: #bababa;
}

 // 胶囊内的两颗圆按钮
.input-bar__plus,
.input-bar__mode {
  width: 76rpx;
  height: 76rpx;
  flex: 0 0 76rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  box-sizing: border-box;
}

// 加号图标自带灰底圆，直接铺满按钮，不再叠 CSS 背景
.input-bar__plus {
  background: transparent;
}

// 语音/键盘是纯图标，底色由 CSS 给，留出内边距
.input-bar__mode {
  padding: 18rpx;
  background: #f1f2f4;
}

// 发送与停止本身就是实心图标，不再加底色
.input-bar__send,
.input-bar__stop {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.input-bar__send {
  width: 68rpx;
  height: 68rpx;
}

.input-bar__stop {
  width: 58rpx;
  height: 58rpx;
  margin-right: 8rpx;
}

.input-bar__plus--disabled {
  opacity: 0.35;
  pointer-events: none;
}

.input-bar__mode:active,
.input-bar__voice-pill:active,
.input-bar__plus:active,
.input-bar__send:active,
.input-bar__stop:active {
  opacity: 0.7;
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

.chat-input--keyboard-open .chat-input__dock {
  // 键盘挡住了 home indicator，这段安全区留白让给键盘
  padding-bottom: 0;
}

.chat-input__dock {
  position: relative;
  z-index: 2;
  box-sizing: border-box;
  padding-top: 16rpx;
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
}

// 透明层，只负责接住「点空白收键盘」，铺满全屏。
// 铺满是有意为之：键盘真在的时候，它盖住的那段区域触摸事件归输入法，我们收不到；
// 一旦这段区域的点击落到遮罩上，反过来证明键盘已经收了（安卓返回键收起输入法时
// 既不 blur 也无视口变化，只能靠这个反推）。
// 用 touchstart + preventDefault：走 tap 的话遮罩在 touchend 时就被移除了，
// webview 随后补发的 click 会落到下面刚归位的加号按钮上，凭空弹出附件面板。
.chat-input__keyboard-mask {
  position: fixed;
  z-index: 1;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: transparent;
}

.chat-input__footer {
  padding-top: 8rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.chat-input__footer-text {
  width: 100%;
  font-size: 24rpx; // 12px
  line-height: 30rpx;
  color: #bababa;
  text-align: center;
  margin-bottom: 12px;
}

.chat-input__home-indicator-wrap {
  width: 100%;
  padding: 0 240rpx 16rpx;
  box-sizing: border-box;
}
</style>

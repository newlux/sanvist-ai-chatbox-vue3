<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AiChatAttachments from "@/components/ai-chat-attachments/index.vue";
import { useComposerAttachments } from "@/hooks/useComposerAttachments";
import { useVoiceInput } from "@/hooks/useVoiceInput";

const props = defineProps({
  modelValue: { type: String, default: "" },
  isLoading: { type: Boolean, default: false },
  /** 键盘高度(px)。输入栏与语音面板按它整体上移，页面本身不缩放 */
  keyboardHeight: { type: Number, default: 0 },
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
]);

const { t } = useI18n();

// 键盘上沿再往上垫一点：部分机型算出来的键盘高度偏小，贴着放仍会压住底部文字
const KEYBOARD_EXTRA_GAP_PX = 20;

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

/**
 * 键盘弹起：输入栏整块切成 fixed，bottom 顶到键盘上沿，悬在消息列表之上；
 * 键盘收起：切回 relative，回到页面正常流里的原位。
 */
const keyboardLiftStyle = computed(() =>
  (keyboardOpen.value ? { bottom: `${props.keyboardHeight + KEYBOARD_EXTRA_GAP_PX}px` } : {}),
);

/**
 * 收键盘后遮罩多留一会儿：键盘落下的过程中输入栏会跟着往下移动，
 * 遮罩要是立刻消失，这一次触摸的 tap 会落到刚好移过来的加号上，凭空弹出附件面板。
 */
const maskLingering = ref(false);
let maskLingerTimer = null;
const showKeyboardMask = computed(() => keyboardOpen.value || maskLingering.value);

/** 点击面板以外的区域收起键盘：识别结果编辑态下这是唯一的退出口 */
function onDismissKeyboard() {
  uni.hideKeyboard();
  emit("input-blur");
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

function onTrySend() {
  submitMessage();
}

function onOpenAttachmentPicker() {
  if (props.isLoading) return;
  openAttachmentPicker();
}

onBeforeUnmount(() => {
  if (maskLingerTimer) clearTimeout(maskLingerTimer);
});
</script>

<template>
  <view class="chat-input" :class="{ 'chat-input--keyboard-open': keyboardOpen }">
    <!-- 键盘弹起时的空白区兜底：点一下收键盘，否则编辑识别结果时没有退出口 -->
    <view
      v-if="showKeyboardMask"
      class="chat-input__keyboard-mask"
      :style="{ bottom: keyboardOpen ? `${keyboardHeight}px` : '0' }"
      @touchstart.stop.prevent="onDismissKeyboard"
      @click.stop="onDismissKeyboard"
      @tap.stop="onMaskTap"
    />

    <!-- 语音模式：悬浮在当前对话内容上的面板 -->
    <view
      v-if="inputMode === 'voice' && voicePhase !== 'idle'"
      class="voice-sheet"
      :style="keyboardLiftStyle"
    >
      <view
        v-if="!isVoiceConfirmationOpen"
        class="voice-sheet__close"
        aria-label="关闭语音面板"
        @tap="onVoiceClose"
      >
        <text>×</text>
      </view>
      <!-- 41167:414 正在说话：波纹动画 -->
      <view
        class="voice-recording"
        :class="{ 'voice-recording--finished': isVoiceConfirmationOpen }"
      >
        <view
          v-if="!isVoiceConfirmationOpen"
          class="voice-recording__live"
        >
          <view
            class="voice-recording__header"
            :class="{ 'voice-recording__header--cancelling': voice.cancelling }"
          >
            <text class="voice-recording__listening">
              {{ voice.cancelling ? '松开取消语音' : 'Noyi正在听，请说话' }}
            </text>
            <text class="voice-recording__hint">
              {{ voice.cancelling ? '松开手指取消识别' : '说完松手  可编辑文字' }}
            </text>
          </view>
          <view v-if="voicePhase === 'recording'" class="voice-recording__wave" aria-hidden="true">
            <view v-for="bar in 25" :key="bar" class="voice-recording__wave-bar" />
          </view>
        </view>
        <view
          v-else
          class="voice-recording__stream"
          :class="{ 'voice-recording__stream--recognizing': voice.isRecognizing }"
        >
          <textarea
            ref="voiceTextareaRef"
            class="voice-recording__textarea"
            :value="voiceTextValue"
            :disabled="voice.isRecognizing"
            placeholder=""
            confirm-type="send"
            :adjust-position="false"
            :cursor-spacing="16"
            :show-confirm-bar="false"
            @input="onVoiceTextareaInput"
            @confirm="onVoiceSend"
            @focus="onTextareaFocus"
            @tap="focusVoiceTextarea"
          />
          <view v-if="voice.isRecognizing" class="voice-recognizing" aria-label="语音识别中">
            <view class="voice-recognizing__spinner" />
            <text class="voice-recognizing__text">
              语音识别中...
            </text>
          </view>
          <view v-else-if="voice.restartRecording" class="voice-recognizing" aria-label="正在录音">
            <text class="voice-recognizing__text">
              {{ voice.cancelling ? '松开取消' : '正在录音，松开识别' }}
            </text>
          </view>
        </view>
        <view
          class="voice-recording__body"
          :class="{ 'voice-recording__body--finished': isVoiceConfirmationOpen }"
        >
          <view class="voice-recording__content">
            <view
              v-if="isVoiceConfirmationOpen"
              id="voice-actions-anchor"
              class="voice-finished-actions"
              :class="{ 'voice-finished-actions--recognizing': voice.isRecognizing }"
            >
              <view
                class="voice-actions__btn voice-actions__btn--gray"
                @touchstart.stop.prevent="onVoiceClose"
                @tap="onVoiceClose"
              >
                <image
                  src="@/assets/img/icon-close-lg.svg"
                  mode="aspectFit"
                  class="voice-finished-actions__icon"
                />
              </view>
              <view
                class="voice-actions__btn-send voice-actions__btn--red"
                @touchstart.stop.prevent="onVoiceSend"
                @tap="onVoiceSend"
              >
                <image
                  src="@/assets/img/icon-send-2.svg"
                  mode="aspectFit"
                  class="voice-finished-actions__icon voice-finished-actions__icon--send"
                />
              </view>

              <view
                class="voice-actions__btn voice-actions__btn--gray"
                :class="{ 'voice-actions__btn--recording': voice.restartRecording }"
                @touchstart.stop.prevent="onVoiceRestartStart"
                @touchmove.stop.prevent="updateVoiceGesture"
                @touchend.stop.prevent="onVoiceRestartEnd"
                @touchcancel.stop.prevent="onVoiceRestartCancel"
              >
                <image
                  src="@/assets/img/icon-voice-sm.svg"
                  mode="aspectFit"
                  class="voice-finished-actions__icon"
                />
              </view>
            </view>
            <view
              v-else
              class="voice-recording__rings"
              @touchstart.stop.prevent="onVoiceTouchStart"
              @touchmove.stop.prevent="updateVoiceGesture"
              @touchend.stop.prevent="onVoiceTouchEnd"
              @touchcancel.stop.prevent="onVoiceTouchCancel"
            >
              <view v-if="voicePhase === 'recording'" class="voice-ring voice-ring--outer" />
              <view v-if="voicePhase === 'recording'" class="voice-ring voice-ring--middle" />
              <image
                mode="aspectFit"
                class="voice-ring--inner-img"
                src="@/assets/img/icon-voice-lg.svg"
              />
            </view>
          </view>
        </view>
      </view>
    </view>
    <!-- 键盘弹起时切 fixed 悬浮在消息列表之上，收起时回到正常布局 -->
    <view
      class="chat-input__dock"
      :class="{ 'chat-input__dock--floating': keyboardOpen }"
      :style="keyboardLiftStyle"
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
          :class="{ 'input-bar__plus--disabled': isLoading }"
          @tap="onOpenAttachmentPicker"
        >
          <image src="@/assets/img/icon-plus.svg" mode="aspectFit" />
        </view>

        <view
          v-if="inputMode === 'voice'"
          class="input-bar__voice-pill"
          :class="{ 'input-bar__voice-pill--disabled': isLoading }"
          @touchstart.stop.prevent="onVoicePillTouchStart"
          @touchmove.stop.prevent="updateVoiceGesture"
          @touchend.stop.prevent="onVoicePillTouchEnd"
          @touchcancel.stop.prevent="onVoicePillTouchCancel"
        >
          <text class="input-bar__voice-hint">
            {{ isLoading ? '回答生成中...' : '按住 说话' }}
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
            :cursor-spacing="16"
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
          @tap="onToggleInputMode"
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
          @tap="onTrySend"
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
  background: transparent;
  padding-top: 16rpx;
  // 底部安全区：home indicator / 手势条区域不放内容
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
  transition: padding-bottom 0.2s ease-out;
  box-sizing: border-box;
  position: relative;
  uni-image {
    width: 100%;
    height: 100%;
  }
}

.voice-sheet {
  position: fixed;
  z-index: 1300;
  right: 0;
  // 键盘弹起时由内联样式抬到键盘上沿
  bottom: 0;
  left: 0;
  transition: bottom 0.2s ease-out;
  height: min(540rpx, var(--voice-sheet-h, calc(100dvh - 412rpx)));
  min-height: 420rpx;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: 112rpx 112rpx 0 0;
  background:
    radial-gradient(ellipse 196rpx 117rpx at 0 0, rgba(123, 167, 217, 0.06) 50%, transparent 100%),
    radial-gradient(ellipse 301rpx 117rpx at 100% 0, rgba(254, 0, 0, 0.07) 0%, transparent 100%),
    linear-gradient(160deg, rgba(255, 255, 255, 0.86) 0%, rgba(255, 251, 251, 0.78) 100%);
  backdrop-filter: blur(28rpx) saturate(122%);
  -webkit-backdrop-filter: blur(28rpx) saturate(122%);
  box-shadow: 0 -12rpx 56rpx rgba(75, 85, 99, 0.16);
}

.voice-sheet__close {
  position: absolute;
  z-index: 2;
  top: 24rpx;
  right: 28rpx;
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #7d8796;
  background: transparent;
  font-size: 40rpx;
  font-weight: 300;
  line-height: 1;
}

.voice-sheet::after {
  position: absolute;
  z-index: 0;
  bottom: -104rpx;
  left: -30rpx;
  width: 810rpx;
  height: 342rpx;
  border-radius: 50%;
  background: linear-gradient(180deg, #fce5e5 0%, rgba(252, 229, 229, 0) 99.43%);
  content: '';
}

.voice-recording__body {
  flex: 0 0 auto;
  width: 100%;
}

.voice-recording__body--finished {
  position: static;
  margin: 0 0 8rpx;
}

.voice-recording__content {
  display: flex;
  justify-content: center;
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
.voice-recording__instruction {
  height: 48rpx;
  display: flex;
  justify-content: center;
  align-items: center;
}

.voice-recording__instruction-text {
  font-size: 26rpx;
  font-weight: 500;
  color: #5f6775;
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
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  padding: 0 48rpx 40rpx;
  box-sizing: border-box;
}

.voice-recording--finished {
  justify-content: space-between;
}

.voice-recording__live {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 0;
  // 上下对称 padding：安全区由外层 .voice-recording 统一消费，避免重复叠加导致居中内容偏移
  padding: 40rpx 0;
  box-sizing: border-box;
}

.voice-recording__header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
}

.voice-recording__listening {
  font-size: 30rpx;
  font-weight: 500;
  color: #2f323c;
  line-height: 34rpx;
}

.voice-recording__hint {
  font-size: 26rpx;
  color: #8d95a3;
  line-height: 30rpx;
}

.voice-recording__header--cancelling {
  .voice-recording__listening,
  .voice-recording__hint {
    color: #f12832;
  }
}

.voice-recording__transcript {
  width: 100%;
  margin: 0 0 112rpx;
  font-size: 30rpx;
  color: #2f323c;
  line-height: 46rpx;
}

.voice-recording__wave {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  width: 496rpx;
  height: 46rpx;
  margin: 48rpx 0 0;
}

.voice-recording__wave-bar {
  width: 8rpx;
  height: 12rpx;
  border-radius: 100rpx;
  background: #f12832;
  transform-origin: center;
  animation: voice-wave 0.82s ease-in-out infinite alternate;
}

.voice-recording__wave-bar:nth-child(2n) {
  height: 18rpx;
  animation-delay: 0.12s;
}

.voice-recording__wave-bar:nth-child(3n) {
  height: 28rpx;
  animation-delay: 0.24s;
}

.voice-recording__wave-bar:nth-child(4n) {
  height: 38rpx;
  animation-delay: 0.36s;
}

.voice-recording__wave-bar:nth-child(-n + 6),
.voice-recording__wave-bar:nth-child(n + 20) {
  opacity: 0.42;
}

@keyframes voice-wave {
  from { transform: scaleY(0.55); }
  to { transform: scaleY(1.12); }
}

.voice-recording__stream {
  flex: 1;
  width: 100%;
  min-height: 160rpx;
  margin: 52rpx 0 68rpx;
  padding: 38rpx 32rpx;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.78);
  box-sizing: border-box;
  overflow: hidden;
}

.voice-recording--finished .voice-recording__stream {
  position: static;
  z-index: 1;
  flex: 1 1 0;
  width: 100%;
  min-height: 160rpx;
  margin: 52rpx 0 68rpx;
  padding: 38rpx 32rpx;
  border-radius: 24rpx;
  background: #f6f6f6;
}

.voice-recording__stream--editing {
  background: rgba(244, 247, 252, 0.96);
  box-shadow: inset 0 0 0 2rpx rgba(54, 109, 255, 0.16);
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
  min-height: 120rpx;
  padding: 0;
  margin: 0;
  font-size: 26rpx;
  color: #2f323c;
  line-height: 40rpx;
  background: transparent;
  overflow: hidden;
}

.voice-recording__stream--recognizing {
  position: relative;
}

.voice-recognizing {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.72);
}

.voice-recognizing__spinner {
  width: 30rpx;
  height: 30rpx;
  border: 4rpx solid rgba(241, 40, 50, 0.2);
  border-top-color: #f12832;
  border-radius: 50%;
  animation: voice-recognizing-spin 0.8s linear infinite;
}

.voice-recognizing__text {
  color: #7d8796;
  font-size: 26rpx;
}

.voice-finished-actions--recognizing {
  pointer-events: none;
  opacity: 0.45;
}

@keyframes voice-recognizing-spin {
  to {
    transform: rotate(360deg);
  }
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
  width: 84rpx;
  height: 84rpx;
  margin: 0 auto 24rpx;
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
  width: 104rpx;
  height: 104rpx;
  background: rgba(241, 40, 50, 0.12);
  animation: voice-pulse 2.4s ease-out infinite;
}

.voice-ring--middle {
  width: 92rpx;
  height: 92rpx;
  background: rgba(241, 40, 50, 0.18);
  animation: voice-pulse 1.8s ease-out infinite;
}

.voice-ring--inner {
  width: 84rpx;
  height: 84rpx;
  background: #f12832;
  display: flex;
  justify-content: center;
  align-items: center;
}
.voice-ring--inner-img {
  width: 84rpx;
  height: 84rpx;
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

.voice-actions__btn,
.voice-actions__btn-send {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  background: transparent;

  &:active {
    opacity: 0.8;
  }
}

.voice-actions__btn {
  width: 72rpx;
  height: 72rpx;
}

.voice-actions__btn-send {
  width: 96rpx;
  height: 96rpx;
}

.voice-finished-actions--keyboard-open {
  aspect-ratio: 1;
  border-radius: 50%;
}

.voice-actions__btn-symbol {
  color: #9ca3af;
  font-size: 40rpx;
  font-weight: 300;
  line-height: 1;
}

.voice-actions__btn-arrow {
  color: #fff;
  font-size: 48rpx;
  font-weight: 600;
  line-height: 1;
  transform: translateY(-2rpx);
}

.voice-actions__btn-text {
  font-size: 24rpx;
  color: #5f6775;
}

.voice-finished-actions {
  position: relative;
  z-index: 1;
  width: 460rpx;
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin: 0 auto;
  // 安全区由外层 .voice-recording 统一消费，此处不再重复叠加
  padding: 0 0 36rpx;
}

.voice-finished-actions .voice-actions__btn {
  transform: translateY(42rpx);
}

.voice-finished-actions .voice-actions__btn-send {
  transform: none;
}

.voice-finished-actions__icon {
  display: block;
  width: 72rpx;
  height: 72rpx;
}

.voice-finished-actions .voice-actions__btn {
  transform: translateY(42rpx);
}

.voice-finished-actions__icon--send {
  width: 96rpx;
  height: 96rpx;
}

.voice-actions__btn--red .voice-actions__btn-text {
  color: #ffffff;
}

// 重录进行中：按钮给个按住反馈，面板本身保持不动
.voice-actions__btn--recording {
  opacity: 0.6;
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

// 键盘挡住了 home indicator，这段安全区留白让给键盘
.chat-input--keyboard-open {
  padding-bottom: 0;
}

.chat-input__dock {
  // 键盘收起：留在文档流里，跟着页面正常排版
  position: relative;
  // 必须高于收键盘遮罩，否则键盘弹起后点输入栏会被遮罩吃掉
  z-index: 1250;
}

// 键盘弹起：脱离文档流吸到键盘上沿（bottom 由内联样式给），盖住下方的消息列表
.chat-input__dock--floating {
  position: fixed;
  right: 0;
  left: 0;
  background: #f8f9fc;
}

// 透明层，只负责接住「点空白收键盘」，底边贴着键盘顶沿。
// 用 touchstart + preventDefault：走 tap 的话遮罩在 touchend 时就被移除了，
// webview 随后补发的 click 会落到下面刚归位的加号按钮上，凭空弹出附件面板。
.chat-input__keyboard-mask {
  position: fixed;
  z-index: 1200;
  top: 0;
  right: 0;
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

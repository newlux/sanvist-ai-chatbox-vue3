<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AiAttachmentPicker from "@/components/ai-attachment-picker/index.vue";
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
  /** 是否禁用上传附件入口。 */
  attachmentDisabled: { type: Boolean, default: false },
  /**
   * 录音监听态改用「底部小面板」样式（听播页用）：
   * 只占底部一小块，不整屏遮罩，页面主体保持可见。
   */
  compactVoiceListening: { type: Boolean, default: false },
  /**
   * 输入栏下方是否铺设计稿的底部氛围图形（326:1336 Frame 45）。
   * 只在首页问答页开启，其它复用本组件的页面保持原样。
   */
  bottomGradient: { type: Boolean, default: false },
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
watch(
  () => props.modelValue,
  (value) => {
    const next = String(value || "");
    if (next !== draft.value) draft.value = next;
  },
);

const textTextareaHeight = computed(() => {
  const maxCharsPerLine = 15;
  const lineCount = String(draft.value || "")
    .split("\n")
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / maxCharsPerLine)), 0);
  return `${Math.min(Math.max(lineCount, 1), 4) * 40}rpx`;
});

const {
  attachments,
  hasIncompleteAttachments,
  hasFailedAttachments,
  openAttachmentPicker,
  isNativePickerAvailable,
  chooseImages,
  chooseFilesFromNative,
  removeAttachment,
  retryAttachment,
  takeUploadedFiles,
  appendUploadedAttachments,
} = useComposerAttachments();

/**
 * 输入文字或添加附件后都进入可发送状态；上传未完成时点击发送会给出状态提示。
 */
const canSend = computed(() => Boolean(draft.value.trim() || attachments.value.length));
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
const showKeyboardMask = computed(
  () => keyboardOpen.value || voiceKeyboardOpen.value || maskLingering.value,
);

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
 * 必须有文字（或语音识别文本）才发送；附件仅作附带，随文字一起提交，
 * 随后立刻清空输入框与附件栏。
 */
function submitMessage(rawText?: string) {
  if (props.isLoading) return;
  const text = String(rawText ?? draft.value).trim();
  if (!text && !attachments.value.length) return;

  if (hasIncompleteAttachments.value) {
    uni.showToast({
      title: hasFailedAttachments.value
        ? t("attachment-retry-or-remove")
        : t("attachment-uploading-wait"),
      icon: "none",
    });
    return;
  }

  const { files, meta } = takeUploadedFiles();
  if (!text && !files.length) return;
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
  switchToText,
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

const textTextareaRef = ref<unknown>(null);

/**
 * 供外部调用（步骤卡拍照）：先切到文本模式，再聚焦文本输入框。
 * 走的是 textarea 自己的 focus 链路，键盘与底部间距沿用原有逻辑。
 */
async function focusTextInput() {
  switchToText();
  await nextTick();
  const el = textTextareaRef.value as { focus?: () => void } | null;
  el?.focus?.();
}

/**
 * 对外接口（页面通过 ref 调用）：
 * - appendAttachments：把「已经上传好」的附件挂进输入栏（步骤卡拍照走这条路，不重复上传）；
 * - focusTextInput：切到文本模式并聚焦输入框。
 * 注意 appendAttachments 对应 hook 里的 appendUploadedAttachments，两处名字必须一致。
 */
defineExpose({
  appendAttachments: appendUploadedAttachments,
  focusTextInput,
});

/** 附件来源弹窗：拍照 / 相册 / 文件 三选一（强制 H5 上传期间为唯一入口） */
const isAttachmentPickerOpen = ref(false);

async function onOpenAttachmentPicker() {
  if (props.attachmentDisabled || props.isLoading || voice.isRecognizing) return;
  if (attachments.value.length >= 3) {
    openAttachmentPicker(); // 触顶提示
    return;
  }

  // FORCE_H5_UPLOAD 期间 isNativePickerAvailable 恒为 false，走前端三选项弹窗：
  // 拍照/相册 → uni.chooseImage，文件 → uni.chooseFile（均走 /files/upload）
  const nativeReady = await isNativePickerAvailable();
  if (nativeReady) {
    void chooseFilesFromNative();
    return;
  }

  // 原生不可用（Web/H5 等）时用前端三选项弹窗
  isAttachmentPickerOpen.value = true;
}

function onPickAttachmentSource(source: "camera" | "album" | "file") {
  isAttachmentPickerOpen.value = false;
  if (source === "file") {
    void chooseFilesFromNative();
  } else {
    void chooseImages([source]);
  }
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
        class="voice-sheet"
        :class="compactVoiceListening ? 'voice-sheet--listening-compact' : 'voice-sheet--listening'"
      >
        <view class="voice-listening" :class="{ 'voice-listening--compact': compactVoiceListening }">
          <!-- ===== 紧凑态：底部语音面板，严格按 Ardot 11332:1（问答页语音输入中）实现，11101:512 同构 ===== -->
          <template v-if="compactVoiceListening">
            <!-- 11332:38 Rectangle 103（373×280 @ (2,532)）：#FAFAFA 渐隐遮罩，页面内容向上淡入白色 -->
            <view class="voice-panel__fade" aria-hidden="true" />

            <!-- 11332:104 Rectangle 104（375×146 @ (-0.5,676)）：顶部起尖、向两侧下滑的粉色柔光 -->
            <image
              class="voice-panel__glow"
              src="@/assets/img/voice-listening-glow.svg"
              mode="scaleToFill"
              aria-hidden="true"
            />

            <!-- 11332:91 Frame 45（375×118 @ y694）：底部柔光波浪。
                 11332:97 Rectangle 106（375×53 渐变色带）被 11332:94 Vector 87（449×100 波形，LAYER_BLUR 18）作 alpha 遮罩裁出软边。
                 静态基线即设计稿；动效为增强：色带横向无缝流动 + 波形轮廓缓慢起伏。
                 后层同轮廓、更低透明度、更慢反向流动，叠出液面层次 -->
            <view
              class="voice-panel__wave"
              :class="{ 'voice-panel__wave--paused': voice.cancelling }"
              aria-hidden="true"
            >
              <view class="voice-panel__wave-band voice-panel__wave-band--back" />
              <view class="voice-panel__wave-band" />
            </view>

            <!-- 11101:689 提示行：单节点文案，14px Inter Regular #5E5E5E，居中 -->
            <text
              class="voice-panel__tips"
              :class="{ 'voice-panel__tips--cancelling': voice.cancelling }"
            >
              松手发送  上滑取消
            </text>

            <!-- 11101:698 Frame（46×46 @ 164,698）：麦克风触达区，水平居中 -->
            <view
              class="voice-panel__mic"
              @touchstart.prevent="onVoiceTouchStart"
              @touchmove.prevent="updateVoiceGesture"
              @touchend.prevent="onVoiceTouchEnd"
              @touchcancel.prevent="onVoiceTouchCancel"
              @mousedown.prevent="onVoiceTouchStart"
              @mousemove.prevent="updateVoiceGesture"
              @mouseup.prevent="onVoiceTouchEnd"
            >
              <!-- 11101:713 Ellipse 34 + 11101:706 Mask group（40.25×40.25）：白盘 + 描边 + 投影 -->
              <view class="voice-panel__disc">
                <!-- 11101:708 Ellipse 28：盘内粉色光斑（69.88×86.35 @ 28.81,−25.47，旋转 15°，#FFD8D8 60%，blur 5） -->
                <view class="voice-panel__disc-glow voice-panel__disc-glow--pink" aria-hidden="true" />
                <!-- 11101:709 Ellipse 29：盘内蓝色光斑（54.35×67.16 @ −14.21,−27.07，旋转 15°，#E5F2FF 60%，blur 5） -->
                <view class="voice-panel__disc-glow voice-panel__disc-glow--blue" aria-hidden="true" />
                <!-- 11101:710 Vector 80：盘顶白色高光（23.34×7.78 @ 12.36,3.95，竖向渐变，blur 5） -->
                <view class="voice-panel__disc-sheen" aria-hidden="true" />
                <!-- 11101:699 Waveform Icon（27.0588×27.0588）：5 根红色声纹条，#C8201E，全圆头 -->
                <view class="voice-panel__waveform" aria-hidden="true">
                  <view v-for="i in 5" :key="`bar-${i}`" class="voice-panel__waveform-bar" />
                </view>
              </view>
            </view>
          </template>

          <!-- ===== 整屏态：其它页面沿用原样式，结构保持不动 ===== -->
          <template v-else>
            <view
              class="voice-listening__header"
              :class="{ 'voice-listening__header--cancelling': voice.cancelling }"
            >
              <text class="voice-listening__title">
                {{ voice.cancelling ? "松开取消语音" : "Sani正在听，请说话" }}
              </text>
              <text class="voice-listening__hint">
                {{ voice.cancelling ? "松开手指取消识别" : "说完松手" }}
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
              @mousedown.prevent="onVoiceTouchStart"
              @mousemove.prevent="updateVoiceGesture"
              @mouseup.prevent="onVoiceTouchEnd"
            >
              <image
                src="@/assets/img/icon-mic-red.svg"
                mode="aspectFit"
                class="voice-listening__mic-img"
              />
            </view>
          </template>
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
          <view
            v-if="voice.isRecognizing"
            class="voice-confirm__recognizing"
            aria-label="语音识别中"
          >
            <view class="voice-confirm__spinner" />
            <text class="voice-confirm__recognizing-text"> 语音识别中... </text>
          </view>
          <view
            v-else-if="voice.restartRecording"
            class="voice-confirm__recognizing"
            aria-label="正在录音"
          >
            <text class="voice-confirm__recognizing-text">
              {{ voice.cancelling ? "松开取消" : "正在录音，松开识别" }}
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
            <image
              src="@/assets/img/icon-close-lg.svg"
              mode="aspectFit"
              class="voice-action__icon"
            />
          </view>
          <!-- 发送 -->
          <view
            class="voice-action voice-action--send"
            @touchstart.stop.prevent="onVoiceSendUi"
            @tap="onVoiceSendUi"
          >
            <image
              src="@/assets/img/icon-send-2.svg"
              mode="aspectFit"
              class="voice-action__icon voice-action__icon--send"
            />
          </view>
          <!-- 重新识别 -->
          <view
            class="voice-action voice-action--ghost"
            :class="{ 'voice-action--recording': voice.restartRecording }"
            @touchstart.prevent="onVoiceRestartStartUi"
            @touchmove.prevent="updateVoiceGesture"
            @touchend.prevent="onVoiceRestartEnd"
            @touchcancel.prevent="onVoiceRestartCancel"
            @mousedown.prevent="onVoiceRestartStartUi"
            @mousemove.prevent="updateVoiceGesture"
            @mouseup.prevent="onVoiceRestartEnd"
          >
            <image
              src="@/assets/img/icon-voice-sm.svg"
              mode="aspectFit"
              class="voice-action__icon"
            />
          </view>
        </view>
      </view>
    </view>
    <!-- 底部氛围图形：设计稿 326:1336 Frame 45（375×118），压在输入栏下面 -->
    <view
      v-if="bottomGradient && !keyboardOpen && !voiceKeyboardOpen"
      class="chat-input__bottom-art"
      aria-hidden="true"
    />

    <!-- 始终 fixed 贴底；键盘弹起时用 bottom 抬到键盘上方 -->
    <view v-if="!voiceKeyboardOpen" ref="dockRef" class="chat-input__dock">
      <!-- 页面自定义的贴底区域，会一起计入输入栏高度 -->
      <slot name="dock-top" />

      <!-- 附件预览栏：选中的文件在输入栏上方排开 -->
      <AiChatAttachments
        v-if="attachments.length"
        :attachments="attachments"
        @remove="removeAttachment"
        @retry="retryAttachment"
      />

      <!--
        底部输入栏：默认语音、键盘文本、发送和生成中状态。
        文本态空闲（input-bar--plain）走灰色胶囊样式：无文字时右侧是声波（切语音），
        有文字时右侧是黑圆上箭头（发送）；生成中仍沿用的白色胶囊保持不变。
      -->
      <view
        class="input-bar"
        :class="{
          'input-bar--text': inputMode === 'text',
          'input-bar--plain': inputMode === 'text' && !isLoading && !voice.isRecognizing,
          'input-bar--voice-idle': inputMode === 'voice' && !showSendButton && !isLoading,
        }"
      >
        <!-- 左侧：附件入口 -->
        <view
          v-if="!(attachmentDisabled || isLoading || voice.isRecognizing)"
          class="input-bar__plus"
          @tap="onOpenAttachmentPicker"
        >
          <image src="@/assets/img/icon-plus.svg" mode="aspectFit" />
        </view>

        <!-- 语音态：设计稿 326:1335;85:191 语音胶囊（126×44，左键盘段 + 右白色语音段） -->
        <view
          v-if="inputMode === 'voice'"
          class="input-bar__voice-pill"
          :class="{ 'input-bar__voice-pill--status': isLoading || voice.isRecognizing }"
        >
          <template v-if="isLoading || voice.isRecognizing">
            <text class="input-bar__voice-hint">
              {{ isLoading ? "回答生成中..." : "识别中..." }}
            </text>
          </template>
          <template v-else>
            <!-- 键盘段：设计稿 48×36 / #F3F3F3，切到文字输入 -->
            <view
              v-if="!showSendButton"
              class="input-bar__voice-keyboard"
              :class="{ 'input-bar__voice-keyboard--disabled': voice.gesture.active }"
              @tap="onToggleInputModeUi"
            >
              <image src="@/assets/img/icon-keyboard-dark.svg" mode="aspectFit" />
            </view>
            <!-- 语音段：设计稿 48×36 / #FFFFFF，按住说话 -->
            <view
              class="input-bar__voice-hold"
              @touchstart.prevent="onVoicePillTouchStart"
              @touchmove.prevent="updateVoiceGesture"
              @touchend.prevent="onVoicePillTouchEnd"
              @touchcancel.prevent="onVoicePillTouchCancel"
              @mousedown.prevent="onVoicePillTouchStart"
              @mousemove.prevent="updateVoiceGesture"
              @mouseup.prevent="onVoicePillTouchEnd"
            >
              <image
                class="input-bar__voice-wave"
                src="@/assets/img/icon-voice-wave.svg"
                mode="aspectFit"
              />
            </view>
          </template>
        </view>
        <view
          v-else
          class="input-bar__text-field"
          :class="{
            'input-bar__text-field--padding':
              attachmentDisabled || isLoading || voice.isRecognizing,
          }"
        >
          <textarea
            ref="textTextareaRef"
            class="input-bar__textarea"
            :value="draft"
            :style="{ height: textTextareaHeight }"
            placeholder="请输入内容"
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

        <!-- 文本态 / 语音生成中的切换入口（空闲语音态的键盘入口已收进胶囊左侧，见设计稿 85:191） -->
        <view
          v-if="!showSendButton && (inputMode === 'text' || isLoading || voice.isRecognizing)"
          class="input-bar__mode"
          :class="{ 'input-bar__mode--disabled': voice.gesture.active || voice.isRecognizing }"
          @tap="onToggleInputModeUi"
        >
          <!-- 文本态空闲：深色声波（切到语音输入）；生成中沿用原语音图标 -->
          <image
            v-if="inputMode === 'text' && !isLoading"
            src="@/assets/img/icon-voice-wave-dark.svg"
            mode="aspectFit"
          />
          <image
            v-else-if="inputMode === 'text'"
            src="@/assets/img/icon-voice.svg"
            mode="aspectFit"
          />
          <image v-else src="@/assets/img/icon-keyboard-dark.svg" mode="aspectFit" />
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
          <!-- 文本态：黑圆上箭头；语音态保持原红色发送 -->
          <image
            v-if="inputMode === 'text'"
            src="@/assets/img/icon-send-up.svg"
            mode="aspectFit"
          />
          <image v-else src="@/assets/img/icon-send.svg" mode="aspectFit" />
        </view>
      </view>

      <!-- 输入单元下提示（Figma: 41116:6071）。跟着输入栏一起上移，键盘弹起时同样要看得见 -->
      <view class="chat-input__footer">
        <text class="chat-input__footer-text">
          内容由AI生成，请核实重要信息
        </text>
      </view>
    </view>

    <!-- 附件来源弹窗：拍照 / 从相册选择 / 选择文件；步骤卡复用同一个组件 -->
    <AiAttachmentPicker
      v-model:visible="isAttachmentPickerOpen"
      @pick="onPickAttachmentSource"
    />
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

// 底部氛围图形：设计稿 326:1336 Frame 45（375×118）
// 资源内含 40px 模糊的波浪蒙版 + rgba(239,239,238,0) → #0F7EEE 竖向渐变
.chat-input__bottom-art {
  position: absolute;
  z-index: 0;
  right: 0;
  bottom: 0;
  left: 0;
  height: 236rpx;
  background-image: url("@/assets/img/chat-bottom-wave.svg");
  background-position: center bottom;
  background-repeat: no-repeat;
  background-size: 100% 100%;
  pointer-events: none;
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

/* ==========================================================================
   底部语音面板（Ardot 11332:1 问答页语音输入中，11101:512 听播页同构，1px = 2rpx）
   面板范围：设计稿 y532 → y812，高 280px = 560rpx
   纵向排布：11332:2 提示行(17px @ y647) --24px--> 11332:71 麦克风(46px @ y688)
   装饰层 11332:38（内容渐隐遮罩）、11332:104（粉色柔光）、11332:91（波浪）绝对定位。
   ========================================================================== */
.voice-sheet--listening-compact {
  position: fixed;
  z-index: 100000;
  right: 0;
  bottom: 0;
  left: 0;
  height: 560rpx; /* 280px（y532 → y812） */
  overflow: hidden;
  border-radius: 0; /* 覆盖基类 .voice-sheet 的 64rpx 顶角圆角：贴合屏幕两边缘，无弹窗感 */
  background: transparent; /* 设计稿无面板容器：底色全透明，只叠柔性形状 */
  box-shadow: none; /* 覆盖基类上抛投影：装饰层直接落在页面上，不是浮层 */
  padding-bottom: 0; /* 覆盖基类 safe-area 内边距：波浪色带应贴到屏幕物理底边 */
  pointer-events: none; /* 容器只承担视觉层，不挡页面滚动；手势收口在麦克风触达区 */
}

/* 复合类提高优先级：基础 .voice-listening 定义在本段之后 */
.voice-listening.voice-listening--compact {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  padding-top: 230rpx; /* y647 − y532 = 115px：提示行顶 */
  box-sizing: border-box;
  flex-direction: column;
  align-items: center;
  gap: 48rpx; /* 提示行底(y664) → 麦克风顶(y688)：24px */
}

/* 11332:38 Rectangle 103：373×280 @ (2,532)，#FAFAFA 自上而下 0 → 80%(21.16%) → 100%(35.86%)，
   让页面内容在接近面板处逐渐隐入白色，消除面板顶缘的生硬分界 */
.voice-panel__fade {
  position: absolute;
  top: 0;
  left: 4rpx; /* x 2px */
  width: 746rpx; /* 373px */
  height: 560rpx; /* 280px */
  background: linear-gradient(
    180deg,
    rgb(250 250 250 / 0%) 0%,
    rgb(250 250 250 / 80%) 21.16%,
    #fafafa 35.86%
  );
  pointer-events: none;
}

/* 11332:104 Rectangle 104：375×146 @ (-0.5,676)，顶部起尖的五边形 + 竖向渐变 #FFF1F1 → #FFFFFF(63.25%) */
.voice-panel__glow {
  position: absolute;
  top: 288rpx; /* y676 − y532 = 144px */
  left: -1rpx; /* x −0.5px */
  width: 750rpx; /* 375px */
  height: 292rpx; /* 146px，下沿超出画板，由容器裁切 */
  pointer-events: none;
}

/* 11332:91 Frame 45：375×118 @ (0,694)，波浪装饰容器 */
.voice-panel__wave {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 236rpx; /* 118px */
  pointer-events: none;
}

/* 11332:97 Rectangle 106：375×53 @ (0,759)，横向渐变（#EBB4E9 → #56ABFA 48.72% → #9795E8）色带，
   用 11332:94 Vector 87 波形（内建 feGaussianBlur 9 柔边）作 alpha 遮罩裁出软边。
   动效：静态基线即设计稿三色带；为做到「横向流动不露边、不跳色」，
   把三色带做成「镜像周期」——0 → 48.72% 是设计稿色带，48.72% → 100% 是它的镜像，
   首尾同为 #EBB4E9，背景宽取两个窗口宽（1500rpx），位移一个周期即可无缝循环。
   同时让遮罩左右小幅往复（波形轮廓缓慢起伏，画布两侧各留 ~120rpx 出血，不会露边）。 */
.voice-panel__wave-band {
  position: absolute;
  top: 130rpx; /* y759 − y694 = 65px */
  left: 0;
  width: 750rpx; /* 375px */
  height: 106rpx; /* 53px */
  background: linear-gradient(
    90deg,
    #ebb4e9 0%,
    #56abfa 24.36%, /* 设计稿 #56ABFA 在色带 48.72% → 半周期 24.36% */
    #9795e8 50%, /* 设计稿色带末端 #9795E8 → 半周期端点 */
    #56abfa 75.64%, /* 后半为镜像 */
    #ebb4e9 100%
  );
  background-size: 1500rpx 100%; /* 两个窗口宽，配合镜像渐变实现无缝循环 */
  -webkit-mask-image: url("@/assets/img/voice-listening-wave-blur-mask.svg");
  mask-image: url("@/assets/img/voice-listening-wave-blur-mask.svg");
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 990rpx 286rpx; /* 遮罩画布 495×143（波形 449×100 四周留 blur 出血）@2x */
  mask-size: 990rpx 286rpx;
  -webkit-mask-position: -121rpx -14rpx; /* 画布原点对齐页面 (−60.5, 752) */
  mask-position: -121rpx -14rpx;
  animation:
    voice-wave-color-flow 9s linear infinite,
    voice-wave-sway 7.5s ease-in-out infinite alternate;
  will-change: background-position, mask-position;
}

/* 后层波浪：轮廓相同、透明度更低、流动更慢且反向，叠出液面的层次感 */
.voice-panel__wave-band--back {
  opacity: 0.4;
  transform: translateY(8rpx);
  animation:
    voice-wave-color-flow 13s linear infinite reverse,
    voice-wave-sway 9.5s ease-in-out infinite alternate;
}

/* 取消态：波浪停止流动（与声纹条暂停逻辑一致） */
.voice-panel__wave--paused .voice-panel__wave-band {
  animation-play-state: paused;
}

/* 色带横向流动：位移一个背景周期（1500rpx），首尾同色，循环无缝 */
@keyframes voice-wave-color-flow {
  from {
    background-position: 0 0;
  }
  to {
    background-position: 1500rpx 0;
  }
}

/* 波形轮廓缓慢起伏：基准 mask-position 为 (−121rpx, −14rpx)，±20rpx 摆动 */
@keyframes voice-wave-sway {
  from {
    -webkit-mask-position: -141rpx -14rpx;
    mask-position: -141rpx -14rpx;
  }
  to {
    -webkit-mask-position: -101rpx -14rpx;
    mask-position: -101rpx -14rpx;
  }
}

/* 系统偏好减少动效时，波浪回到设计稿静态基线 */
@media (prefers-reduced-motion: reduce) {
  .voice-panel__wave-band {
    animation: none;
    transform: none;
  }
}

/* 11101:689：单节点文案，14px Inter Regular #5E5E5E，文本块 120×17 居中 */
.voice-panel__tips {
  position: relative;
  font-family:
    Inter,
    "PingFang SC",
    "Noto Sans SC",
    "Microsoft YaHei",
    sans-serif;
  font-size: 28rpx; /* 14px */
  font-weight: 400;
  color: #5e5e5e;
  line-height: 34rpx; /* 文本框高 17px */
  text-align: center;
}

/* 设计稿未定义取消态配色，沿用项目品牌红做手势反馈 */
.voice-panel__tips--cancelling {
  color: #c8201e;
}

/* 11332:71 Frame：46×46 @ (164.5,688)，页面水平居中 */
.voice-panel__mic {
  position: relative;
  display: flex;
  width: 92rpx; /* 46px */
  height: 92rpx;
  align-items: center;
  justify-content: center;
  pointer-events: auto; /* 面板容器已整体关闭命中，录音手势只收口在这里 */
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}

/* 11101:713 Ellipse 34（外环投影）+ 11101:706 Mask group（40.25×40.25 圆形蒙版） */
.voice-panel__disc {
  position: relative;
  display: flex;
  width: 80.5rpx; /* 40.25px */
  height: 80.5rpx;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-sizing: border-box;
  border: 2rpx solid rgb(0 0 0 / 20%); /* 11101:707 Ellipse 35 描边 1px */
  border-radius: 50%;
  background: #ffffff; /* 11101:707 Ellipse 35 填充 */
  box-shadow: 0 2rpx 22rpx rgb(0 0 0 / 10%); /* 11101:713 (0,1) r11 #000 10% */
}

/* 盘内光斑：设计稿为裁切在圆盘内的柔光椭圆（渲染验证：圆盘外无光晕） */
.voice-panel__disc-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(5rpx); /* LAYER_BLUR 5px → SVG stdDeviation 2.5 = CSS blur 2.5px */
}

/* 11101:708 Ellipse 28：69.88×86.35 @ (28.81,-25.47)，旋转 15°，#FFD8D8 60% */
.voice-panel__disc-glow--pink {
  top: -50.94rpx;
  left: 57.62rpx;
  width: 139.76rpx;
  height: 172.7rpx;
  background: rgb(255 216 216 / 60%);
  transform: rotate(15deg);
}

/* 11101:709 Ellipse 29：54.35×67.16 @ (-14.21,-27.07)，旋转 15°，#E5F2FF 60% */
.voice-panel__disc-glow--blue {
  top: -54.14rpx;
  left: -28.42rpx;
  width: 108.7rpx;
  height: 134.32rpx;
  background: rgb(229 242 255 / 60%);
  transform: rotate(15deg);
}

/* 11101:710 Vector 80：23.34×7.78 @ (12.36,3.95)，竖向渐变白，blur 5 */
.voice-panel__disc-sheen {
  position: absolute;
  top: 7.9rpx;
  left: 24.72rpx;
  width: 46.68rpx;
  height: 15.56rpx;
  border-radius: 999rpx;
  background: linear-gradient(180deg, rgb(255 255 255 / 100%) 0%, rgb(255 255 255 / 26.29%) 100%);
  filter: blur(5rpx); /* LAYER_BLUR 5px → CSS blur 2.5px */
}

/* 11101:699 Waveform Icon：27.0588×27.0588，条宽/条距 2.7059，左右内边距 1.3529 */
.voice-panel__waveform {
  position: relative;
  display: flex;
  width: 54.12rpx;
  height: 54.12rpx;
  align-items: center;
  gap: 5.41rpx;
  padding: 0 2.71rpx;
  box-sizing: border-box;
}

.voice-panel__waveform-bar {
  width: 5.41rpx;
  border-radius: 2.71rpx; /* 圆角 1.3529px，即半宽全圆头（导出 SVG 实测 rx/ry = 1.3529） */
  background: #c8201e;
  /* 横向声波：5 根条围绕自身中心做竖向缩放，错峰延迟形成从左到右的波动 */
  transform-origin: center center;
  animation: voice-bar-wave 1.1s ease-in-out infinite;
  will-change: transform;
}

/* 取消态：停止声波动画 */
.voice-panel__tips--cancelling ~ .voice-panel__mic .voice-panel__waveform-bar {
  animation-play-state: paused;
}

/* 5 根声纹条高度（设计稿原值，同一中心线） */
.voice-panel__waveform-bar:nth-child(1) {
  height: 10.82rpx; /* 5.4118px */
  animation-delay: 0s;
}

.voice-panel__waveform-bar:nth-child(2) {
  height: 27.06rpx; /* 13.5294px */
  animation-delay: 0.14s;
}

.voice-panel__waveform-bar:nth-child(3) {
  height: 43.29rpx; /* 21.6471px */
  animation-delay: 0.28s;
}

.voice-panel__waveform-bar:nth-child(4) {
  height: 21.65rpx; /* 10.8235px */
  animation-delay: 0.42s;
}

.voice-panel__waveform-bar:nth-child(5) {
  height: 5.41rpx; /* 2.7059px */
  animation-delay: 0.56s;
}

/* 横向声波关键帧：每根条围绕中心在 0.25~1 之间竖向缩放 */
@keyframes voice-bar-wave {
  0%,
  100% {
    transform: scaleY(0.25);
  }
  50% {
    transform: scaleY(1);
  }
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
  font-family:
    "Sarasa Gothic SC",
    "PingFang SC",
    "Noto Sans SC",
    "Microsoft YaHei",
    -apple-system,
    "Helvetica Neue",
    sans-serif;
  font-size: 28rpx; // 14px
  font-weight: 600;
  color: #333333;
  line-height: 34rpx;
  text-align: center;
}

.voice-listening__hint {
  font-family:
    "Sarasa Gothic SC",
    "PingFang SC",
    "Noto Sans SC",
    "Microsoft YaHei",
    -apple-system,
    "Helvetica Neue",
    sans-serif;
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
  width: 16rpx; // 8px
  height: 16rpx;
  margin: 0 16rpx;
  border-radius: 50%;
  background: #c8201e;
  box-shadow: 0 0 14rpx rgba(200, 32, 30, 0.45);
  animation: voice-wave-center-pulse 0.72s ease-in-out infinite;
}

.voice-wave__dot {
  flex: 0 0 auto;
  width: 10rpx; // 5px
  height: 10rpx;
  border-radius: 50%;
  background: #c8201e;
  transform-origin: center;
  animation: voice-wave-breathe 0.72s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}

.voice-wave__dot:nth-child(1) {
  opacity: 1;
  animation-delay: 0s;
}
.voice-wave__dot:nth-child(2) {
  opacity: 0.86;
  animation-delay: 0.05s;
}
.voice-wave__dot:nth-child(3) {
  opacity: 0.7;
  animation-delay: 0.1s;
}
.voice-wave__dot:nth-child(4) {
  opacity: 0.52;
  animation-delay: 0.15s;
}
.voice-wave__dot:nth-child(5) {
  opacity: 0.36;
  animation-delay: 0.2s;
}
.voice-wave__dot:nth-child(6) {
  opacity: 0.24;
  animation-delay: 0.25s;
}
.voice-wave__dot:nth-child(7) {
  opacity: 0.15;
  animation-delay: 0.3s;
}
.voice-wave__dot:nth-child(8) {
  opacity: 0.08;
  animation-delay: 0.35s;
}
.voice-wave__dot:nth-child(9) {
  opacity: 0.04;
  animation-delay: 0.4s;
}

@keyframes voice-wave-breathe {
  0%,
  100% {
    transform: scaleY(0.75) scaleX(0.85);
  }
  50% {
    transform: scaleY(3) scaleX(1.15);
  }
}

@keyframes voice-wave-center-pulse {
  0%,
  100% {
    transform: scale(0.9);
  }
  50% {
    transform: scale(1.45);
  }
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
  font-family:
    "Inter",
    "Sarasa Gothic SC",
    "PingFang SC",
    "Noto Sans SC",
    -apple-system,
    "Helvetica Neue",
    "Microsoft YaHei",
    sans-serif;
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
  to {
    transform: rotate(360deg);
  }
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
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
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

// 语音态输入栏：设计稿 326:1335;85:183 Input Bar（375×64，上 8 / 下 12 / 左右 20，透明底）
.input-bar:not(.input-bar--text) {
  gap: 20rpx;
  min-height: 128rpx;
  margin: 0;
  padding: 16rpx 40rpx 24rpx;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

// 空闲语音态：加号 + 胶囊作为一组水平居中（设计稿：加号 x=99.5）
.input-bar--voice-idle {
  justify-content: center;
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

// 语音胶囊：设计稿 326:1335;85:191（126×44，r22，底 #0D0D0D 3.61%）
// 左右内边距 6 + 键盘段 48 + 间距 18 + 语音段 48 + 左右内边距 6 = 126
.input-bar__voice-pill {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 36rpx; // 18px
  height: 88rpx; // 44px
  padding: 8rpx 12rpx; // 上下 4px、左右 6px
  box-sizing: border-box;
  border-radius: 44rpx; // 22px
  background: rgba(13, 13, 13, 0.0361);
}

// 生成中 / 识别中：沿用原来的整条提示，不再套设计稿的胶囊
.input-bar__voice-pill--status {
  flex: 1;
  min-width: 0;
  justify-content: center;
  padding: 0;
  background: transparent;
}

// 键盘段：设计稿 326:1335;85:192（48×36，#F3F3F3，r18）
.input-bar__voice-keyboard {
  display: flex;
  width: 96rpx;
  height: 72rpx;
  flex: 0 0 96rpx;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 36rpx;
  background: #f3f3f3;
}

.input-bar__voice-keyboard--disabled {
  opacity: 0.45;
}

// 语音段：设计稿 326:1335;85:197（48×36，#FFFFFF，r18）
.input-bar__voice-hold {
  display: flex;
  width: 96rpx;
  height: 72rpx;
  flex: 0 0 96rpx;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 36rpx;
  background: #ffffff;
  touch-action: none; /* 桌面/触屏长按时禁用滚动/缩放，pointer 事件不被默认手势劫持 */
  -webkit-user-select: none;
  user-select: none;
}

// 段内图标：设计稿 20px 画布（声纹 18.33×16.67、键盘 18.33×15）
.chat-input .input-bar__voice-keyboard image,
.chat-input .input-bar__voice-hold image {
  width: 40rpx;
  height: 40rpx;
}

.input-bar__voice-pill .input-bar__voice-wave {
  width: 40rpx;
  height: 40rpx;
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
  padding: 12rpx 10rpx;
  overflow: hidden;
}

.input-bar__text-field--padding {
  padding-left: 20rpx;
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

// 加号：设计稿 326:1335;85:188 Frame 74 —— 40×40 点击区，图标自带 44 圆底
.input-bar__plus {
  width: 80rpx;
  height: 80rpx;
  flex: 0 0 80rpx;
  background: transparent;
}

.chat-input .input-bar__plus image {
  width: 88rpx;
  height: 88rpx;
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

.input-bar__mode:active,
.input-bar__voice-keyboard:active,
.input-bar__voice-hold:active,
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
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding-top: 16rpx;
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
}

// 输入栏下方提示（Figma: 41116:6071）：内容由AI生成，请核实重要信息
.chat-input__footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 8rpx;
}

.chat-input__footer-text {
  width: 100%;
  margin-bottom: 12px;
  color: #bababa;
  font-size: 24rpx; // 12px
  line-height: 30rpx;
  text-align: center;
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

.chat-input__home-indicator-wrap {
  width: 100%;
  padding: 0 240rpx 16rpx;
  box-sizing: border-box;
}

/* ==========================================================================
   文本态输入栏（设计稿：灰色胶囊 + 右侧切换）
   - 无文字：胶囊右侧是深色声波（切到语音）
   - 有文字：胶囊右侧是黑圆上箭头（发送）
   只在 .input-bar--plain 下生效，生成中 / 语音态维持原样。
   换算：1px = 2rpx。胶囊高 44、加号 44（与首次一致）、切换图标 20（同语音态键盘图标）、
   发送黑圆 35、左右内边距 16。
   ========================================================================== */
.input-bar.input-bar--plain {
  position: relative;
  gap: 16rpx; // 8px
  min-height: 112rpx; // 视觉 44px，外层仍留 56px 触达高度
  padding: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

/* 加号：与首次的加号同尺寸（44px 圆底由 icon-plus.svg 自带） */
.chat-input .input-bar--plain .input-bar__plus {
  width: 88rpx;
  height: 88rpx;
  flex: 0 0 88rpx;
}

.chat-input .input-bar--plain .input-bar__plus image {
  width: 88rpx;
  height: 88rpx;
}

/* 灰色胶囊本体：#F3F3F3，高 44，r22，左内边距 16，右侧给切换钮留位 */
.chat-input .input-bar--plain .input-bar__text-field {
  min-height: 88rpx;
  padding: 0 116rpx 0 32rpx;
  border-radius: 44rpx;
  background: #f3f3f3;
  box-sizing: border-box;
}

.chat-input .input-bar--plain .input-bar__textarea {
  font-size: 28rpx; // 14px，与首次输入文字一致
  line-height: 40rpx;
  color: #0d0d0d;
}

.chat-input .input-bar--plain .input-bar__placeholder {
  font-size: 28rpx;
  color: #8e8e8e;
}

/* 右侧切换钮：贴在胶囊内右侧，无底色（图标自带造型） */
.chat-input .input-bar--plain .input-bar__mode,
.chat-input .input-bar--plain .input-bar__send {
  position: absolute;
  top: 50%;
  right: 32rpx; // 16px，与胶囊右内边距对齐
  width: 70rpx; // 35px
  height: 70rpx;
  flex: 0 0 70rpx;
  margin: 0;
  padding: 0;
  background: transparent;
  transform: translateY(-50%);
}

/* 切换图标：与语音态胶囊里的键盘图标同尺寸（20px） */
.chat-input .input-bar--plain .input-bar__mode image {
  width: 40rpx; // 20px
  height: 40rpx;
}

.chat-input .input-bar--plain .input-bar__send image {
  width: 70rpx; // 35px，与按钮同大
  height: 70rpx;
}

/* 附件来源弹窗样式随组件走：src/components/ai-attachment-picker/index.vue */
</style>

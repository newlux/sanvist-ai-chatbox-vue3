<script setup lang="ts">
import type { GuideStepSelectEvent } from "@/api/chat/types";
import type { ChatMessageAttachment } from "@/stores/chat-types";
import type { AiBlock } from "@/utils/ai-stream";
import { computed, nextTick, provide, ref } from "vue";
import { useI18n } from "vue-i18n";

import iconCopy from "@/assets/img/icon-action-copy.svg";
import iconRadioOn from "@/assets/img/icon-action-radio-on.svg";
import iconArrowNext from "@/assets/img/icon-arrow-red.svg";
import iconRepair from "@/assets/img/icon-repair-dark.svg";
import saniIcon from "@/assets/img/icon-sani.png";

import { formatFileSize } from "@/hooks/useComposerAttachments";
import { toInlineImageUrl } from "@/utils/image-preview";
import AiContentBlocks from "./AiContentBlocks.vue";

defineOptions({ name: "AiBubbleV2" });

const { t } = useI18n();

const props = defineProps({
  role: { type: String, default: "ai" },
  content: { type: String, default: "" },
  blocks: { type: Array as () => AiBlock[], default: () => [] },
  loading: { type: Boolean, default: false },
  ttsEnabled: { type: Boolean, default: false },
  ttsLoading: { type: Boolean, default: false },
  ttsPlaying: { type: Boolean, default: false },
  showActions: { type: Boolean, default: false },
  waitingText: { type: String, default: "" },
  /** 用户消息随行的附件：图片直接出图，其它文件出卡片 */
  attachments: { type: Array as () => ChatMessageAttachment[], default: () => [] },
  interrupted: { type: Boolean, default: false },
  durationMs: { type: Number, default: null },
  processStatus: { type: Object, default: null },
  processSubtitle: { type: String, default: "" },
  positive: { type: Boolean, default: null },
  selected: { type: Boolean, default: false },
  suppressHighlight: { type: Boolean, default: false },
  selectMode: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  forceThinkingExpanded: { type: Boolean, default: false },
  hideSuggestion: { type: Boolean, default: false },
  // 分享海报场景：不渲染「输出结果」分组标题
  noAnswerGroup: { type: Boolean, default: false },
  /** 语音已松手、ASR 尚未返回：展示「识别中...」占位 */
  asrPending: { type: Boolean, default: false },
  /**
   * 顶部「识别中...」实时转写浮层是否可以出现。
   * 首页从初始页起飞时，要等中间图标飞进灵动岛、落位动效收尾之后再出现，
   * 否则这行文字会跟图标动效叠在一起；其它入口（对话页直接说话）默认 true。
   */
  asrTipReady: { type: Boolean, default: true },
  /** 维修助手回流的 QA 卡片标题。 */
  assistantCallbackTitle: { type: String, default: "" },
  /** 回流卡片副标题：故障诊断 / 快问快答。 */
  assistantCallbackStatus: { type: String, default: "" },
  assistantCallbackDetails: {
    type: Array as () => Array<{ label: string; value: string }>,
    default: () => [],
  },
  /** 维修助手侧会话 ID，有值时摘要卡可跳转到详情。 */
  assistantCallbackConversationId: { type: String, default: "" },
  /**
   * 深色主题（首页问答态 Ardot 1193:5104）：
   * 只换发问 / 回复的材质色，尺寸、间距、圆角、字号、动效两稿一致。
   * 默认关 —— 智能体页 / 分享海报仍走浅色稿。
   */
  dark: { type: Boolean, default: false },
});

const emit = defineEmits([
  "suggestion-tap",
  "ask-slot-open",
  "guide-step-open",
  "guide-suggestion-open",
  "tts-click",
  "share-click",
  "feedback-change",
  "copy-click",
  "select-toggle",
  "longpress-copy",
  "assistant-callback-open",
  "assistant-navigation-open",
  "guide-check-step-select",
  "gantt-open",
]);

/**
 * 回答正文由 MarkdownRenderer 走 mp-html 行内样式渲染，scoped 样式压不住，
 * 深色只能由它自己按主题换色。这里把深色标记往下传一程：
 * 未 provide 的场景（听播 / 报告 / 分享海报）自动回落浅色稿。
 */
provide("ai-bubble-dark", computed(() => props.dark));

/** 工作流结束事件的 elapsed_time 已在流层换算为毫秒；展示时统一转换为秒。 */
const durationSeconds = computed(() => {
  const milliseconds = Number(props.durationMs);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  return (milliseconds / 1000).toFixed(2).replace(/\.00$/, "");
});

async function copyText(text) {
  const value = String(text || "").trim();
  if (!value) return false;

  try {
    if (typeof uni !== "undefined" && typeof uni.setClipboardData === "function") {
      await new Promise((resolve, reject) => {
        uni.setClipboardData({
          data: value,
          success: resolve,
          fail: reject,
        });
      });
      return true;
    }
  } catch {
    // 回退到浏览器剪贴板 API
  }

  try {
    if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // 忽略
  }

  return false;
}

/** 图片加载失败时的兜底地址（按附件下标记录，避免重复请求） */
const fileImageFallback = ref<Record<number, string>>({});

/**
 * 图片附件 src：
 * - 新发送的图片带 localPath（H5/mPaaS 都是本地可渲染地址），直接展示本地文件；
 * - 历史图片用 message_files[].url 直链渲染（Dify 的 file-preview 自带签名），
 *   img 无凭证也能拿到内容，不再走 /files/{id}/preview 鉴权预览。
 * 本地地址加载失败过（兜底地址已生成）时优先用兜底，避免一直卡在灰块上。
 */
function fileImageSrc(file: ChatMessageAttachment, fileIndex: number) {
  if (fileImageFallback.value[fileIndex]) return fileImageFallback.value[fileIndex];
  if (file.localPath) return file.localPath;
  return file.previewPath || file.url || "";
}

/**
 * 点开大图。同一条消息里的图片一起进预览，可以左右翻。
 * urls 必须用可内联地址（previewPath / blob 兜底），
 * 否则原始 url 带 Content-Disposition: attachment 时，
 * 部分浏览器（Firefox/Safari）会提示下载而不是显示图片。
 */
function onPreviewImage(url) {
  const urls = props.attachments
    .map((item, index) => item?.type === "image"
      ? item.localPath || fileImageFallback.value[index] || item.previewPath || item.url
      : "")
    .filter(Boolean);
  if (!urls.length) return;
  uni.previewImage({ current: url, urls });
}

/**
 * 图片加载失败兜底：把带 attachment 头/Content-Type 异常的原始地址
 * 用 fetch + blob 换成一定能被 img 渲染的本地地址。
 * 本地缩略图（data / blob）本身挂了也要能退回远端地址，不能一直卡在灰块上。
 */
async function onFileImageError(file, fileIndex) {
  if (fileImageFallback.value[fileIndex]) return;
  const source = file.previewPath || file.url;
  if (!source || source === file.localPath) return;
  const inline = await toInlineImageUrl(source);
  if (inline !== source) {
    fileImageFallback.value = { ...fileImageFallback.value, [fileIndex]: inline };
  }
}

const USER_MENU_GAP_PX = 12;
const showUserMenu = ref(false);
const userMenuRef = ref<HTMLElement | { $el?: HTMLElement } | null>(null);
const userMenuPos = ref({ left: USER_MENU_GAP_PX, top: USER_MENU_GAP_PX });

function clampUserMenuPosition(x: number, y: number, width: number, height: number) {
  const maxLeft = Math.max(USER_MENU_GAP_PX, window.innerWidth - width - USER_MENU_GAP_PX);
  const maxTop = Math.max(USER_MENU_GAP_PX, window.innerHeight - height - USER_MENU_GAP_PX);
  userMenuPos.value = {
    left: Math.max(USER_MENU_GAP_PX, Math.min(x, maxLeft)),
    top: Math.max(USER_MENU_GAP_PX, Math.min(y, maxTop)),
  };
}

async function onUserLongpress(event: any) {
  if (props.selectMode || props.disabled) return;

  const touch = event?.changedTouches?.[0] || event?.touches?.[0] || event?.detail;
  const x = Number(touch?.clientX ?? touch?.pageX ?? USER_MENU_GAP_PX);
  const y = Number(touch?.clientY ?? touch?.pageY ?? USER_MENU_GAP_PX);
  showUserMenu.value = true;
  await nextTick();
  const menuRef = userMenuRef.value;
  const menuEl = menuRef instanceof HTMLElement ? menuRef : menuRef?.$el;
  const rect = menuEl?.getBoundingClientRect();
  clampUserMenuPosition(x, y, rect?.width || 100, rect?.height || 56);
}

function closeUserMenu() {
  showUserMenu.value = false;
}

async function onUserMenuCopy() {
  const copied = await copyText(props.content);
  if (typeof uni !== "undefined" && typeof uni.showToast === "function") {
    uni.showToast({
      title: copied ? "已复制" : "复制失败",
      icon: "none",
    });
  }
  closeUserMenu();
}

const isUser = computed(() => props.role === "user");
const visibleBlocks = computed(() =>
  props.hideSuggestion
    ? props.blocks.filter(block => block && block.type !== "suggestion")
    : props.blocks,
);
/**
 * 独立成卡的 block 类型：不套在回答气泡里。
 * - guide-check：核对/步骤卡是独立白卡；
 * - gantt：调度视图入口卡（4708:743）独立于回答框，跟在气泡下方、与气泡同宽。
 * 气泡只渲染正文/图片等，这些 block 由消息列表在气泡外单独成卡。
 */
const STANDALONE_BLOCK_TYPES = ["guide-check", "gantt"];
const contentBlocks = computed(() => {
  const blocks = visibleBlocks.value
    .filter(block => block && block.type !== "suggestion" && !STANDALONE_BLOCK_TYPES.includes(block.type));
  return blocks.length || !props.content
    ? blocks
    : [{ id: "content-fallback", type: "answer" as const, payload: { content: props.content }, complete: true }];
});
const suggestionBlocks = computed(() =>
  visibleBlocks.value.filter(block => block && block.type === "suggestion"),
);

/** 只有独立卡片、没有正文时，气泡不再画白卡外壳（操作栏仍保留），避免留一个空框 */
const isBareBody = computed(() =>
  !isUser.value
  && !contentBlocks.value.length
  && !props.content
  // 生成中的思考过程（过程状态行 / 过程副标题 / 等待条）要留在气泡卡片里，
  // 否则还没吐出正文时卡片外壳被去掉，灰色的思考文案会裸露在卡片外。
  && !((props.loading || props.interrupted)
    && (Boolean(props.processStatus) || Boolean(props.processSubtitle?.trim()) || Boolean(props.waitingText))),
);

/**
 * 多步骤卡（guide-step）的回答：整块不渲染 `.ai-bubble-v2__body`（过程状态 + 步骤卡入口 + 参考来源 + 正文全在里面），
 * 界面上只留气泡外的多步骤卡（底部白板）、步骤详情卡与底部选项。
 * 参考来源由消息列表移进步骤详情卡（见 ai-message-list 的 hidesBody），不会跟着一起消失。
 *
 * 判定不看「是否生成结束」（原来的 `!props.loading`）：多步骤卡随流式事件到达即生效，
 * 否则流式过程中正文会先冒出来、收尾时又整块消失，用户看到一段随后被撤掉的正文。
 * 白板的自动弹起不再依赖步骤卡组件挂载，改由页面盯 guide-step 块触发（见 pages/guide、pages/task）。
 */
const hasGuideStepCard = computed(() => visibleBlocks.value.some(block => block?.type === "guide-step"));
const hideBody = computed(() => !isUser.value && hasGuideStepCard.value);

/**
 * 消息里带独立卡片（核对卡 / 调度视图入口卡）时，气泡正文为空属于正常情况，
 * 不能再补「系统繁忙」兜底提示——内容在气泡外那张卡上。
 */
const hasStandaloneCard = computed(() =>
  visibleBlocks.value.some(block => block && STANDALONE_BLOCK_TYPES.includes(block.type)),
);

/**
 * 兜底提示：回答已经结束，但回复区里既没有正文、也没有任何内容块
 * （例如接口只回了过程进度，或只回了语音播报这类不落正文的场景）时，
 * 在操作栏上方补一句「系统繁忙，请稍后重试」，避免只留一个空回复区。
 * 用户主动停止的那一轮不算（那种情况显示的是「已停止」等待条）；
 * 带独立卡片（核对卡 / 调度视图入口卡）的那轮也不算。
 */
const showBusyFallback = computed(
  () => !props.loading && !props.interrupted && !hideBody.value && !hasStandaloneCard.value && isBareBody.value,
);

/**
 * 等待条：模型还没吐出内容时的占位。
 * 被中断后不撤掉，只把状态字改成「已停止」——否则没来得及出内容的那一轮
 * 会变成一个空气泡，用户看不出这轮发生了什么。
 */
const showWaiting = computed(
  () => Boolean(props.waitingText) && (props.loading || props.interrupted),
);

/**
 * 过程状态行文案随当前语言切换（英文界面下不再出现中文）：
 * 固定状态走 i18n，`status.title` 是后端下发的工作流节点名，原样保留。
 */
const processStatusText = computed(() => {
  const status = props.processStatus as { phase?: string; title?: string } | null;
  if (!status) return "";
  // 完成态不再显示「已完成」：改为品牌署名 SANI，前面由模板配 sani 图标（26×26）
  if (status.phase === "succeeded") return "SANI";
  if (status.phase === "failed") return t("process-status-failed");
  if (status.phase === "stopped") return t("process-status-stopped");
  return status.title ? `${status.title}...` : t("process-status-thinking");
});

const showProcessStatus = computed(() => !isUser.value && Boolean(processStatusText.value));
const hasProcessContent = computed(() => Boolean(contentBlocks.value.length || props.content));
const showProcessSubtitle = computed(() => showProcessStatus.value && Boolean(props.processSubtitle?.trim()));

 
/** 维修助手回流卡：轮询中显示「故障诊断中…」，回流完成后展示摘要详情。 */
const showAssistantCallbackResult = computed(
  () => Boolean(props.assistantCallbackTitle) && !props.loading && !props.interrupted,
);
/** 回流卡片副标题：故障诊断与快问快答文案不同，缺省沿用故障诊断；轮询中沿用过程状态文案。 */
const assistantCallbackStatusText = computed(() =>
  showAssistantCallbackResult.value
    ? props.assistantCallbackStatus || "诊断报告生成已完成"
    : processStatusText.value,
);

function onAssistantCallbackOpen() {
  const conversationId = props.assistantCallbackConversationId.trim();
  if (conversationId) emit("assistant-callback-open", conversationId);
}

function onSelectTap() {
  if (props.selectMode && !props.disabled) emit("select-toggle");
}

function onSuggestionTap(event) {
  emit("suggestion-tap", event);
}

function onAskSlotOpen(payload) {
  emit("ask-slot-open", payload);
}

/** 跳转确认块（维修助手）：块只在 auto_open 时抛一次，继续上抛给页面开弹框 */
function onAssistantNavigationOpen(payload) {
  emit("assistant-navigation-open", payload);
}

function onGuideStepOpen(payload, auto = false) {
  emit("guide-step-open", payload, auto);
}

function onGuideSuggestionOpen(payload, auto = false) {
  emit("guide-suggestion-open", payload, auto);
}

/** 点调度视图入口卡：继续往上抛，由页面存数据并跳横屏调度视图 */
function onGanttOpen(payload) {
  emit("gantt-open", payload);
}

/** 点核对卡步骤条某一段：继续往上抛给消息列表 / 页面 */
function onGuideCheckStepSelect(payload: GuideStepSelectEvent) {
  emit("guide-check-step-select", payload);
}

/** 语音播报：按钮已移到过程状态行（SANI 后面），这里只把点击往上抛 */
function onTtsTap() {
  if (!props.ttsEnabled) return;
  emit("tts-click");
}
</script>

<template>
  <view
    class="ai-bubble-v2"
    :class="{
      'ai-bubble-v2--selected': props.selectMode,
      'ai-bubble-v2--disabled': props.disabled,
      'ai-bubble-v2--user': isUser,
      'ai-bubble-v2--asr-pending': isUser && props.asrPending,
      'ai-bubble-v2--no-answer-group': props.noAnswerGroup,
      'ai-bubble-v2--with-suggestions': !isUser && suggestionBlocks.length,
      'ai-bubble-v2--dark': props.dark,
    }"
    @tap="onSelectTap"
  >
    <!-- 录音中的实时转写：Teleport 到 body 再 fixed 钉在头部下沿。
         留在列表里做 fixed 不行 —— scroll-view 内部有 GPU 合成层，
         fixed 会被那一层当成包含块并裁掉，表现就是「录音时顶部一个字都没有」。
         钉在视口上之后位置只由安全区 + 头部高度决定，与列表滚到哪儿无关，
         所以「停止问答 → 再次发起问答」也一定出现在顶部 -->
    <Teleport to="body">
      <view
        v-if="isUser && props.asrPending && props.asrTipReady"
        class="ai-bubble-v2-asr-tip"
        :class="{ 'ai-bubble-v2-asr-tip--dark': props.dark }"
      >
        <text class="ai-bubble-v2-asr-tip__text">
          {{ props.content }}
        </text>
        <text class="ai-bubble-v2-asr-tip__dot">
          .
        </text>
        <text class="ai-bubble-v2-asr-tip__dot">
          .
        </text>
        <text class="ai-bubble-v2-asr-tip__dot">
          .
        </text>
      </view>
    </Teleport>

    <!-- 长按用户消息弹出的跟随菜单（复制，后续可扩展删除） -->
    <Teleport to="body">
      <view v-if="showUserMenu" class="ai-bubble-v2-menu-mask" @tap="closeUserMenu" />
      <view
        v-if="showUserMenu"
        ref="userMenuRef"
        class="ai-bubble-v2-menu"
        :style="{ left: `${userMenuPos.left}px`, top: `${userMenuPos.top}px` }"
        @tap.stop
      >
        <view class="ai-bubble-v2-menu__item" @tap="onUserMenuCopy">
          <view class="ai-bubble-v2-menu__icon">
            <image :src="iconCopy" mode="aspectFit" class="ai-bubble-v2-menu__icon-img" />
          </view>
          <text class="ai-bubble-v2-menu__text">
            复制
          </text>
        </view>
      </view>
    </Teleport>
    <view v-if="props.selectMode" class="ai-bubble-v2__check">
      <image
        v-if="props.disabled"
        src="@/assets/img/icon-checkDisabled.svg"
        mode="aspectFit"
        class="ai-bubble-v2__check-img"
      />
      <image
        v-else-if="props.selected"
        src="@/assets/img/icon-checked.svg"
        mode="aspectFit"
        class="ai-bubble-v2__check-img"
      />
      <image
        v-else
        src="@/assets/img/icon-check.svg"
        mode="aspectFit"
        class="ai-bubble-v2__check-img"
      />
    </view>

    <!-- 附件独立成条，不塞进文字气泡里 -->
    <view v-if="isUser && props.attachments.length" class="ai-bubble-v2__files">
      <template v-for="(file, fileIndex) in props.attachments" :key="fileIndex">
        <image
          v-if="file.type === 'image'"
          class="ai-bubble-v2__file-image"
          mode="aspectFill"
          :src="fileImageSrc(file, fileIndex)"
          @tap.stop="onPreviewImage(fileImageSrc(file, fileIndex))"
          @error="onFileImageError(file, fileIndex)"
        />
        <view v-else class="ai-bubble-v2__file-card">
          <image
            class="ai-bubble-v2__file-icon"
            src="@/assets/img/icon-form.svg"
            mode="aspectFit"
          />
          <view class="ai-bubble-v2__file-info">
            <text class="ai-bubble-v2__file-name">
              {{ file.name || "附件" }}
            </text>
            <text v-if="formatFileSize(file.size)" class="ai-bubble-v2__file-size">
              {{ formatFileSize(file.size) }}
            </text>
          </view>
        </view>
      </template>
    </view>

    <view
      v-if="(!isUser || props.content) && !hideBody"
      class="ai-bubble-v2__body"
      :class="{
        'ai-bubble-v2__body--bare': isBareBody,
        'ai-bubble-v2__body--assistant-callback': Boolean(props.assistantCallbackTitle),
      }"
    >
      <template v-if="isUser">
        <view v-if="props.asrPending" class="ai-bubble-v2__asr" aria-label="识别中">
          <text class="ai-bubble-v2__asr-label">
            {{ props.content }}
          </text>
          <text class="ai-bubble-v2__asr-dot">
            .
          </text>
          <text class="ai-bubble-v2__asr-dot">
            .
          </text>
          <text class="ai-bubble-v2__asr-dot">
            .
          </text>
        </view>
        <text
          v-else
          class="ai-bubble-v2__user-content"
          :selectable="true"
          :user-select="true"
          @longpress="onUserLongpress"
        >
          {{ props.content }}
        </text>
      </template>

      <template v-else>
        <view
          v-if="props.assistantCallbackTitle"
          class="ai-bubble-v2__assistant-callback-card"
          :class="{ 'ai-bubble-v2__assistant-callback-card--clickable': props.assistantCallbackConversationId }"
          @tap="onAssistantCallbackOpen"
        >
          <view class="ai-bubble-v2__assistant-callback-heading">
            <image class="ai-bubble-v2__assistant-callback-icon" :src="iconRepair" mode="aspectFit" />
            <view class="ai-bubble-v2__assistant-callback-copy">
              <text class="ai-bubble-v2__assistant-callback-title">
                {{ props.assistantCallbackTitle }}
              </text>
              <text class="ai-bubble-v2__assistant-callback-status">
                {{ assistantCallbackStatusText }}
              </text>
            </view>
            <image
              v-if="props.assistantCallbackConversationId"
              class="ai-bubble-v2__assistant-callback-arrow"
              :src="iconArrowNext"
              mode="aspectFit"
            />
          </view>
          <view
            v-if="showAssistantCallbackResult && props.assistantCallbackDetails.length"
            class="ai-bubble-v2__assistant-callback-details"
          >
            <view
              v-for="(item, index) in props.assistantCallbackDetails"
              :key="`${item.label}-${index}`"
              class="ai-bubble-v2__assistant-callback-detail"
            >
              <text class="ai-bubble-v2__assistant-callback-index">
                {{ index + 1 }}
              </text>
              <text class="ai-bubble-v2__assistant-callback-label">
                {{ item.label }}
              </text>
              <text class="ai-bubble-v2__assistant-callback-value">
                {{ item.value }}
              </text>
            </view>
          </view>
        </view>
        <view
          v-if="showProcessStatus && !props.assistantCallbackTitle"
          class="ai-bubble-v2__process-status"
          :class="[
            `ai-bubble-v2__process-status--${props.processStatus?.phase}`,
            {
              'ai-bubble-v2__process-status--with-content': hasProcessContent && !showProcessSubtitle,
              'ai-bubble-v2__process-status--with-subtitle': showProcessSubtitle,
            },
          ]"
        >
          <!-- 完成态品牌署名：sani 图标 26×26（52rpx）+ 文案 SANI，替代原来的「✓ 已完成」 -->
          <image
            v-if="props.processStatus?.phase === 'succeeded'"
            class="ai-bubble-v2__process-icon-img"
            :src="saniIcon"
            mode="aspectFit"
          />
          <text class="ai-bubble-v2__process-text">
            {{ processStatusText }}
          </text>
          <!-- 语音播报按钮：从底部操作栏上移到 SANI 后面，完成态且允许操作时才可点 -->
          <view
            v-if="props.processStatus?.phase === 'succeeded' && props.showActions && props.ttsEnabled"
            class="ai-bubble-v2__action-btn ai-bubble-v2__process-tts"
            @tap.stop="onTtsTap"
          >
            <view v-if="props.ttsLoading" class="ai-bubble-v2__tts-spinner" />
            <!-- 播放中：蓝色声波条依次起伏，动画从左往右推进 -->
            <view v-else-if="props.ttsPlaying" class="ai-bubble-v2__tts-wave">
              <view
                v-for="index in 4"
                :key="index"
                class="ai-bubble-v2__tts-wave-bar"
                :class="`ai-bubble-v2__tts-wave-bar--${index}`"
              />
            </view>
            <image v-else :src="iconRadioOn" mode="aspectFit" class="ai-bubble-v2__action-icon" />
          </view>
          <!-- <text v-if="durationSeconds != null && props.processStatus?.phase === 'succeeded'" class="ai-bubble-v2__process-duration">
            {{ t("process-duration", { seconds: durationSeconds }) }}
          </text> -->
        </view>
        <view
          v-if="showProcessSubtitle && !props.assistantCallbackTitle"
          class="ai-bubble-v2__process-subtitle"
          :class="{ 'ai-bubble-v2__process-subtitle--with-content': hasProcessContent }"
        >
          <text :key="props.processSubtitle" class="ai-bubble-v2__process-subtitle-text">
            {{ props.processSubtitle }}
          </text>
        </view>
        <view
          v-if="showWaiting && !showProcessStatus && !props.assistantCallbackTitle"
          class="ai-bubble-v2__waiting"
          :class="{ 'ai-bubble-v2__waiting--stopped': props.interrupted }"
        >
          <text class="ai-bubble-v2__waiting-mark">
            ✓
          </text>
          <text class="ai-bubble-v2__waiting-label">
            {{ props.interrupted ? "已停止：" : "等待模型响应：" }}
          </text>
          <text class="ai-bubble-v2__waiting-query">
            {{ props.waitingText }}
          </text>
          <text v-if="!props.interrupted" class="ai-bubble-v2__waiting-suffix">
            努力链接中
          </text>
        </view>
        <AiContentBlocks
          v-if="!props.assistantCallbackTitle"
          :blocks="contentBlocks"
          :force-thinking-expanded="props.forceThinkingExpanded"
          :no-answer-group="props.noAnswerGroup"
          :loading="props.loading"
          @suggestion-tap="onSuggestionTap"
          @ask-slot-open="onAskSlotOpen"
          @assistant-navigation-open="onAssistantNavigationOpen"
          @guide-step-open="onGuideStepOpen"
          @guide-suggestion-open="onGuideSuggestionOpen"
          @guide-check-step-select="onGuideCheckStepSelect"
          @gantt-open="onGanttOpen"
        />
        <!-- 空回答兜底：回复区没有内容时给一句提示，位置就在操作栏上方 -->
        <view v-if="showBusyFallback && !props.assistantCallbackTitle" class="ai-bubble-v2__busy-hint">
          <text class="ai-bubble-v2__busy-hint-text">
            {{ t("ai-busy-retry-later") }}
          </text>
        </view>
        <!-- 底部操作栏（复制 / 分享 / 点赞 / 点踩）已移除：
             语音播报按钮上移到过程状态行的 SANI 后面，其余动作不再展示 -->
      </template>
    </view>
    <!-- 追问属于当前回答，但不放进回答卡片；与卡片保持独立且紧邻的视觉关系。 -->
    <view v-if="!isUser && suggestionBlocks.length" class="ai-bubble-v2__suggestions">
      <AiContentBlocks
        :blocks="suggestionBlocks"
        :force-thinking-expanded="props.forceThinkingExpanded"
        :no-answer-group="true"
        @suggestion-tap="onSuggestionTap"
      />
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* ===== 单条消息容器：设计稿 1187:1「日常运营助手-AI正在回答」里的一行 =====
   勾选框 / 附件 / 气泡之间的横向间距统一走 gap（8px），不靠 margin 撑 */
.ai-bubble-v2 {
  display: flex;
  // margin-bottom: 40rpx;
  gap: 16rpx;
}
/* 带追问时换行排：追问整行铺满，与回答卡的间距 12px */
.ai-bubble-v2--with-suggestions {
  flex-wrap: wrap;
  row-gap: 24rpx;
}
.ai-bubble-v2__suggestions {
  flex: 0 0 100%;
  min-width: 0;
  box-sizing: border-box;
}
/* 勾选态：右侧让出勾选框宽度，追问与气泡左边缘对齐（不是间距，是缩进对齐） */
.ai-bubble-v2--selected .ai-bubble-v2__suggestions {
  flex-basis: calc(100% - 48rpx);
  margin-left: 48rpx;
}

.ai-bubble-v2--selected {
  justify-content: space-between;
}
.ai-bubble-v2--user {
  flex-direction: column;
  align-items: flex-end;
  justify-content: flex-end;
}
/* ===== 录音中的实时转写：列表里只留一行占位 =====
   实时文字本身由 Teleport 到 body 的浮层渲染（见 .ai-bubble-v2-asr-tip）。
   列表里这条消息不能删：pin 定位要靠它在内容里的位置把历史顶上去；
   高度压到一行，文字再长也不会把下面的内容顶来顶去。
   只有 final 回来（asrPending=false）才收成右侧白底气泡，所以气泡外壳整层去掉 */
.ai-bubble-v2--user.ai-bubble-v2--asr-pending {
  align-items: flex-start;
}
.ai-bubble-v2--user.ai-bubble-v2--asr-pending .ai-bubble-v2__body {
  flex: 1 1 auto;
  max-width: 100%;
  height: 48rpx;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  overflow: hidden;
}
/* 文字在顶部浮层里显示，列表里的这份只负责撑高度 */
.ai-bubble-v2--user.ai-bubble-v2--asr-pending .ai-bubble-v2__asr {
  visibility: hidden;
}
.ai-bubble-v2--user.ai-bubble-v2--selected {
  flex-direction: row;
  align-items: center;
}
.ai-bubble-v2__check {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.ai-bubble-v2--user.ai-bubble-v2--selected .ai-bubble-v2__check {
  order: 1;
}
.ai-bubble-v2__check-img {
  width: 32rpx;
  height: 32rpx;
}
.ai-bubble-v2__body {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  box-sizing: border-box;
  // 气泡内所有文字都可以划词复制：表格、指标、图表降级清单里的 text 也一并放开
  -webkit-user-select: text;
  user-select: text;
}

.ai-bubble-v2__body text,
.ai-bubble-v2__body uni-text {
  -webkit-user-select: text;
  user-select: text;
}
/* ===== AI 回答卡：设计稿 1187:14 / 1187:56「AI Answer Card」=====
   底色 #F3F3F3 / 描边 1px #EFEFEF / 圆角 20px / 内边距 20px /
   纵向 gap 12px（卡片内各区域统一用 gap 排布，不再用 margin 凑）/
   阴影 0 2px 8px rgba(0,0,0,0.04)（设计稿 effects 里 visible=false，按原值写出） */
.ai-bubble-v2:not(.ai-bubble-v2--user) .ai-bubble-v2__body {
  display: flex;
  flex-direction: column;
  gap: 10rpx 24rpx;
  padding: 40rpx;
  // border: 1px solid #efefef;
  // border-radius: 40rpx;
  // background: #f3f3f3;
  // box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.04);
}
/* 没有正文只有独立卡片：不画白卡外壳，只留操作栏 */
.ai-bubble-v2:not(.ai-bubble-v2--user) .ai-bubble-v2__body--bare {
  gap: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
/* 维修助手回流卡片本身承担边框和底色，不使用通用 AI 气泡外壳。 */
.ai-bubble-v2:not(.ai-bubble-v2--user) .ai-bubble-v2__body--assistant-callback {
  gap: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
/* 维修助手回流卡（设计稿 1187:1 之外的独立态）：白卡 / 1px #EFEFEF 描边 / 20px 圆角，
   标题区与详情区之间用 gap 排（16px） */
.ai-bubble-v2__assistant-callback-card {
  display: flex;
  flex-direction: column;
  gap: 32rpx;
  box-sizing: border-box;
  width: 100%;
  padding: 36rpx;
  border: 1px solid #efefef;
  border-radius: 40rpx;
  background: #ffffff;
}
.ai-bubble-v2__assistant-callback-card--clickable {
  cursor: pointer;
}
.ai-bubble-v2__assistant-callback-heading {
  display: flex;
  gap: 16rpx;
  width: 100%;
  align-items: flex-start;
}
.ai-bubble-v2__assistant-callback-icon {
  flex: 0 0 auto;
  width: 32rpx;
  height: 32rpx;
  margin-top: 2rpx; // 与标题首行视觉对齐（对齐偏移，不是间距）
}
.ai-bubble-v2__assistant-callback-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 24rpx;
}
.ai-bubble-v2__assistant-callback-title {
  overflow: hidden;
  color: #1a1a1a;
  font-family: "PingFang SC";
  font-size: 28rpx;
  font-weight: 500;
  line-height: 34rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-bubble-v2__assistant-callback-status {
  overflow: hidden;
  color: #8f8f8f;
  font-size: 22rpx;
  line-height: 26rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-bubble-v2__assistant-callback-arrow {
  flex: 0 0 auto;
  width: 40rpx;
  height: 40rpx;
  margin-top: 28rpx; // 与标题行垂直居中（对齐偏移，不是间距）
}
.ai-bubble-v2__assistant-callback-details {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 20rpx;
}
.ai-bubble-v2__assistant-callback-detail {
  display: flex;
  gap: 24rpx;
  width: 100%;
  min-width: 0;
  align-items: flex-start;
}
.ai-bubble-v2__assistant-callback-index {
  flex: 0 0 auto;
  color: #8f8f8f;
  font-size: 24rpx;
  line-height: 30rpx;
}
.ai-bubble-v2__assistant-callback-label {
  flex: 0 0 auto;
  color: #8f8f8f;
  font-size: 24rpx;
  line-height: 30rpx;
}
/* 数值列占满剩余宽度并右对齐：靠 flex 撑开（flex:1），不用 margin 推 */
.ai-bubble-v2__assistant-callback-value {
  flex: 1;
  min-width: 0;
  color: #1a1a1e;
  font-size: 24rpx;
  line-height: 30rpx;
  text-align: right;
  word-break: break-all;
  white-space: normal;
}
/* 分享海报：逐块渲染、块间距由内容块自己控制，这里不再加卡片级 gap */
.ai-bubble-v2--no-answer-group:not(.ai-bubble-v2--user) .ai-bubble-v2__body {
  gap: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
/* ===== 用户消息气泡：设计稿 1187:82「User Message Row / User Bubble」=====
   白底 #FFFFFF / 描边 1px #EFEFEF / 圆角 24px /
   内边距 左右 18px · 上下 12px */
.ai-bubble-v2--user .ai-bubble-v2__body {
  flex: 0 1 auto;
  max-width: calc(100% - 64rpx);
  padding: 24rpx 36rpx;
  border: 1px solid #efefef;
  border-radius: 48rpx;
  background: #ffffff;
}
.ai-bubble-v2__body--highlighted {
  background: rgba(248, 49, 94, 0.06);
}
/* 用户正文：设计稿 1187:84「User Question」14px / 22px / #0D0D0D */
.ai-bubble-v2--user .ai-bubble-v2__user-content {
  color: #0d0d0d;
  font-size: 28rpx;
  line-height: 44rpx;
  white-space: pre-wrap;
  word-break: break-word;
  // 允许划词选中复制；长按仍走整条复制
  -webkit-user-select: text;
  user-select: text;
}

/* ASR 识别中占位：沿用用户正文的字号/行高，末尾三个点做呼吸动画。
   必须走行内排版：flex 会把三个点当成独立 flex item，文字一换行它们就被插到行中间 */
.ai-bubble-v2__asr {
  display: block;
  color: #0d0d0d;
  font-size: 28rpx;
  line-height: 44rpx;
  white-space: pre-wrap;
  word-break: break-word;
}
/* 录音中按「顶部提词」的字号铺字：32rpx / 48rpx，与原来的浮层提词保持一致 */
.ai-bubble-v2--asr-pending .ai-bubble-v2__asr {
  font-size: 32rpx;
  font-weight: 500;
  line-height: 48rpx;
}
.ai-bubble-v2--dark.ai-bubble-v2--asr-pending .ai-bubble-v2__asr {
  color: #f2f3f5;
}

/* ===== 录音实时转写浮层（Teleport 到 body） =====
   位置只由「安全区 + 头部高度」决定，和列表滚到哪儿、内容多长都无关：
   停止问答后再发起，文字依然落在头部下沿，不会再掉回列表末尾。
   top 的口径与页面上的 --chat-top-inset 完全一致（env(safe-area) + 300rpx），
   Teleport 出去后拿不到页面变量，所以这里直接写死同一个公式 */
.ai-bubble-v2-asr-tip {
  position: fixed;
  top: calc(constant(safe-area-inset-top) + 300rpx);
  top: calc(env(safe-area-inset-top) + 300rpx);
  right: 40rpx;
  left: 40rpx;
  z-index: 1005; // 盖过顶部毛玻璃（1）、低于头部（1010）与录音条（1001）
  padding-bottom: 12rpx;
  // 铺页面底色（下沿羽化到透明）：列表被顶上去之后这块本来就是空白；
  // 万一 pin 没到位、旧气泡还停在原处，也不会从字的缝里透出来跟文字叠在一起
  background: linear-gradient(180deg, #fafafa 0%, #fafafa 62%, rgba(250, 250, 250, 0) 100%);
  color: #0d0d0d;
  font-size: 32rpx;
  font-weight: 500;
  line-height: 48rpx;
  white-space: pre-wrap;
  word-break: break-word;
  // 只做展示：不挡下面列表与头部的点击
  pointer-events: none;
}

.ai-bubble-v2-asr-tip--dark {
  background: linear-gradient(180deg, #1a1a1a 0%, #1a1a1a 62%, rgba(26, 26, 26, 0) 100%);
  color: #f2f3f5;
}

/* 末尾三个点：与正文同字号，点与点之间留一点空，错峰呼吸 */
.ai-bubble-v2-asr-tip__dot {
  margin-left: 8rpx;
  opacity: 0.3;
  animation: asr-dot-blink 1.2s ease-in-out infinite;
}

.ai-bubble-v2-asr-tip__dot:nth-child(2) { animation-delay: 0s; }
.ai-bubble-v2-asr-tip__dot:nth-child(3) { animation-delay: 0.2s; }
.ai-bubble-v2-asr-tip__dot:nth-child(4) { animation-delay: 0.4s; }

.ai-bubble-v2__asr-dot {
  opacity: 0.25;
  animation: asr-dot-blink 1.2s ease-in-out infinite;
}

.ai-bubble-v2__asr-dot:nth-child(2) { animation-delay: 0s; }
.ai-bubble-v2__asr-dot:nth-child(3) { animation-delay: 0.2s; }
.ai-bubble-v2__asr-dot:nth-child(4) { animation-delay: 0.4s; }

@keyframes asr-dot-blink {
  0%, 20% { opacity: 0.2; }
  40% { opacity: 1; }
  100% { opacity: 0.2; }
}

/* 长按用户消息弹出的跟随菜单 */
.ai-bubble-v2-menu-mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 2000;
}
.ai-bubble-v2-menu {
  position: fixed;
  z-index: 2001;
  display: flex;
  flex-direction: column;
  min-width: 200rpx;
  padding: 12rpx 0;
  border-radius: 20rpx;
  background: #ffffff;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.12);
}
.ai-bubble-v2-menu__item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  height: 88rpx;
  padding: 0 28rpx;
}
.ai-bubble-v2-menu__item:active {
  background: #f5f5f5;
}
.ai-bubble-v2-menu__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36rpx;
  height: 36rpx;
}
.ai-bubble-v2-menu__icon-img {
  width: 36rpx;
  height: 36rpx;
}
.ai-bubble-v2-menu__text {
  font-size: 28rpx;
  color: #333333;
}
.ai-bubble-v2__ai-content {
  display: block;
  color: #2f323c;
  font-size: 28rpx;
  line-height: 42rpx;
  white-space: pre-wrap;
  word-break: break-word;
}
/* 用户附件条：设计稿 1187:82「User Message Row」上方独立成条，
   与文字气泡的上下间距由 .ai-bubble-v2--user 的 gap 统一给（此处不再用 margin-bottom） */
.ai-bubble-v2__files {
  max-width: calc(100% - 64rpx);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12rpx;
}

/* 附件图片：20px 圆角、#F1F2F4 占位底 */
.ai-bubble-v2__file-image {
  width: 320rpx;
  height: 320rpx;
  border-radius: 40rpx;
  background: #f1f2f4;
}

/* 附件卡片：白底 / 1px #EFEFEF 描边 / 20px 圆角 / 阴影 0 4px 10px rgba(0,0,0,0.04) */
.ai-bubble-v2__file-card {
  max-width: 460rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
  box-sizing: border-box;
  padding: 20rpx 24rpx;
  border: 1px solid #efefef;
  border-radius: 40rpx;
  background: #ffffff;
  box-shadow: 0 8rpx 20rpx rgba(0, 0, 0, 0.04);
}

.ai-bubble-v2__file-icon {
  width: 44rpx;
  height: 44rpx;
  flex-shrink: 0;
}

.ai-bubble-v2__file-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.ai-bubble-v2__file-name,
.ai-bubble-v2__file-size {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ai-bubble-v2__file-name {
  color: #1a1a1e;
  font-size: 28rpx;
  line-height: 40rpx;
}

.ai-bubble-v2__file-size {
  color: #8f8f8f;
  font-size: 24rpx;
  line-height: 36rpx;
}

/* 等待响应：设计稿 1187:14「✓ 已完成 0.5m」那一行的未完成形态，
   行内各段之间用 gap 排，与下方正文的间距由卡片父级 gap 统一给 */
.ai-bubble-v2__waiting {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8rpx;
  color: #a5a5a5;
  font-family: "PingFang SC";
  font-size: 26rpx;
  line-height: 36rpx;
}
.ai-bubble-v2__waiting-mark {
  color: #a5a5a5;
  font-size: 24rpx;
  line-height: 36rpx;
}
.ai-bubble-v2__waiting-label,
.ai-bubble-v2__waiting-query,
.ai-bubble-v2__waiting-suffix {
  color: #a5a5a5;
  font-weight: 400;
}
// 已停止：和「等待响应」用同一行样式，只把状态字加深一点区分出来
.ai-bubble-v2__waiting--stopped .ai-bubble-v2__waiting-mark,
.ai-bubble-v2__waiting--stopped .ai-bubble-v2__waiting-label {
  color: #7b7b7b;
}
/* ===== 过程状态行：设计稿 1187:14「✓ 已完成 0.5m」=====
   12px / 18px / #5D5D5D，图标与文字间距 4px；
   下面有正文时跟一条 1px #E8E8E8 分隔线（对应 1187:40 Divider），
   文字到线的间距 12px，线到正文的间距由卡片父级 gap 给 */
.ai-bubble-v2__process-status {
  display: flex;
  align-items: center;
  gap: 8rpx;
  min-width: 0;
  color: #5d5d5d;
  font-size: 24rpx;
  line-height: 36rpx;
}
.ai-bubble-v2__process-status--with-content {
  // padding-bottom: 24rpx;
  // border-bottom: 1px solid #e8e8e8;
}
.ai-bubble-v2__process-status--with-subtitle {
  padding-bottom: 24rpx;
  border-bottom: 1px solid #e8e8e8;
}
.ai-bubble-v2__process-subtitle {
  display: block;
  min-width: 0;
  overflow: hidden;
  color: #8f8f8f;
  font-size: 24rpx;
  line-height: 36rpx;
}
.ai-bubble-v2__process-subtitle-text {
  display: block;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  animation: ai-bubble-subtitle-enter 0.28s ease-out both;
}
@keyframes ai-bubble-subtitle-enter {
  from { opacity: 0; transform: translateY(24rpx); }
  to { opacity: 1; transform: translateY(0); }
}
/* 状态行里的「✓」：设计稿 1187:17 与文字同色，不单独着色 */
.ai-bubble-v2__process-icon {
  flex-shrink: 0;
  color: #5d5d5d;
  font-size: 24rpx;
  line-height: 36rpx;
}
/* 完成态品牌图标：26×26（52rpx），与 SANI 文字同排、垂直居中；
   图标与文字的间距沿用 status 行的 gap，不额外加 margin */
.ai-bubble-v2__process-icon-img {
  width: 52rpx; // 26px
  height: 52rpx; // 26px
  flex-shrink: 0;
}
.ai-bubble-v2__process-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-bubble-v2__process-status--thinking .ai-bubble-v2__process-text {
  background-image: linear-gradient(90deg, #8a8a8a 25%, #c9c9c9 45%, #c9c9c9 55%, #8a8a8a 75%);
  background-position: 200% 0;
  background-size: 200% 100%;
  background-repeat: repeat;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: ai-bubble-process-shimmer 2.8s linear infinite;
}
/* 右侧耗时：设计稿 1187:35「已消耗 2.5」11px / #8F8F8F，靠右对齐（flex 对齐，不靠 padding 撑） */
.ai-bubble-v2__process-duration {
  flex-shrink: 0;
  margin-left: auto;
  color: #8f8f8f;
  font-size: 22rpx;
  white-space: nowrap;
}
.ai-bubble-v2__process-status--failed { color: #d54941; }
.ai-bubble-v2__process-status--stopped { color: #999999; }
@keyframes ai-bubble-process-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
.ai-bubble-v2__duration {
  color: #bababa;
  font-size: 22rpx;
  line-height: 32rpx;
  white-space: nowrap;
}
.ai-bubble-v2__typing {
  display: flex;
  gap: 8rpx;
  align-items: center;
  padding: 6rpx 4rpx;
}
.ai-bubble-v2__dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: #bbc0c9;
  animation: typing-blink 1.2s infinite;
}
.ai-bubble-v2__dot:nth-child(2) {
  animation-delay: 0.2s;
}
.ai-bubble-v2__dot:nth-child(3) {
  animation-delay: 0.4s;
}
.ai-bubble-v2__streaming {
  padding-top: 24rpx;
}
/* 过程状态行内的语音播报按钮（原设计稿 1187:18 Actions Bar 的 TTS）。
   16×16（32rpx）见 .ai-bubble-v2__action-btn；与 SANI 文字之间留 4px，
   加上状态行本身的 gap 4px，视觉间距 8px，不用 margin 撑 */
.ai-bubble-v2__process-tts {
  padding-left: 8rpx;
}
/* ===== 空回答兜底提示 =====
   （设计稿无此状态，沿用回答正文的字号/行高规范：14px / 20px / #1A1A1E） */
.ai-bubble-v2__busy-hint {
  box-sizing: border-box;
  width: 100%;
  padding: 24rpx 32rpx;
  border-radius: 20rpx;
  background: #f9f9f9;
}
.ai-bubble-v2__busy-hint-text {
  color: #1a1a1e;
  font-size: 28rpx;
  line-height: 40rpx;
  word-break: break-word;
}

/* ===== 回答正文：设计稿 1187:14「设备运行状态正常…」/ 1187:37 参数列表 =====
   14px / 20px / #1A1A1E（正文主色 #0D0D0D 80%）；
   markdown-renderer 是全局组件，这里只在气泡作用域内对齐设计稿的字号与配色 */
.ai-bubble-v2__body :deep(p),
.ai-bubble-v2__body :deep(li) {
  color: #1a1a1e;
  font-size: 28rpx;
  line-height: 40rpx;
}
.ai-bubble-v2__action-btn {
  width: 32rpx;
  height: 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ai-bubble-v2__action-icon {
  width: 32rpx;
  height: 32rpx;
}
.ai-bubble-v2__tts-spinner {
  width: 24rpx;
  height: 24rpx;
  box-sizing: border-box;
  border: 3rpx solid rgba(136, 136, 136, 0.22);
  border-top-color: #888888;
  border-radius: 50%;
  animation: ai-bubble-tts-spin 0.8s linear infinite;
}
/* 播放中的语音图标：蓝色声波，四根条错峰起伏，视觉上从左往右推进 */
.ai-bubble-v2__tts-wave {
  display: flex;
  width: 32rpx;
  height: 32rpx;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
}
.ai-bubble-v2__tts-wave-bar {
  width: 4rpx;
  height: 24rpx;
  border-radius: 4rpx;
  background: #1a6dff;
  transform-origin: center center;
  animation: ai-bubble-tts-wave 0.9s ease-in-out infinite;
}
.ai-bubble-v2__tts-wave-bar--1 {
  animation-delay: 0s;
}
.ai-bubble-v2__tts-wave-bar--2 {
  animation-delay: 0.12s;
}
.ai-bubble-v2__tts-wave-bar--3 {
  animation-delay: 0.24s;
}
.ai-bubble-v2__tts-wave-bar--4 {
  animation-delay: 0.36s;
}

@keyframes ai-bubble-tts-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 声波条：只有高度在起伏，宽度不变；错峰延迟让它看起来像从左往右推过去 */
@keyframes ai-bubble-tts-wave {
  0%,
  100% {
    transform: scaleY(0.35);
    opacity: 0.6;
  }

  50% {
    transform: scaleY(1);
    opacity: 1;
  }
}

@keyframes typing-blink {
  0%,
  80%,
  100% {
    opacity: 0.2;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}

/* ===== 深色主题：发问 / 回复（Ardot 1193:5104「日常运营助手-语音输入中」） =====
   1px = 2rpx。两稿的尺寸 / 间距 / 圆角 / 字号完全一致，这里只替换材质与文字颜色：
   - 发问 1193:5110 / 5111 User Bubble：底 #1A1A1A、描边 1px #303030、圆角 24、
     内边距 12·18；正文 1193:5112：14 / 22 / #FFFFFF
   - 回复 1193:5116 AI Answer Card：底 #212121、描边 1px #303030、圆角 20、
     内边距 20、纵向 gap 12、阴影 0 2px 8px rgba(0,0,0,0.04)
   - 卡片内：步骤态 1193:5141、分区标签 1193:5118 = #5D5D5D；
     正文 1193:5140 = 14 / 24 / #FFFFFF 80%；
     分隔线 1193:5139 / 5117 = 1px #303030；
     操作栏图标 1193:5120 = #8F8F8F 线框 */
.ai-bubble-v2--dark {
  // ---- 发问：气泡 1193:5111 ----
  &.ai-bubble-v2--user .ai-bubble-v2__body {
    border-color: #303030;
    background: #1a1a1a;
  }

  &.ai-bubble-v2--user .ai-bubble-v2__user-content,
  &.ai-bubble-v2--user .ai-bubble-v2__asr {
    color: #ffffff;
  }

  // 分享选中的高亮：深底上 6% 红几乎看不见，抬到 16%（设计稿无选中态，按同一红加不透明度）
  .ai-bubble-v2__body--highlighted {
    background: rgba(254, 0, 0, 0.16);
  }

  // ---- 回复：卡片 1193:5116 ----
  &:not(.ai-bubble-v2--user) .ai-bubble-v2__body {
    border-color: #303030;
    background: #212121;
    box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.04); // 0 2px 8px rgba(0,0,0,.04)
  }

  // 无正文 / 回流卡 / 分享海报：本来就不画卡片外壳，深色下同样保持透明
  &.ai-bubble-v2--no-answer-group:not(.ai-bubble-v2--user) .ai-bubble-v2__body,
  .ai-bubble-v2__body--bare,
  .ai-bubble-v2__body--assistant-callback {
    border-color: transparent;
    background: transparent;
    box-shadow: none;
  }

  // 步骤态 / 分区标签：#5D5D5D（与设计稿同值，显式写一遍，避免被深底吃掉）
  .ai-bubble-v2__process-status,
  .ai-bubble-v2__process-icon {
    color: #5d5d5d;
  }

  // 语音播报图标 1193:5120：全部 #8F8F8F 线框。
  // 图标是自带颜色的 svg，先压成纯黑再反相到 #8F8F8F；点赞 / 点踩选中的那两颗保留品牌色
  .ai-bubble-v2__action-btn:not(.ai-bubble-v2__action-btn--liked):not(.ai-bubble-v2__action-btn--disliked) .ai-bubble-v2__action-icon {
    filter: brightness(0) invert(0.56); // 0.56 × 255 ≈ #8F8F8F
  }

  // ---- 发问侧附件（设计稿无此态）：白卡换成回复卡同一材质 ----
  &.ai-bubble-v2--user .ai-bubble-v2__file-card {
    border-color: #303030;
    background: #212121;
    box-shadow: none;
  }

  .ai-bubble-v2__file-name {
    color: #ffffff;
  }

  .ai-bubble-v2__file-image {
    background: #303030;
  }

  // 空回答兜底（设计稿无此态）：底压到 #1A1A1A，文字跟随正文
  .ai-bubble-v2__busy-hint {
    background: #1a1a1a;
  }

  .ai-bubble-v2__busy-hint-text {
    color: rgba(255, 255, 255, 0.8);
  }
}
</style>

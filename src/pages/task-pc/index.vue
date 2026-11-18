<script setup lang="ts">
import type { AskSlotOption, AskSlotPayload } from '@/api/chat/types';
import type { ChatScene } from '@/utils/session-scene';

import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';

import AiBlockRenderer from '@/components/ai-bubble-v2/AiBlockRenderer.vue';

import heySaniUrl from '@/assets/img/hey-sani.svg';
import taskPcIconCancel from '@/assets/img/task-pc-icon-cancel.svg';
import taskPcIconCheck from '@/assets/img/task-pc-icon-check.svg';
import taskPcIconEdit from '@/assets/img/task-pc-icon-edit.svg';
import taskPcIconPause from '@/assets/img/task-pc-icon-pause.svg';
import taskPcIconSpeaker from '@/assets/img/task-pc-icon-speaker.svg';
import logoUrl from '@/assets/img/task-pc-logo.webp';
import { useChatSend } from '@/hooks/useChatSend';
import { useRealtimeTts } from '@/hooks/useRealtimeTts';
import { useVoiceQuery } from '@/hooks/useVoiceQuery';
import { provideChatScope, useChatStore } from '@/stores';
import { stripOptionPrefix } from '@/utils/option-label';

/**
 * 车载端（大屏）任务协同页（Ardot file 743688427371853 / 车载端页面）。
 *
 * 设计口径：画布 1920×1080，本页所有尺寸直接按设计稿 px 落地（不走 rpx）——
 * 目标设备就是 1920×1080 的车机屏，等比换算反而会把 32px 的字换算回移动端尺度。
 * 底部车机 Dock 不在本页范围内（由宿主桌面绘制），只做内容区。
 *
 * 交互（与需求对齐）：
 * 1. 进页面先停在海报态：中间品牌区（hey, SANI → logo → 随时为你而来 → 描述）、底部蓝色光晕；
 *    海报态顶部**不出现**胶囊，也**不自动收音**——只有点中间的 logo 才开始这一轮；
 * 2. 底部光晕只在「收音中」和「播报中」亮（见 glowOn）：点 logo 开始收音亮起、进入呼吸动画，
 *    收音结束后的思考阶段熄灭，回答开始播报时再亮，播报结束熄灭；
 * 3. 点右下角 logo 可再次收音；进入对话后顶部胶囊（logo + 我在，你说）才出现，
 *    本轮还在跑时文案切换为「正在思考」/「正在回答」（见 capsuleText）；
 * 4. 本轮思考中，提问左侧是「暂停」圆钮（设计稿 78 圆 / #262438）；答完或被暂停后
 *    同一个位置换成「编辑」，点开提问变成输入框 + 右侧「确认 / 取消」：
 *    确认把输入框里的文案当作**新提问**追加发送（原提问与回答保持不动），
 *    取消还原原文、不发送；
 * 5. 识别到文本即走与任务协同页同一套发送链路，AI 结果按设计稿的深色卡片展示；
 * 6. 调度视图卡（gantt）在本页不展示（见 contentBlocks 的过滤）。
 */
defineOptions({ name: 'TaskPcPage' });

const chatScope = provideChatScope('task-pc');
/** 块组件（图表 / 指标 / 参考来源 / 推荐问题 …）复用 task 页那一套，卡片是深色底，走深色稿 */
provide('ai-bubble-dark', computed(() => true));
const chatStore = useChatStore(chatScope);
const realtimeTts = useRealtimeTts(chatScope);

/**
 * 与任务协同页同一套场景标识（见 pages/task）：
 * `VITE_TASK_SCENE` 改走沙箱分支时，`VITE_TASK_SANDBOX_CODE` 必须一起下发，
 * 否则同一套链路在两端拿到的是不同场景，会话对不上。
 */
const TASK_SCENE: ChatScene = (String(import.meta.env.VITE_TASK_SCENE || '').trim() || 'TASK') as ChatScene;
const TASK_SANDBOX_CODE = String(import.meta.env.VITE_TASK_SANDBOX_CODE || '').trim();

const liveText = ref('');
const listReady = ref(false);

const { sendMessage, stopGenerating, sendAskSlotSelection } = useChatSend(chatScope, {
  scene: TASK_SCENE,
  // 任务协同不区分新老手，不做「新手隐藏老师傅导语」的过滤（与 pages/task 同口径）
  hideNoviceVoice: false,
  // 沙箱代码与任务协同页一致：只在配了环境变量时下发
  getExtraInputs: () => (TASK_SANDBOX_CODE ? { code: TASK_SANDBOX_CODE } : {}),
  // 显式下发的 voice 播报稿按流式增量进入队列
  onAiAnswerDelta({ aiMsgId, delta, ended }) {
    const message = chatStore.messages.find(item => item.id === aiMsgId);
    if (!message) return;
    realtimeTts.feedAnswerDelta(message, delta, ended);
  },
});

const { voiceQueryActive, voiceLevel, startVoiceQuery, stopVoiceQuery, cancelVoiceQuery } = useVoiceQuery({
  // 不插「识别中」占位气泡：收音态由右下角 logo + 光晕表达，实时字幕走 liveText
  beginPlaceholder: () => '__task-pc-voice__',
  patchPlaceholder: (_id, text) => {
    liveText.value = text;
  },
  pinPlaceholder: () => {},
  discardPlaceholder: () => {
    liveText.value = '';
  },
  submit: (text) => {
    liveText.value = '';
    void sendMessage({ text });
  },
  // 开口前先掐掉正在播的回答，避免外放被麦克风收进去
  onStart: () => {
    realtimeTts.stop();
  },
});

/** 有没有对话内容 */
const hasMessages = computed(() => chatStore.messages.length > 0);

/**
 * 是否已经进入对话页：点欢迎帧的 logo 立刻切过去，不等第一条消息落地。
 * 收音字幕要落在对话流里（下一条消息的位置），所以必须先让列表渲染出来。
 */
const chatOpen = ref(false);
const inChat = computed(() => chatOpen.value || hasMessages.value);

/** 胶囊只在对话态出现：海报态顶部不放浮层；对话态收音中也留着，用来显示「正在收听」 */
const showCapsule = computed(() => inChat.value);
/** 右下角 logo：收音中 / 对话态常驻，是再次收音的入口 */
const showDockLogo = computed(() => voiceQueryActive.value || inChat.value);

/** 光晕强度跟着麦克风音量走，静静地呼吸 */
const glowStyle = computed(() => ({
  '--task-pc-glow-level': String(0.35 + Math.min(voiceLevel.value, 1) * 0.65),
}));

/** 正在播报回答（自动播报 / 点喇叭手动播报都算） */
const ttsSpeaking = computed(() => realtimeTts.playing.value);

/**
 * 光晕的亮灭时序（需求口径）：
 * 点 logo 开始收音 → 亮；收音结束、思考中 → 灭；回答出现开始播报 → 再亮；播报结束 → 灭。
 * 欢迎帧（还没进入对话）保留设计稿里那层常驻的底部光晕，不受这条规则影响。
 */
const glowOn = computed(() => !inChat.value || voiceQueryActive.value || ttsSpeaking.value);

/* ------------------------------ 消息渲染 ------------------------------ */

type MessageRow = (typeof chatStore.messages)[number];

/**
 * 本页手写渲染的块：设计稿在这几类上定制过样式（大字号正文 / 表格 / 图片 / 选项胶囊 / 过程提示）。
 * 其余要素（图表 / 指标 / 参考来源 / 推荐问题 / 视频 / 思考过程 / 错误提示）直接复用 task 页的块组件，
 * 见 extraBlocks。
 */
const CUSTOM_BLOCK_TYPES = new Set(['answer', 'tips', 'table', 'image', 'ask-slot']);

/**
 * 车机屏不展示的块：
 * - voice：只是这一轮的播报稿，不进回答流程（播报链照旧读它）；
 * - gantt：调度视图卡按需求不展示；
 * - report-card / assistant-navigation：跳转类入口卡，车机端点了要开 WebView / 播报页，暂不接管；
 * - guide-*：作业指导专属的步骤卡，任务协同不下发，避免误渲染出带按钮的空卡。
 */
const HIDDEN_BLOCK_TYPES = new Set([
  'voice',
  'gantt',
  'report-card',
  'assistant-navigation',
  'guide-step',
  'guide-lead',
  'guide-suggestion',
  'guide-check',
]);

function contentBlocks(message: MessageRow) {
  return (message.blocks || []).filter(block => !HIDDEN_BLOCK_TYPES.has(block.type));
}

/** 交给通用块组件渲染的那部分（与 task 页同一套 AiBlockRenderer） */
function extraBlocks(message: MessageRow) {
  return (message.blocks || []).filter(
    block => !CUSTOM_BLOCK_TYPES.has(block.type) && !HIDDEN_BLOCK_TYPES.has(block.type),
  );
}

/** 追问卡（选项胶囊）在车机屏上的展示数据 */
interface AskSlotView {
  payload: AskSlotPayload;
  title: string;
  description: string;
  options: AskSlotOption[];
  key: string;
}

/**
 * 把 ask-slot 块归一成可渲染的选项组：
 * - 多步骤表单（带 slots / input_type=text）在车机屏上不做，只处理「选择题」；
 * - 没有选项的卡片（纯文本题）也不渲染；
 * - 结果按消息缓存，模板里多处取同一份，避免每次重算。
 */
const askSlotCache = new WeakMap<object, AskSlotView | null>();

function askSlotView(message: MessageRow): AskSlotView | null {
  if (askSlotCache.has(message))
    return askSlotCache.get(message) || null;
  const block = (message.blocks || []).find(item => item.type === 'ask-slot');
  const payload = block?.payload as AskSlotPayload | undefined;
  let view: AskSlotView | null = null;
  if (payload) {
    // 文案先剥掉后端可能自带的「A |」序号：序号由左侧字母统一画，否则会显示成「A ｜ A | 全部任务」
    const options = (payload.options || [])
      .filter(option => option && String(option.label || '').trim())
      .map(option => ({ ...option, label: stripOptionPrefix(String(option.label || '')) }));
    const isForm = Array.isArray(payload.slots) && payload.slots.length > 0;
    const isText = Boolean(payload.input_type) && payload.input_type !== 'choice';
    if (options.length && !isForm && !isText) {
      view = {
        payload,
        title: String(payload.title || payload.original_query || '').trim(),
        description: String(payload.description || '').trim(),
        options,
        key: String(message.id || ''),
      };
    }
  }
  askSlotCache.set(message, view);
  return view;
}

/** 已经作答过的追问卡：同一张卡只发一次，避免连点重复提问 */
const answeredSlots = ref<string[]>([]);

function isSlotAnswered(key: string) {
  return answeredSlots.value.includes(key);
}

/** 选项序号：A / B / C…（与身份选择那组胶囊同一套写法） */
function slotOptionLetter(index: number) {
  return String.fromCharCode(65 + index);
}

/**
 * 点选项：单选 / 多选都是「点哪项就发哪项」，与任务协同页（pages/task 的 onAskSlotPick）同一套口径。
 */
function onSlotOptionTap(message: MessageRow, option: AskSlotOption) {
  const view = askSlotView(message);
  if (!view || isSlotAnswered(view.key))
    return;
  answeredSlots.value = [...answeredSlots.value, view.key];
  sendAskSlotSelection({ slot: view.payload, selectedOptions: [option] });
}

/** 正在跑的这一轮 AI 消息：顶栏状态文案跟着它走（结束 / 被停止时自动回落） */
const streamingMessage = computed<MessageRow | null>(() => {
  const list = chatStore.messages;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (message.role === 'ai' && message.loading) return message;
  }
  return null;
});

/**
 * 顶栏胶囊的文案，按优先级：
 * 收音中「正在收听」→ 本轮还在跑「正在思考」/「正在回答」→ 空闲「我在，你说」。
 */
const capsuleText = computed(() => {
  if (voiceQueryActive.value) return '正在收听';
  const streaming = streamingMessage.value;
  if (!streaming) return '我在，你说';
  const hasAnswer = (streaming.blocks || []).some(block => block.type === 'answer' && String(block.payload?.content || '').trim());
  return hasAnswer ? '正在回答' : '正在思考';
});

/* ------------------------------ 提问行操作（暂停 / 编辑） ------------------------------ */

/** 正在编辑的提问 id：为空表示没有在编辑 */
const editingId = ref('');
const editingText = ref('');

/** 最后一条提问：只有它能「暂停 / 编辑」——历史提问不再挂操作钮 */
const lastUserId = computed(() => {
  const list = chatStore.messages;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index].role === 'user') return String(list[index].id || '');
  }
  return '';
});

/** 这一轮跑着的提问 id（AI 回包还在流）：它左侧的按钮是「暂停」，其余状态都是「编辑」 */
const streamingUserId = computed(() => {
  const streaming = streamingMessage.value;
  if (!streaming) return '';
  const list = chatStore.messages;
  const index = list.findIndex(item => item.id === streaming.id);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (list[cursor].role === 'user') return String(list[cursor].id || '');
  }
  return '';
});

/** 这条提问要不要挂操作钮：只给最后一条，且当前没在编辑 */
function showRowAction(message: MessageRow) {
  const id = String(message.id || '');
  return Boolean(id) && id === lastUserId.value && id !== editingId.value;
}

/** 暂停态：这一轮还在思考 / 输出 */
function isPausing(message: MessageRow) {
  return String(message.id || '') === streamingUserId.value;
}

function onRowAction(message: MessageRow) {
  if (isPausing(message)) {
    // 暂停这一轮：流停掉，正在念的回答也一起收掉
    realtimeTts.stop();
    stopGenerating();
    return;
  }
  editingId.value = String(message.id || '');
  editingText.value = message.content;
}

/**
 * 确认编辑：编辑框里的文案按**新提问**发出去。
 * 原先那条提问和它的回答原样留在列表里（不就地改写历史记录），
 * 新问题照常追加在最后、走同一套发送链路。
 */
function confirmEdit() {
  const id = editingId.value;
  if (!id) return;
  const text = editingText.value.trim();
  editingId.value = '';
  editingText.value = '';
  if (!text) return;
  void sendMessage({ text });
}

/** 取消编辑：输入框丢掉，提问原文原样留着，不发 */
function cancelEdit() {
  editingId.value = '';
  editingText.value = '';
}

/**
 * 协议标签源码（成对或未闭合）一律不显示。
 * 正常解析不会留下这些源码，这里是车机屏的兜底：历史里已有的脏数据（后端偶尔不发
 * `</COMPONENT>`）不得以 `<COMPONENT>{"scene":"guide",…}` 的形式出现在回答里。
 */
const PROTOCOL_SOURCE = /<(SANVIST|ASK|GUIDE|COMPONENT|TIPS)>[\s\S]*?(?:<\/\1>|$)/gi;

function stripProtocolSource(text: string) {
  return text.replace(PROTOCOL_SOURCE, '').trim();
}

/**
 * voice 块的文本只用来播报：后端常把同一句播报稿也写进 answer 开头（「本轮的具体情况已经整理好。」
 * 这类导语），task 页由 AiContentBlocks 的 stripVoiceFromAnswers 剔掉，本页自己拼正文，
 * 不补这一步就会在回答最上面多出一行播报稿。
 */
function stripVoiceEcho(text: string, voices: string[]) {
  if (!text || !voices.length)
    return text;
  let result = text;
  voices.forEach((voiceText) => {
    const index = result.indexOf(voiceText);
    if (index >= 0)
      result = result.slice(0, index) + result.slice(index + voiceText.length);
  });
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

/** voice 块里的播报稿文本（voice 块本身不渲染，只用来播报 + 从正文里剔重） */
function voiceTexts(message: MessageRow) {
  return (message.blocks || [])
    .filter(block => block.type === 'voice')
    .map(block => String(block.payload?.text || '').trim())
    .filter(Boolean);
}

function answerText(message: MessageRow) {
  const text = stripProtocolSource(contentBlocks(message)
    .filter(block => block.type === 'answer')
    .map(block => String(block.payload?.content || ''))
    .join('\n'));
  return stripVoiceEcho(text, voiceTexts(message));
}

function tableBlock(message: MessageRow) {
  return contentBlocks(message).find(block => block.type === 'table') || null;
}

function tableColumns(message: MessageRow) {
  const columns = tableBlock(message)?.payload?.columns;
  return Array.isArray(columns) ? columns.map(column => String(column)) : [];
}

function tableRows(message: MessageRow) {
  const rows = tableBlock(message)?.payload?.rows;
  return Array.isArray(rows) ? rows.map(row => (Array.isArray(row) ? row.map(cell => String(cell ?? '')) : [])) : [];
}

function imageUrl(message: MessageRow) {
  const items = contentBlocks(message).find(block => block.type === 'image')?.payload?.items;
  if (!Array.isArray(items) || !items.length) return '';
  const first = items[0] as Record<string, unknown> | undefined;
  return String(first?.url || '');
}

/** 耗时：与设计稿一致保留一位小数 */
function durationText(message: MessageRow) {
  const ms = Number(message.durationMs || 0);
  if (!ms) return '';
  return `耗时${(ms / 1000).toFixed(2)}秒`;
}

/**
 * 过程提示（tips 块）：先显示，正文一出现就退场。
 *
 * 解析层本来就会在有最终回复时把 tips 块整块删掉（chatStreamParser 的 applyEventToBlocks /
 * message_end），这里再按「正文是否已有内容」判一次：块还没被删的那一拍也不会和正文同时出现。
 */
function tipTexts(message: MessageRow) {
  const blocks = message.blocks || [];
  const hasAnswer = blocks.some(block => block.type === 'answer' && String(block.payload?.content || '').trim());
  if (hasAnswer)
    return [];
  return blocks
    .filter(block => block.type === 'tips')
    .map(block => String(block.payload?.content || '').trim())
    .filter(Boolean);
}

/** 推荐问题胶囊（suggestion 块）：点一条就当作一次新提问发出去，与 task 页同口径 */
function onSuggestionTap(text: string) {
  const question = String(text || '').trim();
  if (!question || chatStore.isLoading)
    return;
  void sendMessage({ text: question });
}

function messageDomId(id: string) {
  return `task-pc-msg-${id}`;
}

/* ------------------------------ 播报 ------------------------------ */

/** 这一轮能不能手动播报：有正文、且这一轮已经答完（流式中还没有 messageId / sessionId，播报接口用不了） */
function canSpeak(message: MessageRow) {
  return !message.loading && Boolean(message.messageId) && Boolean(answerText(message));
}

/** 点喇叭：念这段回答；再点一次停（同一套音色 / 口播稿由 useRealtimeTts 内部处理） */
function onSpeakerTap(message: MessageRow) {
  void realtimeTts.togglePlay(message);
}

/* ------------------------------ 滚动 ------------------------------ */

/** uni 的 scroll-into-view 只在值变化时生效：两个锚点交替用 */
const scrollAnchor = ref('task-pc-anchor-a');

function scrollToBottom() {
  nextTick(() => {
    scrollAnchor.value = scrollAnchor.value === 'task-pc-anchor-a' ? 'task-pc-anchor-b' : 'task-pc-anchor-a';
  });
}

watch(
  () => [
    chatStore.messages.length,
    chatStore.messages[chatStore.messages.length - 1]?.blocks?.length,
    chatStore.messages[chatStore.messages.length - 1]?.loading,
  ],
  () => {
    if (inChat.value) scrollToBottom();
  },
);

// 识别文字是往一条「输入框」里增长的：跟着滚到底，否则说着说着就被顶出可视区
watch([liveText, voiceQueryActive], () => {
  if (inChat.value) scrollToBottom();
});

/* ------------------------------ 收音 ------------------------------ */

function toggleVoice() {
  if (voiceQueryActive.value) {
    stopVoiceQuery();
    return;
  }
  startVoiceQuery();
}

/**
 * 欢迎帧 logo：先切到对话页，再开始收音。
 * 识别文字要落在对话流里（下一条消息的位置），所以等列表渲染出来再开麦；
 * 收音中已经在响了就别重开，免得把这一轮掐掉。
 */
function startListening() {
  chatOpen.value = true;
  if (voiceQueryActive.value) return;
  nextTick(() => startVoiceQuery());
}

onMounted(() => {
  listReady.value = true;
});

onBeforeUnmount(() => {
  cancelVoiceQuery();
  realtimeTts.stop();
});
</script>

<template>
  <view
    class="task-pc"
    :class="{ 'is-listening': voiceQueryActive }"
    :style="glowStyle"
  >
    <!-- 顶部胶囊：只在对话态出现；思考中 / 正在回答时文案随本轮状态切换 -->
    <view v-show="showCapsule" class="task-pc__capsule" @click="toggleVoice">
      <image class="task-pc__capsule-logo" :src="logoUrl" mode="aspectFit" />
      <text class="task-pc__capsule-text">
        {{ capsuleText }}
      </text>
    </view>

    <!-- 欢迎帧：hey, SANI 字标 → 大 logo → 随时为你而来 → 描述；点 logo 进入对话页并开始收音 -->
    <view v-if="!inChat" class="task-pc__idle">
      <image class="task-pc__idle-hey" :src="heySaniUrl" mode="aspectFit" />
      <image class="task-pc__idle-logo" :src="logoUrl" mode="aspectFit" @click="startListening" />
      <text class="task-pc__idle-title">
        随时为你而来
      </text>
      <text class="task-pc__idle-desc">
        你的三一设备伙伴。把问题交给我，把时间留给工作。
      </text>
    </view>

    <!-- 对话态 -->
    <scroll-view
      v-else-if="listReady"
      class="task-pc__chat"
      scroll-y
      :scroll-into-view="scrollAnchor"
      :scroll-with-animation="true"
    >
      <view class="task-pc__chat-inner">
        <view
          v-for="message in chatStore.messages"
          :key="message.id"
          :id="messageDomId(String(message.id || ''))"
          class="task-pc__row"
          :class="message.role === 'user' ? 'task-pc__row--user' : 'task-pc__row--ai'"
        >
          <!-- 用户提问：圆角气泡，右侧无头像 -->
          <template v-if="message.role === 'user'">
            <!-- 编辑态：气泡换成输入框，右侧确认 / 取消（设计稿 403:791） -->
            <template v-if="editingId === String(message.id)">
              <view class="task-pc__bubble task-pc__bubble--edit">
                <input
                  v-model="editingText"
                  class="task-pc__edit-input"
                  :focus="true"
                  confirm-type="send"
                  @confirm="confirmEdit"
                >
              </view>
              <view class="task-pc__action-btn" @click="confirmEdit">
                <image class="task-pc__action-icon task-pc__action-icon--check" :src="taskPcIconCheck" mode="aspectFit" />
              </view>
              <view class="task-pc__action-btn" @click="cancelEdit">
                <image class="task-pc__action-icon task-pc__action-icon--cancel" :src="taskPcIconCancel" mode="aspectFit" />
              </view>
            </template>

            <template v-else>
              <!-- 提问左侧圆钮：本轮思考中是「暂停」，答完 / 暂停后是「编辑」（设计稿 403:957） -->
              <view v-if="showRowAction(message)" class="task-pc__action-btn" @click="onRowAction(message)">
                <image
                  class="task-pc__action-icon"
                  :src="isPausing(message) ? taskPcIconPause : taskPcIconEdit"
                  mode="aspectFit"
                />
              </view>
              <view class="task-pc__bubble">
                <text class="task-pc__bubble-text">
                  {{ message.content }}
                </text>
              </view>
            </template>
          </template>

          <!-- AI 回答：深色卡片 -->
          <template v-else>
            <view class="task-pc__ai-card">
              <view v-if="durationText(message)" class="task-pc__ai-status">
                <text class="task-pc__ai-status-time">
                  {{ durationText(message) }}
                </text>
              </view>

              <view class="task-pc__ai-body">
                <!-- 过程提示（tips）：只在生成期间出现，正式回复一到解析层就把它删掉 -->
                <text v-for="(tip, index) in tipTexts(message)" :key="`tip-${index}`" class="task-pc__ai-step">
                  {{ tip }}
                </text>

                <text v-if="answerText(message)" class="task-pc__ai-answer">
                  {{ answerText(message) }}
                </text>

                <view v-if="tableBlock(message)" class="task-pc__ai-table">
                  <view class="task-pc__ai-table-row task-pc__ai-table-row--head">
                    <text
                      v-for="(column, index) in tableColumns(message)"
                      :key="`th-${index}`"
                      class="task-pc__ai-table-cell"
                    >
                      {{ column }}
                    </text>
                  </view>
                  <view
                    v-for="(row, rowIndex) in tableRows(message)"
                    :key="`tr-${rowIndex}`"
                    class="task-pc__ai-table-row"
                  >
                    <text
                      v-for="(cell, cellIndex) in row"
                      :key="`td-${rowIndex}-${cellIndex}`"
                      class="task-pc__ai-table-cell"
                    >
                      {{ cell }}
                    </text>
                  </view>
                </view>

                <image
                  v-if="imageUrl(message)"
                  class="task-pc__ai-image"
                  :src="imageUrl(message)"
                  mode="widthFix"
                />

                <!-- 其余要素与 task 页同一套块组件：图表 / 指标 / 参考来源 / 推荐问题 / 视频 / 思考过程 / 错误提示 -->
                <view v-if="extraBlocks(message).length" class="task-pc__ai-extra">
                  <AiBlockRenderer
                    v-for="block in extraBlocks(message)"
                    :key="block.id"
                    :block="block"
                    :loading="message.loading"
                    @suggestion-tap="onSuggestionTap"
                  />
                </view>

                <!-- 追问卡：选项胶囊，点一项即当作一次新提问发出去（与任务协同页同一套口径） -->
                <view v-if="askSlotView(message)" class="task-pc__ask">
                  <text v-if="askSlotView(message)?.title" class="task-pc__ask-title">
                    {{ askSlotView(message)?.title }}
                  </text>
                  <text v-if="askSlotView(message)?.description" class="task-pc__ask-desc">
                    {{ askSlotView(message)?.description }}
                  </text>
                  <view class="task-pc__ask-options">
                    <view
                      v-for="(option, index) in askSlotView(message)?.options"
                      :key="String(option.value)"
                      class="task-pc__ask-option"
                      :class="{ 'is-answered': isSlotAnswered(askSlotView(message)?.key || '') }"
                      @click="onSlotOptionTap(message, option)"
                    >
                      <text class="task-pc__ask-letter">
                        {{ slotOptionLetter(index) }}
                      </text>
                      <view class="task-pc__ask-divider" />
                      <text class="task-pc__ask-text">
                        {{ option.label }}
                      </text>
                    </view>
                  </view>
                </view>
              </view>

              <!-- 底部一行：左喇叭（播报这段回答），右 AI 声明 -->
              <view class="task-pc__ai-footer">
                <view
                  v-if="canSpeak(message)"
                  class="task-pc__ai-speaker"
                  :class="{ 'is-playing': message.ttsPlaying }"
                  @click="onSpeakerTap(message)"
                >
                  <image class="task-pc__ai-speaker-icon" :src="taskPcIconSpeaker" mode="aspectFit" />
                </view>
                <text class="task-pc__ai-tip">
                  内容由AI生成，请核实重要信息
                </text>
              </view>
            </view>
          </template>
        </view>

        <!-- 收音中：识别出来的文字直接长成一条用户气泡（与真实提问同一套样式），说完自动发出去 -->
        <view v-if="voiceQueryActive && liveText" class="task-pc__row task-pc__row--user">
          <view class="task-pc__bubble">
            <text class="task-pc__bubble-text">
              {{ liveText }}
            </text>
          </view>
        </view>

        <!-- 滚动锚点：两个交替使用 -->
        <view id="task-pc-anchor-a" class="task-pc__anchor" />
        <view id="task-pc-anchor-b" class="task-pc__anchor" />
      </view>
    </scroll-view>

    <!-- 底部蓝色光晕：只在收音中 / 播报中亮起（见 glowOn），思考中保持熄灭 -->
    <view class="task-pc__glow" :class="{ 'is-on': glowOn }" />

    <!-- 右下角 logo：收音中 / 有对话时常驻，点一下又开始收音 -->
    <view v-if="showDockLogo" class="task-pc__dock" @click="toggleVoice">
      <image class="task-pc__dock-logo" :src="logoUrl" mode="aspectFit" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 尺寸全部按 Ardot 设计稿（1920×1080）标注值写死，不做 rpx 换算 */
.task-pc {
  --task-pc-glow-level: 0.6;
  --task-pc-bg: #181a1e;
  --task-pc-capsule: #262438;
  --task-pc-bubble: #485064;
  --task-pc-card: #212834;
  --task-pc-text: #ffffff;

  position: relative;
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--task-pc-bg);
  font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--task-pc-text);
}

/* ------------------------------ 顶部胶囊 ------------------------------ */
/* 设计稿：hug×64 / r32 / #262438 / padding 0 20 / gap 10 / logo 44 / 文案 28 */
.task-pc__capsule {
  position: absolute;
  top: 84px;
  left: 50%;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 64px;
  padding: 0 20px;
  border-radius: 32px;
  background: var(--task-pc-capsule);
  transform: translateX(-50%);
  cursor: pointer;
  transition: opacity 0.24s ease;
}

.task-pc__capsule-logo {
  width: 44px;
  height: 44px;
}

.task-pc__capsule-text {
  font-size: 28px;
  font-weight: 400;
  line-height: 1;
  color: var(--task-pc-text);
  white-space: nowrap;
}

/* ------------------------------ 海报态 ------------------------------ */
/* 自上而下：hey, SANI 字标（242×55）→ 大 logo 254 → 随时为你而来（32）→ 描述 28，整块居中 */
.task-pc__idle {
  position: absolute;
  top: 240px;
  left: 50%;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 672px;
  transform: translateX(-50%);
}

/* 「hey, SANI」用设计导出的整行字标 hey-sani.svg（106×24，比例 4.42），按 242×55 等比装入 */
.task-pc__idle-hey {
  width: 242px;
  height: 55px;
  margin-bottom: 12px;
}

.task-pc__idle-title {
  margin-bottom: 16px;
  font-size: 32px;
  font-weight: 500;
  line-height: 46px;
  color: var(--task-pc-text);
}

.task-pc__idle-logo {
  width: 254px;
  height: 254px;
  margin: 8px 0 20px;
  cursor: pointer;
}

.task-pc__idle-desc {
  font-size: 28px;
  font-weight: 500;
  line-height: 41px;
  color: var(--task-pc-text);
  text-align: center;
  opacity: 0.8;
}

.task-pc.is-listening .task-pc__idle {
  opacity: 0.28;
  transition: opacity 0.32s ease;
}

/* ------------------------------ 对话区 ------------------------------ */
/**
 * scroll-view 必须拿到确定高度才会滚：flex 布局里默认 min-height:auto 会被内容顶开，
 * 整页跟着变高、内部永远没有可滚量。这里 height:0 + min-height:0 把高度交给 flex 分配，
 * 上下留白挪进内容层（chat-inner），滚动时不会被 padding 吃掉。
 */
.task-pc__chat {
  position: relative;
  z-index: 2;
  flex: 1 1 0;
  width: 100%;
  height: 0;
  min-height: 0;
  margin-top: 170px;
  overflow: hidden;
  box-sizing: border-box;
}

.task-pc__chat-inner {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding: 0 106px 300px;
}

.task-pc__row {
  display: flex;
  align-items: flex-start;
}

.task-pc__row--user {
  justify-content: flex-end;
  gap: 30px;
}

/* 用户气泡：1462 宽上限 / r39 / #485064 / padding 20 30 / 32px */
.task-pc__bubble {
  max-width: 1462px;
  padding: 20px 30px;
  border-radius: 39px;
  background: var(--task-pc-bubble);
}

/* 编辑态：气泡变输入框，宽度吃掉圆钮之外的空间（设计稿 403:791 的输入行） */
.task-pc__bubble--edit {
  flex: 1 1 auto;
  min-width: 0;
  max-width: none;
  box-sizing: border-box;
}

.task-pc__edit-input {
  width: auto;
  height: 48px;
  font-size: 32px;
  line-height: 48px;
  color: var(--task-pc-text);

  :deep(input) {
    font-size: 32px;
    font-style: italic;
    line-height: 48px;
    color: var(--task-pc-text);
  }
}

/* 提问行操作钮：78 圆 / #262438 / 图标槽 36（设计稿 403:957 暂停、403:825 确认、403:820 取消） */
.task-pc__action-btn {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 78px;
  height: 78px;
  border-radius: 39px;
  background: var(--task-pc-capsule);
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.task-pc__action-btn:hover {
  opacity: 0.86;
}

.task-pc__action-icon {
  width: 36px;
  height: 36px;
}

.task-pc__action-icon--check {
  width: 27px;
  height: 19.5px;
}

.task-pc__action-icon--cancel {
  width: 48px;
  height: 48px;
}

.task-pc__bubble-text {
  font-size: 32px;
  line-height: 48px;
  color: var(--task-pc-text);
  word-break: break-word;
}

/* AI 卡片：1708 宽 / r20 / #212834 / padding 46 / gap 12 */
.task-pc__ai-card {
  width: 1708px;
  max-width: 100%;
  padding: 46px;
  border-radius: 20px;
  background: var(--task-pc-card);
  box-sizing: border-box;
}

.task-pc__ai-status {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
}

.task-pc__ai-status-time {
  font-size: 28px;
  line-height: 34px;
  color: var(--task-pc-text);
  opacity: 0.72;
}

.task-pc__ai-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task-pc__ai-step {
  font-size: 28px;
  line-height: 39px;
  color: var(--task-pc-text);
  opacity: 0.86;
}

/* 通用块容器：图表 / 指标 / 参考来源 / 推荐问题 / 视频 / 思考过程 / 错误提示，与 task 页同一套组件。
   这里只补两件事：
   1. 统一竖向间距；
   2. 把仍是浅色硬编码的块（指标 / 错误 / 工具调用 / 状态）改成深色卡里的材质 ——
      这几个组件没有 dark 分支，白底在车机深色卡里像贴上去的纸片 */
.task-pc__ai-extra {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

.task-pc__ai-extra :deep(.metric-block),
.task-pc__ai-extra :deep(.error-block),
.task-pc__ai-extra :deep(.tool-call-block) {
  padding: 24px 28px;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 16px;
  background: rgb(255 255 255 / 6%);
  color: var(--task-pc-text);
}

.task-pc__ai-extra :deep(.metric-block__label),
.task-pc__ai-extra :deep(.metric-block__unit),
.task-pc__ai-extra :deep(.metric-block__trend),
.task-pc__ai-extra :deep(.error-block__message),
.task-pc__ai-extra :deep(.tool-call-block__title),
.task-pc__ai-extra :deep(.tool-call-block__name),
.task-pc__ai-extra :deep(.tool-call-block__args) {
  color: rgb(255 255 255 / 62%);
}

.task-pc__ai-extra :deep(.metric-block__value) {
  color: var(--task-pc-text);
}

.task-pc__ai-extra :deep(.status-block) {
  border: 1px solid rgb(255 255 255 / 12%);
  background: rgb(255 255 255 / 8%);
  color: rgb(255 255 255 / 70%);
}

/* 图表：组件用 aspect-ratio 4:3 撑高度，车机卡片宽 1600+ 时会算出上千像素高、一张图占满屏，
   这里改成固定高度（echarts 按容器尺寸重新布局） */
.task-pc__ai-extra :deep(.chart-block__canvas) {
  height: 380px;
  min-height: 0;
  aspect-ratio: auto;
}

.task-pc__ai-answer {
  font-size: 32px;
  line-height: 46px;
  color: var(--task-pc-text);
  white-space: pre-wrap;
  word-break: break-word;
}

.task-pc__ai-table {
  display: table;
  width: 100%;
  margin-top: 8px;
  border-collapse: collapse;
}

.task-pc__ai-table-row {
  display: table-row;
}

.task-pc__ai-table-row--head .task-pc__ai-table-cell {
  background: rgb(255 255 255 / 6%);
  font-weight: 600;
}

.task-pc__ai-table-cell {
  display: table-cell;
  padding: 16px 20px;
  border: 1px solid rgb(255 255 255 / 12%);
  font-size: 28px;
  line-height: 36px;
  color: var(--task-pc-text);
  word-break: break-word;
}

.task-pc__ai-image {
  width: 100%;
  margin-top: 8px;
  border-radius: 12px;
}

/* ------------------------------ 追问卡（选项胶囊） ------------------------------ */
/* 深色卡里排选项：材质沿用移动端追问卡的深色胶囊（半透明白底 + 浅描边 + 全圆角），
   车机屏宽，选项横向排、放不下自动换行；点了以后整组置灰，避免同一张卡重复提问 */
.task-pc__ask {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  margin-top: 20px;
}

.task-pc__ask-title {
  font-size: 32px;
  font-weight: 500;
  line-height: 46px;
  color: var(--task-pc-text);
}

.task-pc__ask-desc {
  margin-top: -8px;
  font-size: 26px;
  line-height: 36px;
  color: rgb(255 255 255 / 55%);
}

/* 竖向排列、左对齐、每项按内容撑宽（与移动端追问卡同一套排法） */
.task-pc__ask-options {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
}

.task-pc__ask-option {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  max-width: 100%;
  padding: 16px 32px;
  border: 1px solid rgb(255 255 255 / 24%);
  border-radius: 999px;
  background: rgb(255 255 255 / 8%);
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, opacity 0.2s ease;
}

.task-pc__ask-option:hover {
  border-color: rgb(255 255 255 / 40%);
  background: rgb(255 255 255 / 14%);
}

.task-pc__ask-option.is-answered {
  opacity: 0.45;
  cursor: default;
}

.task-pc__ask-letter {
  font-size: 28px;
  line-height: 40px;
  color: rgb(255 255 255 / 70%);
}

.task-pc__ask-divider {
  width: 1px;
  height: 26px;
  margin: 0 18px;
  background: rgb(255 255 255 / 24%);
}

.task-pc__ask-text {
  font-size: 30px;
  line-height: 42px;
  color: var(--task-pc-text);
  word-break: break-word;
}

.task-pc__ai-footer {
  display: flex;
  align-items: center;
  margin-top: 20px;
}

/* 喇叭按钮：设计稿 403:914，40×40 无底色，图标本身 0.8 不透明度 */
.task-pc__ai-speaker {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  cursor: pointer;
  opacity: 0.8;
  transition: opacity 0.2s ease;
}

.task-pc__ai-speaker:hover {
  opacity: 1;
}

.task-pc__ai-speaker-icon {
  width: 40px;
  height: 40px;
}

/* 正在播报：呼吸一下，跟页面其它「进行中」状态同一套观感 */
.task-pc__ai-speaker.is-playing {
  opacity: 1;
  animation: task-pc-speaker-pulse 1.6s ease-in-out infinite;
}

@keyframes task-pc-speaker-pulse {
  0%,
  100% {
    opacity: 0.7;
  }

  50% {
    opacity: 1;
  }
}

/* AI 声明靠右：喇叭不出现时也贴着右边缘 */
.task-pc__ai-tip {
  margin-left: auto;
  font-size: 24px;
  line-height: 29px;
  color: var(--task-pc-text);
  opacity: 0.55;
}

.task-pc__anchor {
  height: 1px;
}

/* ------------------------------ 收音识别文本 ------------------------------ */
/* 识别中的文字直接复用用户气泡（.task-pc__bubble + .task-pc__bubble-text），
   视觉上就是「这条提问马上要发出去」，发送后由真实消息无缝接上，没有独立样式 */


/* ------------------------------ 底部光晕 ------------------------------ */
/**
 * 播放 / 收听光晕：`background: #1B72CF` + `backdrop-filter: blur(70px)`。
 *
 * 层叠要点：光晕压在内容之上（z-index 高于对话区），背景模糊才有东西可糊——
 * 放在内容下面的话背后只有页面底色，糊出来是一片纯色，没有发光感。
 * 边缘用 radial mask 化开成光晕，避免露出 1680 宽的矩形硬边；交互继续穿透（pointer-events: none）。
 *
 * 亮灭由 `.is-on` 控制（见 glowOn）：默认全透明，只有收音中 / 播报中才淡入，
 * 思考阶段与「我在，你说」空闲态都保持熄灭。
 */
.task-pc__glow {
  position: absolute;
  bottom: -360px;
  left: 50%;
  z-index: 3;
  width: 1920px;
  height: 660px;
  background: #0277f4;
  backdrop-filter: blur(70px);
  -webkit-backdrop-filter: blur(70px);
  opacity: 0;
  transition: opacity 0.32s ease;
  /* 必须常驻独立合成层：车机 WebView 里 scroll-view 的原生滚动层会压在普通兄弟元素之上，
     光晕只有等到某次内容 / 动画重绘（例如收音时呼吸动画变快）才会被画到上层，
     空闲态（我在，你说）就会整块看不见。translate3d + will-change 把它钉在合成层里 */
  transform: translate3d(-50%, 0, 0);
  will-change: transform, opacity;
  backface-visibility: hidden;
  pointer-events: none;
  animation: task-pc-glow-breathe 5.2s ease-in-out infinite;
  -webkit-mask-image: radial-gradient(74% 96% at 50% 100%, #000 0%, rgb(0 0 0 / 88%) 58%, rgb(0 0 0 / 34%) 80%, transparent 96%);
  mask-image: radial-gradient(74% 96% at 50% 100%, #000 0%, rgb(0 0 0 / 88%) 58%, rgb(0 0 0 / 34%) 80%, transparent 96%);
}

/* 收音中 / 播报中才亮：亮度跟麦克风音量走，呼吸节奏比空闲时快 */
.task-pc__glow.is-on {
  opacity: calc(0.72 + var(--task-pc-glow-level) * 0.24);
}

.task-pc.is-listening .task-pc__glow {
  animation-duration: 2.4s;
}

@keyframes task-pc-glow-breathe {
  0%,
  100% {
    transform: translate3d(-50%, 0, 0) scale(1);
  }

  50% {
    transform: translate3d(-50%, 0, 0) scale(1.06);
  }
}

/* ------------------------------ 右下角 logo ------------------------------ */
/* 收音时顶部胶囊让位给它：点一下又开始新一轮收音 */
.task-pc__dock {
  position: absolute;
  right: 64px;
  bottom: 96px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 容器跟 logo 同尺寸（150×150）：圆钮的 hover / 脉动 / 点击热区才对得上图标 */
  width: 150px;
  height: 150px;
  cursor: pointer;
  transition: transform 0.28s ease, opacity 0.28s ease;
}

.task-pc__dock:hover {
  transform: scale(1.06);
}

.task-pc__dock-logo {
  width: 150px;
  height: 150px;
}

.task-pc.is-listening .task-pc__dock {
  filter: drop-shadow(0 0 18px rgb(96 148 255 / 55%));
  animation: task-pc-dock-pulse 2.4s ease-in-out infinite;
}

@keyframes task-pc-dock-pulse {
  0%,
  100% {
    transform: scale(1);
  }

  50% {
    transform: scale(1.08);
  }
}
</style>

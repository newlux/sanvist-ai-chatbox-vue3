<script setup lang="ts">
import type { ChatScene } from '@/utils/session-scene';

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

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
 * 2. 开始收音：光晕进入呼吸动画、品牌区压暗、logo 收到右下角；
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

const { sendMessage, stopGenerating } = useChatSend(chatScope, {
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

/** 有没有对话内容：决定渲染海报态还是对话态 */
const hasMessages = computed(() => chatStore.messages.length > 0);

/** 胶囊只在对话态出现：海报态顶部不放浮层；对话态收音中也留着，用来显示「正在收听」 */
const showCapsule = computed(() => hasMessages.value);
/** 右下角 logo：收音中 / 有对话时常驻，是再次收音的入口 */
const showDockLogo = computed(() => voiceQueryActive.value || hasMessages.value);

/** 光晕强度跟着麦克风音量走，静静地呼吸 */
const glowStyle = computed(() => ({
  '--task-pc-glow-level': String(0.35 + Math.min(voiceLevel.value, 1) * 0.65),
}));

/* ------------------------------ 消息渲染 ------------------------------ */

type MessageRow = (typeof chatStore.messages)[number];

/** 只渲染设计稿里出现的块：正文 / 表格 / 图片。调度视图卡（gantt）按需求不展示 */
function contentBlocks(message: MessageRow) {
  return (message.blocks || []).filter((block) => {
    if (block.type === 'gantt')
      return false;
    return block.type === 'answer' || block.type === 'table' || block.type === 'image';
  });
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

function answerText(message: MessageRow) {
  return contentBlocks(message)
    .filter(block => block.type === 'answer')
    .map(block => String(block.payload?.content || ''))
    .join('\n')
    .trim();
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

/** 「已完成 / 输出中」状态行 */
function statusText(message: MessageRow) {
  if (message.loading) return '正在输出';
  if (message.interrupted) return '已停止';
  return '✓ 已完成';
}

/** 耗时：与设计稿一致保留一位小数 */
function durationText(message: MessageRow) {
  const ms = Number(message.durationMs || 0);
  if (!ms) return '';
  return `耗时${(ms / 1000).toFixed(2)}秒`;
}

/** 步骤行（调用Ai运营助手 / 拉取数据…）：接口下发的过程文案 */
function stepTexts(message: MessageRow) {
  const subtitle = String(message.processSubtitle || '').trim();
  return subtitle ? [subtitle] : [];
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
    if (hasMessages.value) scrollToBottom();
  },
);

/* ------------------------------ 收音 ------------------------------ */

function toggleVoice() {
  if (voiceQueryActive.value) {
    stopVoiceQuery();
    return;
  }
  startVoiceQuery();
}

/** 海报 logo 只负责「开始收音」：收音中海报还在（压暗），别让误触把这一轮掐掉 */
function startListening() {
  if (voiceQueryActive.value) return;
  startVoiceQuery();
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

    <!-- 海报态：hey, SANI 字标 → 大 logo → 随时为你而来 → 描述；点 logo 才开始收音 -->
    <view v-if="!hasMessages" class="task-pc__idle">
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
              <view class="task-pc__ai-status">
                <text class="task-pc__ai-status-done">
                  {{ statusText(message) }}
                </text>
                <text v-if="durationText(message)" class="task-pc__ai-status-time">
                  {{ durationText(message) }}
                </text>
              </view>

              <view class="task-pc__ai-body">
                <text v-for="(step, index) in stepTexts(message)" :key="`step-${index}`" class="task-pc__ai-step">
                  {{ step }}
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

        <!-- 滚动锚点：两个交替使用 -->
        <view id="task-pc-anchor-a" class="task-pc__anchor" />
        <view id="task-pc-anchor-b" class="task-pc__anchor" />
      </view>
    </scroll-view>

    <!-- 收音实时字幕 -->
    <view v-if="voiceQueryActive && liveText" class="task-pc__live">
      <text class="task-pc__live-text">
        {{ liveText }}
      </text>
    </view>

    <!-- 底部蓝色光晕（收音时进入呼吸动画） -->
    <view class="task-pc__glow" />

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

.task-pc__ai-status-done,
.task-pc__ai-status-time {
  font-size: 28px;
  line-height: 34px;
  color: var(--task-pc-text);
}

.task-pc__ai-status-time {
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

/* ------------------------------ 收音字幕 ------------------------------ */
.task-pc__live {
  position: absolute;
  bottom: 260px;
  left: 50%;
  z-index: 4;
  max-width: 1400px;
  transform: translateX(-50%);
}

.task-pc__live-text {
  font-size: 32px;
  line-height: 46px;
  color: rgb(255 255 255 / 88%);
  text-align: center;
}

/* ------------------------------ 底部光晕 ------------------------------ */
/**
 * 播放 / 收听光晕：`background: #1B72CF` + `backdrop-filter: blur(70px)`。
 *
 * 层叠要点：光晕压在内容之上（z-index 高于对话区），背景模糊才有东西可糊——
 * 放在内容下面的话背后只有页面底色，糊出来是一片纯色，没有发光感。
 * 边缘用 radial mask 化开成光晕，避免露出 1680 宽的矩形硬边；交互继续穿透（pointer-events: none）。
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
  opacity: calc(0.72 + var(--task-pc-glow-level) * 0.24);
  transform: translateX(-50%);
  pointer-events: none;
  animation: task-pc-glow-breathe 5.2s ease-in-out infinite;
  -webkit-mask-image: radial-gradient(74% 96% at 50% 100%, #000 0%, rgb(0 0 0 / 88%) 58%, rgb(0 0 0 / 34%) 80%, transparent 96%);
  mask-image: radial-gradient(74% 96% at 50% 100%, #000 0%, rgb(0 0 0 / 88%) 58%, rgb(0 0 0 / 34%) 80%, transparent 96%);
}

.task-pc.is-listening .task-pc__glow {
  // opacity: calc(0.6 + var(--task-pc-glow-level) * 0.38);
  animation-duration: 2.4s;
}

@keyframes task-pc-glow-breathe {
  0%,
  100% {
    transform: translateX(-50%) scale(1);
  }

  50% {
    transform: translateX(-50%) scale(1.06);
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

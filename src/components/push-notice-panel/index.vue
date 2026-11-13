<script setup lang="ts">
import type { PushConnectionState, PushMessageRecord, TaskDispatchPush } from "@/utils/push/types";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { usePushNotification } from "@/hooks/usePushNotification";
import { pushActionOf } from "@/utils/push/push-payload";

/**
 * 任务下发通知面板（sanvist.push/1 消息中心）。
 *
 * 独立组件：只依赖 `hooks/usePushNotification` 与 `utils/push/*`，不读写任何业务 store，
 * 放到哪个页面都只是「一块卡片」。当前挂在声音设置页，用于验证车载端推送链路。
 *
 * 文案不走 i18n 词条：这份面板是随推送协议一起新增的独立文件，词条需要先进 i18n.csv
 * 再跑生成脚本（会重写 15 个语言包），为避免影响其它模块，这里按当前语言就地取词。
 */
const props = withDefaults(
  defineProps<{
    /** 深色模式：与声音设置页 .sound-settings--dark 同一套配色 */
    dark?: boolean;
    /** 设备号，默认取 config/push 里的联调账号 */
    deviceNo?: string;
    /** 是否进页面即连接 */
    autoConnect?: boolean;
  }>(),
  { dark: false, deviceNo: "", autoConnect: true },
);

const { locale } = useI18n();

const COPY = {
  zh: {
    title: "任务下发通知",
    connect: "开启推送",
    disconnect: "断开连接",
    clear: "清空记录",
    empty: "暂无推送消息，等待服务端下发…",
    first: "首次下发",
    append: "新增任务",
    detail: "查看详情",
    noAction: "该通知没有可执行的关联动作",
    countText: (total: number, unread: number) => (unread > 0 ? `${total} 条 · ${unread} 条未读` : `${total} 条`),
    status: {
      idle: "未连接",
      connecting: "连接中…",
      connected: "已连接",
      reconnecting: "重连中…",
      unauthorized: "认证失败",
      failed: "连接失败",
    } as Record<PushConnectionState, string>,
  },
  en: {
    title: "Task push notices",
    connect: "Connect",
    disconnect: "Disconnect",
    clear: "Clear",
    empty: "No messages yet, waiting for the server…",
    first: "First dispatch",
    append: "New tasks",
    detail: "View detail",
    noAction: "This notice has no executable action",
    countText: (total: number, unread: number) => (unread > 0 ? `${total} · ${unread} unread` : `${total}`),
    status: {
      idle: "Disconnected",
      connecting: "Connecting…",
      connected: "Connected",
      reconnecting: "Reconnecting…",
      unauthorized: "Auth failed",
      failed: "Connect failed",
    } as Record<PushConnectionState, string>,
  },
};

const copy = computed(() => (String(locale.value || "").toLowerCase().startsWith("zh") ? COPY.zh : COPY.en));

const { deviceNo, state, stateDetail, notices, running, unreadCount, connected, toggle, clear, markRead, openDetail } =
  usePushNotification({
    deviceNo: props.deviceNo || undefined,
    autoStart: props.autoConnect,
  });

const statusText = computed(() => copy.value.status[state.value] || state.value);
const countText = computed(() => copy.value.countText(notices.value.length, unreadCount.value));

/** 06:17:32：面板按收到的本地时间展示，服务端的 created_at 不带年份更要解析，容易受时区影响 */
function formatTime(timestamp: number) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function variantText(payload: TaskDispatchPush) {
  if (payload?.variant === "first") return copy.value.first;
  if (payload?.variant === "append") return copy.value.append;
  return String(payload?.variant || "");
}

/** 业务日期 · 执行人 · 车牌：与通知正文互补，正文里刻意不含这些明细（协议 5.6） */
function metaText(record: PushMessageRecord) {
  const payload = record.payload;
  const parts = [
    String(payload?.business_date || ""),
    String(payload?.recipient?.name || ""),
    String(payload?.terminal?.plate_no || ""),
  ].filter(Boolean);
  return parts.join(" · ");
}

function actionLabel(payload: TaskDispatchPush) {
  return String(pushActionOf(payload)?.label || copy.value.detail);
}

function onToggle() {
  toggle();
}

function onClear() {
  clear();
}

function onOpen(record: PushMessageRecord) {
  markRead(record.msgId);
  if (!openDetail(record.payload)) {
    uni.showToast({ title: copy.value.noAction, icon: "none" });
  }
}
</script>

<template>
  <view class="push-panel" :class="{ 'push-panel--dark': dark }">
    <view class="push-panel__head">
      <view class="push-panel__head-main">
        <text class="push-panel__title">{{ copy.title }}</text>
        <view class="push-panel__status">
          <view class="push-panel__dot" :class="`push-panel__dot--${state}`" />
          <text class="push-panel__status-text">{{ statusText }}</text>
        </view>
      </view>
      <text class="push-panel__toggle" @tap="onToggle">{{ running ? copy.disconnect : copy.connect }}</text>
    </view>

    <view class="push-panel__meta">
      <text class="push-panel__meta-text">{{ deviceNo }}</text>
      <text class="push-panel__meta-text">{{ countText }}</text>
    </view>

    <view v-if="stateDetail" class="push-panel__detail">{{ stateDetail }}</view>

    <view v-if="!notices.length" class="push-panel__empty">{{ copy.empty }}</view>

    <view
      v-for="record in notices"
      :key="record.msgId"
      class="push-panel__item"
      :class="{ 'push-panel__item--unread': !record.read }"
      @tap="onOpen(record)"
    >
      <view class="push-panel__item-head">
        <text class="push-panel__item-title">{{ record.payload.notice?.title || copy.title }}</text>
        <text class="push-panel__badge">{{ variantText(record.payload) }}</text>
      </view>
      <text class="push-panel__item-text">{{ record.payload.notice?.text }}</text>
      <view class="push-panel__item-foot">
        <text class="push-panel__item-meta">{{ metaText(record) }}</text>
        <text class="push-panel__item-time">{{ formatTime(record.receivedAt) }}</text>
        <text v-if="pushActionOf(record.payload)" class="push-panel__item-action">{{ actionLabel(record.payload) }}</text>
      </view>
    </view>

    <view v-if="notices.length" class="push-panel__foot">
      <text class="push-panel__clear" @tap="onClear">{{ copy.clear }}</text>
      <text v-if="connected" class="push-panel__hint">MQTT · QoS 1</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 与声音设置页的播放速度卡同一套规格：白底、圆角 12px（24rpx）、内边距 16px（32rpx） */
.push-panel {
  display: flex;
  flex-direction: column;
  padding: 32rpx;
  border-radius: 24rpx;
  background: #ffffff;
}

.push-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.push-panel__head-main {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 16rpx;
}

/* 14px（28rpx）Medium #0D0D0D，与音色卡标题同字号 */
.push-panel__title {
  color: #0d0d0d;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
  white-space: nowrap;
}

.push-panel__status {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.push-panel__dot {
  width: 12rpx;
  height: 12rpx;
  flex: 0 0 12rpx;
  border-radius: 50%;
  background: #c7c7c7;
}

.push-panel__dot--connected {
  background: #34c759;
}

.push-panel__dot--connecting,
.push-panel__dot--reconnecting {
  background: #ff9500;
}

.push-panel__dot--unauthorized,
.push-panel__dot--failed {
  background: #ff3b30;
}

.push-panel__status-text {
  color: #8e8e8e;
  font-size: 20rpx;
  line-height: 28rpx;
}

/* 右上角主操作：蓝字，可点热区由 padding 撑开 */
.push-panel__toggle {
  flex: 0 0 auto;
  padding: 8rpx 0 8rpx 16rpx;
  color: #1166d6;
  font-size: 22rpx;
  line-height: 32rpx;
}

.push-panel__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8rpx;
}

.push-panel__meta-text {
  color: #8e8e8e;
  font-size: 20rpx;
  line-height: 30rpx;
}

/* 认证失败 / 订阅被拒 / 补取中的说明行 */
.push-panel__detail {
  margin-top: 8rpx;
  color: #ff9500;
  font-size: 20rpx;
  line-height: 30rpx;
}

.push-panel__empty {
  margin-top: 20rpx;
  padding: 32rpx 0;
  color: #8e8e8e;
  font-size: 22rpx;
  line-height: 32rpx;
  text-align: center;
}

/* 单条通知：浅底卡片，未读时左侧一条蓝竖条 */
.push-panel__item {
  position: relative;
  display: flex;
  flex-direction: column;
  margin-top: 16rpx;
  padding: 20rpx 22rpx;
  border-radius: 16rpx;
  background: #f7f8fa;
}

.push-panel__item--unread::before {
  position: absolute;
  top: 20rpx;
  bottom: 20rpx;
  left: 0;
  width: 4rpx;
  border-radius: 0 4rpx 4rpx 0;
  background: #1166d6;
  content: "";
}

.push-panel__item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.push-panel__item-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #0d0d0d;
  font-size: 24rpx;
  font-weight: 500;
  line-height: 34rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.push-panel__badge {
  flex: 0 0 auto;
  padding: 2rpx 10rpx;
  border-radius: 8rpx;
  background: rgba(17, 102, 214, 0.1);
  color: #1166d6;
  font-size: 18rpx;
  line-height: 26rpx;
}

.push-panel__item-text {
  margin-top: 4rpx;
  color: #5d5d5d;
  font-size: 22rpx;
  line-height: 32rpx;
}

.push-panel__item-foot {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 8rpx;
}

.push-panel__item-meta {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #8e8e8e;
  font-size: 18rpx;
  line-height: 26rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.push-panel__item-time {
  flex: 0 0 auto;
  color: #8e8e8e;
  font-size: 18rpx;
  line-height: 26rpx;
}

.push-panel__item-action {
  flex: 0 0 auto;
  color: #1166d6;
  font-size: 20rpx;
  line-height: 28rpx;
}

.push-panel__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 20rpx;
}

.push-panel__clear {
  color: #8e8e8e;
  font-size: 20rpx;
  line-height: 28rpx;
}

.push-panel__hint {
  color: #c7c7c7;
  font-size: 18rpx;
  line-height: 26rpx;
}

/* ===================== 深色模式（203:1093 深色稿同一套配色） ===================== */
.push-panel--dark {
  background: #303030;

  .push-panel__title {
    color: #ffffff;
  }

  .push-panel__status-text {
    color: #8e8e8e;
  }

  .push-panel__meta-text,
  .push-panel__clear {
    color: #8e8e8e;
  }

  .push-panel__empty {
    color: #8e8e8e;
  }

  .push-panel__item {
    background: rgba(255, 255, 255, 0.04);
  }

  .push-panel__item-title {
    color: #ffffff;
  }

  .push-panel__item-text {
    color: #d6d6d6;
  }

  .push-panel__item-meta,
  .push-panel__item-time {
    color: #8e8e8e;
  }

  .push-panel__badge {
    background: #003883;
    color: #d3e6ff;
  }

  .push-panel__hint {
    color: #5d5d5d;
  }
}
</style>

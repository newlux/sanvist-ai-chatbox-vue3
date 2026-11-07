<script setup lang="ts">
import type { TaskDetailGroup, TaskDetailItem, TaskDetailPayload } from "@/components/ai-task-detail-sheet/types";

import { onLoad } from "@dcloudio/uni-app";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { taskDetailStatusKey } from "@/components/ai-task-detail-sheet/types";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useSystemStore } from "@/stores";
import { backFromScene } from "@/utils/scene-navigation";
import { consumePendingTaskDetail } from "@/utils/task-detail-view";

/**
 * 个人任务详情列表（计划详情-司机）——竖屏页，设计稿 4637:478（列表）+ 6832:464（带状态）
 * + 3918:345（入口：作业协同对话里的「任务协同-个人排班甘特图」卡片）。
 *
 * 数据来源：入口卡点击时落本地存储的 gantt 整包 data，详情内容在它的 `payload` 字段里
 * （driverName / dateText / vehicleText / groups[].items[] / note），本页 onLoad 取出。
 * 路由：`viewType=personal` 固定走本页（站内 pushWindow / navigateTo），**不进离线包容器**
 * （见 utils/gantt-navigation），所以本页只需要处理竖屏版面。
 * 深浅色跟随 systemStore.isDark（根节点 `.td--dark`），与对话页 / 横屏详情面板同一口径。
 * **没有的值不渲染对应元素**：司机信息为空不渲染司机卡片、路线为空不渲染标题、
 * 起止时间为空不渲染时间列（只给一端就只渲染一端）、状态认不出不渲染状态文案、备注为空不渲染备注。
 *
 * 版面：375 宽竖屏（稿件坐标直接用 px）
 * - 顶部导航 50 高：「<」返回（22 左）+ 居中标题「详情」16px Medium #1A1A1E；
 * - 司机卡片 335×72：姓名 16px SemiBold #000 / 日期 14px Medium #1A1A1E（右对齐）
 *   / 车辆班组 14px Regular #999；
 * - 行程分组：路线标题 15px Medium #000 + 逐条任务行
 *   （左列起止时间 14px Medium #666、中间连接线与圆点、右侧任务卡 252×41）；
 * - 底部备注 335×54：白底 + #E6E6E6 描边、圆角 6、12px Medium 居中两行。
 *
 * 任务卡配色（设计稿 6832:494 / 6832:507 / 6832:514 / 6832:531）：
 *   已完成  底 #FBFBFB 描边 #F2F2F2 文字 #1A1A1E，右侧状态 #999999
 *   执行中  底 #ECF5FF 描边 #F2F2F2 文字 #1A1A1E，右侧状态 #1A1A1A（唯一高亮态）
 *   待执行  底 #FFFFFF 描边 #F2F2F2 文字 #1A1A1E，右侧状态 #999999
 *   已取消  底 #EFEFEF 描边 #F2F2F2 文字 #999999，右侧状态 #999999
 *   无状态  不加底色修饰（白底 + 默认描边）
 */

defineOptions({ name: "TaskDetailPage" });

/** 状态栏 / 底部安全区：内嵌 webview 里拿不到真实值时 hook 会兜底 */
const { safeAreaStyle } = useSafeArea();

/** 深浅色：与对话页同一套口径（唯一数据源 systemStore.isDark），页面只负责把 --dark 类挂到根节点 */
const systemStore = useSystemStore();
const isDark = computed(() => systemStore.isDark);

/** 详情内容：没有数据时是空对象，页面上除了导航不渲染任何元素 */
const detail = ref<TaskDetailPayload>({});

onLoad(() => {
  detail.value = consumePendingTaskDetail() || {};
});

/** 空白串一律当没有值（接口给的是空串 / 空格时同样不渲染） */
function trimText(value?: string) {
  return String(value ?? "").trim();
}

/** 归一化后的任务条：空值已清掉，模板只看有没有值 */
interface NormalizedItem {
  /** 已 trim 的起止时间 / 名称，空串 = 没有 */
  start: string;
  end: string;
  name: string;
  /** 状态原文（只用于判断高亮） */
  status: string;
  /** 状态文案：接口没给或认不出的值 → 空串（不渲染） */
  statusText: string;
  /** 任务卡底色修饰类：只认已知状态，其余走默认白底 */
  statusClass: string;
}

/** 已知状态才加底色修饰类，避免出现没有样式定义的类名 */
const CARD_STATUS_CLASS = new Set(["done", "running", "pending", "canceled"]);

const { t } = useI18n();

function normalizeItem(item: TaskDetailItem): NormalizedItem {
  const status = trimText(item?.status);
  const statusKey = taskDetailStatusKey(status);
  return {
    start: trimText(item?.start),
    end: trimText(item?.end),
    name: trimText(item?.name),
    status,
    statusText: statusKey ? t(statusKey) : "",
    statusClass: CARD_STATUS_CLASS.has(status) ? `td__card--${status}` : "",
  };
}

const driverName = computed(() => trimText(detail.value.driverName));
const dateText = computed(() => trimText(detail.value.dateText));
const vehicleText = computed(() => trimText(detail.value.vehicleText));
const noteText = computed(() => trimText(detail.value.note));

/** 三个司机信息都为空就不渲染司机卡片 */
const hasDriver = computed(() => Boolean(driverName.value || dateText.value || vehicleText.value));

/** 只保留有内容的分组与任务条：路线为空且没有任务的组、以及完全空白（无名称 / 时间 / 状态）的条目都不渲染 */
const groups = computed(() => {
  const source = Array.isArray(detail.value.groups) ? detail.value.groups : [];
  return source
    .map((group: TaskDetailGroup) => ({
      route: trimText(group?.route),
      items: (Array.isArray(group?.items) ? group.items : [])
        .map(normalizeItem)
        .filter(item => Boolean(item.name || item.start || item.end || item.statusText)),
    }))
    .filter(group => Boolean(group.route || group.items.length > 0));
});

/** 返回：上一页是对话页就直接返回，独立场景窗口则关窗，兜底回作业协同页 */
function onBack() {
  backFromScene("/pages/task/index");
}
</script>

<template>
  <view class="td" :class="{ 'td--dark': isDark }" :style="safeAreaStyle">
    <!-- 顶部导航（设计稿 4637:491：返回 4637:492 + 标题 4637:494） -->
    <view class="td__nav">
      <view class="td__back" @tap="onBack">
        <view class="td__back-arrow" />
      </view>
      <text class="td__nav-title">
        {{ t("task-detail-title") }}
      </text>
    </view>

    <scroll-view class="td__body" scroll-y>
      <!-- 司机卡片（设计稿 6832:400 / 401 / 403 / 402）：三项全空则不渲染 -->
      <view v-if="hasDriver" class="td__driver">
        <view class="td__driver-top">
          <text v-if="driverName" class="td__driver-name">
            {{ driverName }}
          </text>
          <text v-if="dateText" class="td__driver-date">
            {{ dateText }}
          </text>
        </view>
        <text v-if="vehicleText" class="td__driver-vehicle">
          {{ vehicleText }}
        </text>
      </view>

      <!-- 行程分组：路线标题 + 逐条任务（左侧起止时间 + 连接线圆点 + 右侧任务卡） -->
      <view v-for="(group, groupIndex) in groups" :key="`${group.route}-${groupIndex}`" class="td__group">
        <text v-if="group.route" class="td__route">
          {{ group.route }}
        </text>

        <view v-for="(item, itemIndex) in group.items" :key="`${group.route}-${itemIndex}-${item.name}`" class="td__row">
          <!-- 起止时间：只渲染有值的那些 -->
          <view v-if="item.start || item.end" class="td__times">
            <text v-if="item.start" class="td__time">
              {{ item.start }}
            </text>
            <!-- 两段时间之间的小短横（设计稿 6832:443 / 4708:570 等） -->
            <view v-if="item.start && item.end" class="td__time-tick" />
            <text v-if="item.end" class="td__time">
              {{ item.end }}
            </text>
          </view>

          <view class="td__spine">
            <view class="td__dot" />
          </view>

          <view class="td__card" :class="item.statusClass">
            <text v-if="item.name" class="td__card-text">
              {{ item.name }}
            </text>
            <text v-if="item.statusText" class="td__status" :class="{ 'td__status--running': item.status === 'running' }">
              {{ item.statusText }}
            </text>
          </view>
        </view>
      </view>

      <!-- 底部备注（设计稿 6832:463 / 6832:462 / 6832:460） -->
      <view v-if="noteText" class="td__note">
        <text class="td__note-text">
          {{ noteText }}
        </text>
      </view>
    </scroll-view>
  </view>
</template>

<style lang="scss" scoped>
/* 竖屏页：稿子 375 × 818；除 1px 描边/细线外，尺寸一律用 rpx 随屏宽自适应（稿子 1px = 2rpx） */
.td {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #ffffff;
  color: #1a1a1e;
  font-family: "PingFang SC", "Inter", sans-serif;
}

/* ---------- 顶部导航：100rpx 高，标题居中、返回箭头贴左 44rpx ---------- */
.td__nav {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  /* 状态栏高度由 useSafeArea 写入 --safe-top-px */
  margin-top: var(--safe-top-px, 0px);
  height: 100rpx;
}

.td__back {
  position: absolute;
  left: 44rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40rpx;
  height: 40rpx;
}

.td__back:active {
  opacity: 0.6;
}

/* 返回箭头：两条线拼出的「<」（设计稿 4637:493） */
.td__back-arrow {
  width: 18rpx;
  height: 18rpx;
  border-left: 1.5px solid #1a1a1e;
  border-bottom: 1.5px solid #1a1a1e;
  transform: rotate(45deg);
}

.td__nav-title {
  font-size: 32rpx;
  font-weight: 500;
  line-height: 40rpx;
  color: #1a1a1e;
}

/* ---------- 内容区：整页可滚，左右各 40rpx 内边距 ---------- */
.td__body {
  flex: 1 1 auto;
  min-height: 0;
  box-sizing: border-box;
  padding: 0 40rpx calc(40rpx + var(--safe-bottom-px, 0px));
}

/* ---------- 司机卡片：高 144rpx、白底 + #EFEFEF 描边、圆角 32rpx ---------- */
.td__driver {
  display: flex;
  flex-direction: column;
  justify-content: center;
  box-sizing: border-box;
  height: 144rpx;
  padding: 0 32rpx;
  border: 1px solid #efefef;
  border-radius: 32rpx;
  background: #ffffff;
}

.td__driver-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.td__driver-name {
  font-size: 32rpx;
  font-weight: 600;
  line-height: 38rpx;
  color: #000000;
}

/* margin-left: auto：姓名缺省时日期仍贴右（space-between 只有一个子元素时会失效） */
.td__driver-date {
  margin-left: auto;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 34rpx;
  color: #1a1a1e;
}

.td__driver-vehicle {
  margin-top: 8rpx;
  font-size: 28rpx;
  line-height: 34rpx;
  color: #999999;
}

/* ---------- 行程分组 ---------- */
/* 组间距 22rpx（稿件上一行时间框底 389 → 下一个路线标题 400）；首组距司机卡片 28rpx（179 → 193） */
.td__group {
  margin-top: 22rpx;
}

/* 首组紧跟在司机卡片后面（不能用 :first-of-type：兄弟节点都是 uni-view） */
.td__driver + .td__group {
  margin-top: 28rpx;
}

.td__route {
  display: block;
  font-size: 30rpx;
  font-weight: 500;
  line-height: 36rpx;
  color: #000000;
}

/* 任务行：时间列（86rpx 高）+ 连接线圆点 + 任务卡（82rpx 高），行间 28rpx（稿件行距 57 = 43 + 14） */
.td__row {
  display: flex;
  align-items: flex-start;
  margin-top: 24rpx;
}

.td__row + .td__row {
  margin-top: 28rpx;
}

/* 左列起止时间：28rpx Medium #666；文本盒 34rpx、两段时间之间留 18rpx（合计 86rpx）。
   用 flex + gap 撑间距：两段文字中间还夹着绝对定位的短线，相邻选择器（+）会被它隔断而不生效 */
.td__times {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 18rpx;
  flex-shrink: 0;
  box-sizing: border-box;
  width: 84rpx;
}

.td__time {
  display: block;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 34rpx;
  color: #666666;
}

/* 两段时间之间的灰色实线：#CCCCCC 1×16rpx，水平居中、垂直正好填满 34→50rpx 这段间隙
   （稿子 6832:443：y 4849 → 4857）；1px 线宽保留像素，避免高分屏上被抹掉 */
.td__time-tick {
  position: absolute;
  top: 34rpx;
  left: 28rpx;
  width: 1px;
  height: 16rpx;
  margin-left: -0.5px;
  background: #cccccc;
}

/* 连接线 + 圆点：外 28rpx 圈 #F1F1F1、内 16rpx 点 #C0C0C0；线只在圆点之间（最后一行不画） */
.td__spine {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  flex-shrink: 0;
  align-self: stretch;
  /* 稿件：时间列右缘 62 → 任务卡左缘 103 之间，圆点居中（圆心 83） */
  width: 82rpx;
}

.td__spine::before {
  content: "";
  position: absolute;
  top: 14rpx;
  /* 画到下一行圆点中心：行距 57 - 行高 43 + 圆点中心 7 = 21（42rpx） */
  bottom: -42rpx;
  left: 50%;
  width: 1px;
  margin-left: -0.5px;
  background: #f1f1f1;
}

.td__row:last-child .td__spine::before {
  display: none;
}

.td__dot {
  position: relative;
  box-sizing: border-box;
  width: 28rpx;
  height: 28rpx;
  border-radius: 50%;
  background: #f1f1f1;
}

.td__dot::after {
  content: "";
  position: absolute;
  top: 6rpx;
  left: 6rpx;
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  background: #c0c0c0;
}

/* 任务卡：高 82rpx、圆角 12rpx、描边 #F2F2F2；右侧状态文案在卡内右对齐（稿件 x=298） */
.td__card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  flex: 1 1 auto;
  box-sizing: border-box;
  min-width: 0;
  height: 82rpx;
  padding: 0 30rpx 0 24rpx;
  border: 1px solid #f2f2f2;
  border-radius: 12rpx;
  background: #ffffff;
}

.td__card-text {
  min-width: 0;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 34rpx;
  color: #1a1a1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.td__card--done {
  background: #fbfbfb;
}

.td__card--running {
  background: #ecf5ff;
}

.td__card--canceled {
  background: #efefef;
}

.td__card--canceled .td__card-text {
  color: #999999;
}

.td__status {
  flex-shrink: 0;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 34rpx;
  color: #999999;
}

.td__status--running {
  color: #1a1a1a;
}

/* ---------- 底部备注：高 108rpx、白底 + #E6E6E6 描边、圆角 12rpx、24rpx 居中两行 ---------- */
.td__note {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 108rpx;
  /* 稿件：最后一行时间框底 689 → 备注块 696 */
  margin-top: 14rpx;
  padding: 20rpx 76rpx;
  border: 1px solid #e6e6e6;
  border-radius: 12rpx;
  background: #ffffff;
}

.td__note-text {
  font-size: 24rpx;
  font-weight: 500;
  line-height: 30rpx;
  text-align: center;
  color: #1a1a1e;
}

/* ===== 深色主题 =====
   与同族「任务详情面板」（components/ai-task-detail-panel 的 .tdp--dark）同一套材质，
   保证横竖两版详情在深色下观感一致：
   - 页面底 #0D0D0D；司机卡 / 任务卡 / 备注块 #1A1A1A + 1px #303030
   - 标题 #FFFFFF、正文 #E5E5E5、次要（车辆班组 / 时间列 / 状态）#8E8E8E
   - 连接线 #303030、圆点外圈 #262626 内点 #6B6B6B、时间短横 #4A4A4A
   - 任务卡状态色：已完成 #1F1F1F、待执行 #1A1A1A、已取消 #141414（文字 #5D5D5D），
     执行中保留淡蓝语义（底 #16283C + 描边 #4C7396，状态文案提亮到 #FFFFFF）
   尺寸 / 间距 / 字号与浅色稿完全一致，只换颜色 */
.td--dark {
  background: #0d0d0d;
  color: #e5e5e5;

  /* ---- 顶部导航 ---- */
  .td__back-arrow {
    border-color: #e5e5e5;
  }

  .td__nav-title {
    color: #ffffff;
  }

  /* ---- 司机卡片 ---- */
  .td__driver {
    border-color: #303030;
    background: #1a1a1a;
  }

  .td__driver-name {
    color: #ffffff;
  }

  .td__driver-date {
    color: #e5e5e5;
  }

  .td__driver-vehicle {
    color: #8e8e8e;
  }

  /* ---- 行程分组 / 左侧时间列 ---- */
  .td__route {
    color: #ffffff;
  }

  .td__time {
    color: #8e8e8e;
  }

  .td__time-tick {
    background: #4a4a4a;
  }

  /* ---- 连接线与圆点 ---- */
  .td__spine::before {
    background: #303030;
  }

  .td__dot {
    background: #262626;
  }

  .td__dot::after {
    background: #6b6b6b;
  }

  /* ---- 任务卡 ---- */
  .td__card {
    border-color: #303030;
    background: #1a1a1a;
  }

  .td__card-text {
    color: #e5e5e5;
  }

  .td__status {
    color: #8e8e8e;
  }

  .td__status--running {
    color: #ffffff;
  }

  .td__card--done {
    background: #1f1f1f;
  }

  .td__card--running {
    border-color: #4c7396;
    background: #16283c;
  }

  // 待执行在深色下与默认卡面同色，显式写出来避免以后改默认底色时跟着漂
  .td__card--pending {
    background: #1a1a1a;
  }

  .td__card--canceled {
    background: #141414;
  }

  .td__card--canceled .td__card-text {
    color: #5d5d5d;
  }

  /* ---- 底部备注 ---- */
  .td__note {
    border-color: #303030;
    background: #1a1a1a;
  }

  .td__note-text {
    color: #e5e5e5;
  }
}
</style>

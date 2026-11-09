<script setup lang="ts">
import type { TaskDetailPanelPayload } from "./types";

import { computed } from "vue";
import { useI18n } from "vue-i18n";

import closeIcon from "@/assets/img/task-detail-close.svg";
import { TASK_DETAIL_PANEL_STATUS_KEY } from "./types";

/**
 * 任务详情面板 —— 设计稿 6832:292「查看任务详情」。
 *
 * 版面（稿子按 812×375 横屏标注，元素直接用 px）：
 * - 蒙层：整屏 40% 黑（6832:306），点它关闭；
 * - 面板：右侧 368 宽、全高、白底（6832:295），内边距左右 20；
 * - 顶部：状态胶囊（6832:319，底 #ECF5FF 圆角 3）+ 标题 14px Medium（6832:302）+ 关闭 ✕（6832:314，#999）；
 * - 地点卡：328×70、底 #FBFBFB、圆角 6（6832:299）——站点（14px Medium）/ 作业内容 + 方量（12px）/ 右侧补充（12px 右对齐）；
 * - 时段卡：328×56、白底 + #F2F2F2 描边、圆角 6（6832:301）——「计划时段：」「当前进度：」（标签 #999 + 值 #1A1A1A）；
 * - 现场配合：标签（6832:312）+ 328×27 灰底行（6832:313）；
 * - 前后衔接：标签（6832:293）+ 上一程 / 下一程（6832:311/303、6832:300/318）。
 *
 * 两套版式，用视口方向切换（见文件末尾的 `(orientation: portrait)`）：
 * - 横屏（页面正常横屏，或横屏是用 CSS 旋转模拟的）→ 右侧抽屉；
 * - 竖屏 → 贴底弹层（稿子 1522:306「执行中」/ 1522:412「逾期未开始」，375×812）：
 *   全宽、顶部圆角 22、无拖拽条、高度由内容决定（不设 max-height，也就没有滚动条）、
 *   胶囊与关闭按钮一行、标题独占一行 16px、卡片带 #F2F2F2 描边、文本换行不截断。
 *   页面整体旋转模拟横屏时 `rotated = true`，此时视口虽然是竖的，但版面已经是横的，仍走右侧抽屉。
 */
defineOptions({ name: "AiTaskDetailPanel" });

const props = defineProps<{
  visible: boolean;
  detail: TaskDetailPanelPayload | null;
  /** 页面是否已用 CSS 旋转成横屏（竖屏视口 + 旋转时，版面仍是横的，弹窗保持侧边） */
  rotated?: boolean;
  /** 深色模式：与调度视图底板同步（页 #0D0D0D、卡 #1A1A1A + #303030 描边） */
  dark?: boolean;
}>();

const emit = defineEmits<{ "update:visible": [value: boolean] }>();

const { t } = useI18n();

const statusLabel = computed(() => (
  props.detail ? t(TASK_DETAIL_PANEL_STATUS_KEY[props.detail.status]) : ""
));

/**
 * 信息卡第二行的标签随状态变化（稿子 6832:292 / 6832:321）：
 * 执行中 →「当前进度：」，待执行 →「准备就绪：」；其余状态按语义补。
 * 存 i18n key，按当前语言翻译。
 */
const PROGRESS_KEY: Record<string, string> = {
  running: "task-progress-running",
  pending: "task-progress-pending",
  done: "task-progress-done",
  canceled: "task-progress-canceled",
  overdue: "task-progress-overdue",
};

const progressLabel = computed(() => {
  const status = props.detail?.status;
  return t((status && PROGRESS_KEY[status]) || "task-progress-running");
});

function close() {
  emit("update:visible", false);
}
</script>

<template>
  <view v-if="visible" class="tdp" :class="{ 'tdp--dark': dark ,'tdp--rotated': rotated }" >
    <!-- 蒙层：40% 黑，点击关闭（6832:306） -->
    <view class="tdp__mask" @tap="close" @touchstart.stop />

    <!-- 横屏：右侧抽屉（368 宽、全高、白底 6832:295）；竖屏：贴底弹层（见样式里的 portrait 规则） -->
    <view class="tdp__panel">
      <!-- 顶部：状态胶囊 + 车号|车型|司机 + 关闭（6832:334 / 6832:326 / 6832:347）；
           竖屏里胶囊与关闭在上一行、标题独占下一行（1522:376 / 1522:310 / 1522:378） -->
      <view class="tdp__head">
        <view class="tdp__status" :class="`tdp__status--${detail?.status}`">
          {{ statusLabel }}
        </view>
        <text class="tdp__title">
          {{ detail?.title }}
        </text>
        <view class="tdp__close" @tap="close">
          <!-- 关闭 ✕：ardot 设计稿 1522:310 导出的原图（26×26、#8E8E8E） -->
          <image class="tdp__close-icon" :src="closeIcon" mode="aspectFit" />
        </view>
      </view>

      <!-- 内容区：横屏抽屉里撑满标题栏以下的剩余高度并滚动；竖屏不滚动，面板高度由内容决定 -->
      <view class="tdp__body">
        <!-- 站点卡：328×70、底 #FBFBFB、圆角 6（横屏 6832:299；竖屏 1522:424，另加 #F2F2F2 描边）
             「第N车/共N车」在竖屏里排在第二行右端（1522:419），横屏在卡片右上角 ——
             DOM 只留一份，横屏用绝对定位摆在右上角，竖屏回到第二行（见样式） -->
        <view class="tdp__site">
          <view class="tdp__site-top">
            <text class="tdp__site-name">
              {{ detail?.site }}
            </text>
          </view>
          <view class="tdp__site-bottom">
            <text class="tdp__site-work">
              {{ detail?.workType }}
            </text>
            <text class="tdp__site-volume">
              {{ [detail?.spec, detail?.volume].filter(Boolean).join(" ") }}
            </text>
            <text class="tdp__site-note">
              {{ detail?.supplyNote }}
            </text>
          </view>
        </view>

        <!-- 逾期警告：仅「逾期未开始」有（样本 4：计划未开始（逾期 5 分钟）+ 说明） -->
        <view v-if="detail?.warning" class="tdp__warning">
          <view class="tdp__warning-head">
            <view class="tdp__warning-icon" />
            <text class="tdp__warning-title">
              {{ detail.warning.title }}
            </text>
          </view>
          <text class="tdp__warning-text">
            {{ detail.warning.text }}
          </text>
        </view>

        <!-- 时段 / 进度卡（6832:301）；逾期时「当前进度」由警告块替代 -->
        <view class="tdp__info">
          <view class="tdp__row">
            <text class="tdp__label tdp__label--wide">{{ t("task-plan-period") }}</text>
            <text class="tdp__value">
              {{ detail?.planTime }}
            </text>
          </view>
          <view v-if="!detail?.warning" class="tdp__row">
            <text class="tdp__label tdp__label--wide">
              {{ progressLabel }}
            </text>
            <text class="tdp__value">
              {{ detail?.progress }}
            </text>
          </view>
        </view>

        <!-- 现场配合（6832:312 标签 + 6832:313 行，前面可带一个小图标） -->
        <text class="tdp__section">{{ t("task-section-support") }}</text>
        <view class="tdp__support">
          <text v-if="detail?.supportIcon" class="tdp__support-icon">
            {{ detail.supportIcon }}
          </text>
          <text class="tdp__support-text">
            {{ detail?.support }}
          </text>
        </view>

        <!-- 前后衔接（6832:293 标签 + 上一程 / 下一程） -->
        <text class="tdp__section">{{ t("task-section-route") }}</text>
        <view class="tdp__row">
          <text class="tdp__label">{{ t("task-leg-previous") }}</text>
          <text class="tdp__value">
            {{ detail?.previous }}
          </text>
        </view>
        <view class="tdp__row">
          <text class="tdp__label">{{ t("task-leg-next") }}</text>
          <text class="tdp__value">
            {{ detail?.next }}
          </text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 稿子按 812×375 横屏标注，这里用 px 直接对应（页面本身就是横屏坐标系） */
.tdp {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
}

.tdp__mask {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.4);
}

/* 面板（横屏右侧抽屉）：368 宽 + 全高，内容左右各留 20（464-444=20，与稿子一致） */
.tdp__panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 368px;
  padding: 26px 20px 0;
  background: #ffffff;
}

/* 内容区：撑满标题栏以下的高度，内容比一屏长时滚动，不挤压顶部标题栏 */
.tdp__body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* 顶部一行：胶囊 + 标题 + 关闭；标题折行时这一行跟着长高 */
.tdp__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
}

/* 状态胶囊：底 #ECF5FF、圆角 3、12px Medium（6832:319） */
.tdp__status {
  flex-shrink: 0;
  padding: 1px 4px;
  border-radius: 3px;
  background: #ecf5ff;
  font-size: 12px;
  font-weight: 500;
  line-height: 15px;
  color: #1a1a1a;
}

/* 已完成：灰底 */
.tdp__status--done {
  background: #f0f0f0;
  color: #666666;
}

/* 待执行：淡紫底（样本 3） */
.tdp__status--pending {
  background: #f1ecff;
  color: #6b5ae0;
}

/* 已取消：灰底灰字 */
.tdp__status--canceled {
  background: #f4f4f4;
  color: #999999;
}

/* 逾期未开始：白底 + #D9D9D9 描边（样本 4） */
.tdp__status--overdue {
  padding: 0 3px;
  border: 1px solid #d9d9d9;
  background: #ffffff;
  color: #999999;
}

.tdp__close {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 26px;
  height: 26px;
}

.tdp__close:active {
  opacity: 0.6;
}

/* 关闭 ✕：设计稿导出的 26×26 矢量图（1522:310），不再用 CSS 画 */
.tdp__close-icon {
  display: block;
  width: 26px;
  height: 26px;
}

/* 顶部标题：车号|车型|司机（14px Medium，6832:302/326） */
.tdp__title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 17px;
  color: #000000;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 站点卡：底 #FBFBFB、圆角 6（6832:299 / 6832:333）。
   宽度跟随面板内容区（抽屉里正好 328），高度用 min-height：竖屏窄屏文字折行时卡片自然长高，不裁字 */
.tdp__site {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  width: 100%;
  min-height: 70px;
  margin-top: 4px;
  padding: 10px 16px;
  border-radius: 6px;
  background: #fbfbfb;
}

/* 横屏右侧补充定位在卡片右上角，所以这一行要给右上角的文字让出宽度 */
.tdp__site-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-right: 76px;
}

.tdp__site-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 17px;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tdp__site-bottom {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.tdp__site-work {
  font-size: 12px;
  line-height: 15px;
  color: #1a1a1a;
}

.tdp__site-volume {
  font-size: 12px;
  font-weight: 500;
  line-height: 15px;
  color: #999999;
}

/* 右侧补充（第N车/共N车）：横屏贴在卡片右上角；竖屏回到第二行右端（见文件末尾 portrait 规则） */
.tdp__site-note {
  position: absolute;
  top: 17px;
  right: 16px;
  max-width: 55%;
  font-size: 12px;
  line-height: 15px;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 逾期提示块：白底 + #767676 虚线、圆角 6，宽 328 / 最小高 69（稿子 6832:381） */
.tdp__warning {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  box-sizing: border-box;
  width: 100%;
  min-height: 69px;
  margin-top: 10px;
  padding: 8px 12px;
  border: 1px dashed #767676;
  border-radius: 6px;
  background: #ffffff;
}

.tdp__warning-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 警告图标：12×12 圆圈 + 指针（纯 CSS 画，对应稿子里的小时钟） */
.tdp__warning-icon {
  position: relative;
  flex-shrink: 0;
  box-sizing: border-box;
  width: 12px;
  height: 12px;
  border: 1.5px solid #999999;
  border-radius: 50%;
}

.tdp__warning-icon::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 4px;
  width: 1.5px;
  height: 5px;
  background: #999999;
}

.tdp__warning-title {
  font-size: 12px;
  font-weight: 500;
  line-height: 15px;
  color: #1a1a1a;
}

.tdp__warning-text {
  font-size: 12px;
  line-height: 16px;
  color: #666666;
}

/* 时段 / 进度卡：宽 328 / 最小高 56、白底 + #F2F2F2 描边（6832:301） */
.tdp__info {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  min-height: 56px;
  margin-top: 10px;
  padding: 10px 16px;
  border: 1px solid #f2f2f2;
  border-radius: 6px;
  background: #ffffff;
}

.tdp__row {
  display: flex;
  align-items: center;
  min-width: 0;
}

.tdp__label {
  flex-shrink: 0;
  width: 48px;
  font-size: 12px;
  line-height: 15px;
  color: #999999;
}

/* 卡片里的标签宽 60（稿子 480 → 540，值从 540 起） */
.tdp__label--wide {
  width: 60px;
}

.tdp__value {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  line-height: 15px;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 分区标签：现场配合 / 前后衔接（6832:312 / 6832:293） */
.tdp__section {
  margin-top: 10px;
  font-size: 12px;
  line-height: 15px;
  color: #999999;
}

/* 现场配合行：#FBFBFB、圆角 6、最小高 27（6832:313） */
.tdp__support {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  min-height: 27px;
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: #fbfbfb;
}

.tdp__support-text {
  font-size: 12px;
  line-height: 15px;
  color: #000000;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 现场配合前置小图标（可选） */
.tdp__support-icon {
  flex-shrink: 0;
  margin-right: 6px;
  font-size: 12px;
  line-height: 15px;
}

/* 前后衔接两行：标签 48 + 值（稿子 464 → 512） */
.tdp__section + .tdp__row,
.tdp__support + .tdp__section + .tdp__row {
  margin-top: 6px;
}

.tdp__panel > .tdp__row + .tdp__row {
  margin-top: 6px;
}

/* ---------- 竖屏：右侧抽屉改成贴底弹层（稿子 1522:306 / 1522:412，375×812） ----------
   触发条件 = 视口竖屏 且 页面没有被 CSS 旋转成横屏（.tdp--rotated 排除掉旋转模拟横屏的情况）。
   横屏（原生转屏 / 桌面浏览器横向窗口 / 旋转模拟横屏）一律保持右侧抽屉。
   竖屏下所有尺寸都按 375 宽稿子标注：面板左右 24、顶 30、底 22（+ 安全区）。 */
@media (orientation: portrait) {
  /* 面板：贴底、全宽、圆角 22、高度自适应 —— 不设 max-height，内容多高面板多高，也就不出现滚动条 */
  .tdp:not(.tdp--rotated) .tdp__panel {
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
    width: auto;
    max-height: none;
    padding: 30px 24px calc(22px + env(safe-area-inset-bottom, 0px));
    border-radius: 22px 22px 0 0;
    box-shadow: 0 -2px 21px rgba(0, 0, 0, 0.06);
  }

  /* 内容区不再滚动，交给面板自身高度（1522:309 / 1522:432 高度都是内容撑出来的） */
  .tdp:not(.tdp--rotated) .tdp__body {
    flex: 0 0 auto;
    overflow: visible;
  }

  /* 顶部两行：胶囊 + 关闭在上一行（胶囊左、关闭右，1522:376 / 1522:310），标题独占下一行（1522:378） */
  .tdp:not(.tdp--rotated) .tdp__head {
    flex-wrap: wrap;
    align-items: center;
    gap: 0;
    min-height: 0;
  }

  /* 胶囊：12px / 行高 17，整体高 19（1522:376 / 1522:448） */
  .tdp:not(.tdp--rotated) .tdp__status {
    line-height: 17px;
  }

  /* 逾期未开始：白底 + #767676 虚线描边（样本 1522:448） */
  .tdp:not(.tdp--rotated) .tdp__status--overdue {
    border-color: #767676;
    border-style: dashed;
  }

  .tdp:not(.tdp--rotated) .tdp__close {
    margin-left: auto;
  }

  /* 标题：16px Medium / 23、与胶囊行间隔 8，折行显示（抽屉里是单行省略号，竖屏更窄，省略就看不出是哪台车） */
  .tdp:not(.tdp--rotated) .tdp__title {
    flex: 1 0 100%;
    order: 1;
    margin-top: 8px;
    font-size: 16px;
    line-height: 23px;
    color: #000000;
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    overflow-wrap: anywhere;
  }

  /* 站点卡：328×70、#FBFBFB + #F2F2F2 描边、圆角 6、内边距 16/14、两行间隔 3（1522:424 / 1522:383） */
  .tdp:not(.tdp--rotated) .tdp__site {
    min-height: 70px;
    margin-top: 10px;
    padding: 16px 16px 14px;
    border: 1px solid #f2f2f2;
    gap: 3px;
  }

  /* 竖屏里右侧补充不在右上角，回到第二行（1522:419），所以这一行不用再让出宽度 */
  .tdp:not(.tdp--rotated) .tdp__site-top {
    padding-right: 0;
  }

  .tdp:not(.tdp--rotated) .tdp__site-name {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    overflow-wrap: anywhere;
  }

  /* 第二行：作业内容 + 标号 + 方量，右侧补充靠右对齐；窄屏放不下时换行 */
  .tdp:not(.tdp--rotated) .tdp__site-bottom {
    flex-wrap: wrap;
    gap: 2px 8px;
  }

  .tdp:not(.tdp--rotated) .tdp__site-note {
    position: static;
    max-width: 60%;
    margin-left: auto;
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
  }

  /* 逾期提示块：328×69、虚线 #767676、圆角 6、内边距 10/16（1522:445） */
  .tdp:not(.tdp--rotated) .tdp__warning {
    margin-top: 6px;
    padding: 10px 16px;
    gap: 4px;
  }

  /* 竖屏稿子里提示块只有「已逾期N分钟」红字 + 说明，没有小时钟图标 */
  .tdp:not(.tdp--rotated) .tdp__warning-icon {
    display: none;
  }

  .tdp:not(.tdp--rotated) .tdp__warning-title {
    color: #c8201e;
  }

  /* 时段 / 进度卡：328×57、与站点卡间隔 8（1522:426） */
  .tdp:not(.tdp--rotated) .tdp__info {
    margin-top: 8px;
  }

  /* 分区标签「现场配合」距上一张卡 14，「前后衔接」距现场配合行 10（1522:398 / 1522:399） */
  .tdp:not(.tdp--rotated) .tdp__section {
    margin-top: 14px;
  }

  .tdp:not(.tdp--rotated) .tdp__support + .tdp__section {
    margin-top: 10px;
  }

  /* 现场配合行：328×27、#FBFBFB + #F2F2F2 描边、与标签间隔 4（1522:404） */
  .tdp:not(.tdp--rotated) .tdp__support {
    margin-top: 4px;
    border: 1px solid #f2f2f2;
  }

  /* 标签 + 值：值折行后与标签首行对齐，不再垂直居中；行距 4（1522:441 / 1522:416） */
  .tdp:not(.tdp--rotated) .tdp__row {
    align-items: flex-start;
  }

  .tdp:not(.tdp--rotated) .tdp__section + .tdp__row {
    margin-top: 4px;
  }

  .tdp:not(.tdp--rotated) .tdp__body > .tdp__row + .tdp__row {
    margin-top: 4px;
  }

  .tdp:not(.tdp--rotated) .tdp__value,
  .tdp:not(.tdp--rotated) .tdp__support-text {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    overflow-wrap: anywhere;
  }
}

/* ===== 深色主题：任务详情面板 =====
   与调度视图同一套材质（页 #0D0D0D、卡 #1A1A1A + 1px #303030）：尺寸 / 圆角 / 间距一律不动。
   状态胶囊保留各自语义色相，只把浅底色压成深底 + 亮字。 */
.tdp--dark {
  .tdp__panel {
    background: #0d0d0d;
  }

  .tdp__title {
    color: #ffffff;
  }

  .tdp__close-icon::before,
  .tdp__close-icon::after {
    background: #8e8e8e;
  }

  /* 站点卡 / 现场配合行 */
  .tdp__site,
  .tdp__support {
    background: #1a1a1a;
  }

  .tdp__site-name,
  .tdp__site-work,
  .tdp__site-note,
  .tdp__support-text {
    color: #e5e5e5;
  }

  .tdp__site-volume,
  .tdp__label,
  .tdp__section {
    color: #8e8e8e;
  }

  .tdp__value {
    color: rgb(255 255 255 / 85%);
  }

  /* 时段 / 进度卡 */
  .tdp__info {
    border-color: #303030;
    background: #1a1a1a;
  }

  /* 逾期提示：白底虚线 → 深底虚线 */
  .tdp__warning {
    border-color: #6b6b6b;
    background: #1a1a1a;
  }

  .tdp__warning-icon {
    border-color: #8e8e8e;
  }

  .tdp__warning-icon::after {
    background: #8e8e8e;
  }

  .tdp__warning-title {
    color: #e5e5e5;
  }

  .tdp__warning-text {
    color: #8e8e8e;
  }

  /* 状态胶囊：保留色相、压深底、提亮字 */
  .tdp__status {
    background: #16283c;
    color: #cfe4ff;
  }

  .tdp__status--done {
    background: #242424;
    color: #b3b3b3;
  }

  .tdp__status--pending {
    background: #241f3d;
    color: #c3b6ff;
  }

  .tdp__status--canceled {
    background: #1f1f1f;
    color: #6b6b6b;
  }

  .tdp__status--overdue {
    border-color: #4a4a4a;
    background: transparent;
    color: #8e8e8e;
  }
}

/* ===== 竖屏贴底弹层的深色 =====
   竖屏版式用的是 `.tdp:not(.tdp--rotated) .xxx`（三级选择器）声明亮色，
   上面 `.tdp--dark .xxx` 只有两级、打不过它，这里用同级选择器 + 更靠后的位置重写一遍。 */
@media (orientation: portrait) {
  .tdp--dark:not(.tdp--rotated) {
    /* 标题在竖屏里独占一行且是纯黑，深色下要转白 */
    .tdp__title {
      color: #ffffff;
    }

    /* 站点卡 / 现场配合行：竖屏给的是 #F2F2F2 亮描边，换成深色分隔色 */
    .tdp__site,
    .tdp__support {
      border-color: #303030;
    }

    /* 逾期提示标题：竖屏是 #C8201E 红字，深色底上按抽屉口径转灰 */
    .tdp__warning-title {
      color: #e5e5e5;
    }

    /* 逾期胶囊：竖屏的 #767676 虚线描边深色下过亮 */
    .tdp__status--overdue {
      border-color: #4a4a4a;
    }
  }
}

</style>

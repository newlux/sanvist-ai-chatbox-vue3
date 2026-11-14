<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import iconRightArrow from "@/assets/img/iocn-right-arrow.png";
import { isListenReportListened, openListenReportPage } from "@/utils/listen-report";

/**
 * 听汇报入口卡 —— Ardot 479:384「听汇报」卡片（父画板 479:152「日常运营助手-正在回答…」）。
 *
 * 版式（设计稿 px，1px = 2rpx，描边仍用 px）：
 *   卡片 315×104（= 375 页宽 − 左右各 30），圆角 16，**填充 visible=false（透明，只有描边）**，
 *   描边 1px 内描边三色标线性渐变：#AAAAAA 1.67% → #F2F2F2 44.16% → #AAAAAA 100%（近似对角走向）；
 *   内边距 18；
 *   标题行 20 高：「听汇报」14px Medium #0D0D0D + 间距 10 + 「已收听」徽标
 *     （12px #5D5D5D、底 #E9E9E9、圆角 4、内边距 1/6、高 19）+ 箭头（距卡片右边缘约 4.8）；
 *   标题行底 → 副标题顶 4：副标题 12px #8F8F8F（「1105早报，经营概览」）；
 *   副标题底 → 正文顶 10：正文 12px #000000（「设备运行、项目进展、异常动态，一次听明白。」）。
 *
 * 交互：整卡可点。点击把 date / language 写进「当前播报」再带 direct=1 起播报页
 * （逻辑在 utils/listen-report 的 openListenReportPage，与旧的一跳了之链路同一份）。
 *
 * 深色：设计稿没有深色稿，材质沿用同目录回复卡的一套（标题 #FFFFFF、次要文字 rgba(255,255,255,.45)、
 * 正文 rgba(255,255,255,.8)、徽标 8% 白底）；描边不跟浅色的灰阶，单独用蓝白渐变
 * #72BEFF 1.67% → #F9F9F9 44.16% → #72BEFF 100%（同一走向）。
 */
defineOptions({ name: "AiReportEntryCard" });

const props = defineProps({
  /** 播报业务日期（<WORK_REPORT date="…">），用于副标题的「MMDD早报」与已收听的判定 */
  date: { type: String, default: "" },
  /** 播报语言（<WORK_REPORT language="…">），点卡片时原样带给播报页 */
  language: { type: String, default: "" },
  /** 播报风格码（<REPORT_STYLE style="…">），点卡片时落库并作为 play 的 styleCode */
  styleCode: { type: String, default: "" },
  /** 深色模式：材质 / 文字一起切换 */
  dark: { type: Boolean, default: false },
});

const { t } = useI18n();

/** 2026-11-05 → 1105；不是标准日期就原样带上，避免副标题突然空掉 */
function formatMonthDay(value: string) {
  const raw = String(value || "").trim();
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
  if (!match) return raw;
  return `${match[2].padStart(2, "0")}${match[3].padStart(2, "0")}`;
}

const titleText = computed(() => t("nav-report"));
const subtitleText = computed(() => t("report-card-subtitle", { date: formatMonthDay(props.date) }));
const descText = computed(() => t("report-card-desc"));

/**
 * 徽标：只有该日期真的听过（播报页整段播完才落 storage）才显示「已收听」，
 * 没听过就整个标签不渲染 —— 不在卡片上留「未收听」这种负向提示。
 * 已收听状态写在 storage，所以回到本页时要重算一次：
 * 切 tab / 窗口重新聚焦都能覆盖到，卡片卸载时摘掉监听。
 */
const badgeRefreshToken = ref(0);
function refreshBadge() {
  badgeRefreshToken.value += 1;
}
onMounted(() => {
  document.addEventListener("visibilitychange", refreshBadge);
  window.addEventListener("focus", refreshBadge);
});
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", refreshBadge);
  window.removeEventListener("focus", refreshBadge);
});
const badgeText = computed(() => {
  void badgeRefreshToken.value;
  return isListenReportListened(props.date) ? t("overview-listened") : "";
});

function onTap() {
  openListenReportPage({ date: props.date, language: props.language, styleCode: props.styleCode });
}
</script>

<template>
  <!-- tap.stop：气泡根节点上的 @tap 是「分享多选」的勾选开关，别让点卡片同时触发勾选 -->
  <view class="report-entry" :class="{ 'report-entry--dark': dark }" @tap.stop="onTap">
    <!-- 479:385 听汇报 + 479:391 已收听徽标 + 479:389 右向箭头 -->
    <view class="report-entry__head">
      <text class="report-entry__title">
        {{ titleText }}
      </text>
      <!-- 只有已收听才出这个标签，未收听不展示 -->
      <text v-if="badgeText" class="report-entry__badge">
        {{ badgeText }}
      </text>
      <image class="report-entry__chevron" :src="iconRightArrow" mode="aspectFit" />
    </view>
    <!-- 479:388 1105早报，经营概览 / 479:386 设备运行、项目进展、异常动态，一次听明白。 -->
    <view class="report-entry__copy">
      <text class="report-entry__subtitle">
        {{ subtitleText }}
      </text>
      <text class="report-entry__desc">
        {{ descText }}
      </text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 479:387 Rectangle 6：315×104 → 宽度随容器（与设计稿 375 − 30×2 同口径），
   高度由 18 + 20 + 4 + 17 + 10 + 17 + 18 = 104 撑出，不写死 */
.report-entry {
  position: relative;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  gap: 8rpx; /* 标题行 → 副标题 4px */
  padding: 36rpx; /* 18px */
  border-radius: 32rpx; /* 16px */
}

/* 1px 渐变描边：设计稿里卡片填充 visible=false，只剩描边。
   用「渐变底 + mask 挖掉内容区」画 1px 环，不引入内描边颜色近似值。
   渐变走向取设计稿 gradientTransform（起点左下 → 终点右上，约 69.6°）；
   浅色色标保持设计原样 #AAAAAA → #F2F2F2 → #AAAAAA（蓝白那组只给深色用）。 */
.report-entry::before {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  padding: 1px;
  border-radius: 32rpx;
  background: linear-gradient(69.6deg, #aaaaaa 1.67%, #f2f2f2 44.16%, #aaaaaa 100%);
  content: "";
  pointer-events: none;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}

.report-entry:active {
  opacity: 0.85;
}

/* 标题行：479:385 + 479:391 + 479:389 同一行，垂直居中，行高 20px */
.report-entry__head {
  display: flex;
  align-items: center;
  gap: 20rpx; /* 标题右(90) → 徽标左(100) 10px */
  height: 40rpx; /* 20px */
  min-width: 0;
}

/* 479:385：14px / 20px / Medium / #0D0D0D */
.report-entry__title {
  flex: 0 1 auto;
  overflow: hidden;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
  color: #0d0d0d;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 479:391 Listen Button：底 #E9E9E9 / 圆角 4 / 内边距 1·6 / 文字 12px #5D5D5D */
.report-entry__badge {
  flex-shrink: 0;
  padding: 2rpx 12rpx; /* 1px · 6px */
  border-radius: 8rpx; /* 4px */
  background: #e9e9e9;
  font-size: 24rpx; /* 12px */
  font-weight: 400;
  line-height: 34rpx; /* 17px */
  color: #5d5d5d;
}

/* 479:389 Collapse 箭头：切图 iocn-right-arrow.png（40×43 @2x → 显示 20×21.5，
   与设计稿 Collapse 帧 21.41×20 同尺寸）。
   要求：箭头本体距卡片右边框 18px。
   卡片内边距就是 36rpx(18px)，即内容右边缘已在 18px 处；
   但切图本体在画布内右侧还有 13px(@2x)=6.5px 透明留白，所以再向右借 13rpx，
   让「看得见的箭头」右边缘正好压在 18px 这条线上。 */
.report-entry__chevron {
  flex-shrink: 0;
  width: 40rpx; /* 20px */
  height: 43rpx; /* 21.5px */
  margin-right: -13rpx; /* 抵消切图右侧 6.5px 透明留白，箭头本体距右边框 18px */
  margin-left: auto;
}

/* 副标题与正文：479:388 → 479:386 之间 10px */
.report-entry__copy {
  display: flex;
  flex-direction: column;
  gap: 20rpx; /* 10px */
  min-width: 0;
}

/* 479:388：12px / 17px / Regular / #8F8F8F */
.report-entry__subtitle {
  font-size: 24rpx;
  font-weight: 400;
  line-height: 34rpx;
  color: #8f8f8f;
}

/* 479:386：12px / 17px / Regular / #000000 */
.report-entry__desc {
  font-size: 24rpx;
  font-weight: 400;
  line-height: 34rpx;
  color: #000000;
  white-space: normal;
  word-break: break-word;
}

/* ===== 深色（设计稿无深色稿）：材质沿用气泡回复卡同一套，描边单独用蓝白渐变 ===== */
.report-entry--dark {
  /* 深色描边不用 #303030 那一档灰，按设计给的蓝白渐变来：
     #72BEFF 1.67% → #F9F9F9 44.16% → #72BEFF 100%，走向与浅色一致（69.6deg） */
  &::before {
    background: linear-gradient(69.6deg, #72beff 1.67%, #f9f9f9 44.16%, #72beff 100%);
  }

  .report-entry__title {
    color: #ffffff;
  }

  .report-entry__badge {
    background: rgba(255, 255, 255, 0.08);
    color: #8f8f8f;
  }

  /* 箭头切图是 #0D0D0D 纯色图形，深底上先压黑再反相成白，并压到 70% 不抢眼 */
  .report-entry__chevron {
    filter: brightness(0) invert(1);
    opacity: 0.7;
  }

  .report-entry__subtitle {
    color: rgba(255, 255, 255, 0.45);
  }

  .report-entry__desc {
    color: rgba(255, 255, 255, 0.8);
  }
}
</style>

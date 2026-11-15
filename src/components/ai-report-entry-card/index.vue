<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
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

/**
 * 描边渐变的唯一 id：描边改用内联 SVG 画，渐变必须用 url(#id) 引用，
 * 同一页可能同时挂多张听汇报卡，id 重复会让后者串用前者的渐变。
 * 这里用随机后缀而不是自增：`<script setup>` 的顶层代码每次实例化都会重跑一遍，
 * 写在 setup 里的计数器会被重置回同一个值，自增拿到的其实是重复 id。
 */
const outlineId = `report-entry-outline-${Math.random().toString(36).slice(2, 9)}`;

/**
 * 描边 SVG 的绘制尺寸：必须和卡片的实际像素尺寸严格相等（viewBox 用同一个值）。
 *
 * 这是 1px 描边实不实的决定性条件 —— viewBox 与实际渲染尺寸只要差一点，
 * rect 内缩的 0.5 就不再是半个 CSS 像素，1px 线落到亚像素上：直边被摊成两条淡线，
 * 圆角段每个像素的覆盖率都低，看着就断成虚点。
 * 卡片宽度是 rpx 换算出来的小数（如 327.6px），所以量一次实际像素尺寸、取整，
 * 再把 SVG 的宽高也钉成这个整数，x/y 的 0.5 才真正压在像素边界上、整条边满覆盖。
 */
const outlineBox = ref({ width: 315, height: 104 });
const outlineViewBox = computed(() => `0 0 ${outlineBox.value.width} ${outlineBox.value.height}`);
const outlineStyle = computed(() => ({
  width: `${outlineBox.value.width}px`,
  height: `${outlineBox.value.height}px`,
}));

/**
 * 描边渐变的两端点：设计稿是 69.6deg（左下 → 右上）。
 * viewBox 会跟着实测尺寸变，所以端点按宽高现算，保证角度始终 69.6°、
 * 端点正好卡在盒子对角外沿（与 CSS `linear-gradient(69.6deg, …)` 的取法一致）。
 */
const OUTLINE_ANGLE_RAD = (69.6 * Math.PI) / 180;
const outlineGradient = computed(() => {
  const { width, height } = outlineBox.value;
  const sin = Math.sin(OUTLINE_ANGLE_RAD);
  const cos = Math.cos(OUTLINE_ANGLE_RAD);
  const length = width * sin + height * cos;
  const dx = (sin * length) / 2;
  const dy = (cos * length) / 2;
  return {
    x1: width / 2 - dx,
    y1: height / 2 + dy,
    x2: width / 2 + dx,
    y2: height / 2 - dy,
  };
});
const cardRef = ref<HTMLElement | null>(null);

/** uni 的 view 在 H5 下是原生元素，但也可能拿到组件实例，两种都兜住 */
function resolveCardEl(): HTMLElement | null {
  const raw = cardRef.value as unknown as { $el?: HTMLElement } | HTMLElement | null;
  if (!raw) return null;
  const el = (raw as { $el?: HTMLElement }).$el ?? (raw as HTMLElement);
  return typeof HTMLElement !== "undefined" && el instanceof HTMLElement ? el : null;
}

/** 量一次并同步；量不到（未布局 / 隐藏）就保留上一次的值，不要把描边缩成 0 */
function syncOutlineBox() {
  const el = resolveCardEl();
  if (!el) return;
  // offsetWidth/Height 是整数且不受父级 transform 影响，正是 CSS 像素占位尺寸
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  if (!width || !height) return;
  if (outlineBox.value.width === width && outlineBox.value.height === height) return;
  outlineBox.value = { width, height };
}

let outlineObserver: ResizeObserver | null = null;
onMounted(() => {
  void nextTick(() => {
    syncOutlineBox();
    if (typeof ResizeObserver === "undefined") return;
    const el = resolveCardEl();
    if (!el) return;
    // 字体加载 / 换行 / 安全区变化都会改高度，跟着重量一次，描边才一直贴着像素边界
    outlineObserver = new ResizeObserver(syncOutlineBox);
    outlineObserver.observe(el);
  });
});
onBeforeUnmount(() => {
  outlineObserver?.disconnect();
  outlineObserver = null;
});

/** 2026-11-05 → 1105；不是标准日期就原样带上，避免副标题突然空掉 */
function formatMonthDay(value: string) {
  const raw = String(value || "").trim();
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
  if (!match) return raw;
  return `${match[2].padStart(2, "0")}${match[3].padStart(2, "0")}`;
}

/**
 * 描边三色标：浅色 #AAAAAA → #F2F2F2 → #AAAAAA，深色同走向换成 #72BEFF → #F9F9F9 → #72BEFF。
 * 色值与偏移（1.67% / 44.16% / 100%）都按设计稿原样保留，只换了画法。
 */
const outlineStops = computed(() => (props.dark
  ? ["#72beff", "#f9f9f9", "#72beff"]
  : ["#aaaaaa", "#f2f2f2", "#aaaaaa"]));
const outlineStroke = computed(() => `url(#${outlineId})`);

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
  <view ref="cardRef" class="report-entry" :class="{ 'report-entry--dark': dark }" @tap.stop="onTap">
    <!-- 479:387 的 1px 渐变描边：用内联 SVG 的 rect 画（矢量描边自带圆角，拐角不会像 mask 环那样断线）。
         设计稿矩形填充 visible=false、只有 1px 内描边，色标 #AAAAAA 1.67% → #F2F2F2 44.16% → #AAAAAA 100%，
         走向 69.6deg（左下 → 右上）；深色是同一走向的 #72BEFF → #F9F9F9 → #72BEFF。

         为什么还虚：1px 线实不实只取决于它压没压在像素边界上。
         viewBox 一旦和实际渲染尺寸不等（卡片宽度是 rpx 换算出来的小数），内缩的 0.5 就不是半像素，
         线落到亚像素上被抗锯齿摊薄 —— 直边还勉强连成一条淡线，圆角段每个像素的覆盖率都低，
         看着就是断续的虚点。所以这里：
         1) viewBox 用实测的整数像素尺寸，SVG 的宽高也钉成同一个整数，保证 1 个单位 = 1 个 CSS 像素；
         2) 显式 shape-rendering="geometricPrecision"，别让渲染器退回 optimizeSpeed 的跳像素路径；
         3) 1px 主描边下面垫一条 1.5px / 40% 的同色描边，把圆角段边缘的抗锯齿补实
            （直边只多出 0.25px 的淡边，肉眼不可辨；颜色与走向保持不变）。 -->
    <svg
      class="report-entry__outline"
      :viewBox="outlineViewBox"
      :style="outlineStyle"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          :id="outlineId"
          gradientUnits="userSpaceOnUse"
          :x1="outlineGradient.x1"
          :y1="outlineGradient.y1"
          :x2="outlineGradient.x2"
          :y2="outlineGradient.y2"
        >
          <stop offset="1.67%" :stop-color="outlineStops[0]" />
          <stop offset="44.16%" :stop-color="outlineStops[1]" />
          <stop offset="100%" :stop-color="outlineStops[2]" />
        </linearGradient>
      </defs>
      <!-- 抗锯齿补偿层：同色、加宽到 1.5px、压到 40%，只用来填实圆角边缘的半透明像素 -->
      <rect
        x="0.5"
        y="0.5"
        :width="outlineBox.width - 1"
        :height="outlineBox.height - 1"
        rx="15.5"
        ry="15.5"
        fill="none"
        :stroke="outlineStroke"
        stroke-width="1.5"
        stroke-opacity="0.4"
        shape-rendering="geometricPrecision"
      />
      <!-- 主描边：设计值 1px、100% 不透明，颜色/走向与设计稿一致 -->
      <rect
        x="0.5"
        y="0.5"
        :width="outlineBox.width - 1"
        :height="outlineBox.height - 1"
        rx="15.5"
        ry="15.5"
        fill="none"
        :stroke="outlineStroke"
        stroke-width="1"
        shape-rendering="geometricPrecision"
      />
    </svg>
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
   之前用「渐变底 + mask 挖掉内容区」画环，圆角处外框/内洞两层抗锯齿相减会在拐角断成虚线，
   改成内联 SVG 的 rect 描边：矢量路径的圆角是连续曲线，1px 环整圈不断，颜色/走向不变。
   描边层绝对定位铺满卡片、不吃事件，卡片本身保持透明（不填色，不遮页面背景）。 */
.report-entry__outline {
  position: absolute;
  inset: 0;
  /* 宽高由 JS 按实测整数像素写进 inline style（outlineStyle），不在这里写 100%：
     必须是整数、且与 viewBox 相等，1 个单位才等于 1 个 CSS 像素，1px 描边才能压满像素行 */
  overflow: visible;
  pointer-events: none;
  /* 强制走高质量抗锯齿路径：默认的 auto 在部分 WebView 会退化成跳像素绘制，1px 曲线就断成虚线 */
  shape-rendering: geometricPrecision;
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
     #72BEFF 1.67% → #F9F9F9 44.16% → #72BEFF 100%，走向与浅色一致（69.6deg）。
     描边已改成 SVG，色标由模板里的 outlineStops 按 dark 切换，这里不再覆盖 ::before */

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

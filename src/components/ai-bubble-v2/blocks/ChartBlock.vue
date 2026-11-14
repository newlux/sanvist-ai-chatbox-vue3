<script setup lang="ts">
import type { EChartsType } from "echarts/core";
import type { Ref } from "vue";
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, toRaw, unref, watch } from "vue";
import { useVerticalScrollGesture } from "@/hooks/useVerticalScrollGesture";
import { clone, init } from "@/utils/echarts";
import { createLogger } from "@/utils/logger";

defineOptions({ name: "ChartBlock" });

const props = defineProps({
  blockId: { type: [String, Number], required: true },
  option: { type: Object, default: null },
  layout: { type: Object, default: null },
  embedded: { type: Boolean, default: false },
});

/**
 * 深色：跟随 AI 气泡主题（与 TableBlock / SuggestionBlock 同一套取法）。
 * 图表文字（标题 / 图例 / 坐标轴刻度与轴名 / 柱顶数值）统一按主题取色：
 * 浅色 #0d0d0d，深色 #ffffff；
 * 网格横线与轴线：浅色 #0d0d0d33，深色 #ffffff33。
 */
const bubbleDark = inject<Ref<boolean> | null>("ai-bubble-dark", null);
const isDark = computed(() => Boolean(bubbleDark ? unref(bubbleDark) : false));
const textColor = computed(() => (isDark.value ? "#ffffff" : "#0d0d0d"));
const lineColor = computed(() => (isDark.value ? "#ffffff33" : "#0d0d0d33"));

const logger = createLogger("chart");
const chartRoot = ref<unknown>(null);
useVerticalScrollGesture(chartRoot);
const chartEl = ref<unknown>(null);
const chartWidth = ref(320);
const failed = ref(false);

let chart: EChartsType | null = null;
let renderTimer: ReturnType<typeof setTimeout> | null = null;
let resizeObserver: ResizeObserver | null = null;
let windowResizeHandler: (() => void) | null = null;
let sizeRetry = 0;
let disposed = false;
let textMeasureContext: CanvasRenderingContext2D | null | undefined;

const MAX_SIZE_RETRY = 8;
/** 分类轴每项默认占用宽度；兼顾移动端可读性和横向滑动距离。 */
const DEFAULT_CATEGORY_WIDTH = 96;
const MIN_CATEGORY_WIDTH = 72;
const DEFAULT_FONT_SIZE = 11;
const DEFAULT_FONT_FAMILY = "sans-serif";
const DEFAULT_GRID_SIDE = 16;
const DEFAULT_GRID_TOP = 12;
const DEFAULT_GRID_BOTTOM = 24;
const DEFAULT_AXIS_NAME_GAP = 24;
const TITLE_VERTICAL_PADDING = 8;
const LEGEND_LINE_HEIGHT = 20;
const LEGEND_ITEM_MIN_WIDTH = 64;
const AXIS_NAME_TOP_SPACE = 12;
const EMBEDDED_MIN_HEIGHT = "280px";

interface ChartLayout {
  minHeight?: string;
  categoryWidth?: number;
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: any) {
  return String(value?.value ?? value ?? "");
}

function estimateTextWidth(
  text: unknown,
  fontSize = DEFAULT_FONT_SIZE,
  fontFamily = DEFAULT_FONT_FAMILY,
  fontWeight: string | number = "normal",
) {
  const content = String(text ?? "");
  if (typeof document !== "undefined") {
    if (textMeasureContext === undefined)
      textMeasureContext = document.createElement("canvas").getContext("2d");
    if (textMeasureContext) {
      textMeasureContext.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
      return textMeasureContext.measureText(content).width;
    }
  }
  return [...content].reduce((width, char) => {
    return width + (char.charCodeAt(0) > 0xFF ? fontSize : fontSize * 0.58);
  }, 0);
}

function longestLineWidth(text: unknown, textStyle: Record<string, any> = {}) {
  const fontSize = Number(textStyle.fontSize) || DEFAULT_FONT_SIZE;
  const fontFamily = textStyle.fontFamily || DEFAULT_FONT_FAMILY;
  const fontWeight = textStyle.fontWeight || "normal";
  return Math.max(
    0,
    ...String(text ?? "")
      .split("\n")
      .map(line => estimateTextWidth(line, fontSize, fontFamily, fontWeight)),
  );
}

function normalizeSeries(series: any[], textColor: string) {
  return series.map((item) => {
    if (!item || typeof item !== "object") return item;
    const isBar = item.type === "bar";
    const baseLabel = isBar
      ? { show: true, position: "top", formatter: "{c}", ...item.label }
      : item.label;
    // 数值标签（柱顶数字等）颜色跟主题，不跟随系列配色，避免深底上看不见；
    // 落在柱体内部的标签保留原色（通常白字压在色块上）。
    const isInsideLabel = String(baseLabel?.position || "").startsWith("inside");
    const label = baseLabel && typeof baseLabel === "object" && !isInsideLabel
      ? { ...baseLabel, color: textColor }
      : baseLabel;
    const colors = Array.isArray(item.itemStyle?.color) ? [...item.itemStyle.color] : null;
    if (!colors?.length) return { ...item, label };

    const data = Array.isArray(item.data) ? item.data : [];
    return {
      ...item,
      label,
      itemStyle: { ...item.itemStyle, color: undefined },
      data: data.map((point: any, index: number) => {
        const pointStyle =
          point && typeof point === "object" && !Array.isArray(point) ? point.itemStyle : null;
        const itemStyle = { ...pointStyle, color: colors[index % colors.length] };
        return point && typeof point === "object" && !Array.isArray(point)
          ? { ...point, itemStyle }
          : { value: point, itemStyle };
      }),
    };
  });
}

function titleHeight(title: any) {
  return toArray(title).reduce((height, item) => {
    if (item?.show === false || !String(item?.text || "").trim()) return height;
    const textStyle = { fontSize: DEFAULT_FONT_SIZE + 2, ...item?.textStyle };
    const subtextStyle = { fontSize: DEFAULT_FONT_SIZE, ...item?.subtextStyle };
    const titleLines = String(item.text).split("\n").length;
    const subtext = String(item?.subtext || "").trim();
    const subtextLines = subtext ? subtext.split("\n").length : 0;
    return height + titleLines * (Number(textStyle.lineHeight) || Number(textStyle.fontSize) * 1.4)
      + subtextLines * (Number(subtextStyle.lineHeight) || Number(subtextStyle.fontSize) * 1.4)
      + TITLE_VERTICAL_PADDING;
  }, 0);
}

function legendHeight(legend: any, series: any[], chartWidth: number) {
  return toArray(legend).reduce((height, item) => {
    const names = Array.isArray(item?.data) ? item.data : series.map(seriesItem => seriesItem?.name).filter(Boolean);
    if (item?.show === false || !names.length) return height;
    const fontSize = Number(item?.textStyle?.fontSize) || DEFAULT_FONT_SIZE;
    const itemGap = Number(item?.itemGap) || 12;
    const totalWidth = names.reduce((sum, name) => sum + Math.max(
      LEGEND_ITEM_MIN_WIDTH,
      estimateTextWidth(name, fontSize) + 30,
    ), 0) + Math.max(0, names.length - 1) * itemGap;
    return height + Math.max(1, Math.ceil(totalWidth / Math.max(chartWidth, LEGEND_ITEM_MIN_WIDTH))) * LEGEND_LINE_HEIGHT;
  }, 0);
}

function normalizeTitle(title: any, textColor: string) {
  return toArray(title).map(item => ({
    ...item,
    left: item?.left ?? "center",
    top: 0,
    textStyle: {
      fontSize: DEFAULT_FONT_SIZE + 2,
      fontWeight: 600,
      overflow: "break",
      ...item?.textStyle,
      color: textColor,
    },
    subtextStyle: {
      fontSize: DEFAULT_FONT_SIZE,
      overflow: "break",
      ...item?.subtextStyle,
      color: textColor,
    },
  }));
}

function normalizeLegend(legend: any, top: number, textColor: string) {
  return toArray(legend).map(item => ({
    ...item,
    left: item?.left ?? "center",
    top,
    itemWidth: item?.itemWidth ?? 12,
    itemHeight: item?.itemHeight ?? 8,
    itemGap: item?.itemGap ?? 12,
    type: item?.type ?? "scroll",
    textStyle: {
      fontSize: DEFAULT_FONT_SIZE,
      overflow: "break",
      ...item?.textStyle,
      color: textColor,
    },
  }));
}

function resolveCategoryWidth(layout: ChartLayout | null | undefined) {
  return Math.max(MIN_CATEGORY_WIDTH, Number(layout?.categoryWidth) || DEFAULT_CATEGORY_WIDTH);
}

function normalizeCategoryAxis(axis: any, categoryWidth?: number) {
  if (!Array.isArray(axis?.data)) return axis;

  const axisLabel = axis.axisLabel || {};
  const fontSize = Number(axisLabel.fontSize) || DEFAULT_FONT_SIZE;
  const labelWidth = categoryWidth ? Math.max(48, categoryWidth - 16) : axisLabel.width;

  return {
    ...axis,
    axisLabel: {
      interval: 0,
      hideOverlap: false,
      overflow: "break",
      lineHeight: Math.ceil(fontSize * 1.35),
      ...axisLabel,
      ...(labelWidth ? { width: labelWidth } : {}),
      rotate: 0,
    },
  };
}

function isCategoryAxis(axis: any) {
  return axis?.type === "category" || Array.isArray(axis?.data);
}

/**
 * 富文本标签（axisLabel.rich / label.rich）里写死的 color 会盖掉外层 color，
 * 这里把每个片段一并刷成主题色，否则深色底上仍是后端给的深灰字。
 */
function themedRich(rich: any, textColor: string) {
  if (!rich || typeof rich !== "object") return rich;
  const next: Record<string, any> = {};
  Object.keys(rich).forEach((key) => {
    const style = rich[key];
    next[key] = style && typeof style === "object" ? { ...style, color: textColor } : style;
  });
  return next;
}

/**
 * 坐标轴文字（刻度标签 / 轴名）与线条（网格横线 / 轴线）统一跟主题取色。
 * 轴线的颜色改变后，未单独配置颜色的 axisTick 会一并跟随。
 * 底部（x 轴）刻度标签同样走 axisLabel.color：深色 #ffffff，浅色 #0d0d0d。
 */
function applyAxisTheme(axis: any, textColor: string, lineColor: string) {
  if (!axis || typeof axis !== "object") return axis;
  const axisLabel = { ...axis.axisLabel, color: textColor };
  if (axisLabel.rich) axisLabel.rich = themedRich(axisLabel.rich, textColor);
  return {
    ...axis,
    axisLabel,
    nameTextStyle: { ...axis.nameTextStyle, color: textColor },
    splitLine: { ...axis.splitLine, lineStyle: { ...axis.splitLine?.lineStyle, color: lineColor } },
    axisLine: { ...axis.axisLine, lineStyle: { ...axis.axisLine?.lineStyle, color: lineColor } },
  };
}

function axisLabelExtent(axis: any) {
  const labels = Array.isArray(axis?.data) ? axis.data.map(textOf) : [];
  if (!labels.length) return 0;
  return Math.max(...labels.map(label => longestLineWidth(label, axis.axisLabel)));
}

function axisBottomSpace(axis: any) {
  const labels = Array.isArray(axis?.data) ? axis.data.map(textOf) : [];
  const fontSize = Number(axis?.axisLabel?.fontSize) || DEFAULT_FONT_SIZE;
  const lineHeight = Number(axis?.axisLabel?.lineHeight) || Math.ceil(fontSize * 1.35);
  const labelWidth = Number(axis?.axisLabel?.width) || 0;
  const lineCount = (label: string) => {
    const explicitLines = label.split("\n");
    if (!labelWidth) return explicitLines.length;
    return explicitLines.reduce((count, line) => {
      return count + Math.max(1, Math.ceil(longestLineWidth(line, axis.axisLabel) / labelWidth));
    }, 0);
  };
  const labelHeight = lineHeight * Math.max(1, ...labels.map(lineCount));
  const axisNameSpace = String(axis?.name || "").trim()
    ? Number(axis?.nameGap) || DEFAULT_AXIS_NAME_GAP
    : 0;
  return Math.ceil(labelHeight + axisNameSpace + 12);
}

function resolveTopSpace(option: any, xAxes: any[], yAxes: any[], series: any[], chartWidth: number) {
  const titleSpace = titleHeight(option.title);
  const legendSpace = legendHeight(option.legend, series, chartWidth);
  const hasYAxisName = yAxes.some(axis => String(axis?.name || "").trim());
  const topAxes = xAxes.filter(axis => axis?.position === "top");
  const topAxisSpace = Math.max(0, ...topAxes.map(axisBottomSpace));
  const axisNameSpace = legendSpace && hasYAxisName ? AXIS_NAME_TOP_SPACE : 0;
  return Math.max(DEFAULT_GRID_TOP + titleSpace + legendSpace + axisNameSpace, topAxisSpace);
}

function createDefaultGrid(option: any, xAxes: any[], yAxes: any[], series: any[], chartWidth: number) {
  const leftAxes = yAxes.filter(axis => axis?.position !== "right");
  const rightAxes = yAxes.filter(axis => axis?.position === "right");
  const bottomAxes = xAxes.filter(axis => axis?.position !== "top");

  const requiredLeft = Math.max(
    DEFAULT_GRID_SIDE,
    ...leftAxes.map(
      axis => axisLabelExtent(axis) + (axis?.name ? DEFAULT_AXIS_NAME_GAP : 0) + 12,
    ),
  );
  const requiredRight = Math.max(
    DEFAULT_GRID_SIDE,
    ...rightAxes.map(
      axis => axisLabelExtent(axis) + (axis?.name ? DEFAULT_AXIS_NAME_GAP : 0) + 12,
    ),
  );
  const bottom = Math.max(DEFAULT_GRID_BOTTOM, ...bottomAxes.map(axisBottomSpace));

  return {
    top: resolveTopSpace(option, xAxes, yAxes, series, chartWidth),
    right: Math.ceil(requiredRight),
    bottom,
    // 额外预留刻度与画布边缘的安全距离，防止首位数字被裁切。
    left: Math.ceil(requiredLeft + 10),
    containLabel: false,
  };
}

function centerPolarSeries(series: any[]) {
  return series.map((item) => {
    if (!item || typeof item !== "object") return item;
    if (item.type !== "pie") return item;
    return { ...item, center: item.center ?? ["50%", "55%"] };
  });
}

/**
 * 将后端 option 转为稳定的展示配置：业务样式原样保留，仅补齐缺失的布局规则。
 * 默认内容以画布中线为基准；分类标签保持横向，通过画布宽度和动态边距完整展示。
 * 文字与线条颜色统一由主题决定（textColor / lineColor），不沿用后端配置里的固定色。
 */
function normalizeOption(
  raw: Record<string, any> | null,
  layout?: ChartLayout | null,
  width = 320,
  textColor = "#0d0d0d",
  lineColor = "#0d0d0d33",
) {
  if (!raw) return raw;
  const option = clone(toRaw(raw));
  const sourceSeries = Array.isArray(option.series) ? option.series : [];
  const sourceXAxes = toArray(option.xAxis);
  const sourceYAxes = toArray(option.yAxis);
  const categoryWidth = resolveCategoryWidth(layout);
  const xAxes = sourceXAxes.map(axis =>
    applyAxisTheme(normalizeCategoryAxis(axis, categoryWidth), textColor, lineColor));
  const yAxes = sourceYAxes.map(axis => applyAxisTheme(normalizeCategoryAxis(axis), textColor, lineColor));
  const series = centerPolarSeries(normalizeSeries(sourceSeries, textColor));

  const next: Record<string, any> = {
    ...option,
    series,
    textStyle: { ...option.textStyle, color: textColor },
  };

  if (option.title) {
    const title = normalizeTitle(option.title, textColor);
    next.title = Array.isArray(option.title) ? title : title[0];
  }
  const titleSpace = titleHeight(option.title);
  if (option.legend) {
    const legend = normalizeLegend(option.legend, titleSpace, textColor);
    next.legend = Array.isArray(option.legend) ? legend : legend[0];
  }
  if (option.xAxis) next.xAxis = Array.isArray(option.xAxis) ? xAxes : xAxes[0];
  if (option.yAxis) next.yAxis = Array.isArray(option.yAxis) ? yAxes : yAxes[0];
  if (option.xAxis || option.yAxis) {
    const defaultGrid = createDefaultGrid(option, xAxes, yAxes, series, width);
    if (!option.grid) {
      next.grid = defaultGrid;
    } else if (!Array.isArray(option.grid)) {
      next.grid = {
        ...option.grid,
        top: defaultGrid.top,
        right: Math.max(Number(option.grid.right) || 0, defaultGrid.right),
        bottom: Math.max(Number(option.grid.bottom) || 0, defaultGrid.bottom),
        left: Math.max(Number(option.grid.left) || 0, defaultGrid.left + 10),
        containLabel: true,
      };
    }
  }

  if (option.radar) {
    const radar = toArray(option.radar).map(item => ({
      ...item,
      center: item?.center ?? ["50%", "55%"],
      axisName: {
        overflow: "break",
        ...item?.axisName,
        color: textColor,
      },
    }));
    next.radar = Array.isArray(option.radar) ? radar : radar[0];
  }

  return next;
}

const chartLayout = computed(() => props.layout as ChartLayout | null);
const chartOption = computed(
  () => normalizeOption(props.option, chartLayout.value, chartWidth.value, textColor.value, lineColor.value),
);
const chartMinHeight = computed(
  () => chartLayout.value?.minHeight || (props.embedded ? EMBEDDED_MIN_HEIGHT : undefined),
);

function categoryAxis(option: any) {
  return toArray(option?.xAxis).find(isCategoryAxis) ?? toArray(option?.yAxis).find(isCategoryAxis);
}

function horizontalCategoryAxis(option: any) {
  return toArray(option?.xAxis).find(isCategoryAxis);
}

const chartMinWidth = computed(() => {
  const option = chartOption.value;
  const axis = horizontalCategoryAxis(option);
  const categories = Array.isArray(axis?.data) ? axis.data : [];
  if (!categories.length) return undefined;

  const categoryWidth = resolveCategoryWidth(chartLayout.value);
  const labelWidth = Number(axis?.axisLabel?.width) || categoryWidth;
  const labelWidths = categories.map((category: any) =>
    Math.min(labelWidth, longestLineWidth(textOf(category), axis.axisLabel)),
  );
  const slotsWidth = categories.length * categoryWidth;
  const grid = option?.grid && !Array.isArray(option.grid) ? option.grid : {};
  const gridLeft = typeof grid.left === "number" ? grid.left : DEFAULT_GRID_SIDE;
  const gridRight = typeof grid.right === "number" ? grid.right : DEFAULT_GRID_SIDE;
  const edgeSpace = Math.ceil(
    (labelWidths[0] || 0) / 2 + (labelWidths[labelWidths.length - 1] || 0) / 2,
  );

  return `${Math.ceil(gridLeft + slotsWidth + gridRight + edgeSpace)}px`;
});

function readSeriesValue(item: any) {
  if (item == null) return null;
  if (typeof item === "number" || typeof item === "string") return item;
  if (Array.isArray(item)) return item[item.length - 1];
  if (typeof item === "object") return item.value ?? null;
  return null;
}

function readSeriesLabel(item: any, index: number, categories: string[]) {
  if (item && typeof item === "object" && !Array.isArray(item) && item.name)
    return String(item.name);
  if (Array.isArray(item) && item.length > 1) return String(item[0]);
  return String(categories[index] ?? `#${index + 1}`);
}

function formatValue(value: unknown) {
  if (value == null || value === "") return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return String(Math.round(num * 100) / 100);
}

function readTitle(option: any) {
  const node = toArray(option?.title)[0];
  return String(node?.text || "").trim();
}

function readCategories(option: any) {
  const axis = categoryAxis(option);
  return toArray(axis?.data).map(textOf);
}

const fallbackSeries = computed(() => {
  const option = chartOption.value;
  if (!option) return [];
  const categories = readCategories(option);
  const series = Array.isArray(option.series) ? option.series : [];
  return series
    .map((item: any, seriesIndex: number) => {
      const data = Array.isArray(item?.data) ? item.data : [];
      const rows = data
        .map((point: any, index: number) => ({
          label: readSeriesLabel(point, index, categories),
          value: formatValue(readSeriesValue(point)),
        }))
        .filter((row: { value: string }) => row.value !== "");
      return {
        id: `series-${seriesIndex}`,
        name: String(item?.name || "").trim(),
        rows,
      };
    })
    .filter((item: { rows: unknown[] }) => item.rows.length);
});

const fallbackTitle = computed(() => readTitle(chartOption.value));
const hasFallbackData = computed(() => fallbackSeries.value.length > 0);

function getChartElement(): HTMLElement | null {
  const target = chartEl.value as { $el?: unknown } | null;
  const element = target?.$el ?? target;
  return typeof HTMLElement !== "undefined" && element instanceof HTMLElement ? element : null;
}

function renderDomChart() {
  const element = getChartElement();
  if (!element) {
    if (sizeRetry < MAX_SIZE_RETRY) {
      sizeRetry += 1;
      scheduleRenderChart();
    }
    return;
  }

  if (!element.clientWidth || !element.clientHeight) {
    if (sizeRetry < MAX_SIZE_RETRY) {
      sizeRetry += 1;
      scheduleRenderChart();
    } else {
      logger.warn("容器尺寸为 0，降级为数据清单");
      failed.value = true;
    }
    return;
  }

  sizeRetry = 0;
  chartWidth.value = element.clientWidth;
  if (!chart) chart = init(element);
  chart.setOption(chartOption.value, { notMerge: true, lazyUpdate: false, silent: true });
  chart.resize();
}

function renderChart() {
  if (disposed || !props.option) return;
  failed.value = false;
  try {
    renderDomChart();
  } catch (error) {
    logger.error("render failed", error);
    failed.value = true;
    chart?.dispose();
    chart = null;
  }
}

function scheduleRenderChart() {
  if (disposed) return;
  if (renderTimer) clearTimeout(renderTimer);
  void nextTick(() => {
    if (disposed) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderChart();
    }, 80);
  });
}

function disposeChart() {
  disposed = true;
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (windowResizeHandler) window.removeEventListener("resize", windowResizeHandler);
  windowResizeHandler = null;
  chart?.dispose();
  chart = null;
}

watch(() => props.option, scheduleRenderChart, { deep: true });
watch(chartOption, scheduleRenderChart);

onMounted(async () => {
  disposed = false;
  await nextTick();
  const element = getChartElement();
  if (typeof ResizeObserver !== "undefined" && element) {
    resizeObserver = new ResizeObserver(scheduleRenderChart);
    resizeObserver.observe(element);
  } else if (typeof window !== "undefined") {
    windowResizeHandler = scheduleRenderChart;
    window.addEventListener("resize", windowResizeHandler);
  }
  scheduleRenderChart();
});

onBeforeUnmount(disposeChart);
</script>

<template>
  <view
    ref="chartRoot"
    class="chart-block"
    :class="[{ 'chart-block--embedded': embedded, 'chart-block--dark': isDark }]"
  >
    <scroll-view
      v-show="!failed"
      class="chart-block__scroll"
      scroll-x
      :show-scrollbar="false"
      :style="{ minHeight: chartMinHeight }"
    >
      <view
        ref="chartEl"
        class="chart-block__canvas"
        :style="{ minWidth: chartMinWidth, minHeight: chartMinHeight }"
      />
    </scroll-view>
    <view v-if="failed && hasFallbackData" class="chart-block__data">
      <text v-if="fallbackTitle" class="chart-block__data-title">
        {{ fallbackTitle }}
      </text>
      <view v-for="series in fallbackSeries" :key="series.id" class="chart-block__data-series">
        <text v-if="series.name" class="chart-block__data-series-name">
          {{ series.name }}
        </text>
        <view v-for="(row, rowIndex) in series.rows" :key="rowIndex" class="chart-block__data-row">
          <text class="chart-block__data-label">
            {{ row.label }}
          </text>
          <text class="chart-block__data-value">
            {{ row.value }}
          </text>
        </view>
      </view>
    </view>
    <text v-else-if="failed" class="chart-block__fallback">
      图表暂无法展示
    </text>
  </view>
</template>

<style lang="scss" scoped>
.chart-block {
  width: 100%;
  margin-top: 24rpx;
  padding: 32rpx;
  box-sizing: border-box;
  border-radius: 20rpx;
  background: #fff;
}
.chart-block--embedded {
  padding: 0;
  border-radius: 0;
  background: transparent;
}
/* 深色：图表文字已改为 #ffffff，白底卡片会让文字看不见，跟随气泡走透明底 */
.chart-block--dark {
  background: transparent;
}
.chart-block--dark .chart-block__fallback,
.chart-block--dark .chart-block__data-series-name {
  color: rgba(255, 255, 255, 0.45);
}
.chart-block--dark .chart-block__data-title,
.chart-block--dark .chart-block__data-value {
  color: #ffffff;
}
.chart-block--dark .chart-block__data-label {
  color: rgba(255, 255, 255, 0.65);
}
.chart-block--dark .chart-block__data-row {
  border-bottom-color: rgba(255, 255, 255, 0.12);
}
.chart-block__scroll {
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
}
.chart-block__canvas {
  touch-action: pan-x !important;
  :deep(*) { touch-action: pan-x !important; }
  width: 100%;
  min-height: 280px;
  overflow: hidden;
  aspect-ratio: 4 / 3;
}
.chart-block--embedded .chart-block__scroll {
  min-height: 280px;
  aspect-ratio: 4 / 3;
}
.chart-block--embedded .chart-block__canvas {
  height: 100%;
  min-height: inherit;
  aspect-ratio: auto;
}
.chart-block__fallback {
  display: block;
  padding: 48rpx 0;
  color: #8a8f99;
  font-size: 26rpx;
  text-align: center;
}
.chart-block__data {
  display: flex;
  flex-direction: column;
  padding: 8rpx 0;
}
.chart-block__data-title {
  display: block;
  margin-bottom: 12rpx;
  color: #1a1a1a;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 40rpx;
}
.chart-block__data-series {
  display: flex;
  flex-direction: column;
  margin-bottom: 8rpx;
}
.chart-block__data-series-name {
  display: block;
  margin: 8rpx 0 4rpx;
  color: #8a8f99;
  font-size: 24rpx;
  line-height: 34rpx;
}
.chart-block__data-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10rpx 0;
  border-bottom: 1rpx solid #f0f1f3;
}
.chart-block__data-row:last-child {
  border-bottom: none;
}
.chart-block__data-label {
  flex: 1;
  min-width: 0;
  color: #4a4f57;
  font-size: 26rpx;
  line-height: 36rpx;
}
.chart-block__data-value {
  margin-left: 24rpx;
  color: #1a1a1a;
  font-size: 26rpx;
  font-weight: 600;
  line-height: 36rpx;
}
</style>

<script setup lang="ts">
import type { EChartsType } from "echarts/core";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  toRaw,
  watch,
} from "vue";
import { clone, init } from "@/utils/echarts";
import { createLogger } from "@/utils/logger";

defineOptions({ name: "ChartBlock" });

const props = defineProps({
  blockId: { type: [String, Number], required: true },
  option: { type: Object, default: null },
  layout: { type: Object, default: null },
  embedded: { type: Boolean, default: false },
});

const logger = createLogger("chart");
const chartEl = ref<unknown>(null);
const failed = ref(false);

let chart: EChartsType | null = null;
let renderTimer: ReturnType<typeof setTimeout> | null = null;
let resizeObserver: ResizeObserver | null = null;
let windowResizeHandler: (() => void) | null = null;
let sizeRetry = 0;
let disposed = false;
let textMeasureContext: CanvasRenderingContext2D | null | undefined;

const MAX_SIZE_RETRY = 8;
const MIN_CATEGORY_WIDTH = 64;
const CATEGORY_HORIZONTAL_PADDING = 32;
const DEFAULT_FONT_SIZE = 12;
const DEFAULT_FONT_FAMILY = "sans-serif";
const DEFAULT_GRID_SIDE = 16;
const DEFAULT_GRID_TOP = 24;
const DEFAULT_GRID_BOTTOM = 24;
const DEFAULT_AXIS_NAME_GAP = 32;
const TITLE_SPACE = 36;
const LEGEND_SPACE = 32;
const AXIS_NAME_TOP_SPACE = 16;
const EMBEDDED_MIN_HEIGHT = "240px";

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

function estimateTextWidth(text: unknown, fontSize = DEFAULT_FONT_SIZE, fontFamily = DEFAULT_FONT_FAMILY, fontWeight: string | number = "normal") {
  const content = String(text ?? "");
  if (typeof document !== "undefined") {
    if (textMeasureContext === undefined) textMeasureContext = document.createElement("canvas").getContext("2d");
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
  return Math.max(0, ...String(text ?? "").split("\n").map(line => estimateTextWidth(line, fontSize, fontFamily, fontWeight)));
}

function normalizeSeries(series: any[]) {
  return series.map((item) => {
    if (!item || typeof item !== "object") return item;
    const colors = Array.isArray(item.itemStyle?.color) ? [...item.itemStyle.color] : null;
    if (!colors?.length) return item;

    const data = Array.isArray(item.data) ? item.data : [];
    return {
      ...item,
      itemStyle: { ...item.itemStyle, color: undefined },
      data: data.map((point: any, index: number) => {
        const pointStyle = point && typeof point === "object" && !Array.isArray(point)
          ? point.itemStyle
          : null;
        const itemStyle = { ...pointStyle, color: colors[index % colors.length] };
        return point && typeof point === "object" && !Array.isArray(point)
          ? { ...point, itemStyle }
          : { value: point, itemStyle };
      }),
    };
  });
}

function normalizeTitle(title: any) {
  return toArray(title).map(item => ({
    ...item,
    left: item?.left ?? "center",
    textStyle: {
      overflow: "break",
      ...item?.textStyle,
    },
    subtextStyle: {
      overflow: "break",
      ...item?.subtextStyle,
    },
  }));
}

function normalizeLegend(legend: any) {
  return toArray(legend).map(item => ({
    ...item,
    left: item?.left ?? "center",
    top: item?.top ?? 12,
    type: item?.type ?? "scroll",
    textStyle: {
      overflow: "break",
      ...item?.textStyle,
    },
  }));
}

function normalizeCategoryAxis(axis: any) {
  if (!Array.isArray(axis?.data)) return axis;

  return {
    ...axis,
    axisLabel: {
      interval: 0,
      hideOverlap: false,
      overflow: "break",
      ...axis.axisLabel,
      rotate: 0,
    },
  };
}

function isCategoryAxis(axis: any) {
  return axis?.type === "category" || Array.isArray(axis?.data);
}

function axisLabelExtent(axis: any) {
  const labels = Array.isArray(axis?.data) ? axis.data.map(textOf) : [];
  if (!labels.length) return 0;
  return Math.max(...labels.map(label => longestLineWidth(label, axis.axisLabel)));
}

function axisBottomSpace(axis: any) {
  const labels = Array.isArray(axis?.data) ? axis.data.map(textOf) : [];
  const fontSize = Number(axis?.axisLabel?.fontSize) || DEFAULT_FONT_SIZE;
  const labelHeight = fontSize * Math.max(1, ...labels.map(label => label.split("\n").length));
  const axisNameSpace = String(axis?.name || "").trim()
    ? Number(axis?.nameGap) || DEFAULT_AXIS_NAME_GAP
    : 0;
  return Math.ceil(labelHeight + axisNameSpace + 12);
}

function isVisibleTitle(title: any) {
  return toArray(title).some(item => item?.show !== false && String(item?.text || "").trim());
}

function isVisibleLegend(legend: any, series: any[]) {
  const hasNamedSeries = series.some(item => String(item?.name || "").trim());
  return toArray(legend).some(item => item?.show !== false && (Array.isArray(item?.data) ? item.data.length > 0 : hasNamedSeries));
}

function resolveTopSpace(option: any, xAxes: any[], yAxes: any[], series: any[]) {
  const titleSpace = isVisibleTitle(option.title) ? TITLE_SPACE : 0;
  const legendSpace = isVisibleLegend(option.legend, series) ? LEGEND_SPACE : 0;
  const hasYAxisName = yAxes.some(axis => String(axis?.name || "").trim());
  const topAxes = xAxes.filter(axis => axis?.position === "top");
  const topAxisSpace = Math.max(0, ...topAxes.map(axisBottomSpace));
  const axisNameSpace = legendSpace && hasYAxisName ? AXIS_NAME_TOP_SPACE : 0;
  return Math.max(DEFAULT_GRID_TOP + titleSpace + legendSpace + axisNameSpace, topAxisSpace);
}

function createDefaultGrid(option: any, xAxes: any[], yAxes: any[], series: any[]) {
  const leftAxes = yAxes.filter(axis => axis?.position !== "right");
  const rightAxes = yAxes.filter(axis => axis?.position === "right");
  const bottomAxes = xAxes.filter(axis => axis?.position !== "top");

  const requiredLeft = Math.max(DEFAULT_GRID_SIDE, ...leftAxes.map(axis => axisLabelExtent(axis) + (axis?.name ? DEFAULT_AXIS_NAME_GAP : 0) + 12));
  const requiredRight = Math.max(DEFAULT_GRID_SIDE, ...rightAxes.map(axis => axisLabelExtent(axis) + (axis?.name ? DEFAULT_AXIS_NAME_GAP : 0) + 12));
  const horizontalInset = Math.ceil(Math.max(requiredLeft, requiredRight));
  const bottom = Math.max(DEFAULT_GRID_BOTTOM, ...bottomAxes.map(axisBottomSpace));

  return {
    top: resolveTopSpace(option, xAxes, yAxes, series),
    right: horizontalInset,
    bottom,
    left: horizontalInset,
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
 */
function normalizeOption(raw: Record<string, any> | null) {
  if (!raw) return raw;
  const option = clone(toRaw(raw));
  const sourceSeries = Array.isArray(option.series) ? option.series : [];
  const sourceXAxes = toArray(option.xAxis);
  const sourceYAxes = toArray(option.yAxis);
  const xAxes = sourceXAxes.map(normalizeCategoryAxis);
  const yAxes = sourceYAxes.map(normalizeCategoryAxis);
  const series = centerPolarSeries(normalizeSeries(sourceSeries));

  const next: Record<string, any> = { ...option, series };

  if (option.title) {
    const title = normalizeTitle(option.title);
    next.title = Array.isArray(option.title) ? title : title[0];
  }
  if (option.legend) {
    const legend = normalizeLegend(option.legend);
    next.legend = Array.isArray(option.legend) ? legend : legend[0];
  }
  if (option.xAxis) next.xAxis = Array.isArray(option.xAxis) ? xAxes : xAxes[0];
  if (option.yAxis) next.yAxis = Array.isArray(option.yAxis) ? yAxes : yAxes[0];
  if (option.xAxis || option.yAxis) {
    if (!option.grid) {
      next.grid = createDefaultGrid(option, xAxes, yAxes, series);
    }
    else if (!Array.isArray(option.grid) && option.grid.top == null) {
      // 后端显式给了 grid 但漏掉 top：补齐动态顶部空间，避免落到 ECharts 默认的 60px 造成大量留白
      next.grid = { ...option.grid, top: resolveTopSpace(option, xAxes, yAxes, series) };
    }
  }

  if (option.radar) {
    const radar = toArray(option.radar).map(item => ({
      ...item,
      center: item?.center ?? ["50%", "55%"],
      axisName: {
        overflow: "break",
        ...item?.axisName,
      },
    }));
    next.radar = Array.isArray(option.radar) ? radar : radar[0];
  }

  return next;
}

const chartOption = computed(() => normalizeOption(props.option));
const chartLayout = computed(() => props.layout as ChartLayout | null);
const chartMinHeight = computed(() => chartLayout.value?.minHeight || (props.embedded ? EMBEDDED_MIN_HEIGHT : undefined));

function categoryAxis(option: any) {
  return toArray(option?.xAxis).find(isCategoryAxis)
    ?? toArray(option?.yAxis).find(isCategoryAxis);
}

function horizontalCategoryAxis(option: any) {
  return toArray(option?.xAxis).find(isCategoryAxis);
}

const chartMinWidth = computed(() => {
  const option = chartOption.value;
  const axis = horizontalCategoryAxis(option);
  const categories = Array.isArray(axis?.data) ? axis.data : [];
  if (!categories.length) return undefined;

  const categoryWidth = Math.max(MIN_CATEGORY_WIDTH, Number(chartLayout.value?.categoryWidth) || 0);
  const labelWidths = categories.map((category: any) => longestLineWidth(textOf(category), axis.axisLabel));
  const slotsWidth = labelWidths.reduce((total: number, textWidth: number) => {
    return total + Math.max(categoryWidth, Math.ceil(textWidth) + CATEGORY_HORIZONTAL_PADDING);
  }, 0);
  const grid = option?.grid && !Array.isArray(option.grid) ? option.grid : {};
  const gridLeft = typeof grid.left === "number" ? grid.left : DEFAULT_GRID_SIDE;
  const gridRight = typeof grid.right === "number" ? grid.right : DEFAULT_GRID_SIDE;
  const edgeSpace = Math.ceil((labelWidths[0] || 0) / 2 + (labelWidths[labelWidths.length - 1] || 0) / 2);

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
  if (item && typeof item === "object" && !Array.isArray(item) && item.name) return String(item.name);
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
    }
    else {
      logger.warn("容器尺寸为 0，降级为数据清单");
      failed.value = true;
    }
    return;
  }

  sizeRetry = 0;
  if (!chart) chart = init(element);
  chart.setOption(chartOption.value, { notMerge: true, lazyUpdate: false, silent: true });
  chart.resize();
}

function renderChart() {
  if (disposed || !props.option) return;
  failed.value = false;
  try {
    renderDomChart();
  }
  catch (error) {
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

onMounted(async () => {
  disposed = false;
  await nextTick();
  const element = getChartElement();
  if (typeof ResizeObserver !== "undefined" && element) {
    resizeObserver = new ResizeObserver(scheduleRenderChart);
    resizeObserver.observe(element);
  }
  else if (typeof window !== "undefined") {
    windowResizeHandler = scheduleRenderChart;
    window.addEventListener("resize", windowResizeHandler);
  }
  scheduleRenderChart();
});

onBeforeUnmount(disposeChart);
</script>

<template>
  <view class="chart-block" :class="[{ 'chart-block--embedded': embedded }]">
    <scroll-view
      v-show="!failed"
      class="chart-block__scroll"
      scroll-x
      :show-scrollbar="false"
      :style="{ minHeight: chartMinHeight }"
    >
      <view ref="chartEl" class="chart-block__canvas" :style="{ minWidth: chartMinWidth, minHeight: chartMinHeight }" />
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
.chart-block { width: 100%; padding: 32rpx; box-sizing: border-box; border-radius: 20rpx; background: #fff; }
.chart-block--embedded { padding: 0; border-radius: 0; background: transparent; }
.chart-block__scroll { width: 100%; overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; }
.chart-block__canvas { width: 100%; overflow: hidden; aspect-ratio: 3 / 2; }
.chart-block--embedded .chart-block__scroll { aspect-ratio: 4 / 3; }
.chart-block--embedded .chart-block__canvas { height: 100%; min-height: inherit; aspect-ratio: auto; }
.chart-block__fallback { display: block; padding: 48rpx 0; color: #8a8f99; font-size: 26rpx; text-align: center; }
.chart-block__data { display: flex; flex-direction: column; padding: 8rpx 0; }
.chart-block__data-title { display: block; margin-bottom: 12rpx; color: #1a1a1a; font-size: 28rpx; font-weight: 600; line-height: 40rpx; }
.chart-block__data-series { display: flex; flex-direction: column; margin-bottom: 8rpx; }
.chart-block__data-series-name { display: block; margin: 8rpx 0 4rpx; color: #8a8f99; font-size: 24rpx; line-height: 34rpx; }
.chart-block__data-row { display: flex; align-items: center; justify-content: space-between; padding: 10rpx 0; border-bottom: 1rpx solid #f0f1f3; }
.chart-block__data-row:last-child { border-bottom: none; }
.chart-block__data-label { flex: 1; min-width: 0; color: #4a4f57; font-size: 26rpx; line-height: 36rpx; }
.chart-block__data-value { margin-left: 24rpx; color: #1a1a1a; font-size: 26rpx; font-weight: 600; line-height: 36rpx; }
</style>

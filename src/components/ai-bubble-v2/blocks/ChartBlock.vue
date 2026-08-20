<script setup>
import * as echarts from "echarts";
import {
  computed,
  getCurrentInstance,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  toRaw,
  watch,
} from "vue";
import {
  dispatchAlipayChartTouch,
  initAlipayEcharts,
  queryAlipayChartCanvas,
} from "@/utils/platform/alipay-echarts";

defineOptions({ name: "ChartBlock" });

const props = defineProps({
  blockId: { type: [String, Number], required: true },
  option: { type: Object, default: null },
  embedded: { type: Boolean, default: false },
});

const instance = getCurrentInstance();
const failed = ref(false);
const canvasId = computed(() => `c-${String(props.blockId).replace(/[^\w-]/g, "-")}`);

let chart = null;
let renderTimer = null;
let sizeRetry = 0;
let disposed = false;
const MAX_SIZE_RETRY = 8;

/**
 * 将后端透传的 option 转换为 ECharts 可直接消费的纯净对象。
 * - 用 Vue 的 toRaw 剥离响应式 Proxy，再借助 ECharts 官方的 clone 深拷贝，
 *   避免 ECharts 内部遍历配置时访问 Proxy 触发 getter 异常。
 * - 若 itemStyle.color 是数组（如 ["#5470c6","#fac858"]），转成每个数据项各自的颜色。
 */
function normalizeOption(raw) {
  if (!raw) return raw;
  const option = echarts.util.clone(toRaw(raw));

  const series = Array.isArray(option.series) ? option.series : [];
  const normalizedSeries = series.map((s) => {
    if (!s || typeof s !== "object") return s;
    const colors = Array.isArray(s.itemStyle?.color) ? [...s.itemStyle.color] : null;
    if (!colors) return s;
    const data = Array.isArray(s.data) ? s.data : [];
    return {
      ...s,
      itemStyle: { ...s.itemStyle, color: undefined },
      data: data.map((item, index) => ({
        value: item,
        itemStyle: { color: colors[index % colors.length] },
      })),
    };
  });

  const next = { ...option, series: normalizedSeries };

  if (!props.embedded) return next;

  const hasPie = normalizedSeries.some(s => s && s.type === "pie");
  const hasCartesian = normalizedSeries.some(s => s && (s.type === "bar" || s.type === "line"));
  if (hasPie) {
    next.series = normalizedSeries.map(s => (s && s.type === "pie"
      ? { ...s, center: ["50%", "58%"], radius: ["29%", "48%"] }
      : s));
  }
  if (hasCartesian) {
    next.grid = {
      ...(option.grid && !Array.isArray(option.grid) ? option.grid : {}),
      top: 76,
      right: 12,
      bottom: 30,
      left: 12,
      containLabel: true,
    };
  }
  return next;
}

const chartOption = computed(() => normalizeOption(props.option));

/** 系列里可能是 5 / {value:5} / [x, y] 三种写法，统一取出可展示的数值 */
function readSeriesValue(item) {
  if (item == null) return null;
  if (typeof item === "number" || typeof item === "string") return item;
  if (Array.isArray(item)) return item[item.length - 1];
  if (typeof item === "object") return item.value ?? null;
  return null;
}

function readSeriesLabel(item, index, categories) {
  if (item && typeof item === "object" && !Array.isArray(item) && item.name) return String(item.name);
  if (Array.isArray(item) && item.length > 1) return String(item[0]);
  return String(categories[index] ?? `#${index + 1}`);
}

function formatValue(value) {
  if (value == null || value === "") return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return String(Math.round(num * 100) / 100);
}

function readTitle(option) {
  const title = option?.title;
  const node = Array.isArray(title) ? title[0] : title;
  return String(node?.text || "").trim();
}

function readCategories(option) {
  const axis = Array.isArray(option?.xAxis) ? option.xAxis[0] : option?.xAxis;
  const yAxis = Array.isArray(option?.yAxis) ? option.yAxis[0] : option?.yAxis;
  const data = Array.isArray(axis?.data) ? axis.data : (Array.isArray(yAxis?.data) ? yAxis.data : []);
  return data.map(item => String(item?.value ?? item ?? ""));
}

/**
 * 画布拿不到时的降级视图：把 option 直接摊成「系列 - 分类 - 数值」清单。
 * 图表是锦上添花，数据本身不能因为渲染环境而丢掉。
 */
const fallbackSeries = computed(() => {
  const option = chartOption.value;
  if (!option) return [];
  const categories = readCategories(option);
  const series = Array.isArray(option.series) ? option.series : [];
  return series
    .map((item, seriesIndex) => {
      const data = Array.isArray(item?.data) ? item.data : [];
      const rows = data
        .map((point, index) => ({
          label: readSeriesLabel(point, index, categories),
          value: formatValue(readSeriesValue(point)),
        }))
        .filter(row => row.value !== "");
      return {
        id: `series-${seriesIndex}`,
        name: String(item?.name || "").trim(),
        rows,
      };
    })
    .filter(item => item.rows.length);
});

const fallbackTitle = computed(() => readTitle(chartOption.value));
const hasFallbackData = computed(() => fallbackSeries.value.length > 0);

function applyOption(target) {
  target.setOption(chartOption.value, { notMerge: true, lazyUpdate: false, silent: true });
}

async function renderMiniChart() {
  if (chart) {
    applyOption(chart);
    return;
  }
  const queried = await queryAlipayChartCanvas(canvasId.value, instance);
  if (disposed) return;
  if (!queried) {
    if (sizeRetry < MAX_SIZE_RETRY) {
      sizeRetry += 1;
      scheduleRenderChart();
    } else {
      console.warn("[ChartBlock] 取不到 canvas 节点，降级为数据清单", canvasId.value);
      failed.value = true;
    }
    return;
  }
  sizeRetry = 0;
  chart = initAlipayEcharts(queried.canvas, queried.width, queried.height, queried.dpr);
  applyOption(chart);
}

async function renderChart() {
  if (disposed || !props.option || !echarts?.init) return;
  failed.value = false;
  try {
    await renderMiniChart();
  } catch (error) {
    console.error("[ChartBlock] render failed", error);
    failed.value = true;
    if (chart) {
      chart.dispose();
      chart = null;
    }
  }
}

function scheduleRenderChart() {
  if (disposed) return;
  if (renderTimer) clearTimeout(renderTimer);
  void nextTick(() => {
    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderChart();
    }, 80);
  });
}

function disposeChart() {
  disposed = true;
  if (renderTimer) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }
  if (chart) {
    chart.dispose();
    chart = null;
  }
}

function onCanvasTouchStart(event) {
  if (chart) dispatchAlipayChartTouch(chart, "mousedown", event);
}

function onCanvasTouchMove(event) {
  if (chart) dispatchAlipayChartTouch(chart, "mousemove", event);
}

function onCanvasTouchEnd(event) {
  if (!chart) return;
  dispatchAlipayChartTouch(chart, "mouseup", event);
  dispatchAlipayChartTouch(chart, "click", event);
}

watch(() => props.option, scheduleRenderChart, { deep: true });
onMounted(() => {
  disposed = false;
  scheduleRenderChart();
});
onBeforeUnmount(disposeChart);
</script>

<template>
  <view class="chart-block" :class="[{ 'chart-block--embedded': embedded }]">
    <canvas
      v-show="!failed"
      :id="canvasId"
      type="2d"
      :canvas-id="canvasId"
      class="chart-block__canvas"
      @touchstart="onCanvasTouchStart"
      @touchmove="onCanvasTouchMove"
      @touchend="onCanvasTouchEnd"
    />
    <!-- 画布不可用时不留一句空提示，直接把 option 里的数据摊出来 -->
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
.chart-block__canvas { width: 100%; overflow: hidden; height: 420rpx; }
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

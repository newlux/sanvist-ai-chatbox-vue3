<script setup>
import * as echarts from "echarts";

import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from "vue";

defineOptions({ name: "ChartBlock" });

const props = defineProps({
  blockId: { type: [String, Number], required: true },
  option: { type: Object, default: null },
  embedded: { type: Boolean, default: false },
});

const chartCanvas = ref(null);
const chart = ref(null);
let renderTimer = null;
let resizeObserver = null;

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

watch(() => props.option, scheduleRenderChart, { deep: true });
onMounted(() => {
  scheduleRenderChart();
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(scheduleRenderChart);
    if (chartCanvas.value) resizeObserver.observe(chartCanvas.value);
  }
});
onBeforeUnmount(disposeChart);

function scheduleRenderChart() {
  if (renderTimer) clearTimeout(renderTimer);
  void nextTick(() => {
    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderChart();
    }, 80);
  });
}

function disposeChart() {
  if (renderTimer) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (chart.value) {
    chart.value.dispose();
    chart.value = null;
  }
}

function renderChart() {
  if (!props.option || !echarts?.init) {
    console.warn("[ChartBlock] echarts unavailable");
    return;
  }

  const element = chartCanvas.value;
  if (!element) return;
  if (!element.clientWidth || !element.clientHeight) {
    scheduleRenderChart();
    return;
  }

  let instance = chart.value;
  if (!instance) {
    try {
      instance = echarts.init(element);
      chart.value = instance;
    } catch (error) {
      console.error("[ChartBlock] echarts.init failed", error);
      return;
    }
  }

  try {
    instance.setOption(chartOption.value, { notMerge: true, lazyUpdate: false, silent: true });
    instance.resize();
  } catch (error) {
    console.error("[ChartBlock] echarts.setOption failed", error, chartOption.value);
    disposeChart();
  }
}
</script>

<template>
  <view class="chart-block" :class="[{ 'chart-block--embedded': embedded }]">
    <div
      ref="chartCanvas"
      class="chart-block__canvas"
    />
  </view>
</template>

<style lang="scss" scoped>
.chart-block { width: 100%; padding: 32rpx; box-sizing: border-box; border-radius: 20rpx; background: #fff; }
.chart-block--embedded { padding: 0; border-radius: 0; background: transparent; }
.chart-block__canvas { width: 100%; overflow: hidden; height: 420rpx; }
</style>

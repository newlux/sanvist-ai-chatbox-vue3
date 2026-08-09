<script setup>
import * as echartsModule from "echarts";

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

defineOptions({ name: "ChartBlock" });

const props = defineProps({
  blockId: { type: [String, Number], required: true },
  option: { type: Object, default: null },
  embedded: { type: Boolean, default: false },
});

const echarts = echartsModule.default || echartsModule;

const chartCanvas = ref(null);
const chart = ref(null);

const chartOption = computed(() => {
  if (!props.option) return props.option;

  const option = { ...props.option };
  const hasCartesianSeries = Array.isArray(option.series)
    && option.series.some(series => series && (series.type === "bar" || series.type === "line"));
  const hasPieSeries = Array.isArray(option.series)
    && option.series.some(series => series && series.type === "pie");
  if (!props.embedded) return option;

  let normalizedOption = option;
  if (hasPieSeries) {
    normalizedOption = {
      ...normalizedOption,
      legend: option.legend && !Array.isArray(option.legend)
        ? { ...option.legend, top: 8, left: "center", itemWidth: 20, itemHeight: 12, itemGap: 16 }
        : option.legend,
      series: option.series.map(series => series && series.type === "pie"
        ? { ...series, center: ["50%", "58%"], radius: ["29%", "48%"] }
        : series),
    };
  }

  if (!hasCartesianSeries) return normalizedOption;

  return {
    ...normalizedOption,
    legend: option.legend && !Array.isArray(option.legend)
      ? { ...option.legend, top: 8, left: "center", itemWidth: 20, itemHeight: 12, itemGap: 16 }
      : option.legend,
    grid: {
      ...(option.grid && !Array.isArray(option.grid) ? option.grid : {}),
      top: 76,
      right: 12,
      bottom: 30,
      left: 12,
      containLabel: true,
    },
  };
});

watch(() => props.option, () => nextTick(renderChart), { deep: true });
onMounted(() => nextTick(renderChart));
onBeforeUnmount(disposeChart);

function disposeChart() {
  if (chart.value) {
    chart.value.dispose();
    chart.value = null;
  }
}

function renderChart() {
  if (!props.option || !echarts || typeof document === "undefined") {
    disposeChart();
    return;
  }

  const element = chartCanvas.value;
  if (!element) return;

  try {
    if (!chart.value) chart.value = echarts.init(element);
    chart.value.setOption(chartOption.value, { notMerge: true, lazyUpdate: true, silent: true });
    chart.value.resize();
  } catch {
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

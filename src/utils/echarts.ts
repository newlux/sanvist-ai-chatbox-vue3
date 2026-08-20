/**
 * ECharts 按需装配。
 *
 * `import * as echarts` 会把整包（含所有图表、坐标系、地图、SVG 渲染器）打进主 chunk，
 * 压缩后约 400KB，对内嵌 H5 是实打实的首屏成本。这里只注册后端实际会下发的组合：
 * 柱状 / 折线 / 饼 / 散点 / 雷达 + 直角坐标系与常用组件，Canvas 渲染器。
 *
 * 后端如果新增了图表类型（如 gauge、funnel），在这里补一行注册即可 ——
 * 漏注册的表现是图表空白且控制台报 "Series xxx is not exists"，
 * ChartBlock 会兜底降级成数据清单，不会白屏。
 */
import {
  BarChart,
  LineChart,
  PieChart,
  RadarChart,
  ScatterChart,
} from "echarts/charts";
import {
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  PolarComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

use([
  BarChart,
  LineChart,
  PieChart,
  RadarChart,
  ScatterChart,
  GridComponent,
  PolarComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  DatasetComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

export { init } from "echarts/core";
// clone 来自 zrender：echarts.util.clone 就是它的再导出，直接取源头避免拉整包
export { clone } from "zrender/lib/core/util";

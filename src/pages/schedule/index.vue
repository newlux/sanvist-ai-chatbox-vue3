<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useLandscape } from "@/hooks/useLandscape";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useScheduleGestures } from "@/hooks/useScheduleGestures";
import { useTimelineEdgeHint } from "@/hooks/useTimelineEdgeHint";
import ScheduleAskBar from "@/components/schedule-ask-bar/index.vue";
import { stashPendingScheduleAsk } from "@/utils/schedule-ask";
import { backFromScene } from "@/utils/scene-navigation";

/**
 * 横屏调度视图·重排草案（稿子 7229:254）——每个资源的「旧 / 新」两排计划对照。
 * 预排是另一个页面：pages/schedule-pre（稿子 6464:150）。
 *
 * 版面：横屏 812×375（每小时 56px，时间轴以 08:00–21:00 为基准、按数据向外扩到整点）
 * - 顶部栏：标题「调度视图·重排草案」+ 日期 + 图例（原计划 / 新计划 / 已取消）
 *   +「查看全部任务」+ 返回对话按钮；
 * - 左侧资源列（140px）：每行「旧 / 新」标签 + 类别 + 资源名 + 车号|班次；
 * - 右侧排程区：时间轴 + 竖向网格 + 任务条（按起止时间定位），可横向滚动；
 * - 底部「任务置换」提示条（7229:449）：点任务条后按该趟的「旧 / 新」两条生成文案，可关闭。
 *
 * 横屏方式与 pages/schedule-gantt 一致：`useLandscape()` 默认把页面整体旋转 90° 模拟横屏
 * （设备竖屏持握、不申请全屏权限），离开页面自动还原；需要真锁方向时传 `{ lock: true }`。
 *
 * 任务条样式（稿子 7229:254）：26 高、单行——原计划 #F4F4F4 + 虚线 #D9D9D9、
 * 新计划 白底 + 虚线 #9DB3CC、已取消同原计划但文案转灰、强调条为深色实线 #1A1A1A。
 * 任务条可点：点任意一条即选中它那一趟（linkKey 相同的旧 / 新两条），底部提示条随之更新。
 */

defineOptions({ name: "SchedulePage" });

/** 进入页面自动横屏（默认旋转模拟），离开时还原 */
const { rotated, exitLandscape } = useLandscape();

/**
 * 顶部状态栏空白：调原生 landscapeFullscreen 转屏成功后，webview 铺满横屏、
 * 状态栏压在页面顶边，顶栏要给状态栏让出这段高度；
 * CSS 旋转模拟（rotated）时状态栏在设备的物理顶边（对应页面左侧），不需要留。
 */
const { safeTopPx } = useSafeArea();
const headerTopStyle = computed(() => ({ paddingTop: rotated.value ? "" : `${safeTopPx.value}px` }));

/** 旋转页里原生手势在真机不生效：自己接管触摸（见 hooks/useScheduleGestures），并打开排查日志 */
useScheduleGestures({ gridId: "schedule-grid", onRowsOffset: () => measureRowTops() });

/** 时间轴：每小时 56px；稿子基准范围 08:00–21:00（设计稿刻度 6832:608…6832:644） */
const HOUR_WIDTH = 56;
const DESIGN_DAY_START_MIN = 8 * 60;
const DESIGN_DAY_END_MIN = 21 * 60;
/** 时间轴实际范围（分钟）：以稿子基准为底线，数据越界时由下面的 expandDayRange() 向外扩到整点 */
let DAY_START_MIN = DESIGN_DAY_START_MIN;
let DAY_END_MIN = DESIGN_DAY_END_MIN;
const hourLabels = computed(() => {
  const labels: string[] = [];
  for (let hour = DAY_START_MIN / 60; hour <= DAY_END_MIN / 60; hour += 1) {
    labels.push(`${String(hour).padStart(2, "0")}:00`);
  }
  return labels;
});
/** 排程区总宽 = 小时数 × 每小时宽 */
const timelineWidth = computed(() => ((DAY_END_MIN - DAY_START_MIN) / 60) * HOUR_WIDTH);

/**
 * 任务条样式态：
 * - pre      预排（稿子 6464:150）：白底 + #F2F2F2 实线、40 高、条内两行
 * - planned  重排·原计划（稿子 7229:278/317/298）：#F4F4F4 + 虚线 #D9D9D9
 * - new      重排·新计划（稿子 7229:328/265/322）：白底 + 虚线 #9DB3CC
 * - canceled 重排·已取消（稿子 7229:303）：同原计划，文案转灰 #999
 */
type BarState = "pre" | "planned" | "new" | "canceled";

interface ScheduleBar {
  id: string;
  /** 任务标题，如「1号基站 C20 80立方」 */
  title: string;
  /** 条内时间文案，如「08:00-13:00」 */
  timeText: string;
  /** 起点（当天分钟数） */
  startMin: number;
  /** 终点（当天分钟数） */
  endMin: number;
  state: BarState;
  /** 强调条：预排用红描边（6464:358），重排用深色实线描边（7229:339/302/350） */
  highlight?: boolean;
  /**
   * 新旧关联键：同一个 linkKey 只在「旧行 ↔ 新行」之间连虚线（同属一趟任务）。
   * 同一条泳道内的条一律不连；一侧多条对另一侧一条（拆趟 / 并趟）时两两相连。
   */
  linkKey?: string;
}

interface ScheduleRow {
  id: string;
  /** 重排模式的分组标签「旧 / 新」（稿子 7229:352/382）；预排模式没有，留空 */
  tag?: "旧" | "新";
  /** 类别：供料 / 运输 */
  category: string;
  /** 资源名（资源列内的多行文案，如「1号搅拌站」「供料线安排」） */
  names: string[];
  /** 该行的时间条 */
  bars: ScheduleBar[];
  /** 行下方是否带分组分隔线（重排稿 672×1 #DADADA） */
  separator?: boolean;
}

function timeToMin(text: string) {
  const [hour, minute] = text.split(":").map(Number);
  return hour * 60 + (minute || 0);
}

/** 任务条按起止时间定位：设计稿每小时 56px（如 08:00-13:00 → x=0, w=280） */
function barStyle(bar: ScheduleBar) {
  const left = ((bar.startMin - DAY_START_MIN) / 60) * HOUR_WIDTH;
  const width = Math.max(((bar.endMin - bar.startMin) / 60) * HOUR_WIDTH, HOUR_WIDTH / 2);
  return { left: `${left}px`, width: `${width}px` };
}

/**
 * 重排排程数据：**每辆车各有「旧 / 新」两行**——同一辆车的旧计划与新计划上下对照。
 * - `row.tag` = 旧 / 新；`row.names` = [车号|司机, 车牌|班次]（同一辆车两行的名字一致）；
 * - `bar.state` = 原计划(planned) / 新计划(new) / 已取消(canceled)；`highlight` = 稿子里的深色实线强调条；
 * - `bar.linkKey` = 同一趟任务的关联键：只连「旧行 ↔ 新行」，同一条泳道内不连；
 *   一侧多条对另一侧一条（拆趟 / 并趟）时两两相连——供料这组的旧排两条（s1 / s2）→ 新排一条（s3）就是多对一；
 * - 同一行内的任务首尾相接、互不重叠（旧 / 新两行是同一辆车的两个版本，本来就互相覆盖）。
 * 接入后端时替换成接口返回即可。
 */
const repRows: ScheduleRow[] = [
  // ── 供料：1号搅拌站 ──
  {
    id: "supply-old",
    tag: "旧",
    category: "供料",
    names: ["1号搅拌站", "供料线安排"],
    bars: [
      // 强调条（深色实线描边，稿子 7229:339）
      { id: "s1", title: "1号基站 C20 80立方", timeText: "08:00-13:00", startMin: timeToMin("08:00"), endMin: timeToMin("13:00"), state: "planned", highlight: true, linkKey: "supply-1" },
      // 已取消：灰字 + 深色实线描边（稿子 7229:302）
      // 与 s1 同 key：旧排这两条都指向新排的 s3（多对一，画两条跨泳道虚线）
      { id: "s2", title: "万达基地 C20 90立方", timeText: "13:30-19:00", startMin: timeToMin("13:30"), endMin: timeToMin("19:00"), state: "canceled", highlight: true, linkKey: "supply-1" },
    ],
  },
  {
    id: "supply-new",
    tag: "新",
    category: "供料",
    names: ["1号搅拌站", "供料线安排"],
    bars: [
      { id: "s3", title: "1号基站 C20 80立方", timeText: "09:00-13:00", startMin: timeToMin("09:00"), endMin: timeToMin("13:00"), state: "new", linkKey: "supply-1" },
      // 与旧排第 2 条同一趟任务（旧排里被取消，新排重新安排到 13:30-18:30）
      { id: "s4", title: "万达基地 C20 90立方", timeText: "13:30-18:30", startMin: timeToMin("13:30"), endMin: timeToMin("18:30"), state: "new", linkKey: "supply-2" },
      // 注：s4 的 linkKey（supply-2）旧排里没有对应 → 属「新排新增」，不连线
    ],
    separator: true,
  },
  // ── 13号车（白班）──
  {
    id: "t13-day-old",
    tag: "旧",
    category: "运输",
    names: ["13号车|郑文斌", "湘A-P0078|白班"],
    bars: [
      { id: "t1", title: "万达基地 C20 12立方", timeText: "0…", startMin: timeToMin("09:40"), endMin: timeToMin("11:10"), state: "planned", linkKey: "t13-day-1" },
      { id: "t2", title: "万达基地 C20 12立方", timeText: "0…", startMin: timeToMin("11:20"), endMin: timeToMin("12:50"), state: "planned", linkKey: "t13-day-2" },
      { id: "t3", title: "万达基地 C20 …", timeText: "", startMin: timeToMin("13:00"), endMin: timeToMin("14:40"), state: "planned", linkKey: "t13-day-3" },
      { id: "t4", title: "万达基地 C20 20立方", timeText: "15:0…", startMin: timeToMin("15:00"), endMin: timeToMin("19:10"), state: "planned", linkKey: "t13-day-4" },
    ],
  },
  {
    id: "t13-day-new",
    tag: "新",
    category: "运输",
    names: ["13号车|郑文斌", "湘A-P0078|白班"],
    bars: [
      { id: "t5", title: "万达基地 C20 12立方", timeText: "0…", startMin: timeToMin("10:10"), endMin: timeToMin("11:40"), state: "new", linkKey: "t13-day-1" },
      { id: "t6", title: "万达基地 C20 12立方", timeText: "0…", startMin: timeToMin("11:50"), endMin: timeToMin("13:20"), state: "new", linkKey: "t13-day-2" },
      { id: "t7", title: "万达基地 C20 …", timeText: "", startMin: timeToMin("13:30"), endMin: timeToMin("15:00"), state: "new", linkKey: "t13-day-3" },
      { id: "t8", title: "万达基地 C20 20立方", timeText: "15:0…", startMin: timeToMin("15:30"), endMin: timeToMin("19:40"), state: "new", linkKey: "t13-day-4" },
    ],
    separator: true,
  },
  // ── 13号车（晚班）──
  {
    id: "t13-night-old",
    tag: "旧",
    category: "运输",
    names: ["13号车|肖鹏", "湘A-P0078|晚班"],
    bars: [
      { id: "t9", title: "万达基地 C20 12立方", timeText: "0…", startMin: timeToMin("09:40"), endMin: timeToMin("11:10"), state: "planned", linkKey: "t13-night-1" },
      { id: "t10", title: "万达基地 C20 12立方", timeText: "0…", startMin: timeToMin("11:20"), endMin: timeToMin("13:20"), state: "planned", linkKey: "t13-night-2" },
      { id: "t11", title: "万达基地 C20 20立方", timeText: "13:3…", startMin: timeToMin("13:30"), endMin: timeToMin("18:00"), state: "planned", linkKey: "t13-night-3" },
    ],
  },
  {
    id: "t13-night-new",
    tag: "新",
    category: "运输",
    names: ["13号车|肖鹏", "湘A-P0078|晚班"],
    bars: [
      { id: "t12", title: "万达基地 C20 12立方", timeText: "0…", startMin: timeToMin("10:10"), endMin: timeToMin("11:40"), state: "new", linkKey: "t13-night-1" },
      { id: "t13", title: "万达基地 C20 12立方", timeText: "0…", startMin: timeToMin("11:50"), endMin: timeToMin("13:40"), state: "new", linkKey: "t13-night-2" },
      { id: "t14", title: "万达基地 C20 20立方", timeText: "14:0…", startMin: timeToMin("14:00"), endMin: timeToMin("18:30"), state: "new", linkKey: "t13-night-3" },
    ],
    separator: true,
  },
  // ── 12号车 ──
  {
    id: "t12-old",
    tag: "旧",
    category: "运输",
    names: ["12号车|何志刚", "湘A-R6557|白班"],
    bars: [
      { id: "w1", title: "万达基地 C20 12立方", timeText: "09:40-12:10", startMin: timeToMin("09:40"), endMin: timeToMin("12:10"), state: "planned", linkKey: "t12-1" },
      { id: "w2", title: "万达基地 C20 …", timeText: "12:50-15:20", startMin: timeToMin("12:50"), endMin: timeToMin("15:20"), state: "planned", linkKey: "t12-2" },
      { id: "w3", title: "万达基地 C20 20立方", timeText: "15:40-18:10", startMin: timeToMin("15:40"), endMin: timeToMin("18:10"), state: "planned", linkKey: "t12-3" },
    ],
  },
  {
    id: "t12-new",
    tag: "新",
    category: "运输",
    names: ["12号车|何志刚", "湘A-R6557|白班"],
    bars: [
      { id: "w4", title: "万达基地 C20 12立方", timeText: "08:30-11:00", startMin: timeToMin("08:30"), endMin: timeToMin("11:00"), state: "new", linkKey: "t12-1" },
      { id: "w5", title: "万达基地 C20 …", timeText: "11:30-14:00", startMin: timeToMin("11:30"), endMin: timeToMin("14:00"), state: "new", linkKey: "t12-2" },
      { id: "w6", title: "万达基地 C20 20立方", timeText: "14:30-17:30", startMin: timeToMin("14:30"), endMin: timeToMin("17:30"), state: "new", linkKey: "t12-3" },
    ],
    separator: true,
  },
  // ── 10号车 ──
  {
    id: "t10-old",
    tag: "旧",
    category: "运输",
    names: ["10号车|黄立新", "湘A-TY678|白班"],
    bars: [
      { id: "x1", title: "万达基地 C20 12立方", timeText: "06:30-10:30", startMin: timeToMin("06:30"), endMin: timeToMin("10:30"), state: "planned", linkKey: "t10-1" },
      { id: "x2", title: "万达基地 C20 20立方", timeText: "15:00-18:00", startMin: timeToMin("15:00"), endMin: timeToMin("18:00"), state: "planned", linkKey: "t10-2" },
    ],
  },
  {
    id: "t10-new",
    tag: "新",
    category: "运输",
    names: ["10号车|黄立新", "湘A-TY678|白班"],
    bars: [
      { id: "x3", title: "万达基地 C20 12立方", timeText: "07:00-11:00", startMin: timeToMin("07:00"), endMin: timeToMin("11:00"), state: "new", linkKey: "t10-1" },
      { id: "x4", title: "万达基地 C20 20立方", timeText: "15:30-18:30", startMin: timeToMin("15:30"), endMin: timeToMin("18:30"), state: "new", linkKey: "t10-2" },
    ],
    separator: true,
  },
  // ── 粤A-5667 ──
  {
    id: "ya5667-old",
    tag: "旧",
    category: "运输",
    names: ["粤A-5667|何富有"],
    bars: [
      // 强调条：白底 + 深色实线描边（稿子 7229:350）
      { id: "v1", title: "粤A-5667|何富有运输任务", timeText: "05:40", startMin: timeToMin("05:40"), endMin: timeToMin("13:00"), state: "planned", highlight: true, linkKey: "ya5667-1" },
    ],
  },
  {
    id: "ya5667-new",
    tag: "新",
    category: "运输",
    names: ["粤A-5667|何富有"],
    bars: [
      { id: "v2", title: "粤A-5667|何富有运输任务", timeText: "06:00", startMin: timeToMin("06:00"), endMin: timeToMin("14:00"), state: "new", linkKey: "ya5667-1" },
    ],
    separator: true,
  },
  // ── 泵车PA-12 ──
  {
    id: "pump-old",
    tag: "旧",
    category: "泵车",
    names: ["泵车PA-12|赵德海"],
    bars: [
      { id: "v3", title: "泵车PA-12|赵德海", timeText: "完成", startMin: timeToMin("08:00"), endMin: timeToMin("15:00"), state: "planned", linkKey: "pump-1" },
    ],
  },
  {
    id: "pump-new",
    tag: "新",
    category: "泵车",
    names: ["泵车PA-12|赵德海"],
    bars: [
      { id: "v4", title: "泵车PA-12|赵德海", timeText: "完成", startMin: timeToMin("08:30"), endMin: timeToMin("15:30"), state: "new", linkKey: "pump-1" },
    ],
  },
];

/**
 * 时间轴范围外扩：数据里更早 / 更晚的任务要能看到（如 05:40、06:30 的班次），
 * 否则会被裁在轴外面，看起来就是「时间轴只从 8 点开始、前面还有数据」。
 */
function expandDayRange(list: ScheduleRow[]) {
  list.forEach((row) => {
    row.bars.forEach((bar) => {
      DAY_START_MIN = Math.min(DAY_START_MIN, Math.floor(bar.startMin / 60) * 60);
      DAY_END_MIN = Math.max(DAY_END_MIN, Math.ceil(bar.endMin / 60) * 60);
    });
  });
}

expandDayRange(repRows);

/** 「查看全部任务」/ 右下角折叠按钮：切换是否展开下半部分行 */
const expanded = ref(true);
const rows = computed(() => (expanded.value ? repRows : repRows.slice(0, 4)));

/** 每行高 40px（与右侧 track 一致） */
const ROW_HEIGHT = 40;

/**
 * 把「旧 / 新」两行合成一组：同一辆车的车辆信息在左列**只显示一次**、跨两行上下居中，
 * 右侧仍按行渲染任务条（旧一行、新一行）。
 */
const rowGroups = computed(() => {
  const groups: Array<{ id: string; key: string; category: string; names: string[]; rows: ScheduleRow[]; separator: boolean }> = [];
  rows.value.forEach((row) => {
    const key = row.names[0] || row.id;
    const last = groups[groups.length - 1];
    // 只有相邻且同一辆车才合并（折叠/展开时不会把不相邻的行拼在一起）
    if (last && last.key === key) {
      last.rows.push(row);
      last.separator = Boolean(row.separator) || last.separator;
      return;
    }
    groups.push({
      id: `${row.id}-group`,
      key,
      category: row.category,
      names: row.names,
      rows: [row],
      separator: Boolean(row.separator),
    });
  });
  return groups;
});

/** 连接线坐标系：与 .schedule__grid-inner 一致（表头 45 高、重排每行 40 高、条 26 高） */
const LINK_RULER_HEIGHT = 0;
const LINK_ROW_HEIGHT = 40;
const LINK_BAR_TOP = 6;
const LINK_BAR_HEIGHT = 26;

/** 任务条中心点（x 由起止时间算，y 由所在行算） */
function barCenter(rowIndex: number, bar: ScheduleBar) {
  const left = ((bar.startMin - DAY_START_MIN) / 60) * HOUR_WIDTH;
  const width = Math.max(((bar.endMin - bar.startMin) / 60) * HOUR_WIDTH, HOUR_WIDTH / 2);
  return {
    x: left + width / 2,
    y: LINK_RULER_HEIGHT + rowIndex * LINK_ROW_HEIGHT + LINK_BAR_TOP + LINK_BAR_HEIGHT / 2,
  };
}

/** 两点之间的虚线定位（起点在 from，长度取两点距离，旋转到 to） */
function linkLineStyle(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return {
    left: `${from.x}px`,
    top: `${from.y}px`,
    width: `${length}px`,
    transform: `rotate(${angle}deg)`,
  };
}

/** 任务条属于「新计划」那一侧：按行标签判断，行没给标签时退回任务条状态 */
function isNewPlanBar(row: ScheduleRow, bar: ScheduleBar) {
  return row.tag === "新" || bar.state === "new";
}

/**
 * 新旧关联虚线：同一个 linkKey **只连「旧行 ↔ 新行」**。
 * - 同一条泳道内的条（同一行）一律不连；
 * - 支持多对一 / 一对多：旧侧 N 条、新侧 M 条就画 N×M 条（拆趟、并趟都能表达）；
 * - 只有一侧有该 linkKey 时不画线，那就是「新增 / 取消」。
 */
const linkLines = computed(() => {
  const groups = new Map<string, { old: Array<{ rowIndex: number; bar: ScheduleBar }>; fresh: Array<{ rowIndex: number; bar: ScheduleBar }> }>();
  rows.value.forEach((row, rowIndex) => {
    row.bars.forEach((bar) => {
      if (!bar.linkKey) return;
      const group = groups.get(bar.linkKey) || { old: [], fresh: [] };
      // rowIndex 是泳道序号，barCenter() 用它算 y
      const point = { rowIndex, bar };
      if (isNewPlanBar(row, bar)) group.fresh.push(point);
      else group.old.push(point);
      groups.set(bar.linkKey, group);
    });
  });

  const lines: Array<{ key: string; style: Record<string, string> }> = [];
  groups.forEach((group, linkKey) => {
    group.old.forEach((from, oldIndex) => {
      group.fresh.forEach((to, newIndex) => {
        lines.push({
          key: `${linkKey}-${oldIndex}-${newIndex}`,
          style: linkLineStyle(barCenter(from.rowIndex, from.bar), barCenter(to.rowIndex, to.bar)),
        });
      });
    });
  });
  return lines;
});

/** 图例（稿子 7229:440 原计划 / 7229:437 新计划 / 7229:444 已取消） */
const legend = [
  { key: "planned", label: "原计划" },
  { key: "new", label: "新计划" },
  { key: "canceled", label: "已取消" },
] as const;

/** 分钟数 →「HH:MM」（提示文案用真实排班时间，不用条里可能被截断的 timeText） */
function formatMinute(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function formatRange(bar: ScheduleBar) {
  return `${formatMinute(bar.startMin)}-${formatMinute(bar.endMin)}`;
}

/** 命中的任务条 + 它所在的行（行里带资源名、旧 / 新标签） */
interface BarHit {
  row: ScheduleRow;
  bar: ScheduleBar;
}

/**
 * linkKey → 同一趟任务的「旧 / 新」两条。
 * 点任意一条就能拿到对照的另一条：旧排给原时段、新排给调整后时段。
 */
const linkPairs = computed(() => {
  const map = new Map<string, { old?: BarHit; new?: BarHit }>();
  rows.value.forEach((row) => {
    row.bars.forEach((bar) => {
      if (!bar.linkKey) return;
      const pair = map.get(bar.linkKey) || {};
      // 与连线用同一套新旧判定，避免行标签缺失时两边归类不一致
      if (isNewPlanBar(row, bar)) pair.new = { row, bar };
      else pair.old = { row, bar };
      map.set(bar.linkKey, pair);
    });
  });
  return map;
});

/** 当前选中的那一趟任务（同一 linkKey 的旧 / 新两条一起高亮） */
const activeLinkKey = ref("");

/** 资源名取被点任务所在行（新排行优先，和左列显示的车号一致） */
function resourceName(pair: { old?: BarHit; new?: BarHit }) {
  const names = pair.new?.row.names || pair.old?.row.names || [];
  return names[0] || "";
}

/**
 * 底部「任务置换」提示文案：由被点击的旧 / 新任务现场拼出来——
 * 「资源名·任务名：原时段 → 新时段」，取消 / 新增 / 未变三种情况分开说。
 */
const notice = computed(() => {
  const pair = activeLinkKey.value ? linkPairs.value.get(activeLinkKey.value) : undefined;
  if (!pair) return "";
  const oldHit = pair.old;
  const newHit = pair.new;
  if (!oldHit && !newHit) return "";
  const resource = resourceName(pair);
  const title = newHit?.bar.title || oldHit?.bar.title || "";
  const head = resource && title ? `${resource}·${title}` : resource || title;

  if (oldHit && newHit) {
    const oldRange = formatRange(oldHit.bar);
    const newRange = formatRange(newHit.bar);
    if (oldHit.bar.state === "canceled") {
      return `${head}：原 ${oldRange} 已取消，调整至 ${newRange}`;
    }
    if (oldRange === newRange) {
      return `${head}：${oldRange} 与原计划一致，未调整`;
    }
    return `${head}：${oldRange} 调整至 ${newRange}`;
  }
  if (newHit) {
    return `${head}：新增任务，安排在 ${formatRange(newHit.bar)}`;
  }
  if (oldHit) {
    return `${head}：原 ${formatRange(oldHit.bar)} 在新计划中不再安排`;
  }
  return "";
});

/** 点任务条：选中该趟任务（旧 / 新任意一条都行）生成提示；再点一次取消选中 */
function onBarTap(bar: ScheduleBar) {
  if (!bar.linkKey) return;
  activeLinkKey.value = activeLinkKey.value === bar.linkKey ? "" : bar.linkKey;
}

/** 关闭提示条：文案清空，同时取消选中 */
function closeNotice() {
  activeLinkKey.value = "";
}

const dateText = "2025-09-26";

/* ---------- 滚动 ----------
   横屏是用 CSS 把页面旋转 90° 模拟的，手势方向跟着转，所以：
   - 纵向：任务行超出屏幕时，内容区整体上下滚（左右两栏一起滚，保持对齐）；
   - 横向：两个按钮步进 + 屏幕方向拖动连续跟随；原生滚动只读不回写，
     否则每次滚动都被赋回同一个值，表现就是一顿一顿的。 */
/** 每次点按钮移动 1 小时 */
const HOURS_PER_STEP = 1;
/** 绑给 scroll-view 的位置（只在按钮 / 拖动时改） */
const scrollLeftProp = ref(0);
/** 实际滚动位置（从 @scroll 读，用于按钮可用态和拖动起点） */
const currentScrollLeft = ref(0);
/** 按钮点击开动画，拖动时关掉（否则跟手迟滞） */
const smoothScroll = ref(true);
/** 时间轴可视宽度（H5 量一次，量不到就当作需要滚动） */
const gridWidth = ref(0);
const canScrollTimeline = computed(() => gridWidth.value === 0 || timelineWidth.value > gridWidth.value);

function applyScroll(left: number) {
  const next = Math.max(0, Math.round(left));
  if (next === scrollLeftProp.value) return;
  scrollLeftProp.value = next;
  currentScrollLeft.value = next;
}

function scrollTimeline(direction: -1 | 1) {
  smoothScroll.value = true;
  applyScroll(currentScrollLeft.value + direction * HOUR_WIDTH * HOURS_PER_STEP);
}

function onTimelineScroll(event: { detail?: { scrollLeft?: number } }) {
  // 只记录当前位置，不回写 scroll-left
  currentScrollLeft.value = Number(event?.detail?.scrollLeft || 0);
}

/**
 * 每一行左右两侧还有被挡住的任务时，就在那一行的对应侧浮出箭头（稿子 6832:720）；
 * 点一下把时间轴滚到该行那一侧最近的任务。
 */
const { rowHints, jumpToRow } = useTimelineEdgeHint({
  rows: () => rows.value,
  dayStartMin: DAY_START_MIN,
  hourWidth: HOUR_WIDTH,
  scrollLeft: currentScrollLeft,
  viewportWidth: gridWidth,
  contentWidth: () => timelineWidth.value,
  scrollTo: (left) => {
    smoothScroll.value = true;
    applyScroll(left);
  },
});

function measureGrid() {
  // #ifdef H5
  const el = document.getElementById("schedule-grid");
  if (el) gridWidth.value = el.clientWidth;
  // #endif
}

/** 每行箭头相对 .schedule__body 顶部的 Y（取行中心，px）；-1 表示该行没渲染出来 */
const rowTops = ref<number[]>([]);

/**
 * 量出每一行的纵向中心。
 * 这里的纵向滚动是 useScheduleGestures 用 `transform` 平移的（不是原生滚动），
 * 所以直接量 .schedule__track 的当前位置即可；手势每次平移后会回调进来重算。
 */
function measureRowTops() {
  // #ifdef H5
  const body = document.querySelector<HTMLElement>(".schedule__body");
  const tracks = Array.from(document.querySelectorAll<HTMLElement>(".schedule__track"));
  if (!body || tracks.length === 0) return;
  const bodyTop = body.getBoundingClientRect().top;
  rowTops.value = rows.value.map((_row, index) => {
    const el = tracks[index];
    if (!el) return -1;
    const rect = el.getBoundingClientRect();
    return rect.top - bodyTop + rect.height / 2;
  });
  // #endif
}

function measureLayout() {
  measureGrid();
  measureRowTops();
}

onMounted(() => {
  measureLayout();
  // 首帧布局可能晚一点，下一帧再量一次行位置
  nextTick(measureRowTops);
  // #ifdef H5
  window.addEventListener("resize", measureLayout);
  // #endif
});

onBeforeUnmount(() => {
  // #ifdef H5
  window.removeEventListener("resize", measureLayout);
  // #endif
});

// 「查看全部任务」会改变行数，行位置需要重新量
watch(() => rows.value.length, () => {
  nextTick(measureRowTops);
});

/**
 * 左上角按钮：返回对话页面。
 * 先还原屏幕方向（撤掉 CSS 旋转 / 解锁方向 / 退全屏），再走场景返回：
 * 上一页是对话页就直接返回，若是独立场景窗口则关闭 webview 回到对话页。
 *
 * 兜底路由给作业协同对话页：本页都是从作业协同对话里进来的，没有上一页可退时
 * 也要回那个会话（而不是首页），提问才落在原来的对话里。
 */
function backToChat() {
  exitLandscape();
  backFromScene("/pages/task/index");
}

/**
 * 右下角输入条发送：先把问题记到本地（对话页 onShow 取走并发送），
 * 再复用左上角那颗返回按钮的逻辑（收起横屏 → 回到作业协同对话页）。
 */
function onAskSend(text: string) {
  stashPendingScheduleAsk(text);
  backToChat();
}

function toggleExpand() {
  expanded.value = !expanded.value;
}

</script>

<template>
  <view class="schedule" :class="['schedule--rep', { 'schedule--rotated': rotated }]">
    <!-- 顶部栏（稿子 7229:254：标题、日期、图例、查看全部任务、返回对话） -->
    <view class="schedule__header" :style="headerTopStyle">
      <view class="schedule__title-group">
        <text class="schedule__title">
          调度视图·重排草案
        </text>
        <text class="schedule__date">
          {{ dateText }}
        </text>
      </view>

      <view class="schedule__tools">
        <!-- 图例（7229:440/437/444；色块 10×10 圆角 3） -->
        <view class="schedule__legend">
          <view v-for="item in legend" :key="item.key" class="schedule__legend-item">
            <view class="schedule__legend-chip" :class="`schedule__legend-chip--${item.key}`" />
            <text class="schedule__legend-text">
              {{ item.label }}
            </text>
          </view>
        </view>

        <!-- 查看全部任务（7229:416 勾选框 + 7229:417 文案） -->
        <view class="schedule__toggle-all" @tap="toggleExpand">
          <view class="schedule__checkbox" :class="{ 'schedule__checkbox--on': expanded }" />
          <text class="schedule__legend-text">
            查看全部任务
          </text>
        </view>

        <!-- 返回对话页：图标为「托盘 + 向上箭头」，点它退出排程视图回到对话 -->
        <view class="schedule__exit" @tap="backToChat">
          <view class="schedule__exit-icon">
            <view class="schedule__exit-arrow" />
          </view>
        </view>
      </view>
    </view>

    <!-- 主体：左侧资源列 + 右侧排程区 -->
    <view class="schedule__body">
      <view class="schedule__side">
        <view class="schedule__side-head">
          <text class="schedule__side-head-text">
            资源与车辆人员
          </text>
        </view>
        <!-- 同一辆车的「旧 / 新」两行合成一格：车辆信息只显示一次、跨两行上下居中 -->
        <view class="schedule__side-view">
          <view class="schedule__side-list">
        <view
          v-for="group in rowGroups"
          :key="group.id"
          class="schedule__side-group"
          :class="{ 'schedule__side-group--separator': group.separator }"
          :style="{ height: `${group.rows.length * ROW_HEIGHT}px` }"
        >
          <!-- 左列两行：第一行「类别 + 名称」，第二行车号|班次 -->
          <view class="schedule__side-lines">
            <view class="schedule__side-line">
              <text class="schedule__side-category">
                {{ group.category }}
              </text>
              <text v-if="group.names[0]" class="schedule__side-name schedule__side-name--main">
                {{ group.names[0] }}
              </text>
            </view>
            <text v-for="name in group.names.slice(1)" :key="name" class="schedule__side-name">
              {{ name }}
            </text>
          </view>
          <!-- 旧 / 新 标签：每行一个（30×40 的白底格子），与右侧任务行一一对齐 -->
          <view class="schedule__side-tags">
            <view v-for="row in group.rows" :key="row.id" class="schedule__side-tag">
              {{ row.tag }}
            </view>
          </view>
        </view>
          </view>
        </view>
      </view>

      <scroll-view
        id="schedule-grid"
        class="schedule__grid"
        scroll-x
        :show-scrollbar="false"
        :scroll-left="scrollLeftProp"
        :scroll-with-animation="smoothScroll"
        @scroll="onTimelineScroll"
      >
        <view class="schedule__grid-inner" :style="{ width: `${timelineWidth}px` }">
          <!-- 新旧关联：同一趟任务在「旧 / 新」两排之间连一条虚线（数据 linkKey 相同） -->

          <!-- 时间轴刻度 -->
          <view class="schedule__ruler">
            <text
              v-for="(label, index) in hourLabels"
              :key="label"
              class="schedule__ruler-label"
              :style="{ left: `${index * HOUR_WIDTH + 7}px` }"
            >
              {{ label }}
            </text>
          </view>

          <!-- 内容区：纵向滚动（时间轴刻度固定在上面） -->
          <view class="schedule__rows">
            <view class="schedule__rows-inner">
          <view
            v-for="line in linkLines"
            :key="line.key"
            class="schedule__link"
            :style="line.style"
          />
          <!-- 排程行：每行一个时间条区域，按起止时间定位任务条 -->
          <view
            v-for="row in rows"
            :key="row.id"
            class="schedule__track"
            :class="{ 'schedule__track--separator': row.separator }"
          >
            <view
              v-for="bar in row.bars"
              :key="bar.id"
              class="schedule__bar"
              :class="[
                `schedule__bar--${bar.state}`,
                { 'schedule__bar--mark': bar.highlight, 'schedule__bar--active': bar.linkKey && bar.linkKey === activeLinkKey },
              ]"
              :style="barStyle(bar)"
              @tap="onBarTap(bar)"
            >
              <text class="schedule__bar-title">
                {{ bar.title }}
              </text>
              <text v-if="bar.timeText" class="schedule__bar-time">
                {{ bar.timeText }}
              </text>
            </view>
          </view>
            </view>
          </view>
        </view>
      </scroll-view>

      <!-- 每行独立：该行左右还有被挡住的任务时，就在那一行对应侧浮出箭头；点击跳到该行最近的任务（稿子 6832:720） -->
      <view
        v-for="(row, rowIndex) in rows"
        :key="`hint-${row.id}`"
        v-show="rowTops[rowIndex] >= 0"
        class="schedule__hint-anchor"
        :style="{ top: `${rowTops[rowIndex] || 0}px` }"
      >
        <view
          v-if="rowHints[rowIndex] && rowHints[rowIndex].left"
          class="schedule__scroll-btn schedule__scroll-btn--prev"
          @tap="jumpToRow(-1, rowIndex)"
        >
          <view class="schedule__scroll-icon schedule__scroll-icon--prev" />
        </view>
        <view
          v-if="rowHints[rowIndex] && rowHints[rowIndex].right"
          class="schedule__scroll-btn schedule__scroll-btn--next"
          @tap="jumpToRow(1, rowIndex)"
        >
          <view class="schedule__scroll-icon schedule__scroll-icon--next" />
        </view>
      </view>
    </view>


    <!-- 底部提示条（稿子 7229:449：476×42 白底 + #F2F2F2 描边圆角 6，左侧「任务置换」深色胶囊 7229:291） -->
    <view v-if="notice" class="schedule__notice">
      <view class="schedule__notice-chip">
        任务置换
      </view>
      <text class="schedule__notice-text">
        {{ notice }}
      </text>
      <view class="schedule__notice-close" @tap="closeNotice" />
    </view>

    <!-- 右下角输入条（稿子 6694:82 空态 / 4704:261 语音态 / 4704:235 有内容态） -->
    <ScheduleAskBar @send="onAskSend" />
  </view>
</template>

<style lang="scss" scoped>
/* 横屏稿件 6464:150：812 × 375，元素尺寸直接按稿件 px（横屏可视区宽约 812 时与稿一致，窄则横向滚动兜住）
   版式要点：左列 140（底 #FBFBFB / 描边 #F2F2F2）、每小时 56px、行高 45、任务条 40 高白底 + #F2F2F2 描边 */
.schedule {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #ffffff;
  color: #1a1a1e;
  font-family: "PingFang SC", "Inter", sans-serif;
}

/* 旋转模拟横屏时（useLandscape）：body 已旋转 90°，页面按横屏尺寸铺开 */
.schedule--rotated {
  width: 100vh;
  height: 100vw;
}

/* ---------- 顶部栏：高 49，左右内边距 28（设计稿 6832:764 状态栏之下的导航区） ---------- */
.schedule__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  height: 49px;
  padding: 0 28px;
}

.schedule__title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.schedule__title {
  font-size: 12px;
  font-weight: 500;
  color: #000000;
}

.schedule__date {
  font-size: 11px;
  color: #999999;
}

.schedule__tools {
  display: flex;
  align-items: center;
  gap: 16px;
}

/* 图例（7229:440 原计划 / 7229:437 新计划 / 7229:444 已取消），色块 10×10 圆角 3 */
.schedule__legend {
  display: flex;
  align-items: center;
  gap: 16px;
}

.schedule__legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.schedule__legend-chip {
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  border: 1px solid #d9d9d9;
  background: #f4f4f4;
}

/* 新计划：白底 + 虚线 #9DB3CC（7229:438） */
.schedule__legend-chip--new {
  border-style: dashed;
  border-color: #9db3cc;
  background: #ffffff;
}

/* 已取消：#F4F4F4 + 虚线 #D9D9D9（7229:441） */
.schedule__legend-chip--canceled {
  border-style: dashed;
  background: #f4f4f4;
}

.schedule__legend-text {
  font-size: 11px;
  color: #000000;
}

/* 「查看全部任务」：勾选框 + 文案（7229:416 / 7229:417） */
.schedule__toggle-all {
  display: flex;
  align-items: center;
  gap: 5px;
}

.schedule__checkbox {
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  border: 1px solid #d9d9d9;
  border-radius: 2px;
  background: #ffffff;
}

.schedule__checkbox--on {
  border-color: #1a1a1e;
  background: #1a1a1e;
}

/* 退出全屏：稿子里是纯图标按钮（10474:16 底 #FBFBFB + 描边 #F2F2F2、圆角 6） */
.schedule__exit {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  border: 1px solid #f2f2f2;
  border-radius: 6px;
  background: #fbfbfb;
}

.schedule__exit:active {
  opacity: 0.7;
}

/* 返回图标：下方托盘（U 形，开口朝上）+ 中间向上箭头（#222 描边，13×14） */
.schedule__exit-icon {
  position: relative;
  width: 13px;
  height: 14px;
  rotate: 90deg;
}

/* 托盘：左、下、右三边，底部两角圆一点 */
.schedule__exit-icon::before {
  content: "";
  position: absolute;
  left: 0;
  bottom: 0;
  box-sizing: border-box;
  width: 13px;
  height: 8px;
  border-right: 1.5px solid #222222;
  border-bottom: 1.5px solid #222222;
  border-left: 1.5px solid #222222;
  border-radius: 0 0 3px 3px;
}

/* 箭头竖杆：从托盘内底往上穿出托盘上沿 */
.schedule__exit-arrow {
  position: absolute;
  left: 50%;
  bottom: 1px;
  width: 1.5px;
  height: 11px;
  margin-left: -0.75px;
  background: #222222;
}

/* 箭头头部：旋转 45° 的直角，形成向上的 ∧ */
.schedule__exit-arrow::before {
  content: "";
  position: absolute;
  left: 50%;
  top: -3px;
  box-sizing: border-box;
  width: 5px;
  height: 5px;
  margin-left: -2.5px;
  border-top: 1.5px solid #222222;
  border-left: 1.5px solid #222222;
  transform: rotate(45deg);
}

/* ---------- 主体：任务行超出屏幕时纵向可滚（左右两栏一起滚，保持行对齐） ----------
   只允许纵向滚：横向必须 hidden，否则（overflow 一轴非 visible 时另一轴会变成 auto）
   整块主体会被横向拖动，左列被推走、时间轴右侧还会露白底 */
.schedule__body {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  background: #fbfbfb;
}

/* 左侧资源列：宽 140（稿子 6464:279）、底 #FBFBFB、右描边 #F2F2F2 */
.schedule__side {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  box-sizing: border-box;
  border-top: 1px solid #f2f2f2;
  border-right: 1px solid #f2f2f2;
  background: #fbfbfb;
}

.schedule__side-head {
  display: flex;
  align-items: flex-end;
  flex-shrink: 0;
  box-sizing: border-box;
  height: 45px;
  padding: 0 0 8px 10px;
}

.schedule__side-head-text {
  font-size: 11px;
  color: #000000;
}

/* 左侧分组格：同一辆车的「旧 / 新」两行合成一格（高度 = 行数 × 40，模板按 group.rows.length 给），
   车辆信息整体上下居中、贴左；右侧是旧 / 新 标签列（每格 40 高，与任务行对齐）
   上下各一条 1px 描边（稿子 7229 的 Rectangle 112 就是带描边的格子）；
   相邻格共用一条线：统一用上边框、末格再补一条下边框，避免叠成 2px */
.schedule__side-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  box-sizing: border-box;
  width: 100%;
  padding: 0 0 0 10px;
  border-top: 1px solid #f2f2f2;
  overflow: hidden;
}

.schedule__side-group:last-child {
  border-bottom: 1px solid #f2f2f2;
}

.schedule__side-group--separator {
  box-shadow: 0 1px 0 0 #f2f2f2;
}

/* 已经有分组线的格子沿用那条线的颜色，不再额外加深 */
.schedule--rep .schedule__side-group--separator {
  border-top-color: #dadada;
}

/* 上一格已经有分组线时，这一格不再重复画上边框（避免叠成 2px） */
.schedule__side-group--separator + .schedule__side-group {
  border-top: none;
}

.schedule__side-lines {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* 第一行：类别与名称同行（稿子 6464:300 / 6464:297） */
.schedule__side-line {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.schedule__side-category {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 13px;
  font-weight: 500;
  color: #666666;
}

/* 副行（车号|班次）：11px 常规 #999（稿子 6464:296） */
.schedule__side-name {
  font-size: 11px;
  line-height: 13px;
  font-weight: 400;
  color: #999999;
  white-space: nowrap;
}

/* 第一行里的名称：11px Medium #000（稿子 6464:297） */
.schedule__side-name--main {
  font-weight: 500;
  color: #000000;
}

/* 旧 / 新 标签列：每个标签占一格（30×40 白底 + #F2F2F2 描边，稿子 7229:353/362），与任务行对齐 */
.schedule__side-tags {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.schedule__side-tag {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-sizing: border-box;
  width: 30px;
  height: 40px;
  border: 1px solid #f2f2f2;
  background: #ffffff;
  font-size: 11px;
  color: #000000;
}

/* 右侧排程区：横向可滚；底色与表体一致，时间轴尽头之外不露白
   touch-action: none —— 真机上不要让浏览器原生接管手势（旋转页面里它常常失效还抢事件），
   滚动统一由 hooks/useScheduleGestures 的 JS 手势和左右按钮驱动 */
.schedule__grid {
  flex: 1 1 auto;
  min-width: 0;
  background: #fbfbfb;
  touch-action: none;
  white-space: nowrap;
}

/* 隐藏 scroll-view 自带的横向滚动条（已提供左右按钮） */
.schedule__grid::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.schedule__grid-inner {
  position: relative;
  /* 表体底色 #FBFBFB（稿子 6464:167），每小时一条竖网格线 #F3F3F3（Vector 84…98） */
  background-color: #fbfbfb;
  background-image: repeating-linear-gradient(
    to right,
    #f3f3f3 0,
    #f3f3f3 1px,
    transparent 1px,
    transparent 56px
  );
  background-position: 0 45px;
}

.schedule__ruler {
  position: relative;
  flex-shrink: 0;
  height: 45px;
}

.schedule__ruler-label {
  position: absolute;
  bottom: 8px;
  font-size: 12px;
  // font-style: italic;
  color: #1a1a1e;
}

/* 每行高 45，与左侧分组行一一对应（稿子每行 ~45） */
.schedule__track {
  position: relative;
  box-sizing: border-box;
  height: 45px;
}

.schedule__track--separator {
  box-shadow: 0 1px 0 0 #f2f2f2;
}

/* 任务条基础：圆角 6、内边距 8；尺寸/底色/描边/排版按模式区分（见文件末尾「按模式区分」） */
.schedule__bar {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  padding: 0 8px;
  border-radius: 6px;
  overflow: hidden;
}

.schedule__bar-title {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 500;
  line-height: 13px;
  color: #1a1a1e;
  white-space: nowrap;
}

.schedule__bar-time {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 400;
  line-height: 13px;
  color: #999999;
  white-space: nowrap;
}

/* ---------- 底部提示条：仅重排稿有（7229:449） ---------- */
.schedule__notice {
  position: absolute;
  left: 50%;
  /* 让开右下角输入条（catalouge 高度 38 + 12 间距 + 余量） */
  bottom: 64px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  width: 476px;
  max-width: calc(100% - 32px);
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid #f2f2f2;
  border-radius: 6px;
  background: #ffffff;
  transform: translateX(-50%);
}

/* 「任务置换」：深色胶囊 + 白字（7229:291 32×14 圆角 7、7229:450） */
.schedule__notice-chip {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-sizing: border-box;
  min-width: 32px;
  height: 14px;
  padding: 0 4px;
  border-radius: 7px;
  background: #1a1a1a;
  font-size: 11px;
  color: #ffffff;
}

.schedule__notice-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  line-height: 14px;
  color: #1a1a1a;
}

.schedule__notice-close {
  position: relative;
  flex-shrink: 0;
  width: 12px;
  height: 12px;
}

.schedule__notice-close::before,
.schedule__notice-close::after {
  content: "";
  position: absolute;
  top: 5px;
  left: 0;
  width: 12px;
  height: 1px;
  background: #1a1a1a;
}

.schedule__notice-close::before {
  transform: rotate(45deg);
}

.schedule__notice-close::after {
  transform: rotate(-45deg);
}

/* ---------- 任务条 / 行高：按模式区分 ---------- */

/* 重排（稿子 7229:254）：26 高、单行（标题 + 时段并排）、#F4F4F4 底 + 虚线 #D9D9D9（7229:278/317/298） */
.schedule--rep .schedule__bar {
  top: 6px;
  height: 26px;
  border: 1px dashed #d9d9d9;
  background: #f4f4f4;
}

/* 重排·新计划：白底 + 虚线 #9DB3CC（7229:328/265/322） */
.schedule--rep .schedule__bar--new {
  border-color: #9db3cc;
  background: #ffffff;
}

/* 重排·已取消：样式同原计划，文案转灰（7229:303） */
.schedule--rep .schedule__bar--canceled .schedule__bar-title,
.schedule--rep .schedule__bar--canceled .schedule__bar-time {
  color: #999999;
}

/* 重排的强调条：深色实线描边（7229:339/302/350） */
.schedule--rep .schedule__bar--mark {
  border-style: solid;
  border-color: #1a1a1a;
}

/* 选中态：被点的那一趟任务（旧 / 新两条同时描深），底部提示文案就是它俩生成的 */
.schedule--rep .schedule__bar {
  cursor: pointer;
}

.schedule--rep .schedule__bar--active {
  border-style: solid;
  border-color: #1a1a1a;
  box-shadow: 0 0 0 1px #1a1a1a inset;
}

/* 行高：40（条 26 + 上下留白）；左侧分组格的高度由模板按行数算 */
.schedule--rep .schedule__track {
  height: 40px;
}

/* 分组分隔线：重排稿是 #DADADA（7229:276/337） */
.schedule--rep .schedule__track--separator,
.schedule--rep .schedule__side-group--separator {
  box-shadow: 0 1px 0 0 #dadada;
}

/* 每行的箭头锚点：贴着该行中心，宽与主体一致，自身不接收手势（只有箭头接收） */
.schedule__hint-anchor {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  z-index: 5;
  pointer-events: none;
}

/* ---------- 左右隐藏任务提示箭头：28×28 白底方按钮 + #F2F2F2 描边圆角 6 + 阴影（稿子 6832:720 / 6832:724） ---------- */
.schedule__scroll-btn {
  pointer-events: auto;
  position: absolute;
  /* 竖直居中在排程区；左侧那颗要让开 140 宽的左列 */
  top: 50%;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  border: 1px solid #f2f2f2;
  border-radius: 6px;
  background: #ffffff;
  box-shadow: 0 2px 7px rgba(0, 0, 0, 0.14);
  transform: translateY(-50%);
}

.schedule__scroll-btn--prev {
  left: 148px;
}

.schedule__scroll-btn--next {
  right: 8px;
}

.schedule__scroll-btn:active {
  opacity: 0.7;
}

/* 箭头：9×9 的直角旋转 45°（稿子 6832:719 / 10633:140，色 #1A1A1A） */
.schedule__scroll-icon {
  width: 9px;
  height: 9px;
  border-top: 1.5px solid #1a1a1a;
  border-right: 1.5px solid #1a1a1a;
}

.schedule__scroll-icon--prev {
  transform: rotate(-135deg);
}

.schedule__scroll-icon--next {
  transform: rotate(45deg);
}

/* 新旧关联虚线：细虚线（取新计划同色），不挡点击 */
.schedule__link {
  position: absolute;
  height: 0;
  border-top: 1px dashed #9db3cc;
  transform-origin: 0 0;
  pointer-events: none;
}

/* ---------- 布局：外层横向滚动（时间轴方向）套「刻度 + 内容区」，内容区纵向滚动 ---------- */
/* 左列：表头固定，行内容用 transform 跟右侧纵向滚动同步 */
.schedule__side-view {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.schedule__side-list {
  will-change: transform;
}

/* 右侧排程区：占满高度，内部再分「刻度 / 内容区」 */
.schedule__grid {
  height: 100%;
}

.schedule__grid-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.schedule__ruler {
  flex-shrink: 0;
}

/* 内容区：上下滑动（裁剪视口；内容由 useScheduleGestures 用 transform 平移，不依赖原生滚动） */
.schedule__rows {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.schedule__rows-inner {
  position: relative;
  will-change: transform;
}
</style>

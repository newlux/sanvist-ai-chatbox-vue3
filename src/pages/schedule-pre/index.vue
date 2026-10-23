<script setup lang="ts">
import type { GanttViewRow } from "@/api/chat/types";
import type { TaskDetailPanelPayload, TaskDetailPanelStatus } from "@/components/ai-task-detail-panel/types";
import type { SchedulePinchEvent } from "@/hooks/useScheduleGestures";

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AiTaskDetailPanel from "@/components/ai-task-detail-panel/index.vue";
import { useLandscape } from "@/hooks/useLandscape";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useScheduleGestures } from "@/hooks/useScheduleGestures";
import { useTimelineEdgeHint } from "@/hooks/useTimelineEdgeHint";
import ScheduleAskBar from "@/components/schedule-ask-bar/index.vue";
import { backFromScene } from "@/utils/scene-navigation";
import { stashPendingScheduleAsk } from "@/utils/schedule-ask";
import { consumePendingScheduleView } from "@/utils/schedule-view";

/**
 * 横屏调度视图·预排草案（稿子 6464:150）——每个资源一行，行内平铺当班任务。
 * 重排是另一个页面：pages/schedule（稿子 7229:254，每个资源「旧 / 新」两排对照）。
 *
 * 版面：横屏 812×375（每小时 56px，时间轴以 08:00–21:00 为基准、按数据向外扩到整点）
 * - 顶部栏：标题「调度视图·预排草案」+ 日期；右侧为任务状态图例（6832:13，贴着返回按钮）
 *   + 返回对话按钮；
 * - 左侧资源列（140px，6464:279）：第一行「类别 + 名称」，第二行车号|班次；
 * - 右侧排程区：时间轴 + 竖向网格（#F3F3F3）+ 任务条（按起止时间定位），可横向滚动。
 *
 * 不画「当前时间虚线」：产品规范里只有全量调度视图（pages/schedule-gantt，viewType=schedule）
 * 显示这条线；本页只用 NOW_MIN 推任务状态，不渲染时间线。
 *
 * 双指缩放：与甘特页同一套（useScheduleGestures 接管两指手势），按两指间距比例改「每小时像素宽」
 * （28–168px，基准 56px），捏合中心的时刻保持不动；刻度、任务条、竖网格线、箭头跟着实时重排。
 *
 * 横屏方式与 pages/schedule-gantt 一致：`useLandscape()` 默认把页面整体旋转 90° 模拟横屏
 * （设备竖屏持握、不申请全屏权限），离开页面自动还原；需要真锁方向时传 `{ lock: true }`。
 *
 * 任务条样式（稿子 6464:150）：40 高、白底 + #F2F2F2 描边、圆角 6，
 * 条内两行（标题 11px Medium #1A1A1E + 时段 11px #999）；强调条为红描边 #C8201E（6464:358）。
 */

defineOptions({ name: "SchedulePrePage" });

/** 进入页面自动横屏（默认旋转模拟），离开时还原 */
const { rotated, exitLandscape } = useLandscape();

/**
 * 顶部状态栏空白：调原生 landscapeFullscreen 转屏成功后，webview 铺满横屏、
 * 状态栏压在页面顶边，顶栏要给状态栏让出这段高度；
 * CSS 旋转模拟（rotated）时状态栏在设备的物理顶边（对应页面左侧），不需要留。
 */
const { safeTopPx } = useSafeArea();
const headerTopStyle = computed(() => ({ paddingTop: rotated.value ? "" : `${safeTopPx.value}px` }));

/**
 * 旋转页里原生手势在真机不生效：自己接管触摸（见 hooks/useScheduleGestures），并打开排查日志。
 * 双指捏合也走这里（原生 pinch 在旋转页面同样失效），缩的是时间轴每小时像素宽。
 */
useScheduleGestures({
  gridId: "schedule-pre-grid",
  isRotated: () => rotated.value,
  onPinch: onTimelinePinch,
  onRowsOffset: () => measureRowTops(),
});

/** 任务详情面板（点击任务条从右侧滑出，稿子 6832:292） */
const detailVisible = ref(false);
const detail = ref<TaskDetailPanelPayload | null>(null);

/** 状态推导基准：取系统当前时间（分钟数），任务条配色 / 详情里的「执行中 / 已完成」按它判断 */
function currentMinutes() {
  const date = new Date();
  return date.getHours() * 60 + date.getMinutes();
}
const NOW_MIN = currentMinutes();

/** 时间轴：每小时像素宽基准 56px（稿子 1x，双指捏合在 28–168 之间缩放）；基准范围 08:00–21:00 */
const DEFAULT_HOUR_WIDTH = 56;
const HOUR_WIDTH_MIN = 28;
const HOUR_WIDTH_MAX = 168;
/** 当前每小时像素宽（双指缩放会改它，刻度 / 任务条 / 网格线都跟着走） */
const hourWidth = ref(DEFAULT_HOUR_WIDTH);
const DESIGN_DAY_START_MIN = 8 * 60;
const DESIGN_DAY_END_MIN = 21 * 60;
/** 时间轴实际范围（分钟）：以稿子基准为底线，数据越界时由下面的 expandDayRange() 向外扩到整点 */
let DAY_START_MIN = DESIGN_DAY_START_MIN;
let DAY_END_MIN = DESIGN_DAY_END_MIN;
/* ---------- 刻度间隔随缩放自适应 ----------
   相邻刻度保证至少隔开 TICK_MIN_GAP px：缩到 40px/小时以下用 2 小时一格，
   1x（56px/小时）左右是 1 小时一格，放到 80px/小时以上变成半小时一格。 */
const TICK_MIN_GAP = 40;
const TICK_STEPS = [30, 60, 120];

/** 当前刻度间隔（分钟）：取第一个「够宽」的候选 */
const tickStepMin = computed(() => (
  TICK_STEPS.find(step => (step / 60) * hourWidth.value >= TICK_MIN_GAP) ?? TICK_STEPS[TICK_STEPS.length - 1]
));

/** 刻度：left 为相对排程区左边的像素位置（含 7px 文案内缩），label 过 24 点按 24 小时回绕 */
const ticks = computed(() => {
  const step = tickStepMin.value;
  const list: Array<{ min: number, label: string, left: number }> = [];
  for (let min = DAY_START_MIN; min <= DAY_END_MIN; min += step) {
    const hour = Math.floor((min % 1440) / 60);
    const minute = min % 60;
    list.push({
      min,
      label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      left: ((min - DAY_START_MIN) / 60) * hourWidth.value + 7,
    });
  }
  return list;
});
/** 排程区总宽 = 小时数 × 每小时宽（缩放后自动变宽 / 变窄） */
const timelineWidth = computed(() => ((DAY_END_MIN - DAY_START_MIN) / 60) * hourWidth.value);

/* ---------- 时间轴横向滚动 ----------
   横屏是用 CSS 把页面旋转 90° 模拟的，手势方向跟着转（屏幕上左右 ↔ 内容里上下），
   所以这里做三件事：按钮步进、屏幕方向拖动连续跟随、原生滚动只读不回写。
   关键：`:scroll-left` 只在按钮 / 拖动时赋值，**不能**拿 @scroll 的值回写，
   否则每次滚动都会被赋回同一个值，表现就是一顿一顿的。 */
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
/** 任务量超出可视宽度时才显示滚动控件 */
const canScrollTimeline = computed(() => gridWidth.value === 0 || timelineWidth.value > gridWidth.value);

function applyScroll(left: number) {
  const next = Math.max(0, Math.round(left));
  if (next === scrollLeftProp.value) return;
  scrollLeftProp.value = next;
  currentScrollLeft.value = next;
}

function scrollTimeline(direction: -1 | 1) {
  smoothScroll.value = true;
  applyScroll(currentScrollLeft.value + direction * hourWidth.value * HOURS_PER_STEP);
}

function onTimelineScroll(event: { detail?: { scrollLeft?: number } }) {
  // 只记录当前位置，不回写 scroll-left
  currentScrollLeft.value = Number(event?.detail?.scrollLeft || 0);
}

/**
 * 双指捏合 → 时间轴缩放（只改「每小时像素宽」，纵向行高不变）。
 * 捏合中心对应的时刻保持不动：先记下中心的内容坐标 contentX 与可视区偏移 localX，
 * 缩放后再把 contentX × 比例 − localX 滚回去，视觉上就是「以手指为中心放大」。
 */
function onTimelinePinch({ scale, contentX, localX }: SchedulePinchEvent) {
  const prev = hourWidth.value;
  const next = Math.min(Math.max(prev * scale, HOUR_WIDTH_MIN), HOUR_WIDTH_MAX);
  if (next === prev) return;
  hourWidth.value = next;
  const ratio = next / prev;
  // 内容宽随缩放变化：等新宽度生效后再补滚动位置，否则会被旧宽度夹住
  nextTick(() => {
    const max = Math.max(0, timelineWidth.value - gridWidth.value);
    smoothScroll.value = false;
    applyScroll(Math.min(Math.max(contentX * ratio - localX, 0), max));
    nextTick(() => {
      smoothScroll.value = true;
    });
  });
}

function measureGrid() {
  // #ifdef H5
  const el = document.getElementById("schedule-pre-grid");
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

/** 预排只有一种任务条样式；highlight 对应稿子里那条红描边的强调条 */
type BarState = "pre";

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
  /** 强调条：红描边 #C8201E（稿子 6464:358） */
  highlight?: boolean;
  /** 计划开始时间已过、但一直没收到开始记录 → 详情里按「逾期未开始」展示（稿子样本 4） */
  noStartRecord?: boolean;
}

interface ScheduleRow {
  id: string;
  /** 类别：供料 / 泵车 / 运输 */
  category: string;
  /** 资源名（资源列内的多行文案，如「1号搅拌站」「供料线安排」） */
  names: string[];
  /** 该行的时间条 */
  bars: ScheduleBar[];
}

/** 任务条按起止时间定位：每小时 hourWidth px（1x 时 08:00-13:00 → x=0, w=280） */
function barStyle(bar: ScheduleBar) {
  const left = ((bar.startMin - DAY_START_MIN) / 60) * hourWidth.value;
  const width = Math.max(((bar.endMin - bar.startMin) / 60) * hourWidth.value, hourWidth.value / 2);
  return { left: `${left}px`, width: `${width}px` };
}

/* ------------------------------------------------------------------
 * AI 下发的预排数据（COMPONENT scene=task / type=gantt，viewType=pre → data）
 * ------------------------------------------------------------------ */
/**
 * 气泡入口卡点进来时写下的整包 data，打开本页取走（取完即清）；
 * 没有数据（比如兜底跳转进来、或接口没下发 rows）就渲染空视图。
 */
const viewPayload = consumePendingScheduleView();

/** 接口还没排时间的条：每条按 2 小时一节依次排开 */
const UNSCHEDULED_SLOT_MIN = 2 * 60;

/**
 * 接口 rows → 页面行模型。
 * - 预排只有一种任务条样式（`state` 一律 "pre"），接口的 state 不参与配色；
 * - 起止时间直传；**接口没排时间（startMin / endMin 为 null）**时按数组顺序在轴起点依次排开、
 *   条内时间写「时间待定」——否则按 null 定位会算出 NaN，任务条直接跑出画面。
 */
function normalizeViewRows(viewRows: GanttViewRow[]): ScheduleRow[] {
  return viewRows.map((row, rowIndex) => {
    let cursor = DAY_START_MIN;
    return {
      id: String(row.id || `resource-${rowIndex + 1}`),
      category: String(row.category || "").trim() || "—",
      names: Array.isArray(row.names) ? row.names.map(name => String(name || "")) : [],
      bars: (Array.isArray(row.bars) ? row.bars : []).map((bar, barIndex) => {
        // null 不能直接 Number()：会被当成 0，误判成「已排在 00:00」
        const start = bar.startMin == null ? Number.NaN : Number(bar.startMin);
        const end = bar.endMin == null ? Number.NaN : Number(bar.endMin);
        const planned = Number.isFinite(start) && Number.isFinite(end) && end > start;
        const startMin = planned ? start : cursor;
        const endMin = planned ? end : cursor + UNSCHEDULED_SLOT_MIN;
        if (!planned) cursor = endMin;
        return {
          id: String(bar.id || `${row.id || rowIndex}-${barIndex + 1}`),
          title: String(bar.title || ""),
          timeText: String(bar.timeText || "").trim()
            || (planned ? `${minutesToTime(startMin)}-${minutesToTime(endMin)}` : "时间待定"),
          startMin,
          endMin,
          state: "pre" as BarState,
          noStartRecord: Boolean(bar.noStartRecord),
        };
      }),
    };
  });
}

/** 页面行数据只来自接口下发的 rows：没有数据就是空视图（不再用本地模拟数据兜底） */
const allRows = computed<ScheduleRow[]>(() => (
  Array.isArray(viewPayload?.rows) ? normalizeViewRows(viewPayload.rows) : []
));

/**
 * 时间轴范围外扩：数据里更早 / 更晚的任务要能看到（如 06:30 的班次），
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

expandDayRange(allRows.value);

/**
 * 每一行左右两侧还有被挡住的任务时，就在那一行的对应侧浮出箭头（稿子 6832:720）；
 * 点一下把时间轴滚到该行那一侧最近的任务。
 * 放在数据 / 轴范围之后：判定用的起点必须与任务条定位用的是同一个。
 */
const { rowHints, jumpToRow } = useTimelineEdgeHint({
  rows: () => rows.value,
  dayStartMin: DAY_START_MIN,
  hourWidth: () => hourWidth.value,
  scrollLeft: currentScrollLeft,
  viewportWidth: gridWidth,
  contentWidth: () => timelineWidth.value,
  scrollTo: (left) => {
    smoothScroll.value = true;
    applyScroll(left);
  },
});

/** 收起/展开全部（稿子 6464:246 的 34×34 圆形图标按钮）：只显示前 4 个资源 */
const expanded = ref(true);
const rows = computed(() => (expanded.value ? allRows.value : allRows.value.slice(0, 4)));
function toggleExpand() {
  expanded.value = !expanded.value;
}

// 「收起 / 展开全部」会改变行数，行位置需要重新量。
// 必须写在 rows 之后：watch 会立刻执行一次 getter 收集依赖，提前引用会踩 const 的 TDZ。
watch(() => rows.value.length, () => {
  nextTick(measureRowTops);
});

/** 顶部栏日期：有接口给的业务日期就用它，否则取系统当天 */
function formatDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
const dateText = String(viewPayload?.businessDate || "").trim() || formatDate(new Date());

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

/** 分钟数 → HH:MM */
function minutesToTime(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** 时长（分钟）→「89分钟」/「3小时15分」（稿子样本的写法：2 小时内按分钟） */
function lengthText(total: number) {
  const minutes = Math.max(total, 0);
  if (minutes < 120) return `${minutes}分钟`;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return minute ? `${hour}小时${minute}分` : `${hour}小时`;
}

/** 条内时间文案（没给就按起止拼） */
function barTimeText(bar: ScheduleBar) {
  return bar.timeText || `${minutesToTime(bar.startMin)}-${minutesToTime(bar.endMin)}`;
}

/** 类别 → 作业内容（稿子样本：搅拌运输车「混凝土运输」、现场泵车「混凝土浇筑」） */
const WORK_TYPE: Record<string, string> = {
  供料: "混凝土供应",
  泵车: "混凝土浇筑",
  运输: "混凝土运输",
};

/**
 * 按当前时刻判断任务状态（接口没给 status 时用它兜底）。
 * 「计划开始时间已过 + 未收到开始记录」按逾期未开始处理（稿子样本 4）。
 */
function statusOf(bar: ScheduleBar): TaskDetailPanelStatus {
  if (bar.noStartRecord && bar.startMin <= NOW_MIN) return "overdue";
  if (bar.endMin <= NOW_MIN) return "done";
  if (bar.startMin <= NOW_MIN) return "running";
  return "pending";
}

/** 任务条状态前缀（稿子 6832:13 的条内第二行写成「[执行中]08:00-13:00」） */
const BAR_STATUS_TEXT: Record<TaskDetailPanelStatus, string> = {
  running: "执行中",
  done: "已完成",
  pending: "待执行",
  overdue: "已逾期",
  canceled: "已取消",
};

/** 条内第二行：状态 + 时段 */
function barTimeLabel(bar: ScheduleBar) {
  return `[${BAR_STATUS_TEXT[statusOf(bar)]}]${barTimeText(bar)}`;
}

/** 任务条样式类：按状态取四态配色（稿子 6832:13） */
function barClass(bar: ScheduleBar) {
  return `schedule__bar--${statusOf(bar)}`;
}

/**
 * 任务状态图例（稿子 6832:13）：已完成 / 执行中 / 待执行 / 逾期未开始。
 * 对应的 10×10 色块：6832:212 / 6832:280 / 6832:278 / 6832:273。
 */
const legend = [
  { key: "done", label: "已完成" },
  { key: "running", label: "执行中" },
  { key: "pending", label: "待执行" },
  { key: "overdue", label: "逾期未开始" },
] as const;

/**
 * 点击任务条：按稿子 6832:292 + 6832:283 四态样本组装右侧详情面板的数据。
 * 站点 / 规格 / 方量 / 上一程 / 下一程都从接口下发的任务条里推；
 * 「当前进度」与「逾期警告」按任务状态动态给。
 */
function onTaskTap(bar: ScheduleBar, row: ScheduleRow) {
  const [vehicle = "", plate = ""] = row.names;
  const [carNo = "", driver = ""] = String(vehicle).split("|");
  const index = row.bars.findIndex(item => item.id === bar.id);
  const prev = index > 0 ? row.bars[index - 1] : null;
  const next = index >= 0 && index < row.bars.length - 1 ? row.bars[index + 1] : null;
  const status = statusOf(bar);
  const first = row.bars[0];
  // 站点取条标题的第一段（「万达基地 C20 12立方」→「万达基地」），规格/方量取「C20」「12立方」
  const site = String(bar.title || "").split(" ")[0] || "—";
  const spec = (String(bar.title || "").match(/C\d+/) || [""])[0];
  const volume = (String(bar.title || "").match(/[\d.]+立方/) || [""])[0].replace("立方", "方") || "—";
  // 逾期分钟数（计划开始时间到现在）
  const overdueMin = Math.max(NOW_MIN - bar.startMin, 0);
  detail.value = {
    title: [carNo || vehicle, row.category, driver || plate].filter(Boolean).join("|"),
    status,
    site,
    workType: WORK_TYPE[row.category] || "混凝土作业",
    spec,
    volume,
    supplyNote: `预计 ${row.bars.length} 车次送料`,
    planTime: `${minutesToTime(bar.startMin)} - ${minutesToTime(bar.endMin)}（${lengthText(bar.endMin - bar.startMin)}）`,
    progress:
      status === "running"
        ? `作业中（已作业${lengthText(NOW_MIN - bar.startMin)}）`
        : status === "done"
          ? "已完工"
          : status === "pending"
            ? "已就位，等待发车"
            : "",
    support: first ? `首车 ${carNo || vehicle} ${minutesToTime(first.startMin)} 到场，车队连续送料` : "—",
    previous: prev ? `${barTimeText(prev)} ${prev.title}` : "—",
    next: next ? `${barTimeText(next)} ${next.title}` : "—",
    // 仅「逾期未开始」给警告块（稿子样本 4）
    warning:
      status === "overdue"
        ? {
            title: `计划未开始（逾期 ${overdueMin}分钟）`,
            text: `计划 ${minutesToTime(bar.startMin)} 开始，截至 ${minutesToTime(NOW_MIN)} 系统未收到开始记录，上一程已结束 ${overdueMin} 分钟，请核实现场情况。`,
          }
        : undefined,
  };
  detailVisible.value = true;
}
</script>

<template>
  <view class="schedule" :class="{ 'schedule--rotated': rotated }">
    <!-- 顶部栏（稿子 6464:150：标题 6464:277 / 日期 6464:278 / 收起全部 6464:246 / 返回 10474:18）；
         原生横屏全屏时顶部留出状态栏高度（见 headerTopStyle） -->
    <view class="schedule__header" :style="headerTopStyle">
      <view class="schedule__title-group">
        <text class="schedule__title">
          调度视图·预排草案
        </text>
        <text class="schedule__date">
          {{ dateText }}
        </text>
      </view>

      <view class="schedule__tools">
        <!-- 收起/展开全部：34×34 圆形图标按钮（6464:246：白底 + 圆角 36 + 阴影，图标 6464:248） -->
        <!-- <view class="schedule__collapse" @tap="toggleExpand">
          <view class="schedule__collapse-icon" :class="{ 'schedule__collapse-icon--open': expanded }" />
        </view> -->

        <!-- 任务状态图例（稿子 6832:13；色块 10×10 圆角 3），贴着返回按钮放 -->
        <view class="schedule__legend">
          <view v-for="item in legend" :key="item.key" class="schedule__legend-item">
            <view class="schedule__legend-chip" :class="`schedule__legend-chip--${item.key}`" />
            <text class="schedule__legend-text">
              {{ item.label }}
            </text>
          </view>
        </view>

        <!-- 返回对话页：图标为「托盘 + 向上箭头」 -->
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
        <view class="schedule__side-view">
          <view class="schedule__side-list">
        <view v-for="row in rows" :key="row.id" class="schedule__side-row">
          <!-- 左列两行：第一行「类别 + 名称」（6464:300 类别 / 6464:297 名称），第二行车号|班次（6464:296） -->
          <view class="schedule__side-lines">
            <view class="schedule__side-line">
              <text class="schedule__side-category">
                {{ row.category }}
              </text>
              <text v-if="row.names[0]" class="schedule__side-name schedule__side-name--main">
                {{ row.names[0] }}
              </text>
            </view>
            <text v-for="name in row.names.slice(1)" :key="name" class="schedule__side-name">
              {{ name }}
            </text>
          </view>
        </view>
          </view>
        </view>
      </view>

      <view id="schedule-pre-grid" class="schedule__grid-wrap">
        <!-- 时间轴刻度（钉在可视区上沿，不随横向滚动滑出）：
             标签位置 = 列位置 − 当前滚动量，滚动时刻度条本身不动、标签仍与下方列对齐 -->
        <view class="schedule__ruler">
          <!-- 刻度间隔随缩放变（缩小 2 小时 / 放大半小时），位置 = 列位置 − 当前滚动量 -->
          <text
            v-for="tick in ticks"
            :key="tick.min"
            class="schedule__ruler-label"
            :style="{ left: `${tick.left - currentScrollLeft}px` }"
          >
            {{ tick.label }}
          </text>
        </view>

        <scroll-view
          class="schedule__grid"
          scroll-x
          :show-scrollbar="false"
          :scroll-left="scrollLeftProp"
          :scroll-with-animation="smoothScroll"
          @scroll="onTimelineScroll"
        >
          <!-- --hour-width：竖网格线间距跟着双指缩放走 -->
          <view
            class="schedule__grid-inner"
            :style="{ width: `${timelineWidth}px`, '--hour-width': `${hourWidth}px` }"
          >
          <!-- 内容区：纵向滚动（时间轴刻度固定在上面） -->
          <view class="schedule__rows">
            <view class="schedule__rows-inner">
          <!-- 排程行：每行一个时间条区域，按起止时间定位任务条 -->
          <view v-for="row in rows" :key="row.id" class="schedule__track">
            <view
              v-for="bar in row.bars"
              :key="bar.id"
              class="schedule__bar"
              :class="[barClass(bar), { 'schedule__bar--mark': bar.highlight }]"
              :style="barStyle(bar)"
              @tap="onTaskTap(bar, row)"
            >
              <text class="schedule__bar-title">
                {{ bar.title }}
              </text>
              <!-- 第二行：状态 + 时段（稿子 6832:13） -->
              <text class="schedule__bar-time">
                {{ barTimeLabel(bar) }}
              </text>
            </view>
          </view>
            </view>
          </view>
          </view>
        </scroll-view>
      </view>

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


    <!-- 右下角输入条（稿子 6694:82 空态 / 4704:261 语音态 / 4704:235 有内容态） -->
    <ScheduleAskBar @send="onAskSend" />

    <!-- 任务详情面板（横屏右侧，点击任务条滑出，稿子 6832:292） -->
    <AiTaskDetailPanel v-model:visible="detailVisible" :detail="detail" />
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

/* ---------- 顶部栏 ---------- */
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

/* 图例（稿子 6832:13）：色块 10×10 圆角 3 + 11px 标签；放在右侧工具区、贴返回按钮 */
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
  border: 1px solid #ffffff;
  background: #f0f0f0;
}

.schedule__legend-chip--running {
  background: #ecf5ff;
}

.schedule__legend-chip--pending {
  border-color: #f2f2f2;
  background: #ffffff;
}

.schedule__legend-chip--overdue {
  border-color: #767676;
  border-style: dashed;
  background: #ffffff;
}

.schedule__legend-text {
  font-size: 11px;
  color: #000000;
}

.schedule__tools {
  display: flex;
  align-items: center;
  gap: 16px;
}

/* 收起/展开全部：34×34 圆形图标按钮（白底 + 圆角 36 + 阴影 0 3px 5px rgba(0,0,0,.086)） */
.schedule__collapse {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 34px;
  height: 34px;
  border-radius: 36px;
  background: #ffffff;
  box-shadow: 0 3px 5px -1px rgba(0, 0, 0, 0.086);
}

.schedule__collapse:active {
  opacity: 0.7;
}

/* 收起态：向下的 v（展开态朝上） */
.schedule__collapse-icon {
  width: 9px;
  height: 9px;
  border-right: 1.5px solid #1a1a1e;
  border-bottom: 1.5px solid #1a1a1e;
  transform: rotate(45deg) translate(-1px, -1px);
}

.schedule__collapse-icon--open {
  transform: rotate(-135deg) translate(-1px, -1px);
}

/* 返回对话页（稿子 10474:16：底 #FBFBFB + 描边 #F2F2F2、圆角 6） */
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

.schedule__exit-arrow {
  position: absolute;
  left: 50%;
  bottom: 1px;
  width: 1.5px;
  height: 11px;
  margin-left: -0.75px;
  background: #222222;
}

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
  width: 140px;
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

/* 资源行：行高 45，与右侧 track 一一对应，内容上下居中 */
.schedule__side-row {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  box-sizing: border-box;
  height: 45px;
  padding: 0 8px 0 10px;
  overflow: hidden;
}

.schedule__side-lines {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* 第一行：类别与名称同行（6464:300 / 6464:297） */
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

/* 副行（车号|班次）：11px 常规 #999（6464:296） */
.schedule__side-name {
  font-size: 11px;
  line-height: 13px;
  font-weight: 400;
  color: #999999;
  white-space: nowrap;
}

/* 第一行里的名称：11px Medium #000（6464:297） */
.schedule__side-name--main {
  font-weight: 500;
  color: #000000;
}

/* 右侧排程区：上沿固定刻度条 + 下面横向可滚的排程区
   刻度条放在滚动容器外面，横向滚动时它不会被一起带出可视区（标签按滚动量反向偏移） */
.schedule__grid-wrap {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  background: #fbfbfb;
  /* 手势挂在整块上（含刻度条），从刻度条上起手也能拖动 / 缩放 */
  touch-action: none;
}

/* 横向可滚；底色与表体一致，时间轴尽头之外不露白
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
  /* 表体底色 #FBFBFB（6464:167），每小时一条竖网格线 #F3F3F3（间距随双指缩放走） */
  background-color: #fbfbfb;
  background-image: repeating-linear-gradient(
    to right,
    #f3f3f3 0,
    #f3f3f3 1px,
    transparent 1px,
    transparent var(--hour-width, 56px)
  );
  /* 刻度条已移出滚动容器，竖网格线从排程区顶部开始画 */
  background-position: 0 0;
}

/* 刻度条：固定在排程区上沿（在滚动容器外），滚动时标签溢出部分直接裁掉 */
.schedule__ruler {
  position: relative;
  flex-shrink: 0;
  box-sizing: border-box;
  height: 45px;
  overflow: hidden;
  background: #fbfbfb;
}

.schedule__ruler-label {
  position: absolute;
  bottom: 8px;
  font-size: 12px;
  // font-style: italic;
  color: #1a1a1e;
}

/* 每行高 45，与左侧资源行一一对应 */
.schedule__track {
  position: relative;
  box-sizing: border-box;
  height: 45px;
}

/* 任务条：40 高、圆角 6、白底 + #F2F2F2 描边、条内两行（6464:156/157/282） */
.schedule__bar {
  position: absolute;
  top: 2px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  box-sizing: border-box;
  height: 40px;
  padding: 0 8px;
  border: 1px solid #f2f2f2;
  border-radius: 6px;
  background: #ffffff;
  overflow: hidden;
}

/* 任务条四态（稿子 6832:13）：底 / 描边按状态切换 */
.schedule__bar--running {
  border-color: #ffffff;
  background: #ecf5ff;
}

.schedule__bar--done {
  border-color: #ffffff;
  background: #f0f0f0;
}

.schedule__bar--pending {
  border-color: #f2f2f2;
  background: #ffffff;
}

/* 已逾期：白底 + #767676 虚线 [2,2] */
.schedule__bar--overdue {
  border-style: dashed;
  border-color: #767676;
  background: #ffffff;
}

.schedule__bar:active {
  opacity: 0.85;
}

/* 强调条：红描边 #C8201E（6464:358） */
.schedule__bar--mark {
  border-color: #c8201e;
}

.schedule__bar-title {
  font-size: 11px;
  font-weight: 500;
  line-height: 13px;
  color: #1a1a1e;
  white-space: nowrap;
}

.schedule__bar-time {
  font-size: 11px;
  font-weight: 400;
  line-height: 13px;
  color: #999999;
  white-space: nowrap;
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

/* 右侧排程区：占满刻度条以下的剩余高度（刻度条在 .schedule__grid-wrap 里另占 45px） */
.schedule__grid {
  height: auto;
  min-height: 0;
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

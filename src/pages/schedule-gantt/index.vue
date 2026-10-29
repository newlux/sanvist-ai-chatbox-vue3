<script setup lang="ts">
import type { GanttViewRow } from "@/api/chat/types";
import type { TaskDetailPanelPayload, TaskDetailPanelStatus } from "@/components/ai-task-detail-panel/types";
import type { SchedulePinchEvent } from "@/hooks/useScheduleGestures";
import type { NativePhoneInfo } from "@/utils/platform/mpaas";

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AiTaskDetailPanel from "@/components/ai-task-detail-panel/index.vue";
import ScheduleAskBar from "@/components/schedule-ask-bar/index.vue";
import { useLandscape } from "@/hooks/useLandscape";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useScheduleGestures } from "@/hooks/useScheduleGestures";
import { useTimelineEdgeHint } from "@/hooks/useTimelineEdgeHint";
import { getPhoneInfo } from "@/utils/platform/mpaas";
import { backFromScene } from "@/utils/scene-navigation";
import { stashPendingScheduleAsk } from "@/utils/schedule-ask";
import { consumePendingScheduleView } from "@/utils/schedule-view";

/**
 * 横屏调度视图（稿子 6832:13）——每个资源一行，行内平铺当班任务，任务条按状态配色。
 *
 * 版面：横屏 812×375（每小时 56px，时间轴从 08:00 起，终点 = 最晚任务结束 + 2 小时向下取整到整点；
 * 跨过 24:00 时在零点位置画一条红色细实线并标「+1天」）
 * - 顶部栏：标题「调度视图」+ 日期（6832:15 / 6832:186），右侧是任务状态图例（6832:275）
 *   与返回对话页按钮（10474:18，与预排 / 重排调度视图同款 28×28 纯图标）；
 * - 左侧资源列（140px）：第一行「类别 + 名称」，第二行车号|班次；
 * - 右侧排程区：时间轴刻度 + 竖向网格（#F3F3F3）+ 任务条（按起止时间定位）+ 时间线，可横向滚动；
 * - 右下角输入条（components/schedule-ask-bar）：问的问题带回作业协同对话页再发送；
 * - 点击任务条：右侧滑出任务详情面板（6832:292）。
 *
 * 横屏方式与其它调度视图一致：`useLandscape()` 默认把页面整体旋转 90° 模拟横屏
 * （设备竖屏持握、不申请全屏权限），离开页面自动还原；需要真锁方向时传 `{ lock: true }`。
 *
 * 任务条（稿子 6832:13）：40 高、圆角 6、条内两行（任务名 + `[状态]起止`），按状态四态配色：
 * 执行中 #ECF5FF + #FFFFFF 描边 / 已完成 #F0F0F0 / 待执行 #FFFFFF + #F2F2F2 / 已逾期 #FFFFFF + #767676 虚线。
 *
 * 时间线（稿子 6832:208 虚线 + 6832:209 胶囊）：**取系统当前时间**，每 30 秒刷新一次。
 *
 * 双指缩放：旋转页面里浏览器原生 pinch 不生效，由 useScheduleGestures 接管两指手势，
 * 按两指间距的变化比例改「每小时像素宽」（28–168px，基准 56px），捏合中心的时刻保持不动；
 * 刻度、任务条、竖网格线、左右提示箭头都跟着缩放实时重排。
 */

defineOptions({ name: "ScheduleGanttPage" });

/**
 * 进入页面自动横屏（默认旋转模拟），离开时还原。
 * 旋转会改变排程区的实际宽度：必须重排一次再量（否则用的是旋转前的竖屏宽度，箭头会判错、跳偏）。
 */
const { rotated, exitLandscape } = useLandscape(measureLayout);

/**
 * 顶部状态栏空白：调原生 landscapeFullscreen 转屏成功后，webview 铺满横屏、
 * 状态栏压在页面顶边，顶栏要给状态栏让出这段高度；
 * CSS 旋转模拟（rotated）时状态栏在设备的物理顶边（对应页面左侧），不需要留。
 */
const { safeTopPx } = useSafeArea();
const headerTopStyle = computed(() => ({ paddingTop: rotated.value ? "" : `${safeTopPx.value}px` }));

/** 手势接管在 measureRowTops / syncRowTops 之后接线（要读旋转状态与行偏移量） */

/** 任务详情面板（点击任务条从右侧滑出，稿子 6832:292） */
const detailVisible = ref(false);
const detail = ref<TaskDetailPanelPayload | null>(null);

/** 时间轴：每小时像素宽基准 56px（稿子 1x，双指捏合在 28–168 之间缩放）；起点基准 08:00 */
const DEFAULT_HOUR_WIDTH = 56;
const HOUR_WIDTH_MIN = 28;
const HOUR_WIDTH_MAX = 168;
/** 当前每小时像素宽（双指缩放会改它，刻度 / 任务条 / 网格线都跟着走） */
const hourWidth = ref(DEFAULT_HOUR_WIDTH);
const DESIGN_DAY_START_MIN = 8 * 60;
/** 没有任务数据时的兜底终点（稿子基准 21:00）；有数据时按「最晚结束 + 2 小时取整」算 */
const DESIGN_DAY_END_MIN = 21 * 60;
/** 轴尾预留 2 小时：最晚任务结束后再留一段，向下取整到整点（20:15 → 22:15 → 22:00） */
const TIMELINE_TAIL_MIN = 2 * 60;
/** 时间轴实际范围（分钟）：由 expandDayRange() 按任务数据算出来 */
let DAY_START_MIN = DESIGN_DAY_START_MIN;
let DAY_END_MIN = DESIGN_DAY_END_MIN;

/* ------------------------------------------------------------------
 * AI 下发的调度视图数据（COMPONENT scene=task / type=gantt → data）
 * ------------------------------------------------------------------ */
/**
 * 气泡入口卡点进来时写下的整包 data，打开本页取走（取完即清）；
 * 没有数据（比如从作业协同页的入口卡直接进来、或接口没下发 rows）就渲染空视图。
 * 声明放在最前面：下面判断「当前时间虚线要不要画」的 computed 要读 viewType。
 */
const viewPayload = consumePendingScheduleView();

/* ---------- 时间线（稿子 6832:208 虚线 / 6832:209 胶囊）----------
   取**系统当前时间**，每 30 秒刷新一次；任务状态优先用数据里的 status，没给才按当前时刻推。 */
function currentMinutes() {
  const date = new Date();
  return date.getHours() * 60 + date.getMinutes();
}

const nowMinutes = ref(currentMinutes());
/**
 * 当前时间虚线只在全量调度视图（viewType=schedule 或缺省）里画。
 * 预排（pre）/ 重排（replan）各自走自己的页面、都不画这条线；
 * 万一 pre 数据误入本页也不显示，避免两套视图的规范不一致。
 * （viewPayload 在本文件靠下声明：computed 惰性求值，渲染时已完成初始化）
 */
const nowLineEnabled = computed(() => {
  const viewType = String(viewPayload?.viewType || "").trim().toLowerCase();
  return !viewType || viewType === "schedule";
});
/** 时间线落在轴外时不画（轴已把当前时间包进来，正常不会出现） */
const nowVisible = computed(
  () => nowLineEnabled.value && nowMinutes.value >= DAY_START_MIN && nowMinutes.value <= DAY_END_MIN,
);
/** 时间线在时间轴内的横向位置 */
const nowStyle = computed(() => ({ left: `${((nowMinutes.value - DAY_START_MIN) / 60) * hourWidth.value}px` }));
/** 胶囊里的时间文案（HH:MM） */
const nowText = computed(() => minutesToTime(nowMinutes.value));
let nowTimer: ReturnType<typeof setInterval> | null = null;

/* ---------- 跨天分界（24:00 / 次日 00:00）----------
   轴扩过零点时（有跨天任务 / 当前时间在零点后），在 24:00 处画一条红色细实线，
   位置与长度跟当前时间虚线一致（都从刻度条下沿拉到排程区底部），顶部标「+1天」。
   稿子 6694:277：文本 12px Inter Italic #C8201E、无胶囊底，压在线顶并水平居中。 */
const NEXT_DAY_BOUNDARY_MIN = 24 * 60;
const nextDayVisible = computed(
  () => NEXT_DAY_BOUNDARY_MIN >= DAY_START_MIN && NEXT_DAY_BOUNDARY_MIN <= DAY_END_MIN,
);
const nextDayStyle = computed(() => ({
  left: `${((NEXT_DAY_BOUNDARY_MIN - DAY_START_MIN) / 60) * hourWidth.value}px`,
}));
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
   所以屏幕方向拖动由 hooks/useScheduleGestures 接管、原生滚动只读不回写。
   关键：`:scroll-left` 只在拖动时赋值，**不能**拿 @scroll 的值回写，
   否则每次滚动都会被赋回同一个值，表现就是一顿一顿的。 */
/** 绑给 scroll-view 的位置（只在拖动时改） */
const scrollLeftProp = ref(0);
/** 实际滚动位置（从 @scroll 读，拖动起点与左右提示判定用） */
const currentScrollLeft = ref(0);
/** 拖动时关掉滚动动画（否则跟手迟滞） */
const smoothScroll = ref(true);
/** 时间轴可视宽度（H5 量一次） */
const gridWidth = ref(0);

function applyScroll(left: number) {
  const next = Math.max(0, Math.round(left));
  if (next === scrollLeftProp.value) return;
  scrollLeftProp.value = next;
  currentScrollLeft.value = next;
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
  if (next === prev) return Math.round(contentX - localX);
  hourWidth.value = next;
  const ratio = next / prev;
  const max = Math.max(0, timelineWidth.value - gridWidth.value);
  const target = Math.min(Math.max(contentX * ratio - localX, 0), max);
  // 内容宽随缩放变化：等新宽度渲染后再补滚动位置，否则会被旧宽度夹住；
  // 目标值先同步返回给手势层维护缩放锚点，连续缩放时中心不漂移
  nextTick(() => applyScroll(target));
  return Math.round(target);
}

function measureGrid() {
  // #ifdef H5
  const el = document.getElementById("schedule-gantt-grid");
  if (el) gridWidth.value = el.clientWidth;
  // #endif
}

/** 每行箭头相对 .schedule__body 顶部的 Y（取行中心，px）；-1 表示该行没渲染出来 */
const rowTops = ref<number[]>([]);
/** 每行箭头的布局坐标（未扣内容区平移量） */
const layoutRowTops = ref<number[]>([]);

/**
 * 量出每一行的纵向中心（**布局坐标**）。
 * 不能用 getBoundingClientRect：横屏是 body 整体 rotate(90deg) 模拟的，rect 是视觉坐标，
 * 行间纵向差会被旋转成横向差，所有行量出来同一个 top，箭头锚点全叠到一处（竖屏持握时箭头全跑丢）。
 * offsetTop 链是布局值，不受 transform 影响，旋转前后都准。
 */
function measureRowTops() {
  // #ifdef H5
  const body = document.querySelector<HTMLElement>(".schedule__body");
  const tracks = Array.from(document.querySelectorAll<HTMLElement>(".schedule__track"));
  if (!body || tracks.length === 0) return;
  /** 从元素沿 offsetParent 链累加到 .schedule__body 的布局 top */
  const topWithin = (el: HTMLElement) => {
    let top = 0;
    let node: HTMLElement | null = el;
    while (node && node !== body) {
      top += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    return node === body ? top : -1;
  };
  layoutRowTops.value = rows.value.map((_row, index) => {
    const el = tracks[index];
    if (!el) return -1;
    return topWithin(el) + el.offsetHeight / 2;
  });
  syncRowTops();
  // #endif
}

/** 内容区已平移的纵向偏移（手势滚动时更新；箭头位置要按它扣掉） */
const rowsOffsetY = ref(0);

/** 箭头 Y = 行布局中心 − 内容区已平移量（手势纵向滚动时箭头跟着行走） */
function syncRowTops() {
  rowTops.value = layoutRowTops.value.map(top => (top < 0 ? -1 : top - rowsOffsetY.value));
}

/**
 * 原生手势在真机不生效（旋转页面里浏览器不接管）：自己接管触摸，见 hooks/useScheduleGestures。
 * isRotated 决定屏幕方向映射哪一路（CSS 旋转模拟横屏 ≠ 宿主原生转屏全屏）；
 * 纵向平移量回写 rowsOffsetY，箭头锚点跟着行走。
 */
useScheduleGestures({
  gridId: "schedule-gantt-grid",
  isRotated: () => rotated.value,
  // 双指捏合 → 时间轴缩放：不传 onPinch 时 hook 根本不会接管两指手势，
  // 表现就是「缩小放大失效」（见 hooks/useScheduleGestures 的 onStart/onMove）
  onPinch: onTimelinePinch,
  // 捏合期间关掉滚动动画，松手再恢复：避免连续缩放时滚动动画反复起停造成闪烁
  onPinchStart: () => {
    smoothScroll.value = false;
  },
  onPinchEnd: () => {
    smoothScroll.value = true;
  },
  onRowsOffset: (offset) => {
    rowsOffsetY.value = offset;
    syncRowTops();
  },
});

function measureLayout() {
  measureGrid();
  measureRowTops();
}

/**
 * 进页面时向宿主取一次设备信息（getPhoneInfo，仅 mPaaS 容器内有值）。
 * 先原样打印出来便于对着真机日志确认机型；后续按 model / manufacturer / sdkInt 做机型适配时读 phoneInfo。
 */
const phoneInfo = ref<NativePhoneInfo | null>(null);

async function loadPhoneInfo() {
  const info = await getPhoneInfo();
  phoneInfo.value = info;
  // 用 console.log 而不是 logger.info：产物里 info 会被日志级别过滤掉，真机上就看不到了
  console.log("[schedule-gantt][getPhoneInfo] 设备信息", info);
}

onMounted(() => {
  loadPhoneInfo();
  measureLayout();
  // 首帧布局可能晚一点（旋转也是下一帧才生效），下一帧再量一次
  nextTick(measureLayout);
  // 时间线取系统当前时间：每 30 秒对一次表（分钟级精度，不用每秒刷）
  nowTimer = setInterval(() => {
    nowMinutes.value = currentMinutes();
  }, 30_000);
  // #ifdef H5
  window.addEventListener("resize", measureLayout);
  // #endif
});

onBeforeUnmount(() => {
  if (nowTimer) {
    clearInterval(nowTimer);
    nowTimer = null;
  }
  // #ifdef H5
  window.removeEventListener("resize", measureLayout);
  // #endif
});

/** 任务状态（稿子 6832:13 图例四态；「已取消」只出现在重排页，这里用不到） */
type ScheduleBarStatus = Exclude<TaskDetailPanelStatus, "canceled">;

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
  /** 任务状态（接后端时用接口给的 status；没给就按当前时刻推） */
  status?: ScheduleBarStatus;
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

/** 接口 state → 页面四态；认不出 / 没给就留空，交给 statusOf() 按当前时刻推 */
function statusFromState(state: unknown): ScheduleBarStatus | undefined {
  const key = String(state || "").trim().toLowerCase();
  if (key === "done" || key === "finished" || key === "completed") return "done";
  if (key === "running" || key === "executing") return "running";
  if (key === "overdue") return "overdue";
  if (key === "planned" || key === "planning" || key === "new" || key === "pending") return "pending";
  return undefined;
}

/** 接口还没排时间的条：每条按 2 小时一节依次排开 */
const UNSCHEDULED_SLOT_MIN = 2 * 60;

/**
 * 接口 rows → 页面行模型。
 * - 起止时间直传；**接口没排时间（startMin/endMin 为 null）**时按数组顺序在轴起点依次排开、
 *   条内时间写「时间待定」——否则按 null 定位会算出 NaN，任务条直接跑出画面；
 * - 状态取 `state` 映射，映射不到就留空（页面按当前时刻推）。
 */
function normalizeViewRows(viewRows: GanttViewRow[]): ScheduleRow[] {
  return viewRows.map((row, rowIndex) => {
    let cursor = DESIGN_DAY_START_MIN;
    return {
      id: String(row.id || `resource-${rowIndex + 1}`),
      category: String(row.category || "").trim() || "—",
      names: Array.isArray(row.names) ? row.names.map(name => String(name || "")) : [],
      bars: (Array.isArray(row.bars) ? row.bars : []).map((bar, barIndex) => {
        // null 不能直接 Number()：会被当成 0，误判成「已排在 00:00」
        const start = bar.startMin == null ? Number.NaN : Number(bar.startMin);
        const end = bar.endMin == null ? Number.NaN : Number(bar.endMin);
        // 跨天任务：接口把结束时间按当天记（23:00 → 次日 02:00 记成 120），补一天再定位，
        // 否则会被当成「结束早于开始」的脏数据排到轴起点，次日 02:00 那段也画不出来。
        const endMin = Number.isFinite(start) && Number.isFinite(end) && end < start ? end + 24 * 60 : end;
        const planned = Number.isFinite(start) && Number.isFinite(endMin) && endMin > start;
        const slotStart = cursor;
        if (!planned) cursor += UNSCHEDULED_SLOT_MIN;
        return {
          id: String(bar.id || `task-${rowIndex + 1}-${barIndex + 1}`),
          title: String(bar.title || "").trim(),
          timeText: String(bar.timeText || "").trim() || (planned ? "" : "时间待定"),
          startMin: planned ? start : slotStart,
          endMin: planned ? endMin : slotStart + UNSCHEDULED_SLOT_MIN,
          status: statusFromState(bar.state),
          noStartRecord: Boolean(bar.noStartRecord),
        };
      }),
    };
  });
}

/** 页面行数据只来自接口下发的 rows：没有数据就是空视图（不再用本地模拟数据兜底） */
const rows = computed<ScheduleRow[]>(() => (
  Array.isArray(viewPayload?.rows) ? normalizeViewRows(viewPayload.rows) : []
));

// 行数变化（收起 / 展开、接口数据晚到）：行位置与排程区宽度都要重新量。
// 必须写在 rows 之后：watch 会立刻执行一次 getter 收集依赖，提前引用会踩 const 的 TDZ。
watch(() => rows.value.length, () => {
  nextTick(measureLayout);
});

/**
 * 时间轴范围只由接口返回的任务时间决定：
 * - 起点：稿子基准 08:00；数据里有更早的任务（如 07:20 的夜班收尾）就按最早开始向下取整，前面不加余量；
 * - 终点：最晚任务结束 + 2 小时，再**向下取整**到整点 —— 任务到 20:15 → 22:15 → 轴到 22:00；
 *   任务跨夜到 01:30 → 轴到 03:00，24:00 那条「+1天」红色实线由 nextDayVisible 控制。
 * 不再把「当前时间」包进轴里：轴长只跟任务范围走，当前时间落在轴外就不画时间线。
 */
function expandDayRange(list: ScheduleRow[]) {
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  list.forEach((row) => {
    row.bars.forEach((bar) => {
      earliest = Math.min(earliest, bar.startMin);
      latest = Math.max(latest, bar.endMin);
    });
  });
  if (Number.isFinite(earliest)) DAY_START_MIN = Math.min(DESIGN_DAY_START_MIN, Math.floor(earliest / 60) * 60);
  if (Number.isFinite(latest)) DAY_END_MIN = Math.floor((latest + TIMELINE_TAIL_MIN) / 60) * 60;
}

expandDayRange(rows.value);

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

/** 顶部栏日期：取系统当天，与时间线一致 */
function formatDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 顶部栏日期：有接口给的业务日期就用它，否则取系统当天 */
const dateText = String(viewPayload?.businessDate || "").trim() || formatDate(new Date());

/** 返回对话页的退场动画时长（ms）：与 .schedule 的 transition 保持一致 */
const LEAVE_ANIM_MS = 300;
/** 正在退场：缩小动画期间不再响应返回，避免重复收横屏 / 重复联网返回 */
const leaving = ref(false);
/** 退场缩放的起点（内联 transform-origin）：默认居中，点返回时改到返回按钮中心 */
const leaveOrigin = ref("center center");

/**
 * 量出返回按钮（.schedule__exit）在 .schedule 本地坐标系里的中心，整页按它等比收拢。
 *
 * 横屏是 body 整体 rotate 模拟的，getBoundingClientRect 拿到的是旋转后的视觉坐标，
 * 直接拿它当 transform-origin 会算偏；这里沿 offsetParent 链累加 offsetLeft/offsetTop，
 * 拿的是布局坐标，旋转前后都准（与 measureRowTops 同一套思路）。
 * 链没走到 .schedule（例如中途出现 fixed / 无 .schedule）时退回居中。
 */
function resolveLeaveOrigin() {
  // #ifdef H5
  const root = document.querySelector<HTMLElement>(".schedule");
  const button = document.querySelector<HTMLElement>(".schedule__exit");
  if (root && button) {
    let left = 0;
    let top = 0;
    let node: HTMLElement | null = button;
    while (node && node !== root) {
      left += node.offsetLeft;
      top += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    if (node === root) {
      return `${left + button.offsetWidth / 2}px ${top + button.offsetHeight / 2}px`;
    }
  }
  // #endif
  return "center center";
}

/**
 * 退出到对话页（返回按钮 / 输入条发问 / 语音发问共用）。
 *
 * 顺序：退场动画 → 关掉原生横屏（`landscapeFullscreen(false)`）并**等可视区确认回到竖屏**
 * → 竖屏恢复后再写入待发送问题 → 跳回对话页。
 * 之前是 `exitLandscape()` 与 `backFromScene()` 同步连着调，原生转屏还没生效就跳页，
 * 对话页和键盘会落在横屏里；问题也会在错误的视口下发出。
 *
 * `ask` 有值才走「发送问答」那一步，返回按钮不传，因此只收横屏不提问。
 *
 * 兜底路由给作业协同对话页：本页都是从作业协同对话里进来的，没有上一页可退时
 * 也要回那个会话（而不是首页），提问才落在原来的对话里。
 */
async function leaveToChat(ask?: string) {
  if (leaving.value) return;
  // 缩小的落点 = 返回按钮中心（动画开始前量一次，过渡期间布局不变）
  leaveOrigin.value = resolveLeaveOrigin();
  leaving.value = true;
  await new Promise<void>(resolve => setTimeout(resolve, LEAVE_ANIM_MS));
  // 原生横屏置 false 之后要等屏幕真的转回来，再跳页 / 发问
  await exitLandscape();
  if (ask) stashPendingScheduleAsk(ask);
  backFromScene("/pages/task/index");
}

/** 左上角返回按钮（模板直接绑这个，忽略事件参数） */
function backToChat() {
  void leaveToChat();
}

/**
 * 右下角输入条发送（键盘 / 语音问完自动返回）：
 * 问题带着一起走，但仍然等竖屏恢复后才写入（对话页 onShow 取走并发送）。
 */
function onAskSend(text: string) {
  void leaveToChat(text);
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
 * 任务状态：数据带了 status 就以它为准（接后端时用接口字段）；
 * 没给才按当前时刻推 ——「计划开始时间已过 + 未收到开始记录」按逾期未开始处理（稿子样本 4）。
 */
function statusOf(bar: ScheduleBar): TaskDetailPanelStatus {
  if (bar.status) return bar.status;
  if (bar.noStartRecord && bar.startMin <= nowMinutes.value) return "overdue";
  if (bar.endMin <= nowMinutes.value) return "done";
  if (bar.startMin <= nowMinutes.value) return "running";
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
  // 逾期分钟数（计划开始时间到系统当前时间）
  const overdueMin = Math.max(nowMinutes.value - bar.startMin, 0);
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
        ? `作业中（已作业${lengthText(nowMinutes.value - bar.startMin)}）`
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
            text: `计划 ${minutesToTime(bar.startMin)} 开始，截至 ${minutesToTime(nowMinutes.value)} 系统未收到开始记录，上一程已结束 ${overdueMin} 分钟，请核实现场情况。`,
          }
        : undefined,
  };
  detailVisible.value = true;
}
</script>

<template>
  <view
    class="schedule"
    :class="{ 'schedule--rotated': rotated, 'schedule--leaving': leaving }"
    :style="{ transformOrigin: leaveOrigin }"
  >
    <!-- 顶部栏（稿子 6832:15 标题 / 6832:186 日期 / 6832:275 图例 / 10474:18 返回）；
         原生横屏全屏时顶部留出状态栏高度（见 headerTopStyle） -->
    <view class="schedule__header" :style="headerTopStyle">
      <view class="schedule__title-group">
        <text class="schedule__title">
          调度视图
        </text>
        <text class="schedule__date">
          {{ dateText }}
        </text>
      </view>

      <view class="schedule__tools">
        <!-- 任务状态图例（稿子 6832:275；色块 10×10 圆角 3），贴着返回按钮放 -->
        <view class="schedule__legend">
          <view v-for="item in legend" :key="item.key" class="schedule__legend-item">
            <view class="schedule__legend-chip" :class="`schedule__legend-chip--${item.key}`" />
            <text class="schedule__legend-text">
              {{ item.label }}
            </text>
          </view>
        </view>

        <!-- 返回对话页（稿子 10474:18 图标 / 10474:16 底）：与预排、重排调度视图同款纯图标按钮 -->
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

      <view id="schedule-gantt-grid" class="schedule__grid-wrap">
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

          <!-- 时间线（稿子 6832:208 虚线 + 6832:209 胶囊）：取系统当前时间，画在刻度条下方的排程区上 -->
          <view v-if="nowVisible" class="schedule__now" :style="nowStyle">
            <view class="schedule__now-capsule">
              {{ nowText }}
            </view>
          </view>

          <!-- 跨天分界（24:00 / 次日 00:00）：红色细实线（与当前时间虚线同位置同样长度），顶部标「+1天」 -->
          <view v-if="nextDayVisible" class="schedule__day-end" :style="nextDayStyle">
            <text class="schedule__day-end-label">
              +1天
            </text>
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
/* 横屏稿件 6832:13：812 × 375，元素尺寸直接按稿件 px（横屏可视区宽约 812 时与稿一致，窄则横向滚动兜住）
   版式要点：左列 140（底 #FBFBFB / 描边 #F2F2F2）、每小时 56px、行高 45、任务条 40 高按状态配色 */
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
  /* 返回退场：整体缓慢缩小 + 淡出（时长与页面里的 LEAVE_ANIM_MS 对齐）。
     缓动用长尾 ease-out：开头起势、后段慢慢收住，比线性更像“缓慢缩小”。
     缩放原点由模板内联的 transformOrigin 给出（返回按钮中心），这里只是兜底 */
  transform-origin: center center;
  transition: transform 0.52s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.52s ease-out;
  will-change: transform, opacity;
}

/* 旋转模拟横屏时（useLandscape）：body 已旋转 90°，页面按横屏尺寸铺开 */
.schedule--rotated {
  width: 100vh;
  height: 100vw;
}

/* 点返回：整页从画面中心缓慢收拢并淡出，动画结束后再收横屏、回对话页 */
.schedule--leaving {
  transform: scale(0.9);
  opacity: 0;
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

/* 返回对话页（稿子 10474:16：底 #FBFBFB + 描边 #F2F2F2、圆角 6）——与预排 / 重排调度视图同款 28×28 纯图标按钮 */
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

/* 隐藏 scroll-view 自带的横向滚动条（横向由屏幕方向拖动 / 行内箭头驱动） */
.schedule__grid::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.schedule__grid-inner {
  position: relative;
  /* 表体底色 #FBFBFB（6464:167），每小时一条竖网格线 #F3F3F3 */
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
  /* 高于左右隐藏箭头（z-index 5）：上下滑动时箭头会随行上移到刻度条区域，抬高这里让时间轴始终压在箭头之上 */
  z-index: 6;
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

/* 任务条（稿子 6832:13）：40 高、圆角 6、条内两行；基础态按「待执行」白底 + #F2F2F2，其余状态见下方四态 */
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

/* ---------- 时间线（稿子 6832:208 虚线 + 6832:209 胶囊）：取系统当前时间 ---------- */
/* 虚线：从刻度条下沿（= 排程区顶）一直拉到排程区底部；z-index 低于任务条，不挡内容 */
.schedule__now {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 3;
  width: 0;
  border-left: 1px dashed rgba(200, 32, 30, 0.3);
  pointer-events: none;
}

/* 时间胶囊：贴刻度条下沿、以时间线为中心 */
.schedule__now-capsule {
  position: absolute;
  top: 2px;
  left: 0;
  padding: 1px 3px;
  border-radius: 7px;
  background: #c8201e;
  color: #ffffff;
  font-size: 10px;
  line-height: 12px;
  white-space: nowrap;
  transform: translateX(-50%);
}

/* ---------- 跨天分界（24:00 / 次日 00:00）：红色细实线 + 顶部「+1天」 ---------- */
/* 与当前时间虚线同起点、同长度：从刻度条下沿一直拉到排程区底部；z-index 低于任务条，不挡内容。
   稿子 6694:278：红色 30% 细线（实线，区别于当前时间的虚线） */
.schedule__day-end {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 3;
  width: 0;
  border-left: 1px solid rgba(200, 32, 30, 0.3);
  pointer-events: none;
}

/* 「+1天」：稿子 6694:277 —— 12px Inter Italic #C8201E、无胶囊底；
   压在线顶并水平居中（刻度条已移到滚动容器外，文案留在排程区内，避免被裁掉上半截） */
.schedule__day-end-label {
  position: absolute;
  top: 4px;
  left: 0;
  color: #c8201e;
  font-family: Inter, "PingFang SC", sans-serif;
  font-size: 12px;
  font-style: italic;
  line-height: 15px;
  white-space: nowrap;
  transform: translateX(-50%);
}
</style>

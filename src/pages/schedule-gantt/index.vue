<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

import AiTaskDetailSheet from "@/components/ai-task-detail-sheet/index.vue";
import type { TaskDetailPayload, TaskDetailStatus } from "@/components/ai-task-detail-sheet/types";
import { useLandscape } from "@/hooks/useLandscape";
import { useTimelineEdgeHint } from "@/hooks/useTimelineEdgeHint";
import { createLogger } from "@/utils/logger";

/**
 * 横屏调度视图（任务状态版）——设计稿 6832:13「横屏」，基于 DHTMLX Gantt（Community 10.x，MIT）实现。
 * 文档：https://docs.dhtmlx.com/gantt/zh/
 *
 * 说明：
 * - 只用 H5：DHTMLX Gantt 是 DOM 组件，小程序端不支持，全部逻辑包在 `#ifdef H5` 里（小程序构建会被剔除）；
 * - 数据模型按 Gantt 的约定：**资源 = 可折叠的父任务**（父行），**每条任务 = 一个子行**（一行一条任务条）。
 *   设计稿是「一个资源行里横排多条任务条」，Gantt 内核不支持一行多任务条（那是资源泳道视图，需要 DHTMLX
 *   Scheduler/PRO 资源面板或自绘，见 pages/schedule 那一版），这里按 Gantt 的标准形态落地；
 * - 状态配色/字号/当前时间标记均取自稿子（见下方状态表与 CSS）。
 *
 * 状态视觉（设计稿节点）：
 *   执行中   底 #ECF5FF 描边 #FFFFFF 实线
 *   已完成   底 #F0F0F0 描边 #FFFFFF 实线
 *   待执行   底 #FFFFFF 描边 #F2F2F2 实线
 *   已逾期   底 #FFFFFF 描边 #767676 虚线 [2,2]（图例里叫「逾期未开始」）
 */

defineOptions({ name: "ScheduleGanttPage" });

// #ifdef H5
import "dhtmlx-gantt/codebase/dhtmlxgantt.css";
// #endif

const CONTAINER_ID = "schedule-gantt-root";

const logger = createLogger("schedule-gantt");

/** 时间轴范围（稿子：08:00–21:00，每小时一个刻度） */
const AXIS_START_HOUR = 8;
const AXIS_END_HOUR = 21;
/** 每小时像素宽（与 DHTMLX 的 min_column_width 保持一致） */
const HOUR_WIDTH = 56;
/** 左列（资源 / 车辆人员）宽（与 DHTMLX 的 grid_width 保持一致，时间轴可视宽需减掉它） */
const GRID_WIDTH = 140;
/** 提示箭头相对所在行顶部的居中偏移（行高 44 - 按钮 28）/2 */
const ROW_HINT_CENTER_OFFSET = 8;
/** 当前时间标记（稿子 6832:209「12:45」） */
const NOW = { hour: 12, minute: 45 };

type TaskStatus = "running" | "done" | "pending" | "overdue";

const STATUS_LABEL: Record<TaskStatus, string> = {
  running: "执行中",
  done: "已完成",
  pending: "待执行",
  overdue: "已逾期",
};

interface ScheduleTask {
  id: number;
  /** 任务名（条内第一行） */
  title: string;
  /** 所属资源（父任务） */
  parent: number;
  /** 起止时间「HH:MM」 */
  start: string;
  end: string;
  status: TaskStatus;
}

interface ScheduleResource {
  id: number;
  /** 左列第一行：类别（供料 / 泵车 / 运输） */
  category: string;
  /** 左列第二行：资源名（1号搅拌站 / 13号车|郑文斌 …） */
  name: string;
  /** 左列第三行：车号|班次（可空） */
  subName?: string;
  tasks: ScheduleTask[];
}

/**
 * Mock 数据由页面自行生成（不依赖接口，方便直接打开页面看效果）。
 * 接入后端时把 `createMockResources()` 换成接口返回的同结构数据即可。
 *
 * 行规格：[任务名, 开始, 结束, 状态]，共 6 个资源行、15 条任务（与入口卡上的「任务数 15 个」一致）。
 */
const MOCK_ROW_SPECS: Array<{
  category: string;
  name: string;
  subName?: string;
  tasks: Array<[string, string, string, TaskStatus]>;
}> = [
  {
    category: "供料",
    name: "1号搅拌站",
    subName: "供料线安排",
    tasks: [
      ["万达基地 C20 80立方", "08:00", "13:00", "running"],
      ["1号搅拌站 C20 90立方", "20:00", "20:40", "pending"],
    ],
  },
  {
    category: "泵车",
    name: "47米臂架泵",
    subName: "湘A-P0078|李海",
    tasks: [
      ["1号基站 C20 80立方", "08:00", "13:00", "running"],
      ["万达基地 C20 20立方", "20:10", "20:50", "pending"],
    ],
  },
  {
    category: "运输",
    name: "13号车|郑文斌",
    subName: "湘A-P0078|白班",
    // 同一辆车（13号车）的任务首尾相接、互不重叠
    tasks: [
      ["万达基地 C20 12立方", "08:30", "11:00", "done"],
      ["万达基地 C20 …", "13:00", "14:40", "pending"],
      ["万达基地 C20 20立方", "20:00", "20:45", "pending"],
    ],
  },
  {
    category: "运输",
    name: "13号车|肖鹏",    subName: "湘A-P0078|晚班",
    // 同一辆车（13号车·晚班）同样首尾相接
    tasks: [
      ["万达基地 C20 12立方", "08:30", "11:00", "done"],
      ["万达基地 C20 …", "13:30", "16:00", "pending"],
      ["万达基地 C20 20立方", "20:05", "20:50", "overdue"],
    ],
  },
  {
    category: "运输",
    name: "12号车|何志刚",
    subName: "湘A-R6557|白班",
    // 同一辆车（12号车）同样首尾相接
    tasks: [
      ["万达基地 C20 12立方", "09:40", "12:10", "done"],
      ["万达基地 C20 …", "12:50", "15:20", "pending"],
      ["万达基地 C20 20立方", "20:00", "20:35", "pending"],
    ],
  },
  {
    category: "运输",
    name: "10号车|黄立新",
    subName: "湘A-TY678|白班",
    tasks: [
      ["夜班收尾 C8 6立方", "07:20", "08:40", "running"],
      ["万达基地 C20 20立方", "20:10", "20:50", "pending"],
    ],
  },
];

/** 由行规格生成排程数据：资源 id = 行号，任务 id = (行号+1)*100 + 序号（稳定可复现） */
function createMockResources(): ScheduleResource[] {
  return MOCK_ROW_SPECS.map((spec, rowIndex) => {
    const resourceId = rowIndex + 1;
    return {
      id: resourceId,
      category: spec.category,
      name: spec.name,
      subName: spec.subName,
      tasks: spec.tasks.map(([title, start, end, status], taskIndex) => ({
        id: resourceId * 100 + taskIndex + 1,
        title,
        parent: resourceId,
        start,
        end,
        status,
      })),
    };
  });
}

const resources: ScheduleResource[] = createMockResources();

const legend: Array<{ key: TaskStatus; label: string }> = [
  { key: "done", label: "已完成" },
  { key: "running", label: "执行中" },
  { key: "pending", label: "待执行" },
  { key: "overdue", label: "逾期未开始" },
];

const dateText = "2025-09-26";

/** 任务详情窗口（点击任务条弹出，设计稿 6832:464） */
const detailVisible = ref(false);
const detail = ref<TaskDetailPayload | null>(null);

/** 任务条状态 → 详情窗口状态（Gantt 的「已逾期」在详情里按「待执行」展示） */
function toDetailStatus(status: TaskStatus): TaskDetailStatus {
  if (status === "done") return "done";
  if (status === "running") return "running";
  return "pending";
}

/** 点击任务条：用该任务所在的资源行拼出详情数据 */
function openTaskDetail(taskId: unknown) {
  const id = Number(taskId);
  for (const resource of resources) {
    const task = resource.tasks.find(item => item.id === id);
    if (!task) continue;
    detail.value = {
      driverName: String(resource.name).split("|").pop() || resource.name,
      dateText: `${dateText}  今天`,
      vehicleText: [resource.name, resource.subName].filter(Boolean).join("  "),
      groups: [
        {
          route: `${resource.category}｜${resource.name}`,
          items: [
            {
              start: task.start,
              end: task.end,
              name: task.title,
              status: toDetailStatus(task.status),
            },
          ],
        },
      ],
      note: `${task.title}：${task.start}-${task.end}（${STATUS_LABEL[task.status]}）。`,
    };
    detailVisible.value = true;
    return;
  }
}

/** 把「HH:MM」换算成当天 Date */
function timeOfDay(text: string) {
  const [hour, minute] = text.split(":").map(Number);
  const date = new Date();
  date.setHours(hour, minute || 0, 0, 0);
  return date;
}

function timeToMinutes(text: string) {
  const [hour, minute] = text.split(":").map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

/* ------------------------------------------------------------------
 * DHTMLX Gantt 初始化（仅 H5）
 * ------------------------------------------------------------------ */
let ganttInstance: { destructor?: () => void; setSizes?: () => void } | null = null;

/** 可视区尺寸变化后让 Gantt 重新测量画布（横屏锁定/CSS 旋转都会改变容器尺寸） */
function reflowGantt() {
  try {
    ganttInstance?.setSizes?.();
  } catch {
    // 画布尚未初始化时忽略
  }
  // setSizes 后滚动容器可能才出现，兜底确保监听挂上并同步一次尺寸
  ensureScrollListener();
}

/** 进入页面自动横屏：App 锁屏幕方向，H5 锁方向 + 旋转兜底 */
const { rotated, exitLandscape } = useLandscape(reflowGantt);

interface GanttLike {
  config: Record<string, unknown>;
  templates: Record<string, unknown>;
  plugins?: (cfg: Record<string, boolean>) => void;
  i18n?: { setLocale: (locale: string) => void };
  init: (el: HTMLElement | string) => void;
  parse: (data: unknown) => void;
  addMarker?: (cfg: Record<string, unknown>) => void;
  attachEvent?: (name: string, handler: (...args: unknown[]) => unknown) => void;
  setSizes?: () => void;
  destructor?: () => void;
}

/**
 * 取 DHTMLX Gantt 实例：ESM 构建里实例可能挂在具名导出 `gantt` 上，
 * 也可能是 default 导出本身；取不到（没有 init）就当作失败返回 null。
 */
async function resolveGantt() {
  const mod = (await import("dhtmlx-gantt")) as Record<string, unknown>;
  const defaultExport = mod.default as Record<string, unknown> | undefined;
  const candidate = (mod.gantt ?? defaultExport?.gantt ?? defaultExport ?? mod) as Record<string, unknown>;
  return typeof candidate?.init === "function" ? (candidate as unknown as GanttLike) : null;
}

/**
 * 当前时间标记（稿子 6832:208：红色胶囊 + 30% 红虚线）。
 * marker 在 v10 属于**插件能力**：`plugins({ marker: true })` 之后才有 `addMarker`。
 * 装不上时直接跳过——一个装饰性标记不能挡住整张表的渲染。
 */
function addNowMarker(g: GanttLike) {
  if (typeof g.addMarker !== "function") return false;
  try {
    const text = `${String(NOW.hour).padStart(2, "0")}:${String(NOW.minute).padStart(2, "0")}`;
    g.addMarker({ start_date: timeOfDay(text), css: "sg-now", text });
    return true;
  } catch (error) {
    logger.warn("当前时间标记添加失败，已跳过", error);
    return false;
  }
}

async function mountGantt() {
  const g = await resolveGantt();
  if (!g) {
    logger.error("DHTMLX Gantt 实例未取到，甘特图不渲染");
    return;
  }
  ganttInstance = g;

  g.config.date_format = "%Y-%m-%d %H:%i";
  // 稿子里的排程表是只读看板：关掉拖动/编辑/依赖线
  g.config.readonly = true;
  g.config.show_links = false;
  g.config.show_errors = false;
  g.config.row_height = 44;
  g.config.bar_height = 40;
  // 左列宽 140（稿子 6464:279 的 Rectangle 110 宽 140）
  g.config.grid_width = GRID_WIDTH;
  // 每小时 56px，与稿子的时间轴刻度一致（13 小时 ≈ 728px，横屏内基本一屏放下）
  g.config.min_column_width = HOUR_WIDTH;
  g.config.scales = [{ unit: "hour", step: 1, format: "%H:%i" }];
  // 时间轴固定 08:00–21:00（与稿子一致，不被任务时间撑开）
  g.config.start_date = timeOfDay(`${AXIS_START_HOUR}:00`);
  g.config.end_date = timeOfDay(`${AXIS_END_HOUR}:00`);

  // 左列：类别 / 资源名 / 车号|班次 三行，和稿子的资源列一致
  g.config.columns = [
    {
      name: "text",
      label: "资源与车辆人员",
      width: 140,
      tree: true,
      template: (task: { gridHtml?: string }) => task.gridHtml || "",
    },
  ];

  // 任务条：两行文案（任务名 + [状态]起止时间），类名带上状态用于配色
  g.templates.task_class = (_start: Date, _end: Date, task: { status?: TaskStatus }) => `sg-bar sg-bar--${task.status || "pending"}`;
  g.templates.task_text = (_start: Date, _end: Date, task: { title?: string; status?: TaskStatus; timeText?: string }) =>
    `<div class="sg-bar__name">${task.title || ""}</div><div class="sg-bar__meta">[${STATUS_LABEL[task.status || "pending"]}]${task.timeText || ""}</div>`;

  // marker 属插件能力：先启用一次，能加就先加
  try {
    g.plugins?.({ marker: true });
  } catch (error) {
    logger.warn("marker 插件启用失败", error);
  }
  let markerAdded = addNowMarker(g);
  // marker 插件不可用时降级：给「当前时间所在的小时格」打类名，用 CSS 自绘虚线 + 时间胶囊
  if (!markerAdded) {
    g.templates.timeline_cell_class = (_task: unknown, date: Date) =>
      date && date.getHours() === NOW.hour ? "sg-now-cell" : "";
  }

  try {
    g.i18n?.setLocale("cn");
  } catch {
    // 语言包缺失时保持默认，不影响排程展示
  }

  const el = document.getElementById(CONTAINER_ID);
  if (!el) {
    logger.error("甘特图容器不存在，跳过渲染");
    return;
  }
  // 降级方案用到的「当前时间在整点格内的偏移」与文案（12:45 → 75%，"12:45"）
  el.style.setProperty("--sg-now-offset", `${(NOW.minute / 60) * 100}%`);
  el.style.setProperty("--sg-now-text", `"${String(NOW.hour).padStart(2, "0")}:${String(NOW.minute).padStart(2, "0")}"`);
  g.init(el);

  // 说明：marker 只在 init 前试一次。若这里再重试成功，会和上面的降级线叠成两条，故不重试。

  // 资源 = 父任务，任务 = 子行（parent 指向资源 id）
  const data: Array<Record<string, unknown>> = [];
  resources.forEach((resource) => {
    data.push({
      id: resource.id,
      text: `${resource.category} ${resource.name}`,
      gridHtml: `<div class="sg-cell"><div class="sg-cell__category">${resource.category}</div><div class="sg-cell__name">${resource.name}</div>${resource.subName ? `<div class="sg-cell__sub">${resource.subName}</div>` : ""}</div>`,
      type: "project",
      open: true,
      start_date: timeOfDay("08:00"),
      end_date: timeOfDay("21:00"),
    });
    resource.tasks.forEach((task) => {
      data.push({
        id: task.id,
        text: task.title,
        title: task.title,
        status: task.status,
        timeText: `${task.start}-${task.end}`,
        start_date: timeOfDay(task.start),
        end_date: timeOfDay(task.end),
        parent: resource.id,
      });
    });
  });

  try {
    g.parse({ data, links: [] });
  } catch (error) {
    logger.error("甘特图数据加载失败", error);
    return;
  }

  // 点击任务条 → 弹出任务详情窗口（返回 false，避免进入选中/编辑态）
  g.attachEvent?.("onTaskClick", (id: unknown) => {
    openTaskDetail(id);
    return false;
  });

  // 横/纵滚动都会触发：重算可视尺寸与每行 Y 坐标（DHTMLX 只渲染可视行，滚动后渲染的行会变）
  g.attachEvent?.("onGanttScroll", () => {
    syncTimelineMetrics();
  });

  // 监听时间轴横向滚动，实时更新隐藏任务提示（setSizes 后容器可能才出现，由 reflowGantt 兜底）
  ensureScrollListener();

  // 初始化完成后再按当前容器尺寸重排一次（横屏旋转/全屏会改变可视区）
  setTimeout(reflowGantt, 0);
}

onMounted(() => {
  // #ifdef H5
  void mountGantt();
  // #endif
});

onBeforeUnmount(() => {
  try {
    if (timelineScrollHandler && timelineScroller) {
      timelineScroller.removeEventListener("scroll", timelineScrollHandler);
    }
  } catch {
    // 监听移除失败不影响页面离开
  }
  timelineScrollHandler = null;
  try {
    ganttInstance?.destructor?.();
  } catch {
    // 卸载失败不影响页面离开
  }
  ganttInstance = null;
});

/* ---------- 时间轴横向滚动 ----------
   DHTMLX 自身横向/纵向都能滚，但横屏是 CSS 旋转 90° 模拟的，手势方向跟着转，
   所以在画布上加屏幕方向的滑动兜底，并给两个按钮（符合横屏可视方向）。 */
/** 当前横向滚动位置（用于按钮可用态与隐藏任务提示） */
const timelineScrollLeft = ref(0);
/** 时间轴可视宽度 */
const timelineViewportWidth = ref(0);
/** 时间轴内容总宽 */
const timelineContentWidth = ref(0);
/**
 * 时间轴三件套（都做缓存，避免每次滚动全量扫 DOM）：
 * - scroller：原生横滚条 `.gantt_hor_scroll`（`scrollLeft` 与 `scroll` 事件来源）
 * - viewport：时间轴可视区 `.gantt_task`（宽度**不含左列**，与任务条同一坐标系）
 * - content ：时间轴内容层 `.gantt_task_bg`（宽度即内容总宽）
 */
let timelineScroller: HTMLElement | null = null;
let timelineViewport: HTMLElement | null = null;
let timelineContent: HTMLElement | null = null;
/** 滚动监听句柄（卸载时移除） */
let timelineScrollHandler: (() => void) | null = null;

function queryTimeline(selector: string, cache: HTMLElement | null): HTMLElement | null {
  // #ifdef H5
  if (cache?.isConnected) return cache;
  const root = document.getElementById(CONTAINER_ID);
  return root?.querySelector<HTMLElement>(selector) ?? null;
  // #endif
  return null;
}

/** 原生横滚条：时间轴的横向滚动都由它驱动 */
function findTimelineScroller(): HTMLElement | null {
  timelineScroller = queryTimeline(".gantt_hor_scroll", timelineScroller);
  return timelineScroller;
}

/** 时间轴可视区：`clientWidth` 即可视宽（不含左侧冻结列） */
function findTimelineViewport(): HTMLElement | null {
  timelineViewport = queryTimeline(".gantt_task", timelineViewport);
  return timelineViewport;
}

/** 时间轴内容层：`offsetWidth` 即内容总宽 */
function findTimelineContent(): HTMLElement | null {
  timelineContent = queryTimeline(".gantt_task_bg", timelineContent);
  return timelineContent;
}

/**
 * 时间轴滚动度量。
 *
 * 关键：任务条的像素坐标是以「时间轴起点（08:00）」为 0 的，**不含左侧冻结列**。
 * DHTMLX 的原生横滚条 `.gantt_hor_scroll` 是 `width:100%`，它的 `clientWidth` 是
 * 「整张甘特图宽（含左列）」，拿它当可视宽会让右边界虚大一个左列宽，导致靠右的任务
 * 判定不出「被藏起来」。
 *
 * 所以可视宽取 `.gantt_task`（时间轴区，天然不含左列），内容总宽取 `.gantt_task_bg`，
 * `scrollLeft` 直接用横滚条的（与时间轴内容偏移一致）。
 */
function syncTimelineMetrics() {
  const scroller = findTimelineScroller();
  const viewport = findTimelineViewport();
  if (!scroller || !viewport) return;
  const content = findTimelineContent();
  timelineScrollLeft.value = scroller.scrollLeft;
  timelineViewportWidth.value = viewport.clientWidth;
  timelineContentWidth.value = content ? content.offsetWidth : 0;
  measureRowTops();
}

function ensureScrollListener() {
  const scroller = findTimelineScroller();
  if (!scroller || timelineScrollHandler) {
    // 滚动容器还没就绪时也先量一次行位置（横滚出现前就能量出每行 Y）
    measureRowTops();
    return;
  }
  timelineScrollHandler = syncTimelineMetrics;
  scroller.addEventListener("scroll", timelineScrollHandler, { passive: true });
  syncTimelineMetrics();
}

function scrollTimeline(direction: -1 | 1) {
  const scroller = findTimelineScroller();
  if (!scroller) return;
  scroller.scrollLeft = Math.max(0, scroller.scrollLeft + direction * 112);
  syncTimelineMetrics();
}

/** 左右两侧隐藏任务提示：按行（资源）分别判定，每行可各出一对箭头；点击只跳到该行最近任务 */
const { rowHints, jumpToRow } = useTimelineEdgeHint({
  rows: () => resources.map(resource => ({
    bars: resource.tasks.map(task => ({
      startMin: timeToMinutes(task.start),
      endMin: timeToMinutes(task.end),
    })),
  })),
  dayStartMin: AXIS_START_HOUR * 60,
  hourWidth: HOUR_WIDTH,
  scrollLeft: timelineScrollLeft,
  viewportWidth: timelineViewportWidth,
  contentWidth: () => timelineContentWidth.value,
  scrollTo: (left) => {
    const scroller = findTimelineScroller();
    if (!scroller) return;
    // 直接赋值：DHTMLX 会同步自己的滚动状态；smooth 动画会被 DHTMLX 的滚动同步顶掉
    scroller.scrollLeft = left;
    syncTimelineMetrics();
  },
});

/** 每行提示箭头在画布内的纵向坐标（px，相对 .sg__gantt 顶部）；-1 表示该行未渲染（折叠/未就绪） */
const rowTops = ref<number[]>([]);

/** 量出每个资源行（取其首条任务的时间轴行）相对画布顶部的 Y 坐标；纵向滚动 / 横滚都会改变它 */
function measureRowTops() {
  const root = document.getElementById(CONTAINER_ID);
  if (!root) return;
  const containerRect = root.getBoundingClientRect();
  const gantt = ganttInstance as unknown as {
    getTaskRowNode?: (id: string | number) => HTMLElement | null;
    getTaskNode?: (id: string | number) => HTMLElement | null;
  };
  /** 任务条在行内上下各留的空隙：(行高 44 - 条高 40) / 2 */
  const BAR_INSET = 2;
  rowTops.value = resources.map((resource) => {
    const firstTask = resource.tasks[0];
    if (!firstTask) return -1;
    const rowEl = gantt?.getTaskRowNode?.(firstTask.id);
    if (rowEl) {
      return rowEl.getBoundingClientRect().top - containerRect.top + ROW_HINT_CENTER_OFFSET;
    }
    // 兜底：行节点取不到时用任务条反推行顶
    const barEl = gantt?.getTaskNode?.(firstTask.id);
    if (!barEl) return -1;
    return barEl.getBoundingClientRect().top - containerRect.top - BAR_INSET + ROW_HINT_CENTER_OFFSET;
  });
}

/** 屏幕上横向拖动 → 连续换算成时间轴滚动（1:1 跟手；纵向为主的滑动交给 DHTMLX 自己滚） */
let touchStartX = 0;
let touchStartY = 0;
let touchStartScroll = 0;
let dragging = false;

function onGanttTouchStart(event: TouchEvent) {
  const touch = event?.touches?.[0];
  touchStartX = Number(touch?.clientX || 0);
  touchStartY = Number(touch?.clientY || 0);
  touchStartScroll = findTimelineScroller()?.scrollLeft || 0;
  dragging = false;
}

function onGanttTouchMove(event: TouchEvent) {
  const touch = event?.touches?.[0];
  const deltaX = Number(touch?.clientX || 0) - touchStartX;
  const deltaY = Number(touch?.clientY || 0) - touchStartY;
  if (!dragging) {
    // 横向为主的滑动才算拖动，避免和 DHTMLX 的纵向滚动抢事件
    if (Math.abs(deltaX) < 6 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    dragging = true;
  }
  const scroller = findTimelineScroller();
  if (!scroller) return;
  scroller.scrollLeft = Math.max(0, touchStartScroll - deltaX);
  syncTimelineMetrics();
}

function onGanttTouchEnd() {
  dragging = false;
}

/** 退出全屏：先还原屏幕方向（解锁方向 / 撤掉旋转 / 退全屏），再回到上一页 */
function exitFullscreen() {
  exitLandscape();
  const pages = getCurrentPages?.();
  if (Array.isArray(pages) && pages.length > 1) {
    uni.navigateBack();
    return;
  }
  uni.showToast({ title: "已是全屏视图", icon: "none" });
}
</script>

<template>
  <view class="sg" :class="{ 'sg--rotated': rotated }">
    <!-- 顶部栏（稿子 6832:15 标题 / 6832:186 日期 / 图例 6832:275 / 6832:203「退出全屏」） -->
    <view class="sg__header">
      <view class="sg__title-group">
        <text class="sg__title">
          调度视图
        </text>
        <text class="sg__date">
          {{ dateText }}
        </text>
      </view>

      <view class="sg__tools">
        <view v-for="item in legend" :key="item.key" class="sg__legend">
          <view class="sg__legend-chip" :class="`sg__legend-chip--${item.key}`" />
          <text class="sg__legend-text">
            {{ item.label }}
          </text>
        </view>

        <view class="sg__exit" @tap="exitFullscreen">
          <view class="sg__exit-icon" />
          <text class="sg__exit-text">
            退出全屏
          </text>
        </view>
      </view>
    </view>

    <!-- DHTMLX Gantt 画布 + 提示层 -->
    <view class="sg__gantt-wrap">
      <!-- DHTMLX 容器（仅 H5 会初始化；小程序端该节点为空，逻辑已按条件编译剔除） -->
      <view
        :id="CONTAINER_ID"
        class="sg__gantt"
        @touchstart="onGanttTouchStart"
        @touchmove="onGanttTouchMove"
        @touchend="onGanttTouchEnd"
        @touchcancel="onGanttTouchEnd"
      />

      <!-- 提示层必须放在 DHTMLX 容器【外面】：init/重排会清空容器，容器内的节点会被抹掉。
           按行（资源）判定：某行在可视窗口外还有任务，就在那行左右各浮一个箭头；点击只跳到该行最近任务 -->
      <view class="sg__hint-layer">
        <template v-for="(resource, rowIndex) in resources" :key="resource.id">
          <view
            v-if="rowTops[rowIndex] >= 0 && rowHints[rowIndex] && rowHints[rowIndex].left"
            :key="`l-${resource.id}`"
            class="sg__hint sg__hint--left"
            :style="{ top: `${rowTops[rowIndex]}px` }"
            @tap="jumpToRow(-1, rowIndex)"
          >
            <view class="sg__scroll-btn">
              <view class="sg__scroll-icon sg__scroll-icon--prev" />
            </view>
          </view>
          <view
            v-if="rowTops[rowIndex] >= 0 && rowHints[rowIndex] && rowHints[rowIndex].right"
            :key="`r-${resource.id}`"
            class="sg__hint sg__hint--right"
            :style="{ top: `${rowTops[rowIndex]}px` }"
            @tap="jumpToRow(1, rowIndex)"
          >
            <view class="sg__scroll-btn">
              <view class="sg__scroll-icon sg__scroll-icon--next" />
            </view>
          </view>
        </template>
      </view>
    </view>

    <!-- 时间轴横向滚动：任务量超出屏幕时用（移动端点击 / 横向滑动）；纵向由 DHTMLX 自身滚动 -->
    <view class="sg__scroller">
      <view
        class="sg__scroll-btn"
        :class="{ 'sg__scroll-btn--dim': timelineScrollLeft <= 0 }"
        @tap="scrollTimeline(-1)"
      >
        <view class="sg__scroll-icon sg__scroll-icon--prev" />
      </view>
      <view class="sg__scroll-btn" @tap="scrollTimeline(1)">
        <view class="sg__scroll-icon sg__scroll-icon--next" />
      </view>
    </view>

    <!-- 任务详情窗口（点击任务条弹出） -->
    <AiTaskDetailSheet v-model:visible="detailVisible" :detail="detail" />
  </view>
</template>

<style lang="scss" scoped>
/* 横屏稿：812 × 375。正常持握时铺满视口；锁定方向失败走 CSS 旋转兜底（见 useLandscape），
   此时 body 已按「宽=100vh、高=100vw」旋转，页面跟着切成横屏尺寸 */
.sg {
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

.sg--rotated {
  width: 100vh;
  height: 100vw;
}

/* ---------- 顶部栏 ---------- */
.sg__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  height: 49px;
  padding: 0 28px;
}

.sg__title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sg__title {
  font-size: 12px;
  font-weight: 500;
  color: #000000;
}

.sg__date {
  font-size: 11px;
  color: #999999;
}

.sg__tools {
  display: flex;
  align-items: center;
  gap: 16px;
}

.sg__legend {
  display: flex;
  align-items: center;
  gap: 5px;
}

/* 图例色块 10×10 圆角 3：与任务条三态同色 */
.sg__legend-chip {
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  border: 1px solid #ffffff;
  background: #f0f0f0;
}

.sg__legend-chip--running {
  background: #ecf5ff;
}

.sg__legend-chip--pending {
  border-color: #f2f2f2;
  background: #ffffff;
}

.sg__legend-chip--overdue {
  border-color: #767676;
  border-style: dashed;
  background: #ffffff;
}

.sg__legend-text {
  font-size: 11px;
  color: #000000;
}

.sg__exit {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 21px;
  padding: 0 8px;
  border: 1px solid #f2f2f2;
  border-radius: 6px;
  background: #fbfbfb;
}

.sg__exit:active {
  opacity: 0.7;
}

.sg__exit-icon {
  position: relative;
  width: 9px;
  height: 9px;
  border-top: 1.5px solid #666666;
  border-left: 1.5px solid #666666;
}

.sg__exit-icon::after {
  content: "";
  position: absolute;
  right: -1.5px;
  bottom: -1.5px;
  width: 9px;
  height: 9px;
  border-right: 1.5px solid #666666;
  border-bottom: 1.5px solid #666666;
}

.sg__exit-text {
  font-size: 11px;
  color: #666666;
}

/* ---------- Gantt 画布 ---------- */
.sg__gantt-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
}

.sg__gantt {
  position: relative;
  z-index: 0;
  width: 100%;
  height: 100%;
}

/* ---------- 时间轴隐藏任务提示层：独立覆盖在 Gantt 容器之上（不会被 DHTMLX 清空） ---------- */
.sg__hint-layer {
  position: absolute;
  inset: 0;
  z-index: 10;
  overflow: hidden;
  /* 外层不拦截手势，只有箭头本身接收点击 */
  pointer-events: none;
}

/* ---------- 时间轴隐藏任务提示箭头：挂在每行左右边缘，28×28 白底方按钮 + 深色箭头（稿子 6832:720/721） ---------- */
.sg__hint {
  position: absolute;
  pointer-events: auto;
}

.sg__hint--left {
  left: 156px;
}

.sg__hint--right {
  right: 16px;
}

/* ---------- 时间轴横向滚动按钮：右下角两个方形按钮（28×28，白底 + #F2F2F2 描边圆角 6） ---------- */
.sg__scroller {
  position: absolute;
  right: 16px;
  bottom: 12px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 8px;
}

.sg__scroll-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  border: 1px solid #f2f2f2;
  border-radius: 6px;
  background: #ffffff;
}

.sg__scroll-btn:active {
  opacity: 0.7;
}

/* 已经在最左端时按钮变淡 */
.sg__scroll-btn--dim {
  opacity: 0.4;
}

/* 箭头：8×8 的直角旋转 45° */
.sg__scroll-icon {
  width: 8px;
  height: 8px;
  border-top: 1.5px solid #1a1a1e;
  border-right: 1.5px solid #1a1a1e;
}

.sg__scroll-icon--prev {
  transform: rotate(-135deg);
}

.sg__scroll-icon--next {
  transform: rotate(45deg);
}
</style>

<!-- DHTMLX Gantt 内部 DOM 不在 scoped 作用域内，样式需全局生效 -->
<style lang="scss">
#schedule-gantt-root {
  /* 左列表头与时间轴刻度条：底 #FBFBFB、描边 #F2F2F2（稿子 6464:279 / 6464:167） */
  .gantt_grid_scale,
  .gantt_task_scale {
    border-color: #f2f2f2;
    background: #fbfbfb;
  }

  /* 时间轴刻度：12px 斜体（稿子 6464:198） */
  .gantt_scale_cell {
    font-size: 12px;
    font-style: italic;
    color: #1a1a1e;
  }

  /* 左列表头「资源与车辆人员」：11px/400、深色、不斜体、不大写
     （稿子 6464:280；DHTMLX 默认给表头 500 字重 + uppercase，这里一并覆盖） */
  .gantt_grid_scale .gantt_grid_head_cell {
    font-size: 11px;
    font-weight: 400;
    font-style: normal;
    text-transform: none;
    color: #000000;
  }

  /* 竖网格线：稿子 #F3F3F3 */
  .gantt_task_vscroll {
    background: #ffffff;
  }

  .gantt_task_cell {
    border-right: 1px solid #f3f3f3;
  }

  .gantt_row,
  .gantt_task_row,
  .gantt_grid_data .gantt_row.odd,
  .gantt_grid_data .gantt_row {
    border-color: #f2f2f2;
  }

  /* ---------- 左列（grid）单元格：稿子 6464:279 ----------
     底色 #FBFBFB、行分隔线与右边界 #F2F2F2（140 宽）。
     注意：DHTMLX 默认会把最后一列 gantt_last_cell 的右边框去掉，
     而稿子里左列与时间轴之间有 1px 分隔线，这里补回来 */
  .gantt_grid,
  .gantt_grid_data,
  .gantt_grid_data .gantt_row,
  .gantt_grid_data .gantt_row.odd {
    background: #fbfbfb;
  }

  .gantt_grid .gantt_cell,
  .gantt_grid .gantt_cell_tree {
    box-sizing: border-box;
    background: #fbfbfb;
    border-color: #f2f2f2;
    padding: 0 8px 0 14px;
    line-height: 13px;
  }

  .gantt_grid .gantt_cell_tree .gantt_tree_content {
    line-height: 13px;
  }

  .gantt_grid .gantt_last_cell {
    background: #fbfbfb;
    border-right: 1px solid #f2f2f2;
  }

  /* 展开/收起图标弱化到 #999，与稿子的浅色界面一致 */
  .gantt_grid .gantt_tree_icon {
    color: #999999;
  }

  /* 左列资源单元格：类别 + 资源名 + 车号|班次 三行
     （稿子 6464:300 类别 11px Medium #666；6464:297 名称 11px Medium #000；6464:296 副行 11px Regular #999） */
  .sg-cell {
    display: flex;
    flex-direction: column;
    justify-content: center;
    height: 100%;
    font-size: 11px;
    line-height: 13px;
    color: #000000;
  }

  .sg-cell__category {
    font-size: 11px;
    font-weight: 500;
    color: #666666;
  }

  .sg-cell__name {
    font-size: 11px;
    font-weight: 500;
    color: #000000;
  }

  .sg-cell__sub {
    font-size: 11px;
    font-weight: 400;
    color: #999999;
  }

  /* 任务条基础：40px 高、圆角 6、两行文案 */
  .gantt_task_line.sg-bar {
    height: 40px;
    border-radius: 6px;
    padding: 0 7px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    overflow: hidden;
  }

  .sg-bar__name {
    font-size: 11px;
    font-weight: 500;
    line-height: 13px;
    color: #1a1a1e;
    white-space: nowrap;
  }

  .sg-bar__meta {
    font-size: 11px;
    line-height: 13px;
    color: #999999;
    white-space: nowrap;
  }

  /* 三态配色（设计稿） */
  .gantt_task_line.sg-bar--running {
    background: #ecf5ff;
    border: 1px solid #ffffff;
  }

  .gantt_task_line.sg-bar--done {
    background: #f0f0f0;
    border: 1px solid #ffffff;
  }

  .gantt_task_line.sg-bar--pending {
    background: #ffffff;
    border: 1px solid #f2f2f2;
  }

  .gantt_task_line.sg-bar--overdue {
    background: #ffffff;
    border: 1px dashed #767676;
  }

  /* 进度条不显示（稿子只表达状态） */
  .gantt_task_progress {
    display: none;
  }

  /* 当前时间标记：红色胶囊 + 30% 红虚线（稿子 6832:208 / 6832:209） */
  .gantt_marker.sg-now {
    width: 0;
    border-left: 1px dashed rgba(200, 32, 30, 0.3);
    background: transparent;
  }

  .gantt_marker.sg-now .gantt_marker_content {
    top: 2px;
    padding: 1px 3px;
    border-radius: 7px;
    background: #c8201e;
    color: #ffffff;
    font-size: 10px;
    line-height: 12px;
    white-space: nowrap;
  }

  /* marker 插件不可用时的降级：当前时间所在的小时格里画虚线 + 时间胶囊（偏移由页面写入的 CSS 变量给） */
  .gantt_task_cell.sg-now-cell {
    position: relative;
  }

  .gantt_task_cell.sg-now-cell::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--sg-now-offset, 75%);
    border-left: 1px dashed rgba(200, 32, 30, 0.3);
  }

  .gantt_task_cell.sg-now-cell::before {
    content: var(--sg-now-text, "12:45");
    position: absolute;
    z-index: 2;
    top: 2px;
    left: var(--sg-now-offset, 75%);
    transform: translateX(-50%);
    padding: 1px 3px;
    border-radius: 7px;
    background: #c8201e;
    color: #ffffff;
    font-size: 10px;
    line-height: 12px;
    white-space: nowrap;
  }
}
</style>

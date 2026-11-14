<script setup lang="ts">
import type { GanttViewRow } from "@/api/chat/types";
import type { SchedulePinchEvent } from "@/hooks/useScheduleGestures";

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import arrowNextIcon from "@/assets/img/schedule-arrow-next.svg";
import arrowPrevIcon from "@/assets/img/schedule-arrow-prev.svg";
import { useLandscape } from "@/hooks/useLandscape";
import { LARGE_SCREEN_FONT_SCALE, useLargeScreenFont } from "@/hooks/useLargeScreenFont";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useScheduleGestures } from "@/hooks/useScheduleGestures";
import { useTimelineEdgeHint } from "@/hooks/useTimelineEdgeHint";
import { useSystemStore } from "@/stores";
import { clearPendingScheduleView, readPendingScheduleView } from "@/utils/schedule-view";
import { backFromScene } from "@/utils/scene-navigation";

/**
 * 横屏调度视图·重排草案（稿子 7229:254）——每个资源的「旧 / 新」两排计划对照。
 * 预排是另一个页面：pages/schedule-pre（稿子 6464:150）。
 *
 * 版面：横屏 812×375（1x 每小时 56px，时间轴以 08:00–21:00 为基准、按数据向外扩到整点）
 * - 顶部栏：标题「调度视图·重排草案」+ 日期 + 图例（原计划 / 新计划 / 已取消）
 *   +「查看全部任务」+ 返回对话按钮；
 *   **默认不勾** = 只显示**有变动**的任务（新增 / 取消 / 时段调整），
 *   旧新时段一致（未变动）的任务与没有对照的单条任务都收起；勾上才给全量；
 * - 左侧资源列（140px）：每行「旧 / 新」标签 + 类别 + 资源名 + 车号|班次；
 *   标签只给「有新旧对照、且这一排确实有变动」的行：单泳道（没有对照）整列都不渲染，
 *   整排都没变动（只是被「查看全部任务」放出来）那一排也不写字；
 * - 右侧排程区：时间轴 + 竖向网格 + 任务条（按起止时间定位），可横向滚动；
 * - 底部「任务置换」提示条（7229:449）：点任务条后按该趟的「旧 / 新」两条生成文案，可关闭。
 *
 * 双指缩放：与甘特页同一套（useScheduleGestures 接管两指手势），按两指间距比例改「每小时像素宽」
 * （28–168px），捏合中心的时刻保持不动；刻度、任务条、新旧连线、箭头跟着实时重排。
 * **进页面落在最小尺度**（28px/小时 → 刻度 2 小时一格）：先看整天排布，再按需放大。
 *
 * 横屏方式与 pages/schedule-gantt 一致：宿主用 openH5Container 打开甘特图应用时本身就是全屏横屏，
 * 前端不再申请转屏（不再调 landscapeFullscreen）；只有宿主没给横屏可视区时，
 * `useLandscape()` 才把页面整体旋转 90° 模拟横屏（设备竖屏持握、不申请全屏权限），离开页面自动还原。
 *
 * 任务条样式（ardot 134:992 / 207:2606）：26 高、单行——原计划 灰底 #F3F3F3 + **虚线** #E8E8E8、
 * 新计划 白底 #FFFFFF + **虚线** #9DB3CC、已取消 灰底 #F3F3F3 + **实线** #E8E8E8 且文案转灰。
 * 三态的底色 / 描边与右上角图例**共用同一组 CSS 变量**，条与图例不会再出现色差；
 * 线型按状态写死（原计划 / 新计划虚线、已取消实线），接口的 highlight 标志不参与描边，
 * 否则大量「强调条」会把三种状态的线型盖成全实线。
 * 任务条可点：点任意一条即选中它那一趟（linkKey 相同的旧 / 新两条一起描实线框，点空白 / 再点一次还原），
 * 底部提示条随之更新；新旧关联线也**只在选中时**才画出来，未选中画面只有两排任务条。
 */

defineOptions({ name: "SchedulePage" });

/**
 * 进入页面自动横屏（原生优先、CSS 旋转兜底），离开时还原。
 * 转屏 / 旋转会改变排程区实际宽度，必须把 measureLayout 挂到 onReflow：
 * 否则箭头落点、滚动位置还是按转屏前的宽度算的（与甘特页保持一致）。
 */
const { rotated, exitLandscape } = useLandscape(measureLayout);

/**
 * 返回图标要不要顺时针补 90°：改由 CSS `@media (orientation: portrait)` 直接按可视区判定（见样式）。
 *
 * 图标本体画的是「托盘 + 向上箭头」，设计稿里是横置的（箭头朝右），竖屏版面上必须补 90°。
 * 不用脚本算是因为方向来源有几种（原生横屏容器 / CSS 旋转兜底 / 智慧屏这类横屏画布机型
 * 现在按竖屏容器打开），统一的判据其实就是「可视区是不是竖的」。
 */

/**
 * 顶部状态栏空白：宿主全屏横屏时 webview 铺满屏幕、状态栏压在页面顶边，
 * 顶栏要给状态栏让出这段高度；
 * CSS 旋转模拟（rotated）时状态栏在设备的物理顶边（对应页面左侧），不需要留。
 */
const { safeTopPx } = useSafeArea();
const headerTopStyle = computed(() => ({ paddingTop: rotated.value ? "" : `${safeTopPx.value}px` }));

/** 深浅色：与对话页同一套口径（唯一数据源 systemStore.isDark），页面只负责把 --dark 类挂到根节点 */
const systemStore = useSystemStore();
const isDark = computed(() => systemStore.isDark);

/**
 * 大屏电脑（≥ 19 寸）：字号 + 行高 / 任务条 / 左列整体等比放大。
 * 样式侧用 --sch-fs，脚本侧（行高、连接线坐标）用 fontScale，两边同一口径。
 */
const { isLargeScreen } = useLargeScreenFont();
const fontScale = computed(() => (isLargeScreen.value ? LARGE_SCREEN_FONT_SCALE : 1));

/**
 * 原生手势在真机不生效（旋转页面里浏览器不接管）：自己接管触摸，见 hooks/useScheduleGestures。
 * isRotated 决定屏幕方向映射哪一路：CSS 旋转模拟横屏与宿主原生转屏全屏的轴向相反。
 */
useScheduleGestures({
  gridId: "schedule-grid",
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
  onRowsOffset: () => measureRowTops(),
});

/** 时间轴：每小时像素宽（双指捏合在 28–168 之间缩放，1x 基准 56px）；基准范围 08:00–21:00 */
const HOUR_WIDTH_MIN = 28;
const HOUR_WIDTH_MAX = 168;
/**
 * 当前每小时像素宽（双指缩放会改它，刻度 / 任务条 / 连线 / 网格线都跟着走）。
 * 进页面直接落在最小尺度（28px/小时 → 刻度 2 小时一格）：先看整天的排布轮廓，
 * 需要细节再用双指放大。
 */
const hourWidth = ref(HOUR_WIDTH_MIN);
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
  /**
   * 强调条标志：预排页用红描边（6464:358）。
   * 重排页**不参与描边**——接口里大量 highlight=true，若照旧画成实线会把三种状态的线型盖掉，
   * 这里只保留数据字段，渲染一律以 state 为准。
   */
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

/** 任务条按起止时间定位：每小时 hourWidth px（1x 时 08:00-13:00 → x=0, w=280） */
function barStyle(bar: ScheduleBar) {
  const left = ((bar.startMin - DAY_START_MIN) / 60) * hourWidth.value;
  const width = Math.max(((bar.endMin - bar.startMin) / 60) * hourWidth.value, hourWidth.value / 2);
  return { left: `${left}px`, width: `${width}px` };
}

/* ------------------------------------------------------------------
 * AI 下发的重排数据（COMPONENT scene=task / type=gantt，viewType=replan → data）
 * ------------------------------------------------------------------ */
/**
 * 气泡入口卡点进来时写下的整包 data，打开本页读出来（读不删，卸载时才清：
 * 刷新 / 宿主重建 webview 后还能渲染同一份）；
 * 没有数据（比如兜底跳转进来、或接口没下发 rows）就渲染空视图。
 */
const viewPayload = readPendingScheduleView();

/** 接口 state → 重排三态：new = 新计划；canceled / cancelled = 已取消；其余（planned / running / done / overdue…）按原计划 */
function stateFromState(state: unknown): BarState {
  const key = String(state || "").trim().toLowerCase();
  if (key === "new") return "new";
  if (key === "canceled" || key === "cancelled") return "canceled";
  return "planned";
}

/** 接口还没排时间的条：每条按 2 小时一节依次排开（避免 null 参与定位算出 NaN，任务条甩出画面） */
const UNSCHEDULED_SLOT_MIN = 2 * 60;

/**
 * 分钟数 →「HH:MM」（条内时间文案的兜底）。
 * 接口下发的 startMin / endMin 是**带小数的分钟**（1388.6666666666667 = 23:08:40），
 * 直接取模会打印出「23:8.666666666666742」：这里先四舍五入到整分钟，
 * 再按 24 小时回绕（跨天任务 endMin 是 +1440 后的值，1496.33 → 00:56）。
 */
function hhmm(minutes: number) {
  const total = Math.round(Number(minutes) || 0);
  const wrapped = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/**
 * 行标签「旧 / 新」：接口给了 tag 就用（兼容 new / old）；没给时按整行任务条推导，
 * 整行都是新计划算「新」、整行都不是新计划算「旧」；新旧混杂或空行留空（没有新旧对照）。
 */
function tagFromRow(row: GanttViewRow, states: BarState[]): "旧" | "新" | undefined {
  const raw = String(row.tag || "").trim().toLowerCase();
  if (raw === "新" || raw === "new") return "新";
  if (raw === "旧" || raw === "old" || raw === "planned") return "旧";
  if (states.length === 0) return undefined;
  if (states.every(state => state === "new")) return "新";
  if (states.every(state => state !== "new")) return "旧";
  return undefined;
}

/**
 * 接口 rows → 页面行模型：
 * - 任务条按 state 映射成「原计划 / 新计划 / 已取消」三态，linkKey 原样带上（新旧连线用）；
 * - 起止时间直传；接口没排时间时按数组顺序在轴起点依次排开、条内写「时间待定」；
 * - 跨天任务（结束按当天分钟数记，23:00 → 次日 02:00 记成 120）补一天再定位。
 */
function normalizeViewRows(viewRows: GanttViewRow[]): ScheduleRow[] {
  return viewRows.map((row, rowIndex) => {
    let cursor = DESIGN_DAY_START_MIN;
    const bars: ScheduleBar[] = (Array.isArray(row.bars) ? row.bars : []).map((bar, barIndex) => {
      // null 不能直接 Number()：会被当成 0，误判成「已排在 00:00」
      const start = bar.startMin == null ? Number.NaN : Number(bar.startMin);
      const end = bar.endMin == null ? Number.NaN : Number(bar.endMin);
      const endMin = Number.isFinite(start) && Number.isFinite(end) && end < start ? end + 24 * 60 : end;
      const planned = Number.isFinite(start) && Number.isFinite(endMin) && endMin > start;
      const slotStart = cursor;
      if (!planned) cursor += UNSCHEDULED_SLOT_MIN;
      const startMin = planned ? start : slotStart;
      const barEndMin = planned ? endMin : slotStart + UNSCHEDULED_SLOT_MIN;
      return {
        id: String(bar.id || `task-${rowIndex + 1}-${barIndex + 1}`),
        title: String(bar.title || "").trim(),
        timeText: String(bar.timeText || "").trim()
          || (planned ? `${hhmm(startMin)}-${hhmm(barEndMin)}` : "时间待定"),
        startMin,
        endMin: barEndMin,
        state: stateFromState(bar.state),
        highlight: Boolean(bar.highlight),
        linkKey: String(bar.linkKey || "").trim() || undefined,
      };
    });
    const tag = tagFromRow(row, bars.map(bar => bar.state));
    return {
      id: String(row.id || `resource-${rowIndex + 1}`),
      tag,
      category: String(row.category || "").trim() || "—",
      names: Array.isArray(row.names) ? row.names.map(name => String(name || "")) : [],
      bars,
      separator: Boolean(row.separator) || tag === "新",
    };
  });
}

/**
 * 重排排程数据：**每辆车各有「旧 / 新」两行**——同一辆车的旧计划与新计划上下对照。
 * 行来自接口下发的 rows（`tag` 旧 / 新、`names` 车号|司机 + 车牌|班次），
 * 任务条按 `state` 分原计划 / 新计划 / 已取消、按 `linkKey` 连新旧对照线；
 * 单条任务（没有新旧对照）不打标签、只渲染一条，判定为未变动。
 */
const repRows = computed<ScheduleRow[]>(() => normalizeViewRows(
  Array.isArray(viewPayload?.rows) ? viewPayload.rows : [],
));

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

expandDayRange(repRows.value);

/** 「查看全部任务」勾选态：true = 全部任务，false = 只看有变动的任务；默认只看变动，进页面就是重点 */
const showAllTasks = ref(false);

/**
 * 「有变动」的任务条 id。按同一趟任务（linkKey）的旧 / 新对照**逐条**判定：
 * - 该 linkKey 只有一侧（新增 / 取消）→ 那一侧每条都算变动；
 * - 两侧都有：另一侧存在起止完全一致的对照条才算未变动，否则算变动
 *   （一侧多条对另一侧一条的拆趟 / 并趟也能逐条判对）；
 * - 没有 linkKey 的单条任务没有对照，视为未变动。
 * 基于原始 repRows 算（不能基于 rows，否则和下面的过滤互相依赖）。
 */
const changedBarIds = computed(() => {
  const groups = new Map<string, { old: ScheduleBar[]; fresh: ScheduleBar[] }>();
  repRows.value.forEach((row) => {
    row.bars.forEach((bar) => {
      if (!bar.linkKey) return;
      const group = groups.get(bar.linkKey) || { old: [], fresh: [] };
      if (isNewPlanBar(row, bar)) group.fresh.push(bar);
      else group.old.push(bar);
      groups.set(bar.linkKey, group);
    });
  });

  const ids = new Set<string>();
  groups.forEach((group) => {
    if (group.old.length === 0 || group.fresh.length === 0) {
      group.old.forEach(bar => ids.add(bar.id));
      group.fresh.forEach(bar => ids.add(bar.id));
      return;
    }
    /** 对侧是否存在起止一致的对照条（一致 = 这条没被调整） */
    const matched = (bar: ScheduleBar, list: ScheduleBar[]) =>
      list.some(item => item.startMin === bar.startMin && item.endMin === bar.endMin);
    group.old.forEach((bar) => {
      if (!matched(bar, group.fresh)) ids.add(bar.id);
    });
    group.fresh.forEach((bar) => {
      if (!matched(bar, group.old)) ids.add(bar.id);
    });
  });
  return ids;
});

/** 两行任务条是否「本来就是同一条」：条数相同且每条标题 + 起止一致（不看 state，planned / new 也算同一条） */
function sameTaskBars(a: ScheduleBar[], b: ScheduleBar[]) {
  if (a.length !== b.length) return false;
  const fingerprint = (bars: ScheduleBar[]) =>
    bars.map(bar => `${bar.title}|${Math.round(bar.startMin)}|${Math.round(bar.endMin)}`).sort().join("~");
  return fingerprint(a) === fingerprint(b);
}

/**
 * 「查看全部任务」时把重复的泳道折成一条。
 * 有些资源本来就没有新旧两版，接口仍给了两行（甚至其中一行是空的），全量展示时就会并排
 * 出现两条一模一样的任务条，看起来像新旧对照。这里按「相邻 + 同一资源」两两检查：
 * - 两行都空 → 整组丢掉（不占行高）；
 * - 只有一行空 → 只留非空那行；
 * - 两行任务条一一对应 → 只留一条（优先留「新」，那是最终排班），并清掉 tag，
 *   合并后没有新旧之分，左侧「旧 / 新」标签列也不会再出现。
 */
const displayRows = computed<ScheduleRow[]>(() => {
  const source = repRows.value;
  const out: ScheduleRow[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const row = source[index];
    const next = source[index + 1];
    const sameResource = Boolean(next) && (next.names[0] || next.id) === (row.names[0] || row.id);

    if (!sameResource) {
      if (row.bars.length > 0) out.push(row);
      continue;
    }

    if (row.bars.length === 0 && next.bars.length === 0) {
      index += 1;
      continue;
    }
    if (row.bars.length === 0) {
      out.push(next);
      index += 1;
      continue;
    }
    if (next.bars.length === 0) {
      out.push(row);
      index += 1;
      continue;
    }
    if (sameTaskBars(row.bars, next.bars)) {
      // 优先留「新」那条（最终排班），分组分隔线两行任一有就保留
      out.push({
        ...(row.tag === "新" ? row : next),
        tag: undefined,
        separator: row.separator || next.separator,
      });
      index += 1;
      continue;
    }
    out.push(row);
  }
  return out;
});

/**
 * 当前渲染的行：勾选「查看全部任务」给（去过重的）全部；
 * 未勾选只留有变动的任务条，行里一条不剩就整行收起（行位置 / 箭头 / 连线都跟着这份数据算）。
 */
const rows = computed(() => {
  if (showAllTasks.value) return displayRows.value;
  return repRows.value
    .map(row => ({ ...row, bars: row.bars.filter(bar => changedBarIds.value.has(bar.id)) }))
    .filter(row => row.bars.length > 0);
});

/** 每行高 40px（与右侧 track 一致），大屏电脑按 fontScale 等比放大 */
const ROW_HEIGHT = 40;

/** 当前行高：模板里分组格高度、连接线坐标都用它（样式侧同一份倍率见 --sch-fs） */
const rowHeight = computed(() => ROW_HEIGHT * fontScale.value);

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

/**
 * 某一排要不要打「旧 / 新」标签：**有对照 + 这一排确实有变动**才打。
 * - 单泳道（这一组只有一行，没有新旧对照）不打，标签列整列都不渲染；
 * - 整排任务都没变动（新旧时段一致，只是被「查看全部任务」放出来）也不打，
 *   否则满屏都是没有信息量的「旧 / 新」。
 * 一排里混合（部分变动）时整排仍打：这一排确实有需要对照的任务。
 */
function rowTagVisible(groupRows: ScheduleRow[], row: ScheduleRow) {
  if (groupRows.length < 2 || !row.tag) return false;
  return row.bars.some(bar => changedBarIds.value.has(bar.id));
}

/** 连接线坐标系：与 .schedule__grid-inner 一致（表头 45 高、重排每行 40 高、条 26 高） */
const LINK_RULER_HEIGHT = 0;
const LINK_ROW_HEIGHT = 40;
const LINK_BAR_TOP = 6;
const LINK_BAR_HEIGHT = 26;

/** 任务条中心点（x 由起止时间算，y 由所在行算；行高 / 条高随大屏倍率走，与 CSS 保持一致） */
function barCenter(rowIndex: number, bar: ScheduleBar) {
  const left = ((bar.startMin - DAY_START_MIN) / 60) * hourWidth.value;
  const width = Math.max(((bar.endMin - bar.startMin) / 60) * hourWidth.value, hourWidth.value / 2);
  const scale = fontScale.value;
  return {
    x: left + width / 2,
    y: (LINK_RULER_HEIGHT + rowIndex * LINK_ROW_HEIGHT + LINK_BAR_TOP + LINK_BAR_HEIGHT / 2) * scale,
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
 * 这里先算全量并带上 linkKey，交给下面的 activeLinkLines 按选中项过滤。
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

  const lines: Array<{ key: string; linkKey: string; style: Record<string, string> }> = [];
  groups.forEach((group, linkKey) => {
    group.old.forEach((from, oldIndex) => {
      group.fresh.forEach((to, newIndex) => {
        lines.push({
          key: `${linkKey}-${oldIndex}-${newIndex}`,
          linkKey,
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

/** 分钟数 →「HH:MM」（提示文案用真实排班时间，不用条里可能被截断的 timeText；取整 / 回绕见 hhmm） */
function formatMinute(min: number) {
  const total = Math.round(Number(min) || 0);
  const clock = hhmm(total);
  // 跨过 24 点的时段标「次日」，与接口 timeText 的写法（「次日00:21—次日01:04」）保持一致
  return total >= 1440 ? `次日${clock}` : clock;
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

/** 当前选中的那一趟任务（同一 linkKey 的旧 / 新两条一起描实线框） */
const activeLinkKey = ref("");

/**
 * 关联线只在选中时出现：点中某一趟任务后，才把它的「旧 ↔ 新」虚线画出来
 * （旧侧 N 条 × 新侧 M 条，拆趟 / 并趟都能连）；没选中时整层不渲染，画面只有两排任务条。
 */
const activeLinkLines = computed(() => {
  const key = activeLinkKey.value;
  if (!key) return [];
  return linkLines.value.filter(line => line.linkKey === key);
});

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

/** 关闭提示条：文案清空，同时取消选中（任务条边框随之还原成各自的计划态） */
function closeNotice() {
  activeLinkKey.value = "";
}

/** 点排程区空白处取消选中（设计稿 interaction.blankClick = clear）；任务条自身已 .stop，不会走到这里 */
function onBlankTap() {
  if (activeLinkKey.value) closeNotice();
}

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

/**
 * 每一行左右两侧还有被挡住的任务时，就在那一行的对应侧浮出箭头（稿子 6832:720）；
 * 点一下把时间轴滚到该行那一侧最近的任务。
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
  // 数据留到离开页面才清：页面存活期间（含刷新 / 重建）都能读到同一份
  clearPendingScheduleView();
});

// 「查看全部任务」会改变行数，行位置需要重新量
watch(() => rows.value.length, () => {
  nextTick(measureRowTops);
});

/**
 * 退出到对话页（左上角返回按钮，唯一入口）。
 *
 * 顺序：撤掉 CSS 旋转兜底（`exitLandscape()`；方向由宿主容器自己管，
 * 不再调 landscapeFullscreen） → 跳回对话页。
 *
 * 兜底路由给作业协同对话页：本页都是从作业协同对话里进来的，没有上一页可退时
 * 也要回那个会话（而不是首页）。
 */
async function leaveToChat() {
  // 先撤掉 CSS 旋转兜底，再跳页
  await exitLandscape();
  backFromScene("/pages/task/index");
}

/** 左上角返回按钮（模板直接绑这个，忽略事件参数） */
function backToChat() {
  void leaveToChat();
}

/** 切换「查看全部任务」：勾上给全部，取消只看有变动的 */
function toggleShowAll() {
  showAllTasks.value = !showAllTasks.value;
}

</script>

<template>
  <view
    class="schedule"
    :class="['schedule--rep', { 'schedule--rotated': rotated, 'schedule--dark': isDark, 'schedule--large-screen': isLargeScreen }]"
  >
    <!-- 顶部栏（7229:254：图例、查看全部任务、返回对话）：按产品要求去掉左侧标题与日期 -->
    <view class="schedule__header" :style="headerTopStyle">
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

        <!-- 查看全部任务（7229:416 勾选框 + 7229:417 文案）：勾上给全部，不勾只看有变动的 -->
        <view class="schedule__toggle-all" @tap="toggleShowAll">
          <view class="schedule__checkbox" :class="{ 'schedule__checkbox--on': showAllTasks }" />
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
          :style="{ height: `${group.rows.length * rowHeight}px` }"
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
          <!-- 旧 / 新 标签：每行一个（30×40 的白底格子），与右侧任务行一一对齐；
               单泳道（没有新旧对照）整列不渲染；有对照时只有「确实有变动」的那一排写字 -->
          <view v-if="group.rows.length > 1" class="schedule__side-tags">
            <view v-for="row in group.rows" :key="row.id" class="schedule__side-tag">
              <text v-if="rowTagVisible(group.rows, row)">
                {{ row.tag }}
              </text>
            </view>
          </view>
        </view>
          </view>
        </view>
      </view>

      <view id="schedule-grid" class="schedule__grid-wrap">
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
          @tap="onBlankTap"
        >
          <!-- --hour-width：竖网格线间距跟着双指缩放走 -->
          <view
            class="schedule__grid-inner"
            :style="{ width: `${timelineWidth}px`, '--hour-width': `${hourWidth}px` }"
          >
          <!-- 内容区：纵向滚动（时间轴刻度固定在上面） -->
          <view class="schedule__rows">
            <view class="schedule__rows-inner">
          <!-- 新旧关联线：只在选中某一趟任务时画（activeLinkLines），未选中时整层不渲染 -->
          <view
            v-for="line in activeLinkLines"
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
                { 'schedule__bar--active': bar.linkKey && bar.linkKey === activeLinkKey },
              ]"
              :style="barStyle(bar)"
              @tap.stop="onBarTap(bar)"
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
          <image class="schedule__scroll-icon schedule__scroll-icon--prev" :src="arrowPrevIcon" mode="aspectFit" />
        </view>
        <view
          v-if="rowHints[rowIndex] && rowHints[rowIndex].right"
          class="schedule__scroll-btn schedule__scroll-btn--next"
          @tap="jumpToRow(1, rowIndex)"
        >
          <image class="schedule__scroll-icon schedule__scroll-icon--next" :src="arrowNextIcon" mode="aspectFit" />
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

    <!-- 右下角输入条（键盘图标 + 输入 / 语音 / 发送）按需求取消，本页只保留浏览与详情 -->
  </view>
</template>

<style lang="scss" scoped>
/* 横屏稿件 6464:150：812 × 375，元素尺寸直接按稿件 px（横屏可视区宽约 812 时与稿一致，窄则横向滚动兜住）
   版式要点：左列 140（底 #FBFBFB / 描边 #F2F2F2）、每小时 56px、行高 45、任务条 40 高白底 + #F2F2F2 描边 */
.schedule {
  /* 字号 / 行高 / 任务条 / 左列的等比缩放倍率：1 = 设计稿（11px = 22rpx）。
     19 寸以上电脑屏幕由 .schedule--large-screen 改成 1.5455（11px → 17px = 34rpx） */
  --sch-fs: 1;
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

/* 大屏电脑（≥ 19 寸，判定见 hooks/useLargeScreenFont）：
   基准字号 11px(22rpx) 等比放大到 17px(34rpx)，行高 / 任务条 / 左列宽度一并乘 --sch-fs，
   否则字号变大后会被固定的行高、条高裁掉（脚本侧 ROW_HEIGHT 用同一倍率，见 fontScale） */
.schedule--large-screen {
  --sch-fs: 1.5455;
}

/* 旋转模拟横屏时（useLandscape）：body 已旋转 90°，页面按横屏尺寸铺开 */
.schedule--rotated {
  width: 100vh;
  height: 100vw;
}

/* ---------- 顶部栏：设计高 49，左右内边距 28（设计稿 6832:764 状态栏之下的导航区） ----------
   H5 网页（不转屏）的视口通常比设计稿 812 窄：标题 / 日期 / 图例文案一律「按文案自适应宽度」，
   禁止折行、也不参与 flex 压缩；真放不下时让「图例 + 按钮」整块落到第二行，而不是拆字。 */
.schedule__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  min-height: 49px;
  padding: 0 28px;
  /* 行间距只给换行时用（一行时由 min-height + 居中维持设计稿 49 高） */
  gap: 4px 16px;
}

.schedule__tools {
  display: flex;
  align-items: center;
  flex: none;
  /* 窄视口里整块换到第二行时仍然靠右 */
  margin-left: auto;
  gap: 16px;
}

/* 图例（ardot 134:999 / 207:2804）：三组「色块 + 文字」，色块 10×10 圆角 3、项内 gap 5、项间 gap 12 */
.schedule__legend {
  display: flex;
  align-items: center;
  flex: none;
  gap: 12px;
}

.schedule__legend-item {
  display: flex;
  align-items: center;
  flex: none;
  gap: 5px;
}

/* 色块取任务条的同一组变量（见「任务条状态色」）：图例与条永远是同一份颜色 / 线型。
   设计稿：原计划 灰底 #F3F3F3 + 虚线、新计划 白底 + 虚线 #9DB3CC、已取消 灰底 + 实线 */
.schedule__legend-chip {
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  border-width: 1px;
  border-style: dashed;
  border-color: var(--bar-planned-border, #e8e8e8);
  border-radius: 3px;
  background: var(--bar-planned-bg, #f3f3f3);
}

/* 新计划：白底 + 虚线 #9DB3CC */
.schedule__legend-chip--new {
  border-style: dashed;
  border-color: var(--bar-new-border, #9db3cc);
  background: var(--bar-new-bg, #ffffff);
}

/* 已取消：灰底 + 实线 #E8E8E8 */
.schedule__legend-chip--canceled {
  border-style: solid;
  border-color: var(--bar-canceled-border, #e8e8e8);
  background: var(--bar-canceled-bg, #f3f3f3);
}

/* 宽度按文案自适应：不压缩、不折行（网页窄屏时靠整块换行保版面，而不是拆字）；12/Regular #0D0D0D */
.schedule__legend-text {
  flex: none;
  font-size: calc(12px * var(--sch-fs));
  white-space: nowrap;
  color: var(--legend-text, #0d0d0d);
}

/* 「查看全部任务」：勾选框 + 文案（7229:416 / 7229:417） */
.schedule__toggle-all {
  display: flex;
  align-items: center;
  flex: none;
  gap: 5px;
}

/* 窄视口（H5 网页 / 小尺寸窗口）：收紧顶部栏间距，尽量维持一行；
   放在基础样式之后，同特异度才能覆盖上面的 16px / 28px。
   限定 :not(.schedule--rotated)：CSS 旋转模拟横屏时视口本身也是窄的，
   但页面按设计稿 812 宽铺开，留白不能跟着收 */
@media (max-width: 780px) {
  .schedule:not(.schedule--rotated) .schedule__header {
    padding: 0 16px;
  }

  .schedule:not(.schedule--rotated) .schedule__tools {
    gap: 12px;
  }

  .schedule:not(.schedule--rotated) .schedule__legend {
    gap: 12px;
  }
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
}

/* 补 90°：图标本体是横置的（箭头朝右），竖屏版面上要转正。
   直接按可视区方向判，覆盖三种来源：CSS 旋转兜底的设备竖着拿、网页版竖屏窗口、
   本身就是横屏画布但按竖屏容器打开的机型（智慧屏 / 大屏一体机）。
   用 transform 而不是 rotate 独立属性：天猫精灵智慧屏 / 酷开大屏的 WebView 内核较老，不认 `rotate`。 */
@media (orientation: portrait) {
  .schedule__exit-icon {
    transform: rotate(90deg);
  }
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

/* 左侧资源列：宽 140（稿子 6464:279）、底 #FBFBFB、右描边 #F2F2F2。
   顶部线用 inset 阴影画、不用 border-top：border 会把整列内容顶下去 1px，
   左列行就比右侧 track 低 1px，分组线和任务行的分隔线会错开不在同一水平线上 */
.schedule__side {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  box-sizing: border-box;
  border-right: 1px solid #f2f2f2;
  background: #fbfbfb;
  box-shadow: inset 0 1px 0 0 #f2f2f2;
}

/* 左列头部「资源与车辆人员」：高度 45 必须与右侧刻度条（.schedule__ruler）一致，
   否则左列行与右侧 track 错位；文字垂直居中、不留上下留白 */
.schedule__side-head {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  box-sizing: border-box;
  height: calc(45px * var(--sch-fs));
  padding: 0 0 0 10px;
}

.schedule__side-head-text {
  font-size: calc(11px * var(--sch-fs));
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
  font-size: calc(11px * var(--sch-fs));
  line-height: calc(13px * var(--sch-fs));
  font-weight: 500;
  color: #666666;
}

/* 副行（车号|班次）：11px 常规 #999（稿子 6464:296） */
.schedule__side-name {
  font-size: calc(11px * var(--sch-fs));
  line-height: calc(13px * var(--sch-fs));
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
  width: calc(30px * var(--sch-fs));
  height: calc(40px * var(--sch-fs));
  border: 1px solid #f2f2f2;
  background: #ffffff;
  font-size: calc(11px * var(--sch-fs));
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
  /* 表体底色 #FBFBFB（稿子 6464:167），每小时一条竖网格线 #F3F3F3（Vector 84…98，间距随双指缩放走） */
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
  height: calc(45px * var(--sch-fs));
  overflow: hidden;
  background: #fbfbfb;
}

/* 刻度标签：在 45 高的刻度条内上下居中（与左侧头部文字同一水平线） */
.schedule__ruler-label {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  font-size: calc(12px * var(--sch-fs));
  // font-style: italic;
  color: #1a1a1e;
}

/* 每行高 45，与左侧分组行一一对应（稿子每行 ~45） */
.schedule__track {
  position: relative;
  box-sizing: border-box;
  height: calc(45px * var(--sch-fs));
}

.schedule__track--separator {
  box-shadow: 0 1px 0 0 #f2f2f2;
}

/* 任务条基础：圆角 6、内边距 8；尺寸/底色/描边/排版按模式区分（见文件末尾「按模式区分」） */
.schedule__bar {
  position: absolute;
  display: flex;
  align-items: center;
  gap: calc(8px * var(--sch-fs));
  box-sizing: border-box;
  padding: 0 calc(8px * var(--sch-fs));
  border-radius: 6px;
  overflow: hidden;
}

/* 条内文字按设计稿弱化：标题 11/500 #0D0D0D、时段 11/400 #8F8F8F，行高 16（1522:524 / 1522:525） */
.schedule__bar-title {
  flex-shrink: 0;
  font-size: calc(11px * var(--sch-fs));
  font-weight: 500;
  line-height: calc(16px * var(--sch-fs));
  color: #0d0d0d;
  white-space: nowrap;
}

.schedule__bar-time {
  flex-shrink: 0;
  font-size: calc(11px * var(--sch-fs));
  font-weight: 400;
  line-height: calc(16px * var(--sch-fs));
  color: #8f8f8f;
  white-space: nowrap;
}

/* ---------- 底部提示条：仅重排稿有（7229:449） ---------- */
.schedule__notice {
  position: absolute;
  left: 50%;
  /* 右下角输入条已取消，提示条不再需要给它让位，贴到距底 12px */
  bottom: 12px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: calc(8px * var(--sch-fs));
  box-sizing: border-box;
  /* 宽高跟着字号一起放大，否则 34rpx 的字一行放不下 */
  width: calc(476px * var(--sch-fs));
  max-width: calc(100% - 32px);
  min-height: calc(42px * var(--sch-fs));
  padding: 0 calc(12px * var(--sch-fs));
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
  min-width: calc(32px * var(--sch-fs));
  height: calc(14px * var(--sch-fs));
  padding: 0 calc(4px * var(--sch-fs));
  border-radius: 7px;
  background: #1a1a1a;
  font-size: calc(11px * var(--sch-fs));
  color: #ffffff;
}

.schedule__notice-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: calc(11px * var(--sch-fs));
  line-height: calc(14px * var(--sch-fs));
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

/* ---------- 竖屏：提示条改成贴底弹层 ----------
   横屏（原生横屏 / CSS 旋转模拟横屏）维持稿子 7229:449 的 476×42 单行条：深色胶囊 + 一行文案。
   可视区是竖的、且没走旋转模拟（.schedule--rotated）时，按需求换成底部卡片：
   标题一行（左「任务置换」、右关闭）、正文整行折行，左右贴边、上方圆角、让开底部安全区。
   `:not(.schedule--rotated)` 是关键：设备竖着拿但页面旋转成横屏时，media 仍是 portrait，
   不加这条会把横屏版面也变成弹层。 */
@media (orientation: portrait) {
  .schedule:not(.schedule--rotated) .schedule__notice {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    box-sizing: border-box;
    width: auto;
    max-width: none;
    min-height: 0;
    padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 0px));
    border: 0;
    border-radius: 16px 16px 0 0;
    background: #ffffff;
    box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.08);
    transform: none;
  }

  /* 标题：原来的深色胶囊在弹层里只留文字（深色胶囊是横屏的视觉语言） */
  .schedule:not(.schedule--rotated) .schedule__notice-chip {
    grid-row: 1;
    grid-column: 1;
    justify-self: start;
    min-width: 0;
    height: auto;
    padding: 0;
    border-radius: 0;
    background: transparent;
    font-size: 17px;
    font-weight: 600;
    line-height: 24px;
    color: #1a1a1a;
  }

  .schedule:not(.schedule--rotated) .schedule__notice-close {
    grid-row: 1;
    grid-column: 2;
    justify-self: end;
    width: 16px;
    height: 16px;
  }

  .schedule:not(.schedule--rotated) .schedule__notice-close::before,
  .schedule:not(.schedule--rotated) .schedule__notice-close::after {
    top: 7px;
    width: 16px;
    height: 1.5px;
    background: #b3b3b3;
  }

  .schedule:not(.schedule--rotated) .schedule__notice-text {
    grid-row: 2;
    grid-column: 1 / -1;
    font-size: 14px;
    line-height: 22px;
    color: #666666;
  }
}

/* ---------- 任务条 / 行高：按模式区分 ---------- */

/* 任务三态的底色 / 描边 / 线型：右上角图例色块与任务条共用同一组变量。
   任何一处改色另一处自动跟上，不会再出现「条是白底、图例说该是灰底」的错位。
   规格取自 ardot 134:992（浅色）/ 207:2606（深色）：
   - 原计划：灰底 #F3F3F3 + 虚线 #E8E8E8（深色 #303030 + 虚线 #5D5D5D）
   - 新计划：白底 #FFFFFF + 虚线 #9DB3CC（深色 #303030 + 虚线 #9DB3CC，与图例同底）
   - 已取消：灰底 #F3F3F3 + **实线** #E8E8E8（深色 #303030 + 实线 #E8E8E8）
   深色主题在同一组变量上覆盖（见文件末尾 .schedule--dark） */
.schedule--rep {
  --legend-text: #0d0d0d;
  --bar-planned-bg: #f3f3f3;
  --bar-planned-border: #e8e8e8;
  --bar-new-bg: #ffffff;
  --bar-new-border: #9db3cc;
  --bar-canceled-bg: #f3f3f3;
  --bar-canceled-border: #e8e8e8;
}

/* 重排（ardot 134:992）：25/26 高、单行（标题 + 时段并排）、圆角 6、1px 虚线。
   原计划 = 灰条 #F3F3F3 + 虚线 #E8E8E8。
   线型直接写死（不用变量）：三态线型是固定的，少一层变量就少一处「变量没继承到 → 全变成实线」的坑 */
.schedule--rep .schedule__bar {
  top: calc(6px * var(--sch-fs));
  height: calc(26px * var(--sch-fs));
  border-width: 1px;
  border-style: dashed;
  border-color: var(--bar-planned-border, #e8e8e8);
  background: var(--bar-planned-bg, #f3f3f3);
}

/* 重排·新计划：白条 + 虚线 #9DB3CC */
.schedule--rep .schedule__bar--new {
  border-style: dashed;
  border-color: var(--bar-new-border, #9db3cc);
  background: var(--bar-new-bg, #ffffff);
}

/* 重排·已取消：灰底 + 实线，整条文案转灰 #8F8F8F（134:1077） */
.schedule--rep .schedule__bar--canceled {
  border-style: solid;
  border-color: var(--bar-canceled-border, #e8e8e8);
  background: var(--bar-canceled-bg, #f3f3f3);
}

.schedule--rep .schedule__bar--canceled .schedule__bar-title,
.schedule--rep .schedule__bar--canceled .schedule__bar-time {
  color: #8f8f8f;
}

/* 强调条不再改描边：接口里大量 highlight=true 的条会被强行画成实线，
   把「原计划虚线 / 新计划虚线 / 已取消实线」这套状态语言盖掉。
   重排页统一以状态样式为准，只有选中态（--active）才切成实线。 */

/* 选中态：被点的那一趟任务（旧 / 新两条同时描 #5D5D5D 实线），底部提示文案就是它俩生成的 */
.schedule--rep .schedule__bar {
  cursor: pointer;
}

.schedule--rep .schedule__bar--active {
  border-style: solid;
  border-color: #5d5d5d;
}

/* 行高：40（条 26 + 上下留白）；左侧分组格的高度由模板按行数算（脚本侧 rowHeight 同一倍率） */
.schedule--rep .schedule__track {
  height: calc(40px * var(--sch-fs));
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
  left: calc(148px * var(--sch-fs));
}

.schedule__scroll-btn--next {
  right: 8px;
}

.schedule__scroll-btn:active {
  opacity: 0.7;
}

/* 箭头：图片图标（稿子 6832:719 / 10633:140，1.5px 描边 #1A1A1A）。
   原来是 9×9 直角 + rotate 45° 的 CSS 画法：旋转会把图形推出盒子（视觉中心偏右约 3px），
   换成整块 svg 后宽高就是图形本身，交给按钮的 flex 居中即可真正居中。 */
.schedule__scroll-icon {
  width: 8px;
  height: 14px;
}

/* 新旧关联虚线：细虚线（取新计划同色），不挡点击 */
.schedule__link {
  position: absolute;
  height: 0;
  /* 跟新计划的描边同色（深浅色都跟着变量走） */
  border-top: 1px dashed var(--bar-new-border, #9db3cc);
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

/* ===== 深色主题：调度视图·重排草案（ardot 207:2606）=====
   只换材质与字色，版式 / 行高 / 手势 / 缩放与滚动一行不动：
   - 页面底 #1A1A1A；左列与排程区 #212121；竖网格线 #303030；行分隔线 #5D5D5D
   - 左列：表头 / 资源名 #FFFFFF、类别 #8E8E8E、车号|班次 #6B6B6B
   - 任务条：底色 / 描边 / 线型取三态变量，与顶部图例同源（原计划 #303030/#5D5D5D 虚线、
     新计划 #303030/#9DB3CC 虚线、已取消 #303030/#E8E8E8 实线）；已取消文案 #8F8F8F、
     强调 / 选中为 #FFFFFF 实线；条内标题 #FFFFFF、时段 #8F8F8F
   - 顶部图例 / 勾选 / 返回、底部提示条、左右箭头同步换材质；箭头图标是深色线条，反相成白 */
.schedule--dark {
  /* 任务三态色的深色版本（ardot 207:2606）：原计划 #303030 + 虚线 #5D5D5D、
     新计划 #303030 + 虚线 #9DB3CC、已取消 #303030 + 实线 #E8E8E8（三态同底，靠描边区分，与图例一致） */
  --legend-text: #5d5d5d;
  --bar-planned-bg: #303030;
  --bar-planned-border: #5d5d5d;
  --bar-new-bg: #303030;
  --bar-new-border: #9db3cc;
  --bar-canceled-bg: #303030;
  --bar-canceled-border: #e8e8e8;

  background: #1a1a1a;
  color: #e5e5e5;

  /* ---- 顶部栏：图例 / 查看全部 / 返回（图例文字色由 --legend-text 给） ---- */
  .schedule__checkbox {
    border-color: #4a4a4a;
    background: transparent;
  }

  .schedule__checkbox--on {
    border-color: #e5e5e5;
    background: #e5e5e5;
  }

  .schedule__exit {
    border-color: #5d5d5d;
    background: #303030;
  }

  .schedule__exit-icon::before,
  .schedule__exit-arrow::before {
    border-color: #e5e5e5;
  }

  .schedule__exit-arrow {
    background: #e5e5e5;
  }

  /* ---- 主体 / 左列资源 ---- */
  .schedule__body,
  .schedule__side,
  .schedule__grid-wrap,
  .schedule__grid,
  .schedule__ruler {
    background: #212121;
  }

  .schedule__side {
    border-right-color: #303030;
    /* 顶部线同样是 inset 阴影（见 .schedule__side 注释），别改回 border-top */
    box-shadow: inset 0 1px 0 0 #303030;
  }

  .schedule__side-head-text {
    color: #ffffff;
  }

  /* 左侧资源块（ardot 207:2793 等，138×80）：每块 1px #303030 描边的独立卡片，
     块与块共用一条线 —— 只画上边框 + 左边框，右边缘由 .schedule__side 的 border-right 提供，
     最后一块补下边框，避免相邻块叠成 2px */
  .schedule__side-group {
    border-top: 1px solid #303030;
    border-left: 1px solid #303030;
    border-bottom: 0;
  }

  .schedule__side-group:last-child {
    border-bottom: 1px solid #303030;
  }

  /* 分组间隔沿用改动前的样式：块脚下一条 1px #5D5D5D 投影 */
  .schedule__side-group--separator {
    box-shadow: 0 1px 0 0 #5d5d5d;
  }

  .schedule__side-category {
    color: #8e8e8e;
  }

  .schedule__side-name {
    color: #6b6b6b;
  }

  .schedule__side-name--main {
    color: #ffffff;
  }

  /* 旧 / 新 标签格（ardot 207:2796 / 207:2799，30×40）：#1A1A1A 底（比资源块 #212121 暗一档）
     + 1px #303030 描边，文字纯白；格与格之间的线就是这两条描边，不再整行画横线。
     右边缘交给 .schedule__side 的 border-right，避免和标签格右边框叠成 2px */
  .schedule__side-tag {
    border: 1px solid #303030;
    border-right: 0;
    background: #1a1a1a;
    color: #ffffff;
  }

  /* ---- 排程区：竖网格线 / 刻度 / 行分隔 ---- */
  .schedule__grid-inner {
    background-color: #212121;
    background-image: repeating-linear-gradient(
      to right,
      #303030 0,
      #303030 1px,
      transparent 1px,
      transparent var(--hour-width, 56px)
    );
  }

  .schedule__ruler-label {
    color: #ffffff;
  }

  .schedule__track--separator {
    box-shadow: 0 1px 0 0 #5d5d5d;
  }

  /* ---- 任务条：底色 / 描边由上面的三态变量统一给，这里只管文案（标题纯白、时段 #8F8F8F） ---- */
  .schedule__bar-title {
    color: #ffffff;
  }

  .schedule__bar-time {
    color: #8f8f8f;
  }

  /* ---- 底部提示条 / 左右隐藏任务箭头 ---- */
  .schedule__notice {
    border-color: #5d5d5d;
    background: #303030;
  }

  .schedule__notice-chip {
    background: #f2f2f2;
    color: #1a1a1a;
  }

  .schedule__notice-text {
    color: #e5e5e5;
  }

  .schedule__notice-close::before,
  .schedule__notice-close::after {
    background: #e5e5e5;
  }

  .schedule__scroll-btn {
    border-color: #303030;
    background: #1a1a1a;
  }

  .schedule__scroll-icon {
    filter: invert(1);
  }

  /* ---- 重排专用：已取消文案 / 选中（ardot 207:2606）---- */
  &.schedule--rep {
    .schedule__bar--canceled .schedule__bar-title,
    .schedule__bar--canceled .schedule__bar-time {
      color: #8f8f8f;
    }

    /* 选中：白色实线框；未选中的条一律按三态（原计划 / 新计划虚线、已取消实线） */
    .schedule__bar--active {
      border-color: #ffffff;
    }

    /* 右区：每个资源组之间一条 1px #5D5D5D（ardot 207:2686 等），组内旧 / 新两行之间不画线 */
    .schedule__track--separator {
      box-shadow: 0 1px 0 0 #5d5d5d;
    }

    /* 左区：分组间隔与改动前一致（1px #5D5D5D 投影 + #5D5D5D 上边框） */
    .schedule__side-group--separator {
      box-shadow: 0 1px 0 0 #5d5d5d;
      border-top-color: #5d5d5d;
    }
  }

  /* ---- 竖屏弹层（深色）：卡片底 #303030（比页面 #1A1A1A 亮一档）---- */
  @media (orientation: portrait) {
    &:not(.schedule--rotated) {
      .schedule__notice {
        border: 0;
        background: #303030;
        box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.45);
      }

      .schedule__notice-chip {
        background: transparent;
        color: #e5e5e5;
      }

      .schedule__notice-text {
        color: #8e8e8e;
      }

      .schedule__notice-close::before,
      .schedule__notice-close::after {
        background: #b3b3b3;
      }
    }
  }
}
</style>

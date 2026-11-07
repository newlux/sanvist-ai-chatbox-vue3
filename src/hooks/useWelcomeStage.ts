import { computed, nextTick, onBeforeUnmount, ref } from "vue";

/**
 * 「欢迎态 → 对话态」的起飞动画（导出自首页 pages/index 的同款实现）。
 *
 * 首页是「初始页 / 对话页」两个态共用一个路由，guide / task 这类内页则是
 * 「欢迎层铺满 + 对话页在下面渐入」：点欢迎层里的语音或键盘时，
 * 中间 logo 按抛物线飞到对话页顶部灵动岛的位置停住，欢迎层再收起。
 *
 * 用法：
 * ```ts
 * const { stage, leaving, landed, logoStyle, showWelcome, chatEnterDelayMs, goToChat, enterChatNow, backToWelcome } = useWelcomeStage();
 * ```
 * - `goToChat()` 在落位动画彻底走完（欢迎层已卸载）后才 resolve，可在其后聚焦输入框；
 * - `enterChatNow()` 用于历史会话 / 自动带进来的提问等「不该播动画」的场景，直接切到对话态。
 *
 * 页面模板约定：
 * - `<AiWelcome v-if="showWelcome" :leaving :landed :logo-style @start-chat @start-text />`
 * - `<view v-if="stage === 'chat'" class="ai-page__chat ai-page__chat--enter" :style="{ ...chatViewportStyle, '--chat-enter-delay': ... }">`
 */

/** 起飞动画时长（ms）：逐帧位移跑满这么久 */
export const WELCOME_FLY_MS = 640;
/** 落位后留给「欢迎层 logo 淡出 → 头部灵动岛图标接上」的时间 */
const WELCOME_LAND_FADE_MS = 160;
/**
 * 点「点击说话」后先等 listen.gif 扩散到最大再起飞（实测峰值 480ms，扣掉首帧相位差 40ms），
 * 动图还在涨的时候就走，会显得后半段被吃掉。
 */
export const WELCOME_LISTEN_HOLD_MS = 440;
/** 对话页整体淡入的延迟：与起飞同时开始，避免 logo 还停在中间时对话页已经铺满 */
const WELCOME_CHAT_ENTER_DELAY_MS = Math.max(0, WELCOME_LISTEN_HOLD_MS - 120);

/** 飞行曲线的侧向弧线幅度（px）：首尾都在屏幕中线上，靠它画出抛物线 */
const WELCOME_FLY_ARC_X = 18;
/** 中段最大放大倍数：先慢慢变大，末段再收敛回灵动岛图标尺寸 */
const WELCOME_FLY_PEAK_SCALE = 1.16;
/** 放大达到峰值的进度点（0~1） */
const WELCOME_FLY_PEAK_AT = 0.45;

/** 欢迎层 logo 的飞行层（量起点） */
const WELCOME_LOGO_SELECTOR = ".welcome__logo-fly";
/** 对话页头部灵动岛图标（量落点） */
const CHAT_ISLAND_SELECTOR = ".chat-header__island-logo";

export type WelcomeStage = "welcome" | "chat";

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function readClientRect(selector: string) {
  if (typeof document === "undefined") return null;
  const el = document.querySelector(selector) as HTMLElement | null;
  return el ? el.getBoundingClientRect() : null;
}

/** 等两帧：第一帧把新节点画出来，第二帧写 transform 才会走过渡（否则是瞬移） */
function nextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * 对话页首帧布局要等到这些时机才稳定：header 里的状态栏占位高度由 useSafeArea 回填、
 * 字体/图标尺寸也可能在首帧后才定。这些都会让灵动岛图标整体上下移动，
 * 所以量目标位置之前要等布局落定，否则会量到偏高的一点（表现为「冲过头再掉回来」）。
 */
async function waitChatLayoutSettled() {
  await nextTick();
  await nextPaint();
  await sleep(48);
}

/**
 * 抛物线式飞行：逐帧写 transform。
 *
 * - 位移：进度取 1.9 次幂 → 起手慢、越往后越快（末段「冲刺」）；
 * - 轨迹：叠一条 sin 弧线，中段偏离中线最多、两端归零，看起来才是抛物线；
 * - 尺寸：0 → 45% 从 1 放大到 1.16 倍，之后收到灵动岛图标的实际比例。
 */
function runWelcomeFly(from: DOMRect, to: DOMRect, onDone: () => void, onFrame: (style: Record<string, string>) => void) {
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const targetScale = from.width > 0 ? to.width / from.width : 1;
  const startedAt = performance.now();
  let rafId = 0;

  const frame = (now: number) => {
    const p = Math.min(1, (now - startedAt) / WELCOME_FLY_MS);
    const travel = p ** 1.9;
    const arc = Math.sin(Math.PI * p) * WELCOME_FLY_ARC_X;
    const scale = p <= WELCOME_FLY_PEAK_AT
      ? 1 + (WELCOME_FLY_PEAK_SCALE - 1) * (p / WELCOME_FLY_PEAK_AT)
      : WELCOME_FLY_PEAK_SCALE
        + (targetScale - WELCOME_FLY_PEAK_SCALE) * ((p - WELCOME_FLY_PEAK_AT) / (1 - WELCOME_FLY_PEAK_AT));

    onFrame({ transform: `translate3d(${dx * travel + arc}px, ${dy * travel}px, 0) scale(${scale})` });

    if (p < 1) {
      rafId = requestAnimationFrame(frame);
      return;
    }
    // 由最后一帧收尾（而不是另起固定时长的定时器）：两者时间基准不同，
    // 定时器有可能比最后一帧早到，把 logo 停在半路
    onDone();
  };

  rafId = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(rafId);
}

export function useWelcomeStage() {
  const stage = ref<WelcomeStage>("welcome");
  /** 起飞中：欢迎层先不卸载，等中间 logo 滑到对话页顶部再收起 */
  const leaving = ref(false);
  /** 已到顶：欢迎层 logo 淡出，交给对话页自己的灵动岛图标接上 */
  const landed = ref(false);
  /** 欢迎层 logo 的落点 transform：按灵动岛图标的真实坐标算出来 */
  const logoStyle = ref<Record<string, string>>({});
  /** 对话页淡入延迟：语音起飞时等 listen.gif 扩散，文字起飞立即淡入 */
  const chatEnterDelayMs = ref(WELCOME_CHAT_ENTER_DELAY_MS);
  /** 欢迎层是否还挂在页面上（起飞期间与对话页同时存在） */
  const showWelcome = computed(() => stage.value === "welcome" || leaving.value);

  let flyTimer: ReturnType<typeof setTimeout> | null = null;
  let cancelFly: (() => void) | null = null;
  /** 等落位的回调（goToChat 的 await） */
  let landWaiters: Array<() => void> = [];

  function clearFlyTimer() {
    if (flyTimer) {
      clearTimeout(flyTimer);
      flyTimer = null;
    }
  }

  function stopFly() {
    if (cancelFly) {
      cancelFly();
      cancelFly = null;
    }
  }

  function resolveLandWaiters() {
    const waiters = landWaiters;
    landWaiters = [];
    waiters.forEach(fn => fn());
  }

  /** 落位动画真正结束（欢迎层已卸载）后 resolve；没在起飞则立即 resolve */
  function waitLanding() {
    if (!leaving.value) return Promise.resolve();
    return new Promise<void>((resolve) => {
      landWaiters.push(resolve);
    });
  }

  /**
   * 不走动画直接进对话态：打开历史会话、甘特图带回来的提问等场景。
   * 起飞途中调用会被忽略（动画已经在跑，落位后自然就是对话态）。
   */
  function enterChatNow() {
    if (leaving.value || stage.value === "chat") return;
    stopFly();
    clearFlyTimer();
    logoStyle.value = {};
    chatEnterDelayMs.value = 0;
    stage.value = "chat";
    resolveLandWaiters();
  }

  /** 回到欢迎态（新对话 / 重置）：欢迎层重新挂载，内部状态全清 */
  function backToWelcome() {
    stopFly();
    clearFlyTimer();
    leaving.value = false;
    landed.value = false;
    logoStyle.value = {};
    chatEnterDelayMs.value = WELCOME_CHAT_ENTER_DELAY_MS;
    stage.value = "welcome";
    resolveLandWaiters();
  }

  /**
   * 欢迎层 → 对话页：中间图标按抛物线飞到对话页顶部灵动岛的位置停住。
   *
   * `holdMs`：起飞前先等多久（语音要等 listen.gif 扩散到最大，文字传 0）。
   * 返回的 promise 在「滑到顶 + 淡出交接」全部收尾后才 resolve。
   */
  async function goToChat(options?: { holdMs?: number }) {
    if (leaving.value) return waitLanding();
    if (stage.value === "chat") return;

    const holdMs = Math.max(0, options?.holdMs ?? 0);
    chatEnterDelayMs.value = holdMs > 0 ? WELCOME_CHAT_ENTER_DELAY_MS : 0;

    // 起飞前先量欢迎页 logo 的中心（量飞行层，sani / listen 两张图都在它里面），
    // 随后欢迎层让位、对话页开始渲染
    const from = readClientRect(WELCOME_LOGO_SELECTOR);
    const startedAt = performance.now();
    leaving.value = true;
    stage.value = "chat";

    await waitChatLayoutSettled();
    const to = readClientRect(CHAT_ISLAND_SELECTOR);

    const holdRemain = holdMs - (performance.now() - startedAt);
    if (holdRemain > 0) await sleep(holdRemain);
    // 中途被回退 / 直接切走：不再起飞
    if (!leaving.value) return;

    /** 落位收尾：先淡出欢迎层 logo（对话页图标同位置同尺寸接上），再卸载欢迎层 */
    const land = () => {
      stopFly();
      clearFlyTimer();
      landed.value = true;
      flyTimer = setTimeout(() => {
        flyTimer = null;
        leaving.value = false;
        landed.value = false;
        logoStyle.value = {};
        resolveLandWaiters();
      }, WELCOME_LAND_FADE_MS);
    };

    if (from && to && to.width > 0) {
      stopFly();
      cancelFly = runWelcomeFly(from, to, () => {
        cancelFly = null;
        land();
      }, (style) => {
        logoStyle.value = style;
      });
    }
    else {
      // 量不到目标（对话页还没渲染出灵动岛）：不做位移，直接按原时长收尾
      flyTimer = setTimeout(land, WELCOME_FLY_MS);
    }

    await waitLanding();
  }

  onBeforeUnmount(() => {
    stopFly();
    clearFlyTimer();
    resolveLandWaiters();
  });

  return {
    stage,
    leaving,
    landed,
    logoStyle,
    showWelcome,
    chatEnterDelayMs,
    goToChat,
    enterChatNow,
    backToWelcome,
  };
}

/**
 * 遥控器按键（Android TV / 蓝牙遥控器）→ 页面动作。
 *
 * 按键事件走 `remoteKeyEvent`（统一封装见 `utils/platform/mpaas` 的
 * registerRemoteKeyListener / unregisterRemoteKeyListener / onRemoteKeyEvent）。
 *
 * 这里只做四件事：
 * 1. 生命周期：`enabled` 为 true 时注册并订阅，变 false / 组件卸载时注销并退订
 *    —— 注册成功后原生侧会拦截遥控器按键（含返回键），不注销用户就退不出去；
 * 2. 事件规整：长按的 `repeatCount > 0` 丢掉；宿主漏推 `up` 时用时间窗兜住重复 `down`；
 * 3. 按键分发：音量加 / 音量减 / 静音→ onConfirm，返回键 → onBack，其余键忽略；
 * 4. 重连：宿主新开 webview 盖住本页（甘特离线包、场景窗口）再回来时，本页
 *    onHide / onShow 不一定触发，而原生侧监听与前端订阅都已失效 —— 靠「可见 /
 *    window.focus / pageshow / 原生 resume / uni onShow」五路信号把「订阅 + 注册」
 *    整对重建一遍（见 sync 的 forceResubscribe）。只重注册是不够的。
 *    **不要求先收到 hidden**：安卓用 openH5Container 开离线包时宿主 webview 常不产生
 *    hidden，按「先 hidden 再 visible」判定会把回来那次 visible 吞掉，音量键从此失灵。
 *
 * 宿主没实现这套 JSAPI（浏览器 / 旧容器）时静默降级：只打一条 warn，触屏交互照旧。
 *
 * 不用 `getRemoteKeyListenerState` 判活：原生返回 `listening: true` 只说明监听还挂在
 * 原生侧，不代表按键还会派发回这个 webview（容器切换后就是这状态），拿它当判据会漏修。
 */

import type { Ref } from "vue";
import type { RemoteKeyEventPayload } from "@/utils/platform/mpaas";
import { onShow } from "@dcloudio/uni-app";
import { onBeforeUnmount, ref, watch } from "vue";
import { createLogger } from "@/utils/logger";
import { onNativeEvent, onRemoteKeyEvent, registerRemoteKeyListener, unregisterRemoteKeyListener } from "@/utils/platform/mpaas";

const logger = createLogger("remote-key");

// 三个助手共用宿主按键监听，原生注销与注册必须跨页面按顺序执行。
let nativeKeyOperations: Promise<unknown> = Promise.resolve();
function runNativeKeyOperation<T>(operation: () => Promise<T>): Promise<T> {
  const pending = nativeKeyOperations.catch(() => undefined).then(operation);
  nativeKeyOperations = pending.catch(() => undefined);
  return pending;
}


const VOLUME_KEYS = new Set(["volumeup", "volumedown", "volumemute"]);
/** 返回键：KEYCODE_BACK = 4，Linux scanCode 158 */
const BACK_KEYS = new Set(["back", "escape", "esc", "browser_back"]);
const BACK_KEY_CODES = new Set([4]);
const BACK_SCAN_CODES = new Set([158]);

/** 同一物理键的重复 down 只认一次（宿主不推 up 时靠这个兜底，也顺手吃掉按键抖动） */
const REPEAT_GUARD_MS = 400;

/** 重连节流：一次容器往返里「变隐藏 → 变可见」可能连着触发，别每次变化都重建一遍 */
const SYNC_GUARD_MS = 500;

/** 重连失败后的补偿重试间隔（容器刚关闭时原生可能还没准备好接受注册） */
const SYNC_RETRY_MS = 600;

/**
 * 注册连续超时多少次才判定「宿主不支持」。
 *
 * `registerRemoteKeyListener` 走 bridge 调用，容器切换（openH5Container 关容器回来、
 * 场景窗口关闭）那一拍原生侧可能还没准备好，表现为 3s 超时。一次超时就把 supported
 * 置 false，会让整页遥控器永久失效（start / sync 都被挡住），只能重载页面恢复 ——
 * 所以超时按次数容错，连续失败到阈值才真正降级。
 */
const REGISTER_FAIL_TOLERANCE = 3;

/**
 * 遥控器音量键 → 语音输入 的总开关（配置项：环境变量 `VITE_REMOTE_VOICE_KEY`）。
 *
 * 原生注册是「把整套遥控按键都拦截」（见 mpaas.registerRemoteKeyListener 的说明），
 * 没法定向只截音量键：所以配成关闭时**整页不注册监听** ——
 * 音量键回归系统调音量、返回键交回容器，页面本身仍可用触屏操作。
 *
 * 默认开启；配 N / no / false / 0 / off 关闭。值是构建期静态替换，改完要重新打包。
 */
const REMOTE_VOICE_KEY_ENABLED = !["n", "no", "false", "0", "off"].includes(
  String(import.meta.env.VITE_REMOTE_VOICE_KEY ?? "Y").trim().toLowerCase(),
);

export interface UseRemoteKeyOptions {
  /** 是否处于需要接管遥控器的页面态；离开页面务必置 false，否则按键被原生一直拦截 */
  enabled: Ref<boolean>;
  /** 音量加 / 音量减 / 静音按下 */
  onConfirm?: () => void;
  /** 返回键按下：注册后原生不再处理返回键，这里必须给退路 */
  onBack?: () => void;
}

export function useRemoteKey(options: UseRemoteKeyOptions) {
  /** 是否已成功注册（原生侧确实在拦截按键了） */
  const registered = ref(false);
  /** 宿主是否支持这套 JSAPI；一旦确认不支持就不再重试 */
  const supported = ref(true);
  let unsubscribe: (() => void) | null = null;
  let starting = false;
  let pendingConnection: Promise<boolean> | null = null;
  let pendingStop: Promise<void> | null = null;
  let disposed = false;
  /** 连续注册失败次数（成功一次即清零），用来区分「临时超时」和「宿主不支持」 */
  let registerFailures = 0;
  /** 正在重连（sync）：避免和 start / stop 并发注册 */
  let syncing = false;
  /** 最近一次重连时刻，配合 SYNC_GUARD_MS 节流 */
  let lastSyncAt = 0;
  /** 重连失败后的补偿重试句柄 */
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 生命周期代号：stop() / 重连各自自增一次，用来作废「注册还在途中」的那次 connect。
   * 没有它就会留下「原生已经在拦截按键、本页却没有订阅者」的死局（返回键直接失灵）。
   */
  let lifecycle = 0;
  /** 每个物理键最近一次触发时刻，用来吃掉重复 down */
  const lastTriggerAt = new Map<string, number>();

  function keyIdOf(payload: RemoteKeyEventPayload) {
    return payload.key || `${payload.keyCode}:${payload.scanCode}`;
  }

  function matches(
    keys: Set<string>,
    keyCodes: Set<number>,
    scanCodes: Set<number>,
    payload: RemoteKeyEventPayload,
  ) {
    return keys.has(payload.key)
      || keyCodes.has(payload.keyCode)
      || scanCodes.has(payload.scanCode);
  }

  function handleKey(payload: RemoteKeyEventPayload) {
    // 原生可能继续调用旧的注册 callback；停用后必须在派发入口直接丢弃。
    if (disposed || !options.enabled.value) return;
    // 只认按下：抬起不触发动作，长按产生的重复事件（repeatCount > 0）也不触发
    if (payload.action !== "down" || payload.repeatCount > 0) return;

    const keyId = keyIdOf(payload);
    const now = Date.now();
    if (now - (lastTriggerAt.get(keyId) ?? 0) < REPEAT_GUARD_MS) return;
    lastTriggerAt.set(keyId, now);

    if (VOLUME_KEYS.has(payload.key)) {
      logger.info("遥控器音量键", payload);
      options.onConfirm?.();
      return;
    }
    if (matches(BACK_KEYS, BACK_KEY_CODES, BACK_SCAN_CODES, payload)) {
      logger.info("遥控器返回键", payload);
      options.onBack?.();
      return;
    }
    logger.debug("遥控器按键未绑定", payload);
  }

  function clearRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  /**
   * 建立监听：先订阅再注册（宿主可能在注册回调里就推第一帧按键事件）。
   *
   * `forceResubscribe`：容器切换后旧订阅已经失效 —— `AlipayJSBridge.on` 那条绑在切换前的
   * bridge 对象上（返回宿主时对象可能被替换或底层代理已断），DOM 通道也可能被容器重建。
   * 只重新调 `registerRemoteKeyListener` 会让原生返回 `listening: true`，但事件回不到本页，
   * 表现就是「注册成功、音量键没反应」。所以重连时必须把订阅一起重建。
   *
   * 注册是异步的，期间 `enabled` 可能已经翻成 false（用户点开甘特容器 / 场景窗口）：
   * 那样必须把刚挂上的监听还回去，否则原生一直拦截按键、本页却已退订，
   * 返回键没反应、用户被困；而且下次 start() 会被 registered 挡住，再也补不回来。
   */
  function connect(token: number, forceResubscribe = false) {
    const pending = connectImpl(token, forceResubscribe);
    pendingConnection = pending;
    const clear = () => { if (pendingConnection === pending) pendingConnection = null; };
    void pending.then(clear, clear);
    return pending;
  }

  async function connectImpl(token: number, forceResubscribe = false) {
    const startedAt = Date.now();
    if (forceResubscribe && unsubscribe) {
      // 旧订阅可能绑在已经失效的 bridge 上，解绑本身也可能抛错：不能让它挡住后面的重订阅
      try {
        unsubscribe();
      }
      catch (error) {
        logger.warn("遥控器旧订阅解绑失败，继续重建", error);
      }
      unsubscribe = null;
    }
    if (!unsubscribe) unsubscribe = onRemoteKeyEvent(handleKey);
    // 除了 bridge.on / DOM 两条通道，注册接口的回调也接上：部分自研桥没有 on，
    // 按键是复用这个 callback 反复推回来的（见 mpaas.registerRemoteKeyListener 的说明）
    return runNativeKeyOperation(async () => {
      await registerRemoteKeyListener(handleKey);
      if (token !== lifecycle || !options.enabled.value) {
        // 注册是异步的，期间页面可能已经离开（或被容器盖住）：把刚挂上的监听还回去，
        // 否则原生一直拦截按键、本页却已退订，返回键与音量键都会失灵
        logger.info("遥控器注册结果作废：生命周期已变或页面已失活", {
          costMs: Date.now() - startedAt,
          enabled: options.enabled.value,
        });
        await unregisterRemoteKeyListener().catch(() => undefined);
        registered.value = false;
        return false;
      }
      registered.value = true;
      // 注册成功说明原生侧可用，之前的超时计数作废
      registerFailures = 0;
      logger.info("遥控器按键监听已就绪", {
        costMs: Date.now() - startedAt,
        reconnected: lastSyncAt > 0,
        resubscribed: forceResubscribe,
      });
      return true;
    });
  }

  async function start() {
    if (pendingStop) await pendingStop;
    if (disposed || !options.enabled.value) return;
    if (registered.value || starting || syncing || !supported.value) return;
    if (!REMOTE_VOICE_KEY_ENABLED) {
      // 配置里关掉了「音量键触发语音输入」：不注册，按键全部交回系统（音量键照常调音量）
      supported.value = false;
      logger.info("遥控器按键监听已在配置中关闭（VITE_REMOTE_VOICE_KEY），按键交回系统");
      return;
    }
    starting = true;
    const token = ++lifecycle;
    try {
      await connect(token);
    }
    catch (error) {
      /**
       * 注册失败分两种，处理方式不同：
       * - bridge 超时：容器刚切换（openH5Container 关容器回来 / 场景窗口关闭）时原生侧
       *   还没准备好接受注册，属于临时状态。保留 supported 等下一次可见性变化重试，
       *   否则一次超时就会把整页遥控器永久废掉，只能重载页面恢复；
       * - 明确报错（宿主返回了错误码）：实现了 JSAPI 却调不通，直接降级，别反复重试刷日志。
       */
      if (token !== lifecycle || !options.enabled.value) return;
      registerFailures += 1;
      const timeout = error instanceof Error && error.message.includes("超时");
      if (timeout && registerFailures < REGISTER_FAIL_TOLERANCE) {
        logger.warn("遥控器按键监听注册超时，等下一次可见性变化重试", {
          failures: registerFailures,
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      supported.value = false;
      unsubscribe?.();
      unsubscribe = null;
      logger.warn("遥控器按键监听不可用，已降级为纯触屏", error);
    }
    finally {
      starting = false;
    }
  }

  function stop(quiet = false): Promise<void> {
    if (pendingStop) return pendingStop;
    const pending = stopImpl(quiet);
    pendingStop = pending;
    const finish = () => {
      if (pendingStop === pending) pendingStop = null;
      // 快速返回时 enabled 已恢复，但 watcher 可能曾被旧注销挡住，完成后补注册。
      if (!disposed && options.enabled.value) void start();
    };
    void pending.then(finish, finish);
    return pending;
  }

  async function stopImpl(quiet = false) {
    // 作废在途注册（见 connect 里的 token 判断），否则会留下「原生在拦截、本页无订阅」的死局
    lifecycle += 1;
    clearRetry();
    lastTriggerAt.clear();
    const pending = pendingConnection;
    unsubscribe?.();
    unsubscribe = null;
    if (!registered.value) {
      // 等待旧注册完成后的作废/注销，避免它迟到后注销了子页的新监听。
      await pending?.catch(() => false);
      return;
    }
    registered.value = false;
    logger.info("遥控器按键监听注销", { quiet });
    try {
      await runNativeKeyOperation(() => unregisterRemoteKeyListener());
    }
    catch (error) {
      if (!quiet) logger.warn("遥控器按键监听注销失败", error);
    }
    await pending?.catch(() => false);
  }

  /**
   * 重连遥控器监听（幂等，可反复调）。
   *
   * 宿主用新容器盖住本页时（`openH5Container` 打开甘特离线包、pushWindow 开场景窗口），
   * 本页 webview 只是被隐藏：uni 的 onHide / onShow 不一定触发，`enabled` 不会翻，
   * `registered` 一直停在 true；但原生侧的监听在容器切换后已经失效（按键不再派发到本页）。
   * 光重置本地标记没用，必须把「订阅 + 注册」重建一次，否则回首页后遥控器整体失灵。
   *
   * 这里不先注销：容器回来时原生侧通常已经没有监听，多余的 unregister 只会多一次
   * 3s 超时风险，直接覆盖注册即可。失败隔一拍补一次，订阅与 registered 原值都留着，
   * 等下一次可见性变化 / resume（用户再切一次页面）继续重试，不会永久废掉。
   *
   * 但**订阅必须重建**（forceResubscribe）：真机上出现过「重连后原生返回
   * `{ listening: true }`、日志也打了重连成功，按音量键却毫无反应」——
   * 原因是 `onNativeEvent` 的 `AlipayJSBridge.on` 那条还挂在容器切换前的那份 bridge 上。
   * 对比首页正常：它走的是 onHide → stop()（解绑）→ onShow → start()（全新订阅）。
   */
  async function sync(source = "unknown") {
    if (pendingStop) await pendingStop;
    if (disposed || !options.enabled.value || !supported.value || syncing || starting) {
      // 重连被挡住的四种原因分开打：容器回来时 enabled 没翻、宿主不支持、
      // 上一次重连还没结束、首次注册还在途中 —— 真机排查直接看这一行
      logger.debug("遥控器重连跳过", {
        source,
        enabled: options.enabled.value,
        supported: supported.value,
        syncing,
        starting,
        registered: registered.value,
      });
      return;
    }
    const now = Date.now();
    if (now - lastSyncAt < SYNC_GUARD_MS) {
      logger.debug("遥控器重连节流中", { source, gapMs: now - lastSyncAt, guardMs: SYNC_GUARD_MS });
      return;
    }
    lastSyncAt = now;
    syncing = true;
    clearRetry();
    const wasRegistered = registered.value;
    const token = ++lifecycle;
    const startedAt = Date.now();
    logger.info("遥控器重连开始", {
      source,
      registered: wasRegistered,
      supported: supported.value,
      // 重连会把「订阅 + 注册」都重建：只重注册的话原生返回 listening: true，
      // 但事件还挂在失效的旧订阅上，表现就是「注册成功、音量键没反应」
      resubscribe: true,
    });
    try {
      const reconnected = await connect(token, true);
      if (reconnected) {
        logger.info("遥控器按键监听已重连", { source, costMs: Date.now() - startedAt });
      }
      else {
        // 注册完成但结果被作废：说明这期间页面又失活（或被容器盖住）
        logger.warn("遥控器重连未生效：注册期间页面已失活", { source, costMs: Date.now() - startedAt });
      }
    }
    catch (error) {
      // 重连失败：订阅留着（宿主不推事件时就是空转），registered 维持原值 ——
      // 别因为一次重试失败就把它标成 false，否则卸载时 stop() 会跳过注销，
      // 原生那边可能还在拦截按键。改成隔一拍再补一次。
      if (token !== lifecycle || !options.enabled.value) return;
      registered.value = wasRegistered;
      logger.warn("遥控器按键监听重连失败，稍后重试", {
        source,
        costMs: Date.now() - startedAt,
        registered: wasRegistered,
        message: error instanceof Error ? error.message : String(error),
      }, error);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        lastSyncAt = 0;
        void sync("retry");
      }, SYNC_RETRY_MS);
    }
    finally {
      syncing = false;
    }
  }

  /**
   * 降级标记的复位节流：回到前台本身是低频事件，但 visibilitychange / window.focus /
   * pageshow / resume / onShow 常一起到达，别让几个信号各触发一次「注册 → 超时」。
   */
  const REVIVE_GUARD_MS = 10_000;
  let lastReviveAt = 0;

  /**
   * 回到前台时给一次重新注册的机会。
   *
   * 之前因为容器切换（openH5Container 关容器回来）导致注册超时、或宿主返回错误码而降级的，
   * 这里把 supported 与失败计数一起复位 —— 否则「音量键触发语音输入」会一直失效到用户重载页面。
   * 真不支持时下一次仍会失败并再次降级，10s 内不重复尝试。
   */
  function revive(source: string) {
    if (supported.value) return;
    const now = Date.now();
    if (now - lastReviveAt < REVIVE_GUARD_MS) return;
    lastReviveAt = now;
    supported.value = true;
    registerFailures = 0;
    logger.info("遥控器按键监听：回到前台，重新尝试注册", { source, guardMs: REVIVE_GUARD_MS });
  }

  /**
   * 「回到本页」的统一出口：可见 / 窗口聚焦 / 往返缓存恢复 / 原生 resume / onShow 都走这里。
   *
   * 原来的实现要求「先收到 hidden 才认 visible」（hostHidden 门槛）。但安卓上用
   * openH5Container 打开甘特离线包时，宿主 webview 是被另一个 Activity 盖住的：
   * 往往不产生 hidden（或压根不派发 visibilitychange），回来后那次 visible 被门槛挡掉，
   * 音量键（语音输入）从此失灵。现在只要当前不是 hidden 就重建一次监听，
   * 重复触发由 SYNC_GUARD_MS 节流，不会重复注册。
   */
  function onHostReturn(source: string, extra: Record<string, unknown> = {}) {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      logger.info("页面不可见，跳过遥控器重连", { source, registered: registered.value, ...extra });
      return;
    }
    logger.info("回到前台，尝试重连遥控器监听", {
      source,
      registered: registered.value,
      supported: supported.value,
      enabled: options.enabled.value,
      ...extra,
    });
    revive(source);
    void sync(source);
  }

  function onHostVisible() {
    if (typeof document === "undefined") return;
    onHostReturn("visibilitychange", { visibilityState: document.visibilityState });
  }

  /** 窗口重新聚焦：安卓 WebView 从别的 Activity 回来时，除 visible 之外最可靠的信号 */
  function onWindowFocus() {
    onHostReturn("window-focus");
  }

  /** 往返缓存恢复（部分容器把本页放进 bfcache 再拿出来） */
  function onPageShow() {
    onHostReturn("pageshow");
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onHostVisible);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("pageshow", onPageShow);
  }
  // 原生 resume 是同义信号（场景窗口 / pushWindow 关闭），多个通道都接，重复触发有节流
  const offResume = onNativeEvent("resume", () => {
    onHostReturn("resume");
  });

  watch(
    options.enabled,
    (enabled) => {
      if (enabled) {
        // 页面重新接管遥控器：之前被降级的（容器切换导致的临时失败）在这里复位
        logger.info("遥控器接管开启", { registered: registered.value, supported: supported.value });
        revive("enabled-change");
        void start();
      }
      else {
        logger.info("遥控器接管关闭", { registered: registered.value });
        void stop();
      }
    },
    { immediate: true },
  );

  /**
   * 页面 show 再补一道：容器回来时宿主有时会走 onShow，但本页 `enabled` 一直是 true
   * （进入容器时 onHide 没触发，值没翻过），`watch` 不会 fire，只能靠 sync 把失效的监听拉起来。
   * 正常压栈返回时 enabled 刚翻成 true、start 已在途中，sync 会被 starting / syncing 挡住，
   * 不会重复注册。
   */
  onShow(() => {
    onHostReturn("uni-onshow");
  });

  // 组件卸载（页面被销毁 / 路由离开）时兜底注销，避免原生侧继续拦截按键
  onBeforeUnmount(() => {
    disposed = true;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onHostVisible);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("pageshow", onPageShow);
    }
    offResume();
    void stop(true);
  });

  return { registered, supported, start, stop, sync };
}

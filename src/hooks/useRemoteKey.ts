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
 *    onHide / onShow 不一定触发，而原生侧监听已经失效 —— 靠可见性恢复 / 原生 resume
 *    把监听重建一遍（见 sync）。
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
   * 注册是异步的，期间 `enabled` 可能已经翻成 false（用户点开甘特容器 / 场景窗口）：
   * 那样必须把刚挂上的监听还回去，否则原生一直拦截按键、本页却已退订，
   * 返回键没反应、用户被困；而且下次 start() 会被 registered 挡住，再也补不回来。
   */
  async function connect(token: number) {
    if (!unsubscribe) unsubscribe = onRemoteKeyEvent(handleKey);
    await registerRemoteKeyListener();
    if (token !== lifecycle || !options.enabled.value) {
      await unregisterRemoteKeyListener().catch(() => undefined);
      registered.value = false;
      return false;
    }
    registered.value = true;
    return true;
  }

  async function start() {
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
      // 宿主没实现 / 没注入 bridge：退订并永久降级，别每次进页面都重试刷日志
      supported.value = false;
      unsubscribe?.();
      unsubscribe = null;
      logger.warn("遥控器按键监听不可用，已降级为纯触屏", error);
    }
    finally {
      starting = false;
    }
  }

  async function stop(quiet = false) {
    // 作废在途注册（见 connect 里的 token 判断），否则会留下「原生在拦截、本页无订阅」的死局
    lifecycle += 1;
    clearRetry();
    lastTriggerAt.clear();
    if (!registered.value) {
      unsubscribe?.();
      unsubscribe = null;
      return;
    }
    registered.value = false;
    try {
      await unregisterRemoteKeyListener();
    }
    catch (error) {
      if (!quiet) logger.warn("遥控器按键监听注销失败", error);
    }
    unsubscribe?.();
    unsubscribe = null;
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
   */
  async function sync() {
    if (!options.enabled.value || !supported.value || syncing || starting) return;
    const now = Date.now();
    if (now - lastSyncAt < SYNC_GUARD_MS) return;
    lastSyncAt = now;
    syncing = true;
    clearRetry();
    const wasRegistered = registered.value;
    const token = ++lifecycle;
    try {
      const reconnected = await connect(token);
      if (reconnected) logger.info("遥控器按键监听已重连");
    }
    catch (error) {
      // 重连失败：订阅留着（宿主不推事件时就是空转），registered 维持原值 ——
      // 别因为一次重试失败就把它标成 false，否则卸载时 stop() 会跳过注销，
      // 原生那边可能还在拦截按键。改成隔一拍再补一次。
      registered.value = wasRegistered;
      logger.warn("遥控器按键监听重连失败，稍后重试", error);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        lastSyncAt = 0;
        void sync();
      }, SYNC_RETRY_MS);
    }
    finally {
      syncing = false;
    }
  }

  /** 本页是否被容器盖住过（hidden 过一次才算「回来」，避免首次加载就白重连一遍） */
  let hostHidden = false;

  /**
   * 页面重新可见 = 上层容器已经关掉 / 本页重新回到前台，是「回来」这件事最稳的信号
   * （宿主新开 webview 时不保证走 onShow，也不保证推原生 resume）。
   */
  function onHostVisible() {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") {
      hostHidden = true;
      return;
    }
    if (!hostHidden) return;
    hostHidden = false;
    void sync();
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onHostVisible);
  }
  // 原生 resume 是同义信号（场景窗口 / pushWindow 关闭），两个通道都接，重复触发有节流
  const offResume = onNativeEvent("resume", () => {
    void sync();
  });

  watch(
    options.enabled,
    (enabled) => {
      if (enabled) void start();
      else void stop();
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
    void sync();
  });

  // 组件卸载（页面被销毁 / 路由离开）时兜底注销，避免原生侧继续拦截按键
  onBeforeUnmount(() => {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onHostVisible);
    }
    offResume();
    void stop(true);
  });

  return { registered, supported, start, stop, sync };
}

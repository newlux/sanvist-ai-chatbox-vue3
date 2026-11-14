/**
 * 遥控器按键（Android TV / 蓝牙遥控器）→ 页面动作。
 *
 * 原生给的是三件套：`registerRemoteKeyListener` / `unregisterRemoteKeyListener` /
 * `getRemoteKeyListenerState`，按键事件走 `remoteKeyEvent`（统一封装见
 * `utils/platform/mpaas` 的 registerRemoteKeyListener / onRemoteKeyEvent）。
 *
 * 这里只做三件事：
 * 1. 生命周期：`enabled` 为 true 时注册并订阅，变 false / 组件卸载时注销并退订
 *    —— 注册成功后原生侧会拦截遥控器按键（含返回键），不注销用户就退不出去；
 * 2. 事件规整：长按的 `repeatCount > 0` 丢掉；宿主漏推 `up` 时用时间窗兜住重复 `down`；
 * 3. 按键分发：确认键（OK / 方向中键）→ onConfirm，返回键 → onBack，其余键忽略。
 *
 * 宿主没实现这套 JSAPI（浏览器 / 旧容器）时静默降级：只打一条 warn，触屏交互照旧。
 */

import type { Ref } from "vue";
import type { RemoteKeyEventPayload } from "@/utils/platform/mpaas";
import { onBeforeUnmount, ref, watch } from "vue";
import { createLogger } from "@/utils/logger";
import { onRemoteKeyEvent, registerRemoteKeyListener, unregisterRemoteKeyListener } from "@/utils/platform/mpaas";

const logger = createLogger("remote-key");

/**
 * 确认键：宿主给的 key 名、Android keyCode、scanCode 三套都认
 * （DPAD_CENTER = 23、ENTER = 66、NUM_ENTER = 160；scanCode 23 / 28 对应同一组物理键）。
 */
const CONFIRM_KEYS = new Set(["ok", "enter", "center", "select", "dpad_center"]);
const CONFIRM_KEY_CODES = new Set([23, 66, 160]);
const CONFIRM_SCAN_CODES = new Set([23, 28]);
/** 返回键：KEYCODE_BACK = 4，Linux scanCode 158 */
const BACK_KEYS = new Set(["back", "escape", "esc", "browser_back"]);
const BACK_KEY_CODES = new Set([4]);
const BACK_SCAN_CODES = new Set([158]);

/** 同一物理键的重复 down 只认一次（宿主不推 up 时靠这个兜底，也顺手吃掉按键抖动） */
const REPEAT_GUARD_MS = 400;

export interface UseRemoteKeyOptions {
  /** 是否处于需要接管遥控器的页面态；离开页面务必置 false，否则按键被原生一直拦截 */
  enabled: Ref<boolean>;
  /** 确认键（OK / 方向中键）按下 */
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

    if (matches(CONFIRM_KEYS, CONFIRM_KEY_CODES, CONFIRM_SCAN_CODES, payload)) {
      logger.info("遥控器确认键", payload);
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

  async function start() {
    if (registered.value || starting || !supported.value) return;
    starting = true;
    // 先订阅再注册：宿主可能在注册回调里就推第一帧按键事件
    if (!unsubscribe) unsubscribe = onRemoteKeyEvent(handleKey);
    try {
      await registerRemoteKeyListener();
      registered.value = true;
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

  async function stop() {
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
      logger.warn("遥控器按键监听注销失败", error);
    }
    unsubscribe?.();
    unsubscribe = null;
  }

  watch(
    options.enabled,
    (enabled) => {
      if (enabled) void start();
      else void stop();
    },
    { immediate: true },
  );

  // 组件卸载（页面被销毁 / 路由离开）时兜底注销，避免原生侧继续拦截按键
  onBeforeUnmount(() => {
    void stop();
  });

  return { registered, supported, start, stop };
}

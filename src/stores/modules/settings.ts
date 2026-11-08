import type { AppSettings, SettingsDialogueMode, SettingsLanguage, UpdateSettingsParams } from "@/api/settings/types";
import { defineStore } from "pinia";
import { ref } from "vue";
import { getSettings, updateSettings } from "@/api/settings";
import { createLogger } from "@/utils/logger";
import { useSystemStore } from "@/stores/modules/system";

const logger = createLogger("settings-store");

/** 界面语言（zh_CN / en_US）→ 接口语言（zh / en） */
export function toApiLanguage(value: "zh_CN" | "en_US"): SettingsLanguage {
  return value === "en_US" ? "en" : "zh";
}

/** 接口语言（zh / en）→ 界面语言（zh_CN / en_US） */
export function toAppLanguage(value: SettingsLanguage): "zh_CN" | "en_US" {
  return value === "en" ? "en_US" : "zh_CN";
}

/**
 * 系统设置（接口文档 4.5 `/settings`）。
 *
 * 字段归属（拿到返回后各存各家，不重复持久化）：
 * - `language`  → `systemStore.setLanguage`（i18n 全局 locale + header 的 Lang / X-Site-Language）
 * - `appearance`→ `systemStore.setAppearance`（system / light / dark，决定深色主题）
 * - `memoryEnabled` / `pureMode` / `dialogueMode` / `voiceCode` / `speechRate` → 本仓库（运行期状态）
 *
 * 调用时机：
 * - 进应用时 `App.vue` 的 onLaunch 调一次 `load()`，把服务端设置同步到全局；
 * - 设置弹层每次打开再 `load()` 一次，保证回显的是服务端最新值；
 * - 每次操作走 `save(patch)` 部分更新，响应全量回显；失败回滚到上次确认值。
 */
export const useSettingsStore = defineStore("settings", () => {
  const systemStore = useSystemStore();

  /** 是否已成功拿到过服务端设置 */
  const loaded = ref(false);
  /** 长期记忆开关 */
  const memoryEnabled = ref(true);
  /** 纯净模式：接口默认 false（false 即关闭） */
  const pureMode = ref(false);
  /** 对话模式：realtime 实时语音 / push 语音输入 */
  const dialogueMode = ref<SettingsDialogueMode>("push");
  /** 全局音色（听播 / 对话播报共用，TTS 侧只认这个值） */
  const voiceCode = ref("");
  /** 语速倍率：默认 1.2（与听播默认倍速一致），服务端有效区间 [0.5, 2.0] */
  const speechRate = ref(1.2);
  /** 最近一次服务端确认过的全量值，写失败时用它回滚 */
  const confirmed = ref<AppSettings | null>(null);

  /** 把服务端全量值分发到各自的归属地 */
  function apply(data: AppSettings | null | undefined) {
    if (!data) return;
    confirmed.value = data;

    if (data.language) void systemStore.setLanguage(toAppLanguage(data.language));
    if (data.appearance) systemStore.setAppearance(data.appearance);

    memoryEnabled.value = Boolean(data.memoryEnabled);
    pureMode.value = Boolean(data.pureMode);
    dialogueMode.value = data.dialogueMode === "realtime" ? "realtime" : "push";
    if (typeof data.voiceCode === "string") voiceCode.value = data.voiceCode;
    if (typeof data.speechRate === "number") speechRate.value = data.speechRate;
  }

  /** 拉取全量设置；失败只记日志，沿用当前值，不打断启动 / 交互 */
  async function load(): Promise<AppSettings | null> {
    try {
      const data = await getSettings();
      apply(data);
      loaded.value = true;
      return data;
    }
    catch (error) {
      logger.warn("get settings failed", error);
      return null;
    }
  }

  /**
   * 部分更新：只传本次改动的字段。
   * 成功以响应全量回显（服务端可能收敛取值）；失败回滚到上次确认值并返回 false。
   *
   * 注意：`/settings` 的响应目前只回 language / appearance / memoryEnabled 等字段，
   * `voiceCode` / `speechRate` 不回。这种字段缺失时按本次提交值补齐，
   * 否则声音设置页的选中框会因为 store 仍是旧值而跳回第一项。
   */
  async function save(patch: UpdateSettingsParams): Promise<boolean> {
    try {
      const data = await updateSettings(patch);
      apply(data);
      if (patch.voiceCode && !data?.voiceCode) voiceCode.value = patch.voiceCode;
      if (typeof patch.speechRate === "number" && typeof data?.speechRate !== "number") {
        speechRate.value = patch.speechRate;
      }
      loaded.value = true;
      return true;
    }
    catch (error) {
      logger.warn("update settings failed", { patch, error });
      apply(confirmed.value);
      return false;
    }
  }

  /** 记忆开关：先改本地（乐观更新），再落服务端 */
  function setMemory(value: boolean) {
    memoryEnabled.value = value;
    return save({ memoryEnabled: value });
  }

  /** 纯净模式开关 */
  function setPureMode(value: boolean) {
    pureMode.value = value;
    return save({ pureMode: value });
  }

  /** 对话模式（realtime / push） */
  function setDialogueMode(value: SettingsDialogueMode) {
    dialogueMode.value = value;
    return save({ dialogueMode: value });
  }

  /** 外观：先让 system store 立即生效，再落服务端 */
  function setAppearance(value: AppSettings["appearance"]) {
    systemStore.setAppearance(value);
    return save({ appearance: value });
  }

  /** 界面语言：先切 i18n，再落服务端（接口只认 zh / en） */
  function setLanguage(value: "zh_CN" | "en_US") {
    void systemStore.setLanguage(value);
    return save({ language: toApiLanguage(value) });
  }

  return {
    loaded,
    memoryEnabled,
    pureMode,
    dialogueMode,
    voiceCode,
    speechRate,
    confirmed,
    load,
    save,
    setMemory,
    setPureMode,
    setDialogueMode,
    setAppearance,
    setLanguage,
  };
});

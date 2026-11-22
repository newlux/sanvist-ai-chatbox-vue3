import type { ReportVoiceOption } from "@/config/report-voices";
import { REPORT_VOICE_OPTIONS, REPORT_VOICE_STORAGE_KEY } from "@/config/report-voices";
import { createLogger } from "@/utils/logger";

const logger = createLogger("report-voice");

/**
 * 报告听播音色的交互统一入口：保存所选音色、读取历史音色。
 *
 * 持久化只写可序列化字段（SavedReportVoice），hero/avatar/preview 属构建期资源、
 * 哈希会变，读取时按 id 从 REPORT_VOICE_OPTIONS 重新解析，避免存了失效的打包 URL。
 */

/** 保存所选音色到 localStorage。 */
export function saveReportVoice(voice: ReportVoiceOption) {
  const saved = {
    id: voice.id,
    voiceName: voice.voiceName,
    nameKey: voice.nameKey,
    descriptionKey: voice.descriptionKey,
    tagKey: voice.tagKey,
    gender: voice.gender,
  };
  try {
    uni.setStorageSync(REPORT_VOICE_STORAGE_KEY, saved);
  } catch (error) {
    logger.error("保存报告音色失败", error);
  }
}

/**
 * 本机记住的音色值：可能是本地配置里的 id（xieshurou_v3.1）、后台音色码（Cherry…），
 * 也可能是 `<VOICE_STYLE style="…">` 下发的性格码（gentle_healing）—— 标签给什么就存什么。
 */
function readSavedVoiceValue(): string {
  let raw = null;
  try {
    raw = uni.getStorageSync(REPORT_VOICE_STORAGE_KEY);
  } catch (error) {
    logger.error("读取报告音色失败", error);
    return "";
  }
  return String((typeof raw === "string" ? raw : raw?.id) || "").trim();
}

/**
 * 读取已保存的音色，按 id 还原完整选项（含 hero/avatar/preview）；无保存或不是本地选项返回 null。
 *
 * 本机存的可能是标签下发的 style 原值（性格码 / 后台音色码），不一定等于本地选项的 id：
 * 精确匹配不到时再用性格标签兜一次，避免听播页把「存了别的口径的音色」误判成没选过。
 */
export function loadReportVoice(): ReportVoiceOption | null {
  const id = readSavedVoiceValue();
  if (!id) return null;
  return REPORT_VOICE_OPTIONS.find(voice => voice.id === id) ?? matchVoiceOption(id);
}

/**
 * 当前生效的音色值：每次调用现读本机存储（与 `PUT /settings.voiceCode` 是同一个串）。
 *
 * 音色随时可能被 `…<VOICE_STYLE style="…">` 标签改写，所以 TTS 请求不要在进页 / 建会话时
 * 把音色固定下来，发请求那一刻现取，下一句播报就能用上新音色。没选过时返回空串（按后端默认音色）。
 */
export function resolveReportVoiceId(): string {
  return readSavedVoiceValue();
}

/** 音色值 → 本地音色选项：先按 id 精确匹配，再按性格标签（tagKey 后缀、下划线归一成连字符）匹配 */
function matchVoiceOption(value: string): ReportVoiceOption | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/_/g, "-");
  return REPORT_VOICE_OPTIONS.find(voice => voice.id.toLowerCase() === raw.toLowerCase())
    ?? REPORT_VOICE_OPTIONS.find(voice => voice.tagKey.toLowerCase().endsWith(`-${normalized}`))
    ?? null;
}

/**
 * 「<VOICE_STYLE style="…">」标签下发的音色值落库，返回写入本机 / 上送服务端的音色值
 * （空串 = 值不可用、没写）。
 *
 * 存储口径：**标签给什么就存什么** —— 本机记忆的 id 与 `PUT /settings.voiceCode` 用同一个值，
 * 这样 TTS 现取的音色、服务端记录的音色、下一次 `load()` 回显的音色才是同一份。
 * 不再把性格码 / 后台音色码映射成本地选项 id（映射后服务端与本地就对不上了）。
 *
 * 命中本地音色时顺手把展示字段（人设名 / 描述 / 性别）一起存，听播页的选中卡片不用再猜；
 * 匹配不到也只是少几个展示字段，不影响取值。
 */
export function saveReportVoiceByStyle(styleValue: string): string {
  const raw = String(styleValue || "").trim();
  if (!raw) return "";
  /**
   * 非常规音色码（中文名 / 带空格）只提示、不丢弃：标签给什么就存什么，
   * `PUT /settings.voiceCode` 也传什么 —— 否则「标签出现了但音色没切、接口也没调」。
   * 端上不替后端收敛取值，认不出的音色由后端决定如何处理。
   */
  if (!/^[\w.-]+$/.test(raw)) {
    logger.warn("音色标签值不是常规音色码，仍按原值落库", { styleValue: raw });
  }
  const option = matchVoiceOption(raw);
  const saved = option
    ? {
        id: raw,
        voiceName: option.voiceName,
        nameKey: option.nameKey,
        descriptionKey: option.descriptionKey,
        tagKey: option.tagKey,
        gender: option.gender,
      }
    : { id: raw };
  try {
    uni.setStorageSync(REPORT_VOICE_STORAGE_KEY, saved);
  } catch (error) {
    logger.error("保存报告音色失败", error);
    return "";
  }
  logger.info("音色标签值已写入本机记忆", { styleValue: raw, matchedLocal: Boolean(option) });
  return raw;
}

/**
 * 音色落服务端的在途请求。
 *
 * TTS 合成只认服务端 `/settings.voiceCode`（请求里的 voice 只是兜底），而语音切音色是
 * 「标签一到就落库 + 立刻把标签里那句确认文案送去合成」：保存没落地就发请求，
 * 服务端仍按旧音色合成 —— 听感上就是「提示切换成功，但这条播报还是原音色」，
 * 下一次提问（那时保存早已完成）才换成新音色。这里留一个把手，让 TTS 请求等它落地。
 */
let pendingVoiceSync: Promise<unknown> | null = null;
/** 等待上限：保存异常慢时不能把播报卡死，超时就按当前状态发出去 */
const VOICE_SYNC_TIMEOUT_MS = 1500;

/** 记下这次音色落库的请求（由 applyVoiceStyle 在切换音色时调用） */
export function markReportVoiceSyncing(promise: Promise<unknown>) {
  const tracked: Promise<unknown> = promise.then(() => undefined, () => undefined);
  pendingVoiceSync = tracked;
  void tracked.then(() => {
    if (pendingVoiceSync === tracked) pendingVoiceSync = null;
  });
}

/** TTS 发请求前等一次：有在途的音色保存就先等它落地（没有就立即返回） */
export async function waitReportVoiceSynced() {
  const pending = pendingVoiceSync;
  if (!pending) return;
  await Promise.race([
    pending,
    new Promise<void>(resolve => setTimeout(resolve, VOICE_SYNC_TIMEOUT_MS)),
  ]);
}

export function useReportVoice() {
  return {
    saveReportVoice,
    loadReportVoice,
    resolveReportVoiceId,
    saveReportVoiceByStyle,
    markReportVoiceSyncing,
    waitReportVoiceSynced,
  };
}

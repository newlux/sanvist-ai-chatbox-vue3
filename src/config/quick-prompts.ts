import type { VisitorRole } from "@/stores/modules/user";

/** 老板视角：关注车队整体状态、进度、能耗。存 i18n key，展示前由页面按当前语言翻译 */
export const OWNER_QUICK_PROMPTS = [
  "quick-prompt-owner-online-today",
  "quick-prompt-owner-offline-today",
  "quick-prompt-owner-working-today",
  "quick-prompt-owner-month-progress",
  "quick-prompt-owner-week-hours",
  "quick-prompt-owner-month-top-device",
  "quick-prompt-owner-low-activity",
  "quick-prompt-owner-idle-days",
  "quick-prompt-owner-site-status",
  "quick-prompt-owner-month-fuel-top",
  "quick-prompt-owner-month-fuel-energy",
  "quick-prompt-owner-unit-fuel-top",
  "quick-prompt-owner-energy-abnormal",
  "quick-prompt-owner-fuel-up-reason",
  "quick-prompt-owner-low-fuel",
  "quick-prompt-owner-month-total-work",
];

/** 操作手视角：关注自己这台设备的状态、位置、油耗。存 i18n key，展示前由页面按当前语言翻译 */
export const OPERATOR_QUICK_PROMPTS = [
  "quick-prompt-operator-status",
  "quick-prompt-operator-last-week-work",
  "quick-prompt-operator-location",
  "quick-prompt-operator-fuel-left",
  "quick-prompt-operator-device-last-week",
  "quick-prompt-operator-recent-7-days",
  "quick-prompt-operator-yesterday-fuel",
  "quick-prompt-operator-fuel-trend",
];

const QUICK_PROMPT_COUNT = 2;

function resolveQuickPromptPool(role: VisitorRole | null) {
  return role === "OPERATOR" ? OPERATOR_QUICK_PROMPTS : OWNER_QUICK_PROMPTS;
}

/** 按身份从问题池里随机抽两条；有足够候选项时避开上一轮，确保页面重新展示后内容会变化。 */
export function pickRoleQuickPrompts(role: VisitorRole | null, count = QUICK_PROMPT_COUNT, previousPrompts: string[] = []) {
  const source = resolveQuickPromptPool(role);
  const candidates = source.filter(prompt => !previousPrompts.includes(prompt));
  const pool = [...(candidates.length >= count ? candidates : source)];
  const picked: string[] = [];
  while (picked.length < count && pool.length) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

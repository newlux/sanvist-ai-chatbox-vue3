/** 系统设置（接口文档 4.5 `/settings`） */

/** 接口语言口径只有 zh / en，前端界面的 zh_CN / en_US 需在此转换 */
export type SettingsLanguage = "zh" | "en";

/** 外观偏好：system 跟随系统，light / dark 手动指定 */
export type SettingsAppearance = "system" | "light" | "dark";

/** 对话模式：realtime 实时语音（边说边出字）/ push 语音输入（录完再识别） */
export type SettingsDialogueMode = "realtime" | "push";

/** GET `/settings` 的全量返回，PUT 也回全量 */
export interface AppSettings {
  language: SettingsLanguage;
  appearance: SettingsAppearance;
  memoryEnabled: boolean;
  dialogueMode: SettingsDialogueMode;
  pureMode: boolean;
  voiceCode: string;
  speechRate: number;
}

/** PUT `/settings` 支持部分更新：只传本次改动的字段 */
export type UpdateSettingsParams = Partial<
  Pick<
    AppSettings,
    "language" | "appearance" | "memoryEnabled" | "dialogueMode" | "pureMode" | "voiceCode" | "speechRate"
  >
>;

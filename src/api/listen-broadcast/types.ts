export interface ListenBroadcastModule {
  code: string;
  name: string;
}

export interface ListenBroadcastStyle {
  code: string;
  name: string;
  defaultModules: string[];
}

export interface ListenBroadcastVoice {
  code: string;
  name: string;
  gender?: string;
  description?: string;
}

export interface ListenBroadcastConfig {
  roleCode: string;
  roleName: string;
  modules: ListenBroadcastModule[];
  styles: ListenBroadcastStyle[];
  voices?: ListenBroadcastVoice[];
}

export interface SaveListenBroadcastPreferenceParams {
  voiceCode?: string;
  styleCode?: string;
  checkedModules?: string[];
  reportTime?: string;
}

export interface ListenBroadcastPreference {
  voiceCode?: string;
  styleCode?: string;
  checkedModules?: string[];
  reportTime?: string;
  persisted: boolean;
}

export interface PlayListenBroadcastParams {
  styleCode?: string;
  checkedModules?: string[];
  scriptVersion?: "normal" | "brief";
  voice?: string;
  language?: string;
  bizDate?: string;
}

export interface ListenBroadcastAudioChunk {
  event?: "audio_chunk" | "done";
  seq?: number;
  text?: string;
  start?: number;
  format?: string | null;
  audioBase64?: string | null;
  dataUrl?: string | null;
}

export type ListenBroadcastPeriod = "daily" | "weekly" | "monthly";

export interface ListenBroadcastHistoryItem {
  bizDate: string;
  title: string;
  summary?: string;
  broadcastTime?: string;
  moduleCodes?: string[];
}

export interface TodayListenBroadcast extends ListenBroadcastHistoryItem {}

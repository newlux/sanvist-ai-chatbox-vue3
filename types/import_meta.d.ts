/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 是否给所有接口请求头加 `env: <VITE_WEB_ENV>`：Y 开 / 其它关 */
  readonly VITE_BAG_ENABLE_ENV?: string;
  readonly VITE_WEB_ENV: string;
  readonly VITE_H5_OUT_DIR: number;
  readonly VITE_LOG_LEVEL: string;
  readonly VITE_AI_QUESTION_BASE_URL: string;
  readonly VITE_STATIC_BASE_URL: string;
  readonly VITE_GANTT_OFFLINE_APPID: number;
  readonly VITE_CJS_IGNORE_WARNING: boolean;
  readonly VITE_ROOT_DIR: string;
  readonly VITE_USER_NODE_ENV: string;
}

declare interface ImportMeta {
  readonly env: ImportMetaEnv;
}

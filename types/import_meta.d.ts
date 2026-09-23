/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WEB_ENV: string;
  readonly VITE_H5_OUT_DIR: number;
  readonly VITE_LOG_LEVEL: string;
  readonly VITE_AI_QUESTION_BASE_URL: string;
  readonly VITE_STATIC_BASE_URL: string;
  readonly VITE_CJS_IGNORE_WARNING: boolean;
  readonly VITE_USER_NODE_ENV: string;
  readonly VITE_ROOT_DIR: string;
}

declare interface ImportMeta {
  readonly env: ImportMetaEnv;
}

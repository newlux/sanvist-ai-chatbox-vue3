/// <reference types="vite/client" />

/**
 * 构建期注入的环境变量（见 `.env.development` / `.env.production`）。
 * 这里只声明业务代码显式读取的那几个，其余仍走 vite/client 的索引签名。
 */
interface ImportMetaEnv {
  /** 是否给所有接口请求头加 `env: <VITE_WEB_ENV>`：Y 开 / N 关 */
  readonly VITE_BAG_ENABLE_ENV?: string;
  /** 环境标识，`env` 头的取值来源（development / production） */
  readonly VITE_WEB_ENV?: string;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";

  // eslint-disable-next-line ts/no-empty-object-type
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

/** 支付宝小程序运行时由宿主注入的 JSBridge */
declare const AlipayJSBridge: {
  call?: (name: string, params?: Record<string, unknown>, callback?: () => void) => void;
  /** mPaaS 通过 H5AppStartParams 注入的启动参数：离线包的 Lang / Authorization 等在这里 */
  startupParams?: Record<string, unknown>;
} | undefined;

/// <reference types="vite/client" />

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

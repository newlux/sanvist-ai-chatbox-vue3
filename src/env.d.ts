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
} | undefined;

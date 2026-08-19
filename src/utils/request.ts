import type { HookFetchPlugin } from "hook-fetch";
import hookFetch from "hook-fetch";
import { sseTextDecoderPlugin } from "hook-fetch/plugins";
// import { useUserStore } from '@/stores';

export interface BaseResponse<T = unknown> {
  code: number;
  errorCode?: number;
  data: T;
  message: string;
}

let authorization = "";
let guestRole = "";

export function setRequestAuth(value: string) {
  authorization = value;
}

export const GUEST_ROLE_OPTIONS = ["OWNER", "OPERATOR"] as const;

export type GuestRole = typeof GUEST_ROLE_OPTIONS[number];

export function isGuestRole(value: unknown): value is GuestRole {
  return typeof value === "string" && (GUEST_ROLE_OPTIONS as readonly string[]).includes(value);
}

export function setGuestRole(role: string) {
  guestRole = role;
}

export const request = hookFetch.create<BaseResponse, "data">({
  baseURL: import.meta.env.VITE_AI_QUESTION_BASE_URL,
  plugins: [sseTextDecoderPlugin({ json: true, prefix: "data:" })],
});

function jwtPlugin(): HookFetchPlugin<BaseResponse> {
  return {
    name: "jwt",
    beforeRequest: async (config) => {
      config.headers = new Headers(config.headers);
      if (authorization && !config.headers.has("Authorization")) {
        // config.headers.set("Authorization", authorization);
      }
      if (guestRole) {
        config.headers.set("guest-role", guestRole);
      }
      return config;
    },
    afterResponse: async (response) => {
      // console.log(response);
      if (response.result?.code === 200) {
        return response;
      }
      // 处理403逻辑
      if (response.result?.code === 403) {
        // 跳转到403页面（确保路由已配置）
        // router.replace({
        //   name: '403',
        // });
        // ElMessage.error(response.result?.msg);
        return Promise.reject(response);
      }
      // 处理401逻辑
      if (response.result?.code === 401) {
        // 如果没有权限，退出，且弹框提示登录
        // userStore.logout();
        // userStore.openLoginDialog();
      }
      // ElMessage.error(response.result?.msg);
      return Promise.reject(response);
    },
  };
}

request.use(jwtPlugin());

export const post = request.post;

export const get = request.get;

export const put = request.put;

export const del = request.delete;

export default request;

import type { HookFetchPlugin } from "hook-fetch";
import type { GetUserInfoOptions, UserInfo } from "./types";
import type { BaseResponse } from "@/utils/request";
import hookFetch from "hook-fetch";
import { GCP_ORGANIZATION_ID } from "@/config";

const userRequest = hookFetch.create<BaseResponse, "data">({
  headers: {
    "Content-Type": "application/json",
  },
});

// 自动解包 data 字段
function dataExtractorPlugin(): HookFetchPlugin {
  return {
    name: "data-extractor",
    afterResponse: async (context) => {
      const result = context.result as any;
      if (result && typeof result === "object" && "data" in result) {
        context.result = result.data;
      }
      return context;
    },
  };
}

userRequest.use(dataExtractorPlugin());

export async function getUserInfo(options: GetUserInfoOptions) {
  const baseUrl = "https://my-sany-api-uat.sany.com.cn";
  const headers: Record<string, string> = {
    Authorization: options.authorization,
  };

  if (options.version) {
    headers["Version-Code"] = options.version;
  }

  return userRequest
    .get(`${baseUrl}/customer/v1/${GCP_ORGANIZATION_ID}/user-self/get-user-info`, undefined, {
      headers,
    })
    .json() as Promise<UserInfo>;
}

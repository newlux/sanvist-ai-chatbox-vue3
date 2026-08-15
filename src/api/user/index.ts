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
function dataExtractorPlugin(): HookFetchPlugin<BaseResponse> {
  return {
    name: "data-extractor",
    afterResponse: async (response) => {
      if (response.result?.errorCode === 200) {
        return response;
      }
      return Promise.reject(response);
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
    .get<UserInfo>(`${baseUrl}/customer/v1/${GCP_ORGANIZATION_ID}/user-self/get-user-info`, undefined, {
      headers,
    })
    .json();
}

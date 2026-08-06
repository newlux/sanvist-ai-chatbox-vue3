import type { GetUserInfoOptions, UserInfo } from "./types";
import hookFetch from "hook-fetch";
import { GCP_ORGANIZATION_ID } from "@/config";

const userRequest = hookFetch.create({
  headers: {
    "Content-Type": "application/json",
  },
});

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

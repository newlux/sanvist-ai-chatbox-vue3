import type { GetUserInfoOptions, UserInfo } from "./types";
import type { BaseResponse } from "@/utils/request";
import { GCP_ORGANIZATION_ID } from "@/config";
import { alipayRequest, PlatformRequestError } from "@/utils/platform/alipay-request";

export async function getUserInfo(options: GetUserInfoOptions) {
  const baseUrl = "https://my-sany-api-uat.sany.com.cn";
  const headers: Record<string, string> = {
    Authorization: options.authorization,
    "Content-Type": "application/json",
  };

  if (options.version) headers["Version-Code"] = options.version;

  const response = await alipayRequest<BaseResponse<UserInfo>>(
    baseUrl,
    "GET",
    `/customer/v1/${GCP_ORGANIZATION_ID}/user-self/get-user-info`,
    { headers },
  );
  if (response.data.errorCode !== 200) {
    throw new PlatformRequestError(response.data.message || "获取用户信息失败", response.data.errorCode, response.data);
  }
  return response.data.data;
}

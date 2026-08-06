export interface UserInfo extends Record<string, unknown> {
  userId?: string;
}

export interface GetUserInfoOptions {
  baseUrl: string;
  authorization: string;
  version: string;
}

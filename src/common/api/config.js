// const GCP_BASE_URL = "https://dev-api-gcp.sanyglobal.com"
const GCP_BASE_URL = "https://sany-link-api-dev.sany.com.cn";
const GCP_PC_BASE_URL = "http://dev-pc-gcp.sanyglobal.com";

export const AI_QUESTION_BASE_URL =
  process.env.VUE_APP_AI_QUESTION_BASE_URL ||
  "https://sanvist-api-dev.etripon.com";

export const GCP_OFFICIAL_BASE_URL = "https://api-uat.sanyglobal.com";
export const GCP_OFFICIAL_IMG_URL = "https://sanyglobal-img.sany.com.cn";
// export const STATIC_BASE_URL = "https://mysany-img.sany.com.cn/h5-assets"
export const STATIC_BASE_URL =
  "http://sanyme-1254375538.cos.ap-guangzhou.myqcloud.com/mysany-assets";

// GCP 项目各环境 baseUrl
const BASEURL_ENV_MAP = {
  gcp: {
    development: "http://dev-api-gcp.sanyglobal.com",
    sit: "http://sit-api-gcp.sanyglobal.com",
  },
};
// 案例分享落地页地址
export const APP_CASE_SHARE = `${GCP_PC_BASE_URL}/#/appCaseShare`;
// 中心仓分享落地页地址
export const APP_CENTER_WAREHOUSE_SHARE = `${GCP_PC_BASE_URL}/#/appCenterWarehouseShare`;
// 设备分享落地页地址
export const APP_MACHINE_SHARE = `${GCP_PC_BASE_URL}/#/appMachineShare`;
// 配件分享落地页地址
export const APP_MATERIAL_SHARE = `${GCP_PC_BASE_URL}/#/appMaterialShare`;
// 服务网点分享落地页地址
export const APP_SERVICE_NETWORK_SHARE = `${GCP_PC_BASE_URL}/#/appServiceNetworkShare`;
// 代理商网点分享落地页地址
export const APP_AGENT_NETWORK_SHARE = `${GCP_PC_BASE_URL}/#/appAgentNetworkShare`;
// 新闻分享落地页地址
export const APP_NEWS_SHARE = `${GCP_PC_BASE_URL}/#/appNewsShare`;

export const OPEN_ENCRYPT = true; // 是否开启密码加密

export const GCP_ORGANIZATION_ID = 4; // GCP 项目默认组织机构ID

// 通过打包的环境变量获取 baseURL
export function getBaseUrl(project) {
  return GCP_BASE_URL;
}

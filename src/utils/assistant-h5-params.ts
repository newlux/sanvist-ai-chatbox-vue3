/**
 * 维修助理 / 配件助手两个三方 H5 共用的业务参数口径。
 *
 * 两边「参数一致、地址不同」，音色 / 界面语言 / 身份信息的取值方式抽到这里，
 * 避免两条链路各写一份、改一处漏一处。
 */
import { REPORT_VOICE_OPTIONS } from "@/config/report-voices";
import { loadReportVoice } from "@/hooks/useReportVoice";
import { i18n } from "@/i18n";
import { useSystemStore, useUserStore } from "@/stores";
import { resolveLaunchQuery } from "@/utils/launch-query";
import { getRequestAuth } from "@/utils/request";

/**
 * 当前选中的音色 id：读本机记忆的音色（听播页 saveReportVoice 写入的同一份数据），
 * 没选过时与听播页保持一致的兜底口径 —— 取音色列表第一项。
 */
export function resolveSelectedVoiceId() {
  return loadReportVoice()?.id || REPORT_VOICE_OPTIONS[0]?.id || "";
}

/**
 * 当前界面语言：优先取 systemStore.header.Lang（启动参数注入 + 设置弹层切换都会写这里），
 * 它是宿主与请求头共用的口径（zh_CN / en_US）；拿到前用 i18n 当前 locale 兜底。
 */
export function resolveSelectedLanguage() {
  const fromHeader = String(useSystemStore().header?.Lang || "").trim();
  if (fromHeader) return fromHeader;
  return String(i18n.global.locale.value || "zh_CN");
}

/** 从合并后的启动参数里按候选 key 取第一个非空值（宿主 key 大小写 / 下划线写法不统一） */
function readLaunchParam(keys: string[]) {
  const query = resolveLaunchQuery();
  for (const key of keys) {
    const value = String(query[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

/** 从用户信息对象里按候选 key 取第一个非空值 */
function readUserInfo(keys: string[]) {
  const info = useUserStore().userInfo as Record<string, unknown> | undefined;
  if (!info) return "";
  for (const key of keys) {
    const value = info[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

/**
 * 业务用户 id：优先 user store（登录 / 游客身份写入），
 * 其次用户信息与宿主启动参数；都没有时返回空串（调用方不拼这个参数）。
 */
export function resolveUserId() {
  const fromStore = String(useUserStore().userId || "").trim();
  if (fromStore) return fromStore;
  return readUserInfo(["userId", "user_id", "id"])
    || readLaunchParam(["userId", "user_id", "UserId", "externalUserId"]);
}

/**
 * 公司 id：用户信息 → 宿主启动参数。
 * 都没取到时返回空串，调用方沿用 sanvist 侧的默认租户（69，与维修助理一致）。
 */
export function resolveCompanyId() {
  return readUserInfo(["companyId", "company_id", "companyid"])
    || readLaunchParam(["companyId", "company_id", "CompanyId"]);
}

/**
 * 组织 id：用户信息 → 宿主启动参数。
 * 都没取到时返回空串，调用方沿用 sanvist 侧的默认组织（2，与维修助理一致）。
 */
export function resolveOrganizationId() {
  return readUserInfo(["organizationId", "organization_id", "organizationid"])
    || readLaunchParam(["organizationId", "organization_id", "OrganizationId"]);
}

/**
 * 透传给三方页的网关 token：直接用请求层当前生效的那份（宿主下发 / 本地兜底同一个来源），
 * 去掉 `bearer ` 前缀 —— 三方页按 `access_token=<uuid>` 的裸值使用。
 */
export function resolveAccessToken() {
  return getRequestAuth().replace(/^bearer\s+/i, "").trim();
}

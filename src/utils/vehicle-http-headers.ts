/** 车载页面的业务请求身份，按发起请求时所在路由读取，避免页面切换后残留。 */
export function getVehicleHttpHeaders(): Record<string, string> {
  let route = "";
  if (typeof getCurrentPages === "function") {
    const pages = getCurrentPages();
    route = String(pages[pages.length - 1]?.route || "");
  }
  if (!route && typeof location !== "undefined") {
    route = location.hash.replace(/^#\/?/, "").split("?")[0];
  }
  const deviceNo = ({
    "pages/task-pc/index": "26GJ1241016665H",
    "pages/guide-pc/index": "CC0260CG0003",
  } as Record<string, string>)[route.replace(/^\//, "")];
  return deviceNo ? { "X-Device-No": deviceNo, "X-Channel": "vehicle" } : {};
}

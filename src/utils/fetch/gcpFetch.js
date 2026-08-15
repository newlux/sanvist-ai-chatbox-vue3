import { GCP_ORGANIZATION_ID } from "@/common/api/config";
// import { isObject, isPlainObject } from "@/utils/utils";
// import qs from "qs";
// import store from "@/store";

let shwoTokenExpiration = true;

// 请求参数处理
function onBefore(config) {
  config.url = config.url.replace(/\{(.*?)\}/g, (ori, key) => {
    const value = config.data?.[key] ?? config.params?.[key];
    return value || ori;
  });

  // 如果以formData格式提交
  if (config.isFormData) {
    config.header["Content-Type"] = "application/x-www-form-urlencoded";
    config.data = config.data;
  }

  // 如果是后管的接口用后管的token替换
  if (config.isAdminApi && global.admin_token) {
    config.header.Authorization = global.admin_token;
  }

  // 如果需要手动配置语言
  if (config.customLang) {
    // 避免影响state，浅拷贝
    config.header = {
      ...config.header,
      Lang: config.customLang,
    };
  }

  return config;
}

// 对返回的数据进行错误判断
function onAfter(response, url) {
  const { data } = response;

  // 接口业务处理错误
  let msg = "";
  if (data?.failed) {
    msg = data.message == "null" || data.message == null ? "" : data.message;
  }
  if (filterCustomerErrorShowUrl(url)) {
    msg = "";
  }
  return { data: data?.data || data, msg };
}

uni.addInterceptor("request", {
  invoke(args) {
    // request 触发前拼接 url
    onBefore(args);
  },
  success(args) {
    // 请求成功后，修改code值为1
    // onAfter(args)
  },
  fail(err) {
    console.log("interceptor-fail", err);
  },
  complete(res) {
    console.log("interceptor-complete", res);
  },
});

/**
 * fetch的工厂方法
 * @param {string} method 请求方法的 方式
 * @returns
 */
export function gcpFetchFactory(url, method = "post", apiOptions = {}) {
  url = url.replace("{organizationId}", GCP_ORGANIZATION_ID);
  // if (isObject(method)) {
  //   apiOptions = method;
  //   method = "post";
  // }

  return function fetchInstance(_data = {}, options) {
    const option = { url, method, ...apiOptions, ...options };
    // const data = isPlainObject(_data) ? { ...option.data, ..._data } : _data;
    const data = { ...(option?.data || {}), ..._data };
    const params = { ...option.params, ..._data };
    if (option.method.toLocaleLowerCase() === "put") {
      option.params = params;
      option.data = data;
    } else if (option.method.toLocaleLowerCase() === "get") {
      option.params = params;
    } else if (option.method.toLocaleLowerCase() === "delete") {
      option.params = params;
      option.data = data;
    } else {
      option.data = data;
    }

    if (option.params) {
      option.data = option.params;
    }

    // api请求开始时间记录
    let apiStartTime = new Date().getTime();
    let sy_api_params = option.data && Object.keys(option.data).length ? JSON.stringify(option.data) : "";
    let param = {
      event_name: "sy_api_loaded",
      event_params: [
        { sy_api_url: option.url },
        // { sy_service_api: store.state.baseUrl },
      ],
    };
    // 添加get参数
    if (sy_api_params) {
      param.event_params.push({ sy_api_params: sy_api_params.slice(0, 99) });
    }

    const apiUrl = option.url;
    // option.url = store.state.baseUrl + apiUrl;
    option.url = apiUrl;

    let requestTask = null;
    const p = new Promise(async (r, j) => {
      requestTask = uni.request({
        ...option,
        header: {
          // ...(store.state.header || {}),
          ...(option.header || option.headers || {}),
        },
        success: (e) => {
          try {
            const rst = onAfter(e, option.url);
            if (!rst.msg) {
              r(rst.data);
            } else {
              j(rst.msg);
              let showToastCtrl = filterUrl(option.url); // 控制拦截器是否显示错误的Toast
              if (showToastCtrl && rst.msg !== "null") {
                uni.showToast({
                  title: rst.msg,
                  icon: "none",
                  duration: 3000,
                });
              }
            }
          } catch (e) {
            j(e);
          }
        },
        complete: (res) => {
          let curTime = new Date().getTime();
          let dt = Math.floor(((curTime - apiStartTime) * 10) / 1000) / 10;
          if (dt >= 2) {
            param.event_params.unshift({ sy_api_loaded_time: String(dt) });
            console.warn(`接口埋点`, JSON.stringify(param));
            AlipayJSBridge.call("firebaseEvent", param, (res) => {
              param = null;
            });
          } else {
            console.warn(`接口用时：${dt}秒`);
          }

          // 添加异常埋点
          if (res.statusCode !== 200) {
            const errorParams = {
              event_name: "sy_api_error",
              event_params: [
                { sy_api_url: option.url },
                { sy_error: res.statusCode || "network-error" },
              ],
            };
            AlipayJSBridge.call("firebaseEvent", errorParams);
            console.warn(`接口异常埋点`, JSON.stringify(errorParams));
          } else if (res.statusCode === 200 && (!res.data || res.data.failed)) {
            const errorMessage = `${res.data.code}_${res.data.message}`;
            const errorParams = {
              event_name: "sy_api_error",
              event_params: [
                { sy_api_url: option.url },
                { sy_error: errorMessage.length > 100 ? errorMessage.substring(0, 100) : errorMessage },
              ],
            };
            console.warn(`接口异常埋点`, JSON.stringify(errorParams));
            AlipayJSBridge.call("firebaseEvent", errorParams);
          }

          if (res.statusCode === 401) {
            if (shwoTokenExpiration) {
              shwoTokenExpiration = false;
              setTimeout(() => {
                shwoTokenExpiration = true;
              }, 1000);
              AlipayJSBridge.call("tokenExpiration", {}, () => {});
            }
          } else if (
            networkExceptionCapture(option.url) &&
            (!res || (res && res.statusCode !== 200))
          ) {
            j(res);
          }
        },
        fail: (err) => {
          // uni.request fail 场景（包括 abort）会走这里
          j(err);
        },
      });
    });

    // 允许调用方中断请求：p.abort()
    p.abort = function abort() {
      try {
        if (requestTask && typeof requestTask.abort === "function") {
          requestTask.abort();
        }
      } catch (e) {
        // ignore
      }
    };

    return p;
  };
}

// 网络异常捕获
function networkExceptionCapture(currUrl) {
  let showToastCtrl = true;
  // 要过滤的接口URL地址
  let filterUrlList = ["/aftersale/v1/device-users-auditor/save"];
  filterUrlList.some((e) => {
    if (!currUrl.includes(e)) {
      showToastCtrl = false;
    }
  });
  return showToastCtrl;
}

// 过滤判断url地址
function filterUrl(currUrl) {
  let showToastCtrl = true;
  // 要过滤的接口URL地址
  let filterUrlList = [
    "/user-point-details",
    "/aftersale-servicess/createOrder",
    "/aftersale-servicess/createOrderTemp",
    "/aftersale/v1/device-users-auditor/save",
    "/aftersale-servicess/batchCreateOrder",
    "/aftersale-servicess/batchCreateOrderTemp",
    "/inquiry-orders/confirm",
  ];
  filterUrlList.some((e) => {
    if (currUrl.includes(e)) {
      showToastCtrl = false;
    }
  });
  return showToastCtrl;
}

// 过滤判断url地址
function filterCustomerErrorShowUrl(currUrl) {
  let showModel = false;
  // 要过滤的接口URL地址
  let filterModelUrlList = [
    "/aftersale-servicess/batchCreateOrder",
    "/aftersale-servicess/postCancel",
  ];
  filterModelUrlList.some((e) => {
    if (currUrl.includes(e)) {
      showModel = true;
    }
  });
  return showModel;
}

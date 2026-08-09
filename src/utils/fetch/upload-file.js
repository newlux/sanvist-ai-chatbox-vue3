import { GCP_ORGANIZATION_ID } from "@/common/api/config";
import store from "@/store";
import i18n from "@/i18n";

const baseUrl = "/hfle/v1/{organizationId}/gcp-files/multipart".replace(
  "{organizationId}",
  GCP_ORGANIZATION_ID
);
const formData = {
  tenantId: GCP_ORGANIZATION_ID,
  // bucketName: "sanyme",
  // directory: "aftersale"
};

/**
 * 上传单个文件方法
 * @param {*} file 需要上传的文件
 * @param {*} index 文件索引
 * @param {*} callBack 接口返回执行回调
 * @returns 
 */
const goUpload = (file,index,callBack) => {
  // api请求开始时间记录
  let apiStartTime = new Date().getTime();
  let param = {
    event_name: "sy_api_loaded",
    event_params: [
      { sy_api_url: baseUrl },
      { sy_service_api: store.state.baseUrl },
    ],
  };

  return new Promise((resolve) => {
    console.warn(file.path)
    console.log(store.state.header,'...store.state.header')
    const headers = {
      ...store.state.header
    }
    delete headers['Content-Type']
    uni.uploadFile({
      hideLoading: true,
      filePath: file.path,
      name: "file",
      fileType: file.type || "image",
      formData,
      header: {
        ...headers,
        // 'Authorization': store.state.header.Authorization,
      },
      url: store.state.baseUrl + baseUrl,
      success: (res) => {
        if (res.data && res.data.indexOf("http") > -1) {
          callBack(res.data,index)
          resolve(res.data, index);
        } else {
          resolve('')
          console.error(res);
        }
      },
      fail: (error) => {
        resolve('')
        console.error(error);
      },
      complete: (res) => {
        let curTime = new Date().getTime();
        let dt = Math.floor(((curTime - apiStartTime) * 10) / 1000) / 10;
        if (dt >= 2) {
          // 添加post参数
          param.event_params.push({
            sy_api_params: JSON.stringify({
              ...formData,
              filePath: res?.data,
            }),
          });
          param.event_params.unshift({ sy_api_loaded_time: String(dt) });
          console.warn(`接口埋点`, JSON.stringify(param));
          AlipayJSBridge.call("firebaseEvent", param, () => {
            param = null;
          });
        }
      },
    });
  });
};

/**
 * 并发上传方法
 * @param {*} files 文件队列
 * @param {*} index 当前待上传文件索引
 * @param {*} results 返回结果队列
 * @param {*} callBack 每次接口返回执行回调
 */
const goUpFiles = async (files,index=0,results=[],callBack=()=>{}) => {
  const requests = []; // 请求队列
  const concurrency = 2; // 并发数
  for (let i = 0; i < concurrency; i++) {
    if(files[index]){
      requests.push(goUpload(files[index],index,callBack));
      index++
    }
  }

  if(requests.length){
    await Promise.all(requests).then(res=>{
      results = [...results,...res]
      console.warn(results)
    })
  }

  if(files[index]){
   return await goUpFiles(files,index,results,callBack)
  }

  uni.hideLoading();
  return results.filter(o=>o)
};

/**
 *
 * @param {[{path: string, type: 'image' | 'audio' | 'video'}]} files
 */
export async function uploadFiles(files, callBack,showLoading=true) {
  if(showLoading){
    uni.showLoading({ title: i18n.t("loading"), mask: true });
  }
  
  let urls = await goUpFiles(files,0,[],callBack)

  if (urls.length !== files.length) {
    uni.showToast({ title: i18n.t("upload-failed"), icon: "none" });
  }

  return urls
}


/**
 * 单个上传文件 -旧版本
 * @param {[{path: string, type: 'image' | 'audio' | 'video'}]} files
 */
export async function singleUploadFiles(files) {
  const urls = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      await new Promise((resolve, reject) => {
        uni.showLoading({title:i18n.t("loading"),mask:true})
        uni.uploadFile({
          hideLoading:true,
          filePath: file.path,
          name: "file",
          fileType: file.type || "image",
          formData: {
            tenantId: GCP_ORGANIZATION_ID,
            // bucketName: "sanyme",
            // directory: "aftersale"
          },
          header: {
            ...store.state.header,
            ContentType: "multipart/form-data",
          },
          url:
            store.state.baseUrl +
            "/hfle/v1/{organizationId}/gcp-files/multipart".replace(
              "{organizationId}",
              GCP_ORGANIZATION_ID
            ),
          success: function(res) {
            uni.hideLoading()
            if (res.data) urls.push(res.data);
            resolve(res);
          },
          fail: function(res) {
            uni.hideLoading()
          }
        });
      })
    } catch (error) {
      uni.hideLoading()
      uni.showToast({ title: error?.message || error, icon: "error" });
    }
  }
  return urls;
}
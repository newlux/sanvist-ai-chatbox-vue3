import { gcpFetchFactory } from "@/utils/fetch/gcpFetch";
// import store from "@/store";

// gcpFetchFactory 第二个参数可以是 string，指定 method 方式，
// 如 post、get、put ，默认 post，如果第二个参数是对象则默认作为
// post 请求，并且第二个入参作为请求的 options。
// options.ignoreToken 忽略登录的token

// ! {organizationId} URL的占位参数会自动替换，但仅限 {organizationId} 。
// ! 如果后续有其他的先讨论方案

export const GCPAPI = {
  fetchData: gcpFetchFactory("/hpfm/v1/lovs/data", "get"),
  fetchAIReply: (sessionId, messageId) => gcpFetchFactory(`/ai-question-api/chat/stream/${sessionId}/${messageId}`, "get",),
  fetchAISend: gcpFetchFactory("/ai-question-api/chat/send", "post"),
  fetchAIFeedback: gcpFetchFactory("/ai-question-api/chat/feedback", "post"),
  fetchAIChatFeedback: gcpFetchFactory("/ai-question-api/chat/feedback", "post"),
  fetchAIFeedbackCancel: gcpFetchFactory("/ai-question-api/chat/feedback/cancel", "post"),
  // TTS：返回 base64 音频内容
  fetchAITTS: (url) =>
    gcpFetchFactory(url, "get"),
  // ASR：语音转文本（入参 audioBase64: "data:audioBase64;base64,..."）
  fetchASRBase64: ({ audioBase64 } = {}) =>
    new Promise((resolve, reject) => {
      const baseUrl = "";
      const url = `${baseUrl}/ai-question-api/speech/asr/base64`;
      if (!url) {
        reject(new Error("fetchASRBase64: missing baseUrl"));
        return;
      }

      uni.request({
        url,
        method: "POST",
        data: { audioBase64 },
        header: {
          // ...(store.state.header || {}),
          "Content-Type": "application/json",
        },
        success: (res) => resolve(res?.data),
        fail: (err) => reject(err),
      });
    }),
  fetchAISessionList: gcpFetchFactory("/ai-question-api/sessions", "get"),
  fetchAISessionHistory: (sessionId) =>
    gcpFetchFactory(`/ai-question-api/sessions/${sessionId}/history`, "get"),
  // 编辑会话标题
  updateAISession: (sessionId) =>
    gcpFetchFactory(`/ai-question-api/sessions/${sessionId}`, "put"),
  // 单个逻辑删除
  deleteAISession: (sessionId, userId) =>
    gcpFetchFactory(`/ai-question-api/sessions/${sessionId}?userId=${userId}`, "delete"),
  // 批量逻辑删除
  batchDeleteAISession: gcpFetchFactory(
    "/ai-question-api/sessions/batch-delete",
    "post",
  ),
};

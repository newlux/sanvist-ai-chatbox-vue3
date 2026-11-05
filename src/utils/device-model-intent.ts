/**
 * 「换机型」口头指令识别（作业指导页专用）。
 *
 * 用户在作业指导页说这些句子时，不该把这句话发给对话接口，而是直接弹机型选择卡片重选
 * （见 pages/guide/index.vue 的 sendMessage 拦截）。
 *
 * 只做「归一化之后整句命中」，故意不做关键词模糊匹配：
 * 「这台设备换机油怎么换」「换台设备要注意什么」这类正常提问里也带「设备」「换」「台」，
 * 模糊匹配会把它们劫持成换机型。要放宽就往下表里加句子。
 */
const DEVICE_MODEL_SWITCH_INTENTS = [
  "我要切换机型",
  "帮我换台设备",
  "换一台",
  "换个机型",
  "切到另一台机器",
  "我想看其他设备",
  "看看我其他的设备",
  "我想选另一台",
  "我想重新选设备",
  "让我选台设备",
  "打开设备列表",
  "打开设备选择",
  "打开机型切换",
];

/** 语音识别结果常带标点、空白和语气词，比对前统一抹掉 */
function normalize(text: string) {
  return String(text || "")
    // 空白（含全角空格）
    .replace(/[\s\u3000]/g, "")
    // 中英文标点
    .replace(/[，。！？、；：,.!?;:"'“”‘’()（）【】[\]…~～_—-]/g, "")
    // 句尾语气词
    .replace(/[吧呢啊嘛呗呀哦哈啦]+$/, "")
    // 句首迟疑词
    .replace(/^[嗯呃额噢哦]+/, "");
}

const INTENT_SET = new Set(DEVICE_MODEL_SWITCH_INTENTS.map(normalize));

/** 这句话是不是「我要换机型」的意思 */
export function isDeviceModelSwitchIntent(text: string) {
  const normalized = normalize(text);
  return normalized.length > 0 && INTENT_SET.has(normalized);
}

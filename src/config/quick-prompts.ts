import type { VisitorRole } from "@/stores/modules/user";

/** 老板视角：关注车队整体状态、进度、能耗。 */
export const OWNER_QUICK_PROMPTS = [
  "今天一共多少台车在线？",
  "今天哪些设备没上线？",
  "今天有几台设备已经出工？",
  "这个月项目整体进度怎么样？",
  "这周项目设备总工时多少？",
  "这个月哪台车干得最多？",
  "项目设备最近有没有低活跃的",
  "哪几台车连续几天没干活了",
  "这个工地设备运行情况能看下吗",
  "这月哪台泵车耗油最多",
  "这个月设备一共加了多少油、充了多少电",
  "哪台车单位油耗最高",
  "队里有没有单位能耗异常高的车",
  "油耗比上月涨了，是干活多还是单位能耗变高",
  "队里哪台车油量快见底了",
  "这个月设备整体干了多少活",
];

/** 操作手视角：关注自己这台设备的状态、位置、油耗。 */
export const OPERATOR_QUICK_PROMPTS = [
  "我的设备现在状态怎么样",
  "我上周干了多少活",
  "我的设备现在在什么位置",
  "我的设备还剩多少油？",
  "我的设备上周干了多少活",
  "最近7天的设备工作情况",
  "我的设备昨天耗了多少油",
  "最近7天我的设备是不是越来越费油",
];

const QUICK_PROMPT_COUNT = 2;

function resolveQuickPromptPool(role: VisitorRole | null) {
  return role === "OPERATOR" ? OPERATOR_QUICK_PROMPTS : OWNER_QUICK_PROMPTS;
}

/** 按身份从问题池里随机抽两条；有足够候选项时避开上一轮，确保页面重新展示后内容会变化。 */
export function pickRoleQuickPrompts(role: VisitorRole | null, count = QUICK_PROMPT_COUNT, previousPrompts: string[] = []) {
  const source = resolveQuickPromptPool(role);
  const candidates = source.filter(prompt => !previousPrompts.includes(prompt));
  const pool = [...(candidates.length >= count ? candidates : source)];
  const picked: string[] = [];
  while (picked.length < count && pool.length) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

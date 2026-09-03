/**
 * 作业指导页「底部回答卡片」开发演示数据（临时）。
 *
 * 用途：在没有后端流式回包的情况下，本地预览“AI 回答末尾选项卡片 + 输入型选项（其他）”。
 * 各档场景与文案取自设计稿（每个 step 都是一份独立的单帧画面，互不拼接，
 * 便于对照设计稿逐帧验证）。
 *
 * step 与设计稿帧对照（1~15，5~13 暂未配置）：
 * - step=1（吊装工况推荐-问半径 2667:2674）：首问配重 → 确认半径（1/3）；
 * - step=2（追问吊装高度 2667:2772）：承接上一步选 18M（active 黑底白字）
 *   → AI 记录并提取设备机型 / 最大吊重 / 吊装目标 / 作业半径 4 项工况参数
 *   + 底部卡「开始匹配工况 2/3」追问吊装高度；
 * - step=3（推荐方案屏1 2667:2866）：承接上一步选 6M → AI 给出完整方案：
 *   资料来源条 → 标题段 → 履带吊示意图（占位）→ 主臂工况表（5 行 key-value）
 *   → 灰字匹配条件结论 + 黄色「现场实配与安全条件仍需人工确认」安全提示；
 * - step=4（推荐方案-查看依据 2667:3025）：承接上一步点「查看方案依据」→
 *   AI 列出查到的依据材料（标题段 + 审核状态说明 + 演示声明
 *   + SCC2200T 三个 PDF 引用链接）+ 下方“你可以问”两条问题行；
 * - step=5（拆装指导-阶段确认 2667:3214）：承接上一步点「继续拆装指导」→
 *   AI 灰字日志（拉板需求 / 机型臂架组合 / 还需确认 1 项信息 + ✓ 询问用户）
 *   + 底部卡「开始拆装步骤 1/3」确认当前现场拆装进度处于哪个阶段
 *   （6 个普通选项，「其他阶段」为主推高亮态 active 黑底白字）；
 * - step=6（拆装指导-副臂回应 2667:3306）：承接上一步选「准备安装副臂」→ AI 记录
 *   该进度（已从用户询问中提取到以下信息 / ✓ 已记录:准备安装副臂）
 *   + 「下一步需要由现场师傅确认实际配置」+ 桁架连臂现场图（占位）；
 *   本帧为中间过渡画面，无底部回答卡片；
 * - step=7~13：主流程后续帧待开发（访问时展示占位提示）；
 * - step=14（老师傅开新车-选机型 2663:93）：问智混泵车怎么开 → 思考过程（随车教练
 *   链接中 / 深度思考步骤）+ 底部卡「回答 1/1」请选择学习的机型；
 * - step=15（老师傅开新车-内容教学 2699:35）：选中机型进入带教 → 正文「随车教练—
 *   新机带教」+ 红字「步骤1/3」（红 #C8201E，在气泡内，不在卡片上）+ 底部卡
 *   「步骤 1/3」（灰字）确认当前步骤是否学会。
 * 访问 /pages/guide/index?step=N 即预览第 N 档画面。
 *
 * suggestion 块不再渲染进气泡，而是由 guide 页上浮为固定底部的回答卡片（盖住输入栏），
 * 数据仍走真实 suggestion 块协议：
 * - payload.title / step：头部灰字步骤标题与计数（如「开始匹配工况 1/3」，始终为灰字）；
 * - payload.subtitle：AI 反问的问题（黑、Medium 14px）；
 * - items 普通选项：{ text, active? }，灰底圆角条，点击后把文本作为下一条问题发送；
 *   active 表示已点选态（黑底白字，见 2667:2772 的 18M），真实协议可按需下发；
 *   本演示除 step=2 的 18M 外各选项默认不带 active（灰底未选中态）；
 * - items 输入型选项：{ type: "input", text, placeholder }，静止态与普通选项同款
 *   圆角条但文字为次级灰（#666），点击后原位展开为输入框 + 右侧发送箭头提交。
 *
 * 联调完成、后端已能下发同类数据后，删除本文件并移除 guide/index.vue 里的注入调用即可。
 */
import type { UiChatMessage } from "@/stores/chat-types";
import type { AiBlock } from "@/utils/ai-stream";

const DEMO_MAX_STEP = 15;

/** 把任意 step 值收敛到 1~15，非法值回退到 1 */
export function normalizeDemoStep(step: number): number {
  if (!Number.isFinite(step)) return 1;
  return Math.min(DEMO_MAX_STEP, Math.max(1, Math.floor(step)));
}

interface DemoRound {
  /** 该轮用户输入（承接上一步点选的选项，自然拼成一段连续会话） */
  userText: string;
  /** AI 回答正文（markdown） */
  answerContent: string;
  /** AI 回答区额外 block（如 status、think 等），渲染在 answer 与 suggestion 之间 */
  extraBlocks?: AiBlock[];
  /** 回答末尾的选项卡片；缺省（或 items 为空）表示该帧不弹底部回答卡片 */
  suggestion?: {
    title: string;
    step?: string;
    subtitle: string;
    items: Array<Record<string, unknown>>;
  };
}

/** 已配置的演示画面，key 即 step 号（后续补帧时按编号直接增删即可） */
const DEMO_ROUNDS: Record<number, DemoRound> = {
  1: {
    userText: "今天最大吊96吨，怎么配？",
    // 气泡正文三段还原 2667:2674：灰字模型日志 / 黑字提取信息 / 灰字收尾
    answerContent:
      "<!--html-->"
      + "<div style=\"color:#9e9e9e;font-size:13px;line-height:20px;\">"
      + "△模型正在理解您的吊装需求…<br>"
      + "已识别任务：为 96 t 吊装匹配配重方案<br>"
      + "正在核对设备型号、吊装目标及关键工况参数…<br>"
      + "已从资料中提取到以下信息"
      + "</div>"
      + "<div style=\"height:12px;\"></div>"
      + "<div style=\"color:#1a1a1e;font-size:15px;line-height:22px;\">"
      + "✓ 设备机型:SCC3200T<br>"
      + "✓ 最大吊重:96 t<br>"
      + "✓ 吊装目标:110kV主变压器"
      + "</div>"
      + "<div style=\"height:12px;\"></div>"
      + "<div style=\"color:#9e9e9e;font-size:13px;line-height:20px;\">"
      + "还需要确认2项信息<br>"
      + "✓ 询问用户"
      + "</div>",
    suggestion: {
      title: "开始匹配工况",
      step: "1/3",
      subtitle: "此次吊装的作业半径是多少?",
      items: [
        { id: "demo-opt-1-1", text: "12M" },
        { id: "demo-opt-1-2", text: "15M" },
        { id: "demo-opt-1-3", text: "18M" },
        { id: "demo-opt-1-4", text: "20M" },
        {
          id: "demo-opt-1-5",
          type: "input",
          text: "其他半径",
          placeholder: "其他半径",
        },
      ],
    },
  },
  // step=2：追问吊装高度（设计稿 2667:2772）
  // 承接上一步选 18M（active 黑底白字）→ AI 记录并提取 4 项工况参数
  // + 底部卡继续追问吊装高度
  2: {
    userText: "18M",
    // AI Answer Card：灰字日志（已记录 / 已从资料中提取到以下信息）
    // + 黑色 ✓ 4 行参数（设备机型 / 最大吊重 / 吊装目标 / 作业半径）
    answerContent:
      "<!--html-->"
      + "<div style=\"color:#9e9e9e;font-size:13px;line-height:20px;\">"
      + "已记录：作业半径18m。<br>"
      + "已从资料中提取到以下信息"
      + "</div>"
      + "<div style=\"height:12px;\"></div>"
      + "<div style=\"color:#1a1a1e;font-size:15px;line-height:24px;\">"
      + "✓ 设备机型:SCC3200T<br>"
      + "✓ 最大吊重:96 t<br>"
      + "✓ 吊装目标:110kV主变压器<br>"
      + "✓ 作业半径:18m"
      + "</div>",
    suggestion: {
      title: "开始匹配工况",
      step: "2/3",
      subtitle: "吊物最终需要提升到多高？",
      items: [
        { id: "demo-opt-2-1", text: "6M" },
        { id: "demo-opt-2-2", text: "18M", active: true },
        {
          id: "demo-opt-2-3",
          type: "input",
          text: "其他高度",
          placeholder: "其他高度",
        },
      ],
    },
  },
  // step=3：推荐方案屏1（设计稿 2667:2866）
  // 承接上一步选 6M → AI 给出完整方案：
  //   资料来源条 → 标题段 → 履带吊示意图（占位）→ 主臂工况表 5 行 key-value
  //   → 灰字匹配条件结论 + 黄色人工复核安全提示
  3: {
    userText: "6M",
    // AI Answer：资料来源（带 ✓ 的圆点）→ 标题段（黑 15/24 medium）
    // → 履带吊示意图（红线标注占位）→ 主臂工况表（双行表头 + 5 行 key-value）
    // → 灰字结论 → 黄色人工复核提示
    answerContent:
      "<!--html-->"
      + "<div style=\"display:flex;align-items:center;min-height:38px;padding:8px 12px;border:1px solid #e5e5e5;border-radius:8px;color:#1a1a1e;font-size:14px;line-height:20px;\">"
      + "<span style=\"display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#1a8a3a;color:#fff;font-size:12px;margin-right:8px;\">✓</span>"
      + "资料来源:已批准吊装方案"
      + "</div>"
      + "<div style=\"height:14px;\"></div>"
      + "<p style=\"margin:0;color:#1a1a1e;font-size:15px;line-height:24px;font-weight:500;\">"
      + "根据你提供的信息，推荐SCC3200T同机型 审核工况表，请核实现场xxx参考xxx 开展工作吧！</p>"
      + "<div style=\"height:14px;\"></div>"
      + "<div style=\"border:1px dashed #c8201e;border-radius:6px;padding:24px 16px;color:#9e9e9e;font-size:13px;line-height:18px;text-align:center;\">"
      + "（履带吊示意图：含主臂 / 配重 / 吊钩 / 履带红色标注）"
      + "</div>"
      + "<div style=\"height:14px;\"></div>"
      + "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:6px 0;color:#9e9e9e;font-size:13px;line-height:18px;border-bottom:1px solid #f1f1f1;\">"
      + "<span>主臂工况</span><span>主臂工况</span></div>"
      + "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:6px 0;color:#1a1a1e;font-size:14px;line-height:20px;\">"
      + "<span>主臂长度</span><span style=\"font-weight:500;\">42m</span></div>"
      + "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:6px 0;color:#1a1a1e;font-size:14px;line-height:20px;\">"
      + "<span>履带状态</span><span style=\"font-weight:500;\">全伸</span></div>"
      + "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:6px 0;color:#1a1a1e;font-size:14px;line-height:20px;\">"
      + "<span>后配重</span><span style=\"font-weight:500;\">120t</span></div>"
      + "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:6px 0;color:#1a1a1e;font-size:14px;line-height:20px;\">"
      + "<span>吊钩类型</span><span style=\"font-weight:500;\">100t</span></div>"
      + "<div style=\"display:flex;justify-content:space-between;align-items:center;padding:6px 0;color:#1a1a1e;font-size:14px;line-height:20px;border-bottom:1px solid #f1f1f1;\">"
      + "<span>推荐倍率</span><span style=\"font-weight:500;\">8 倍率</span></div>"
      + "<div style=\"height:12px;\"></div>"
      + "<div style=\"color:#666;font-size:13px;line-height:20px;\">"
      + "96t吊重 18m作业半径，满足该演示工况的匹配条件。</div>"
      + "<div style=\"height:12px;\"></div>"
      + "<div style=\"display:flex;align-items:center;min-height:41px;padding:10px 12px;background:#fffee3;color:#1a1a1e;font-size:13px;font-weight:500;line-height:20px;\">"
      + "现场实配与安全条件仍需人工确认</div>",
    suggestion: {
      // 对应设计稿中部"你可以问"+ 两条问题行，映射为底部固定回答卡片
      title: "你可以问",
      subtitle: "已生成推荐工况方案，接下来想做什么？",
      items: [
        { id: "demo-opt-3-1", text: "查看方案依据" },
        { id: "demo-opt-3-2", text: "重新调整参数" },
        {
          id: "demo-opt-3-3",
          type: "input",
          text: "其他输入",
          placeholder: "其他输入",
        },
      ],
    },
  },
  // step=4：推荐方案-查看依据（设计稿 2667:3025）
  // 承接上一步点「查看方案依据」→ AI 展示查到的依据材料：
  //   标题段（黑 medium）→ 审核状态说明（黑）→ 3 个 PDF 引用链接（蓝）
  //   → 灰字演示声明 → 下方“你可以问”两条问题行
  4: {
    userText: "查看方案依据",
    // AI Answer：标题段 + 材料说明 + 三个 PDF 引用（蓝色文件名）
    // + 灰字声明（本结果为展会演示方案…）
    answerContent:
      "<!--html-->"
      + "<div style=\"color:#1a1a1e;font-size:15px;line-height:24px;font-weight:500;\">"
      + "以下是查到的依据</div>"
      + "<div style=\"height:8px;\"></div>"
      + "<div style=\"color:#1a1a1e;font-size:15px;line-height:24px;\">"
      + "查到的材料，有的是已经审核过的、执行度较高；一份尚未审批，你可以仅供参考。</div>"
      + "<div style=\"height:14px;\"></div>"
      + "<a href=\"https://example.com/scc2200t-load-table.pdf\" "
      + "style=\"display:block;color:#0a7cff;font-size:14px;line-height:22px;text-decoration:underline;padding:6px 0;\">"
      + "SCC2200T工况载荷表.pdf</a>"
      + "<a href=\"https://example.com/shanghai-langang-lifting-plan.pdf\" "
      + "style=\"display:block;color:#0a7cff;font-size:14px;line-height:22px;text-decoration:underline;padding:6px 0;\">"
      + "上海临港主变吊装方案.pdf</a>"
      + "<a href=\"https://example.com/scc2200t-config.pdf\" "
      + "style=\"display:block;color:#0a7cff;font-size:14px;line-height:22px;text-decoration:underline;padding:6px 0;\">"
      + "SCC2200T设备配置说明.pdf</a>"
      + "<div style=\"height:14px;\"></div>"
      + "<div style=\"color:#9e9e9e;font-size:13px;line-height:20px;\">"
      + "本结果为展会演示方案。正式作业必须以当前设备对应版本的审核载荷表、"
      + "已批准吊装方案及现场人工复核为准。</div>",
    suggestion: {
      // 对应设计稿中部"你可以问"+ 两条问题行（继续拆装指导 / 查看吊装方案），
      // 映射为底部固定回答卡片
      title: "你可以问",
      subtitle: "已找到相关依据资料，接下来想做什么？",
      items: [
        { id: "demo-opt-4-1", text: "继续拆装指导" },
        { id: "demo-opt-4-2", text: "查看吊装方案" },
        {
          id: "demo-opt-4-3",
          type: "input",
          text: "其他输入",
          placeholder: "其他输入",
        },
      ],
    },
  },
  // step=5：拆装指导-阶段确认（设计稿 2667:3214）
  // 承接上一步点「继续拆装指导」→ AI 灰字日志
  // + 底部卡「开始拆装步骤 1/3」确认当前现场拆装进度处于哪个阶段
  5: {
    userText: "继续拆装指导",
    // AI Answer Card：灰字三行日志（拉板需求 / 机型臂架组合 / 还需确认1项信息）
    // + ✓ 询问用户
    answerContent:
      "<!--html-->"
      + "<div style=\"color:#9e9e9e;font-size:13px;line-height:20px;\">"
      + "模型正在理解您的拉板需求…<br>"
      + "我已经识别到机型和臂架组合。为了匹配正确的连臂图和拆装步骤，"
      + "还需要了解你现在做到哪一步。<br>"
      + "还需要确认1项信息"
      + "</div>"
      + "<div style=\"height:12px;\"></div>"
      + "<div style=\"color:#9e9e9e;font-size:13px;line-height:20px;\">"
      + "✓ 询问用户"
      + "</div>",
    suggestion: {
      title: "开始拆装步骤",
      step: "1/3",
      subtitle: "当前现场拆装进度处于哪个阶段？",
      items: [
        { id: "demo-opt-5-1", text: "主机已就位" },
        { id: "demo-opt-5-2", text: "正在组装主臂" },
        { id: "demo-opt-5-3", text: "准备安装副臂" },
        { id: "demo-opt-5-4", text: "正在核对拉板" },
        { id: "demo-opt-5-5", text: "准备起臂前复核" },
        // 「其他阶段」为主推高亮态（黑底白字 active），点击把文本作为下一条问题发送
        { id: "demo-opt-5-6", text: "其他阶段", active: true },
      ],
    },
  },
  // step=6：拆装指导-副臂回应（设计稿 2667:3306）
  // 承接上一步选「准备安装副臂」→ AI 记录进度 + 桁架连臂现场图（占位）
  // 本帧为中间过渡画面（无底部回答卡片），仅展示确认信息
  6: {
    userText: "准备安装副臂",
    answerContent:
      "<!--html-->"
      + "<div style=\"color:#9e9e9e;font-size:13px;line-height:20px;\">"
      + "已从用户询问中提取到以下信息"
      + "</div>"
      + "<div style=\"height:10px;\"></div>"
      + "<div style=\"color:#1a1a1e;font-size:15px;line-height:24px;\">"
      + "✓ 已记录:准备安装副臂"
      + "</div>"
      + "<div style=\"height:10px;\"></div>"
      + "<div style=\"color:#1a1a1e;font-size:15px;line-height:24px;\">"
      + "下一步需要由现场师傅确认实际配置"
      + "</div>"
      + "<div style=\"height:14px;\"></div>"
      + "<div style=\"border:1px dashed #c8201e;border-radius:6px;padding:24px 16px;color:#9e9e9e;font-size:13px;line-height:18px;text-align:center;\">"
      + "（桁架连臂现场图：臂节 / 销轴 / 拉板 / 配重块现场实拍）"
      + "</div>",
  },
  // step=14：老师傅开新车-选机型（设计稿 2663:93）
  14: {
    userText: "我之前一直开油车，智混泵车怎么开？",
    answerContent: "",
    extraBlocks: [
      {
        id: "demo-status-block-14",
        type: "status",
        complete: true,
        payload: {
          stage: "等待模型响应：",
          message: "随车教练 努力链接中",
        },
      },
      {
        id: "demo-think-block-14",
        type: "think",
        complete: true,
        payload: {
          steps: [
            { node: "找到设备", message: "正在确认本次可查询范围", complete: true },
            { node: "核验资料", message: "正在核验操作保养手册", complete: true },
            { node: "整理回答", message: "正在为你整理清晰的查询结论", complete: true },
          ],
        },
      },
    ],
    suggestion: {
      title: "回答",
      step: "1/1",
      subtitle: "请选择需要学习的机型",
      items: [
        { id: "demo-opt-14-1", text: "泵车45米" },
        { id: "demo-opt-14-2", text: "智混泵车39米" },
        {
          id: "demo-opt-14-3",
          type: "input",
          text: "其他输入",
          placeholder: "其他输入",
        },
      ],
    },
  },
  // step=15：老师傅开新车-内容教学（设计稿 2699:35）
  // 正文含设计稿式富文本（标题行 + 右侧红字进度），用 <!--html--> 前缀走可信 HTML 渲染
  15: {
    userText: "泵车45米",
    answerContent:
      "<!--html-->"
      + "<div style=\"display:flex;align-items:center;justify-content:space-between;\">"
      + "<strong style=\"color:#1a1a1e;font-size:14px;font-weight:500;line-height:20px;\">随车教练— 新机带教</strong>"
      + "<span style=\"color:#c8201e;font-size:12px;font-weight:500;line-height:20px;\">步骤1/3</span>"
      + "</div>"
      + "<div style=\"display:flex;margin:8px 0 10px;height:2px;background:#f1f1f1;\">"
      + "<div style=\"width:49px;height:2px;background:#c8201e;\"></div>"
      + "</div>"
      + "<p style=\"margin:0;color:#1a1a1e;font-size:15px;font-weight:600;line-height:21px;\">"
      + "多了两种作业模式</p>"
      + "<p style=\"margin:8px 0 0;color:#1a1a1e;font-size:15px;line-height:21px;\">"
      + "·智能模式：保电量，优先保障持续作业</p>"
      + "<p style=\"margin:6px 0 0;color:#1a1a1e;font-size:15px;line-height:21px;\">"
      + "·纯电优先：先用电，减少燃油消耗</p>",
    extraBlocks: [
      {
        id: "demo-think-block-15",
        type: "think",
        complete: true,
        payload: {
          steps: [
            { node: "找到设备", message: "正在确认本次可查询范围", complete: true },
            { node: "核验资料", message: "正在核验操作保养手册", complete: true },
            { node: "询问用户", message: "请确认当前步骤是否学会", complete: true },
          ],
        },
      },
    ],
    suggestion: {
      title: "步骤",
      step: "1/3",
      subtitle: "请确认当前步骤是否学会？",
      items: [
        { id: "demo-opt-15-1", text: "已经学会" },
        { id: "demo-opt-15-2", text: "我不确定，拍照让你帮忙识别" },
        {
          id: "demo-opt-15-3",
          type: "input",
          text: "其他输入",
          placeholder: "其他输入",
        },
      ],
    },
  },
};

function buildRound(round: DemoRound, stage: number): UiChatMessage[] {
  const blocks: AiBlock[] = [
    {
      id: `demo-answer-block-${stage}`,
      type: "answer",
      complete: true,
      payload: { content: round.answerContent },
    },
  ];
  if (round.extraBlocks?.length) blocks.push(...round.extraBlocks);
  if (round.suggestion && round.suggestion.items.length > 0) {
    blocks.push({
      id: `demo-suggestion-block-${stage}`,
      type: "suggestion",
      complete: true,
      payload: {
        title: round.suggestion.title,
        step: round.suggestion.step,
        subtitle: round.suggestion.subtitle,
        items: round.suggestion.items,
      },
    });
  }
  return [
    {
      id: `demo-user-${stage}`,
      role: "user",
      content: round.userText,
      sessionId: null,
      messageId: null,
    },
    {
      id: `demo-ai-${stage}`,
      role: "ai",
      content: "",
      blocks,
      sessionId: null,
      messageId: null,
      ttsEnabled: false,
      loading: false,
      interrupted: false,
    },
  ];
}

/** step 5~13 等未配置帧的占位画面，提示后续从设计稿补帧 */
function buildPlaceholder(stage: number): UiChatMessage[] {
  return [
    {
      id: `demo-ai-${stage}`,
      role: "ai",
      content: "",
      blocks: [
        {
          id: `demo-answer-block-${stage}`,
          type: "answer",
          complete: true,
          payload: {
            content:
              "<!--html-->"
              + "<div style=\"color:#9e9e9e;font-size:14px;line-height:22px;text-align:center;padding:40px 16px;\">"
              + `step=${stage} 暂未配置演示画面，可从设计稿选取画面上移至此位。</div>`,
          },
        },
      ],
      sessionId: null,
      messageId: null,
      ttsEnabled: false,
      loading: false,
      interrupted: false,
    },
  ];
}

/**
 * 组装 guide 页演示会话：每个 step 对应一份独立的模拟画面（一轮问答），
 * 互不拼接，方便逐个对照设计稿帧验证。
 * step 1~15（5~13 暂未配置时展示占位提示），非法值按 1 处理。
 */
export function buildDemoConversation(step = 1): UiChatMessage[] {
  const stage = normalizeDemoStep(step);
  const round = DEMO_ROUNDS[stage];
  if (!round) return buildPlaceholder(stage);
  return buildRound(round, stage);
}

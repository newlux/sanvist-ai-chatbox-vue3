import bunnyPreview from "@/assets/audio/voice/brief_qiaoxiaojiao.wav";
import mochiPreview from "@/assets/audio/voice/brief_anmingyuan.wav";
import ethanPreview from "@/assets/audio/voice/brief_longanyang.wav";
import kaiPreview from "@/assets/audio/voice/brief_longzhe.wav";
import maiaPreview from "@/assets/audio/voice/brief_guyunshu.wav";
import miaPreview from "@/assets/audio/voice/brief_xieshurou.wav";
import neilPreview from "@/assets/audio/voice/brief_longsanshu.wav";
import serenaPreview from "@/assets/audio/voice/brief_xuyuyuan.wav";
// 8 个 Qwen 音色试听（本地 wav），id 与声音一一对应

import avatarBunny from "@/assets/img/voice-assistant/voice-avatar-Bunny.png";
import avatarEthan from "@/assets/img/voice-assistant/voice-avatar-Ethan.png";
import avatarKai from "@/assets/img/voice-assistant/voice-avatar-Kai.png";
import avatarMaia from "@/assets/img/voice-assistant/voice-avatar-Maia.png";
import avatarMia from "@/assets/img/voice-assistant/voice-avatar-Mia.png";
import avatarMochi from "@/assets/img/voice-assistant/voice-avatar-Mochi.png";
import avatarNeil from "@/assets/img/voice-assistant/voice-avatar-Neil.png";
import avatarSerena from "@/assets/img/voice-assistant/voice-avatar-Serena.png";
// 角色大图（主视觉，设计稿 2874:1）
// 角色小图（轮播椭圆头像，设计稿 2874:2）
import heroBunny from "@/assets/img/voice-assistant/voice-hero-Bunny.png";
import heroEthan from "@/assets/img/voice-assistant/voice-hero-Ethan.png";
import heroKai from "@/assets/img/voice-assistant/voice-hero-Kai.png";
import heroMaia from "@/assets/img/voice-assistant/voice-hero-Maia.png";
import heroMia from "@/assets/img/voice-assistant/voice-hero-Mia.png";
import heroMochi from "@/assets/img/voice-assistant/voice-hero-Mochi.png";
import heroNeil from "@/assets/img/voice-assistant/voice-hero-Neil.png";
import heroSerena from "@/assets/img/voice-assistant/voice-hero-Serena.png";

export const REPORT_VOICE_STORAGE_KEY = "ai-report-voice";

export interface ReportVoiceOption {
  /** 声音 id，与 TTS/试听一一对应 */
  id: string;
  /** 人设名（中文） */
  voiceName: string;
  name: string;
  description: string;
  tag: string;
  gender: "female" | "male";
  /** 主视觉大图（半身白色上衣 + 底部淡出白，设计稿 2874:1） */
  hero: string;
  /** 轮播椭圆小头像（设计稿 2874:2） */
  avatar: string;
  /** 试听音频（本地 wav URL），滑到该音色时播放 */
  preview: string;
}

/** 按设计稿要求交错排列：女、男、女、男、女、男、女、男。 */
export const REPORT_VOICE_OPTIONS: ReportVoiceOption[] = [
  {
    id: "xieshurou_v3.1",
    voiceName: "谢舒柔",
    name: "温柔治愈",
    description: "适合日常汇报",
    tag: "温柔治愈",
    gender: "female",
    hero: heroMia,
    avatar: avatarMia,
    preview: miaPreview,
  },
  {
    id: "longanyang_v3.1",
    voiceName: "龙安洋",
    name: "阳光温暖",
    description: "适合日常汇报",
    tag: "干练职场",
    gender: "male",
    hero: heroEthan,
    avatar: avatarEthan,
    preview: ethanPreview,
  },
  {
    id: "xuyuyuan_v3.1",
    voiceName: "许玉远",
    name: "温柔知性",
    description: "适合日常汇报",
    tag: "温柔知性",
    gender: "female",
    hero: heroSerena,
    avatar: avatarSerena,
    preview: serenaPreview,
  },
  {
    id: "longzhe_v3.1",
    voiceName: "龙哲",
    name: "沉稳磁性",
    description: "适合日常汇报",
    tag: "成熟沉稳",
    gender: "male",
    hero: heroKai,
    avatar: avatarKai,
    preview: kaiPreview,
  },
  {
    id: "qiaoxiaojiao_v3.1",
    voiceName: "乔小娇",
    name: "灵动可爱",
    description: "适合日常汇报",
    tag: "潮流活力",
    gender: "female",
    hero: heroBunny,
    avatar: avatarBunny,
    preview: bunnyPreview,
  },
  {
    id: "longsanshu_v3.1",
    voiceName: "龙三叔",
    name: "专业播报",
    description: "适合日常汇报",
    tag: "专业播报",
    gender: "male",
    hero: heroNeil,
    avatar: avatarNeil,
    preview: neilPreview,
  },
  {
    id: "guyunshu_v3.1",
    voiceName: "顾云舒",
    name: "知性温柔",
    description: "适合日常汇报",
    tag: "成熟沉稳",
    gender: "female",
    hero: heroMaia,
    avatar: avatarMaia,
    preview: maiaPreview,
  },
  {
    id: "anmingyuan_v3.1",
    voiceName: "安明远",
    name: "聪明伶俐",
    description: "适合日常汇报",
    tag: "轻快活力",
    gender: "male",
    hero: heroMochi,
    avatar: avatarMochi,
    preview: mochiPreview,
  },
];

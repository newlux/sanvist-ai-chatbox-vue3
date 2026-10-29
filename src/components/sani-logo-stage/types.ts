/**
 * 环绕中心图标的一颗球。
 * cx / cy 是「球心相对中心图标圆心的偏移」（rpx，右 / 下为正），size 是直径；
 * 组件内部用「图标圆心 + 偏移 − 半尺寸」反推 left/top，球随 logo 居中一起走，
 * 调用方不用自己算内容区绝对坐标（与 ai-welcome 的 DETAIL_TAG_SLOTS 同一套口径）。
 */
export interface SaniStageBubble {
  /** 唯一 key：交互球取选项命中值，装饰球取固定名 */
  key: string;
  /** 球内文案；装饰球留空。换行直接写 \n */
  label?: string;
  /** 球心相对图标圆心的水平偏移（rpx，右正左负） */
  cx: number;
  /** 球心相对图标圆心的纵向偏移（rpx，下正上负） */
  cy: number;
  size: number;
  /** 球内字号（rpx）；装饰球不用传 */
  fontSize?: number;
  /** 装饰球的纵向渐变 */
  fill?: [string, string];
  /** 身份玻璃球：底色 + 双层阴影 + 虹彩色斑；不传即为装饰虚化球 */
  glass?: boolean;
}

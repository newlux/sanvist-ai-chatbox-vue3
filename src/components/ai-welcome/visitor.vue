<script setup lang="ts">
import { onMounted } from "vue";
import { getRoleOptions } from "@/api/user-role";
import brandLogo from "@/assets/img/header-island-logo.png";
import { LISTEN_REPORT_CURRENT_DATE_KEY, LISTEN_REPORT_DATE_KEY, VISITOR_ROLE_OPTIONS_CACHE_KEY } from "@/config";
import { REPORT_STYLE_STORAGE_KEY } from "@/config/report-styles";
import { REPORT_VOICE_STORAGE_KEY } from "@/config/report-voices";
import { createLogger } from "@/utils/logger";

defineOptions({ name: "AiWelcomeVisitor" });
const logger = createLogger("visitor");
// 欢迎页挂载即预取角色选项并缓存，进入角色选择页时直接使用，避免页面加载闪动
onMounted(async () => {
  try {
    uni.removeStorageSync(LISTEN_REPORT_DATE_KEY);
    uni.removeStorageSync(LISTEN_REPORT_CURRENT_DATE_KEY);
    uni.removeStorageSync(REPORT_VOICE_STORAGE_KEY);
    uni.removeStorageSync(REPORT_STYLE_STORAGE_KEY);
  } catch (error) {
    logger.warn("failed to clear visitor experience state", error);
  }

  try {
    const result = await getRoleOptions();
    const roles = result?.roles ?? [];
    if (roles.length) {
      uni.setStorageSync(VISITOR_ROLE_OPTIONS_CACHE_KEY, roles);
    }
  } catch (error) {
    logger.warn("failed to prefetch role options", error);
  }
});

function goToRoleSelect() {
  uni.navigateTo({ url: "/pages/role-select/index" });
}
</script>

<template>
  <!-- 游客欢迎页：Ardot 306:2777「起始态 • 未唤醒」（375×812，D 方案全白主题）
       状态栏由宿主绘制（父级 safe-area padding），设计稿里的 54 高状态栏只作示意 -->
  <view class="welcome-visitor">
    <!-- 底部光效：只保留贴底一缕淡蓝渐变（约 62px），单层实现，避免多层叠加把颜色压深 -->
    <view class="welcome-visitor__glow">
      <view class="welcome-visitor__glow-fade" />
    </view>

    <view class="welcome-visitor__content">
      <!-- 主视觉组：标题 + Logo -->
      <view class="welcome-visitor__hero">
        <!-- 标题行 Hey,SANI：306:2801（Hey, 纯色）+ 306:2782（SANI 渐变），两段连写无间隙 -->
        <view class="welcome-visitor__title">
          <text class="welcome-visitor__title-hey">Hey,</text>
          <text class="welcome-visitor__title-brand">SANI</text>
        </view>
        <!-- 主视觉：306:2783 容器 134×134 / 306:2791 图 110×110（居中，投影 0 3 9 rgba(0,0,0,.14)） -->
        <view class="welcome-visitor__logo">
          <image class="welcome-visitor__logo-img" :src="brandLogo" mode="aspectFit" />
        </view>
      </view>

      <!-- 文案组：306:2780 副标题 + 306:2800 描述两行 -->
      <view class="welcome-visitor__caption">
        <text class="welcome-visitor__slogan">随时，为你而在</text>
        <view class="welcome-visitor__desc">
          <text class="welcome-visitor__desc-line">你的三一设备伙伴。</text>
          <text class="welcome-visitor__desc-line">把问题交给我，把时间留给工作。</text>
        </view>
      </view>
    </view>

    <!-- 开始体验：保留原有入口与跳转逻辑，仅做配色适配（白底按钮 + 品牌紫文字） -->
    <view class="welcome-visitor__footer">
      <view
        class="welcome-visitor__button"
        hover-class="welcome-visitor__button--pressed"
        @tap="goToRoleSelect"
      >
        <text>开始体验</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.welcome-visitor {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  // 设计稿 306:2781 Rectangle 51：fills 最上层为不透明 #FAFAFA（下面两层渐变被完全遮住）
  background: #fafafa;
  color: #0d0d0d;
  font-family: "Source Han Sans CN", "PingFang SC", sans-serif;
}

/* ===== 底部光效：按反馈图收敛到约 62px，只留贴底一缕淡蓝 ===== */
.welcome-visitor__glow {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  height: 124rpx; // 62px（原 118px，渐变爬得太高）
  overflow: hidden;
  pointer-events: none;
}

/* 主渐变：#FAFAFA → #BFDAF4，曲线按反馈图逐段采样，避免上半段过早显色 */
.welcome-visitor__glow-fade {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 124rpx; // 62px
  background-image: linear-gradient(
    180deg,
    #fafafa 0%,
    #f7f8f9 38%,
    #f0f4f8 52%,
    #e7eff6 65%,
    #d9e8f6 77%,
    #c8def4 90%,
    #bfdaf4 100%
  );
}

/* 内容区：设计稿是绝对定位，这里用居中 + 块内精确间距，保证小屏（折叠屏）不溢出 */
.welcome-visitor__content {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 78rpx; // 39px：Logo 底 → 副标题顶
  min-height: 0;
  overflow-y: auto;
}

/* 标题 + Logo 组：间距 5px */
.welcome-visitor__hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10rpx; // 5px
}

/* 标题行：24px Medium，行盒 35px */
.welcome-visitor__title {
  display: flex;
  align-items: flex-start;
  font-size: 48rpx; // 24px
  font-weight: 500; // Medium
  line-height: 70rpx; // 35px
  white-space: nowrap;
}

/* 306:2801：Hey, → #0D0D0D */
.welcome-visitor__title-hey {
  color: #0d0d0d;
}

/* 306:2782：SANI → 渐变文字（#3D21CD → #1999FE → #C067FA → #FD90C4，水平） */
.welcome-visitor__title-brand {
  background-image: linear-gradient(
    90deg,
    #3d21cd 0%,
    #1999fe 48.72%,
    #c067fa 75.995%,
    #fd90c4 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* 306:2783：134×134 容器，图 110×110 居中（内边距 12） */
.welcome-visitor__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 268rpx; // 134px
  height: 268rpx;
  padding: 24rpx; // 12px
}

.welcome-visitor__logo-img {
  width: 220rpx; // 110px
  height: 220rpx;
  // 设计稿阴影 0 3px 9px rgba(0,0,0,.14)：图片是透明 PNG，
  // 用 drop-shadow 才能沿三角轮廓投影（box-shadow 会沿 110×110 方框铺开，出现方形光晕）
  filter: drop-shadow(0 6rpx 18rpx rgba(0, 0, 0, 0.14));
}

/* 副标题 + 描述组：间距 2px */
.welcome-visitor__caption {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4rpx; // 2px
}

/* 306:2780：16px Medium，行盒 23px，同一套渐变文字 */
.welcome-visitor__slogan {
  font-size: 32rpx; // 16px
  font-weight: 500;
  line-height: 46rpx; // 23px
  text-align: center;
  background-image: linear-gradient(
    90deg,
    #3d21cd 0%,
    #1999fe 48.72%,
    #c067fa 75.995%,
    #fd90c4 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* 306:2800：16px / 行高 24px，两行居中，#8E8E8E */
.welcome-visitor__desc {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 480rpx; // 240px
  font-size: 32rpx; // 16px
  font-weight: 500;
  line-height: 48rpx; // 24px
  text-align: center;
  color: #8e8e8e;
}

.welcome-visitor__desc-line {
  display: block;
  width: 100%;
  text-align: center;
}

/* 底部按钮区：沿用原有布局与跳转，仅配色适配白底页面 */
.welcome-visitor__footer {
  position: relative;
  z-index: 1;
  padding: 0 48rpx 32rpx;
  margin-bottom: 76rpx;
}

.welcome-visitor__button {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 104rpx;
  border-radius: 52rpx;
  background: #ffffff;
  color: #3d21cd;
  font-size: 36rpx;
  font-weight: 800;
  line-height: 44rpx;
  box-shadow: 0 8rpx 24rpx rgba(61, 33, 205, 0.16);
}

.welcome-visitor__button--pressed {
  opacity: 0.85;
}
</style>

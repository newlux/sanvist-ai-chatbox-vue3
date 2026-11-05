<script setup lang="ts">
import { computed } from "vue";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useSystemStore, useUserStore } from "@/stores";
import AiWelcomeMember from "./member.vue";
import AiWelcomeVisitor from "./visitor.vue";

defineOptions({
  name: "AiWelcome",
});

const emit = defineEmits(["start-chat"]);
const userStore = useUserStore();
/**
 * 深浅色：与对话页同一套口径 —— 唯一数据源 systemStore.isDark。
 * 内层（visitor.vue）自己按深色稿铺底，这里只管容器：
 * 顶部安全区属于容器的 padding，不跟着换底就会在深色下露出 #FAFAFA 白带。
 */
const systemStore = useSystemStore();
const isDark = computed(() => systemStore.isDark);
const { safeAreaStyle } = useSafeArea();
const isVisitor = computed(() => userStore.isVisitor === true);

function onStartChat() {
  emit("start-chat");
}
</script>

<template>
  <view
    class="welcome"
    :class="{ 'welcome--visitor': isVisitor, 'welcome--dark': isDark }"
    :style="safeAreaStyle"
  >
    <AiWelcomeVisitor v-if="isVisitor" />
    <AiWelcomeMember v-else @start-chat="onStartChat" />
  </view>
</template>

<style lang="scss" scoped>
.welcome {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 100vh;
  padding-top: var(--safe-top-px, 0px);
  padding-top: max(var(--safe-top-px, 0px), env(safe-area-inset-top));
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
  overflow: hidden;
  color: #fff;
  background-position: center;
  background-size: cover;
  font-family: "PingFang SC", sans-serif;
}

/* 游客欢迎页换成 Ardot 306:2777 的全白主题（含顶部 safe-area 区域也必须是白底） */
.welcome--visitor {
  background: #fafafa;
  color: #0d0d0d;
  // 底部渐变（.welcome-visitor__glow）必须贴到屏幕物理底边：
  // 这里不给底部安全区留内边距，否则渐变会停在安全区上方、露出 #fafafa 白带。
  // 页面内容离底部还有很大余量，不会被系统手势条压到；成员欢迎页仍用上面的默认值
  padding-bottom: 0;
}

.welcome:not(.welcome--visitor) {
  background-image: url("@/assets/img/icon-bg-login.jpeg");
}

/* ===== 深色主题：容器底 =====
   游客欢迎页的深色底（Ardot 1193:4280 #0D0D0D）由 visitor.vue 自己铺在内容区，
   顶部安全区是这里的 padding，不一起换底就会在刘海处露出 #FAFAFA 白带。
   成员欢迎页用的是深色登录图，深底不影响观感，保持原样。 */
.welcome--dark.welcome--visitor {
  background: #0d0d0d;
  color: #ffffff;
}
</style>

<script setup>
import { computed } from "vue";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useUserStore } from "@/stores";
import AiWelcomeMember from "./member.vue";
import AiWelcomeVisitor from "./visitor.vue";

defineOptions({
  name: "AiWelcome",
});

const emit = defineEmits(["start-chat"]);
const userStore = useUserStore();
const { safeAreaStyle } = useSafeArea();
const isVisitor = computed(() => userStore.isVisitor === true);

function onStartChat() {
  emit("start-chat");
}
</script>

<template>
  <view class="welcome" :class="{ 'welcome--visitor': isVisitor }" :style="safeAreaStyle">
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
  padding-bottom: 0;
  overflow: hidden;
  color: #fff;
  background-position: center;
  background-size: cover;
  font-family: "PingFang SC", sans-serif;
}

.welcome--visitor {
  background-image: url("@/assets/img/icon-bg-visitor.jpeg");
}

.welcome:not(.welcome--visitor) {
  background-image: url("@/assets/img/icon-bg-login.jpeg");
}
</style>

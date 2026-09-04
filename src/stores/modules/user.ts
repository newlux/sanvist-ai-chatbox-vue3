import type { AwakeningPrompt } from "@/api/user-role/role-options";
import { defineStore } from "pinia";
import { ref } from "vue";
import { VISITOR_ROLE_CACHE_KEY } from "@/config";

export type VisitorRole = "OWNER" | "OPERATOR" | "ADMIN" | "MAINTAINER" | "PURCHASER";

export const VISITOR_ROLE_ACCOUNTS: Record<VisitorRole, string> = {
  OWNER: "BOSS-001",
  ADMIN: "DISPATCHER-001",
  MAINTAINER: "MAINTAINER-001",
  PURCHASER: "PURCHASER-001",
  OPERATOR: "OPERATOR-001",
};

export const useUserStore = defineStore("user", () => {
  const isVisitor = ref<boolean | null>(null);
  const visitorRole = ref<VisitorRole | null>(null);
  const userId = ref("");
  const username = ref("");
  const userInfo = ref<Record<string, unknown>>({});
  const awakeningPrompt = ref<AwakeningPrompt | null>(null);

  function setIsVisitor(value: boolean | null) {
    isVisitor.value = value;
  }

  function setVisitorRole(value: VisitorRole | null) {
    visitorRole.value = value;
    if (value) {
      userId.value = VISITOR_ROLE_ACCOUNTS[value];
      uni.setStorageSync(VISITOR_ROLE_CACHE_KEY, value);
    } else {
      uni.removeStorageSync(VISITOR_ROLE_CACHE_KEY);
    }
  }

  function restoreVisitorRole() {
    const cachedRole = uni.getStorageSync(VISITOR_ROLE_CACHE_KEY);
    if (typeof cachedRole === "string" && cachedRole in VISITOR_ROLE_ACCOUNTS) {
      setVisitorRole(cachedRole as VisitorRole);
    }
  }

  function setUserId(value: string) {
    userId.value = value;
  }

  function setUsername(value: string) {
    username.value = value;
  }

  function setUserInfo(value: Record<string, unknown>) {
    userInfo.value = value;
  }

  function setAwakeningPrompt(value: AwakeningPrompt | null) {
    awakeningPrompt.value = value;
  }

  return {
    isVisitor,
    visitorRole,
    userId,
    username,
    userInfo,
    awakeningPrompt,
    setIsVisitor,
    setVisitorRole,
    restoreVisitorRole,
    setUserId,
    setUsername,
    setUserInfo,
    setAwakeningPrompt,
  };
});

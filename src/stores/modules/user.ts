import type { AwakeningPrompt } from "@/api/user-role/role-options";
import { defineStore } from "pinia";
import { ref } from "vue";

export type VisitorRole = "OWNER" | "OPERATOR" | "ADMIN" | "MAINTAINER" | "PURCHASER";

export const VISITOR_ROLE_ACCOUNTS: Record<VisitorRole, string> = {
  OWNER: "mock-boss-001",
  ADMIN: "mock-dispatcher-001",
  MAINTAINER: "mock-maintainer-001",
  PURCHASER: "mock-purchaser-001",
  OPERATOR: "mock-operator-001",
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
    setUserId,
    setUsername,
    setUserInfo,
    setAwakeningPrompt,
  };
});

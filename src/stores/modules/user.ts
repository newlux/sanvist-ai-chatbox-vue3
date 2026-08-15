import { defineStore } from "pinia";
import { ref } from "vue";

export type VisitorRole = "OWNER" | "ADMIN" | "MAINTAINER" | "PURCHASER" | "OPERATOR";

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

  return {
    isVisitor,
    visitorRole,
    userId,
    username,
    userInfo,
    setIsVisitor,
    setVisitorRole,
    setUserId,
    setUsername,
    setUserInfo,
  };
});

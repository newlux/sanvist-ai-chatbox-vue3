import { createPinia } from "pinia";

const store = createPinia();
export default store;

export * from "./modules/chat";
export * from "./modules/session";
export * from "./modules/system";
export * from "./modules/user";

import { createPinia } from "pinia";

const store = createPinia();
export default store;

export * from "./modules/system";
export * from "./modules/user";

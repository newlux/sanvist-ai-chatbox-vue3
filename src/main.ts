import * as Pinia from "pinia";
import VConsole from "vconsole";
import { createSSRApp } from "vue";
import App from "./App.vue";
import i18n from "./i18n";
import store from "./stores";
import "./uni.scss";
import "uno.css";

export function createApp() {
  const app = createSSRApp(App);
  app.use(store);
  app.use(i18n);

  if (import.meta.env.DEV) {
    void new VConsole();
  }

  return {
    app,
    Pinia,
  };
}

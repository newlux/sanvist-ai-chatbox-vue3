import * as Pinia from "pinia";
import VConsole from "vconsole";
import { createSSRApp } from "vue";
import App from "./App.vue";
import i18n from "./i18n";
import store from "./stores";
import "./uni.scss";
// import "uno.css";

export function createApp() {
  const app = createSSRApp(App);
  app.use(store);
  app.use(i18n);

  // TODO: 真机调试期间写死开启；调试完成后恢复为 resolveVConsoleEnabled() 判断
  void new VConsole();

  return {
    app,
    Pinia,
  };
}

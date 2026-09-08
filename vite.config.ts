import path from "node:path";
import process from "node:process";
import { defineConfig, loadEnv } from "vite";

import plugins from "./.build/plugins";

// https://vite.dev/config/
export default defineConfig((cnf) => {
  const { mode } = cnf;
  const env = loadEnv(mode, process.cwd());
  const { VITE_WEB_ENV } = env;

  return {
    base: VITE_WEB_ENV === "production" ? "/" : "/",
    server: {
      host: "0.0.0.0",
    },
    plugins: plugins(cnf),
    build: {
      // 低端安卓 WebView 对 ES2019+ 语法支持不全，统一降级输出，
      // 避免三方依赖里的新语法（可选链之后的语法糖、类静态块等）直通到产物里
      target: "es2018",
    },
    css: {
      preprocessorOptions: {
        scss: {
          silenceDeprecations: ["legacy-js-api"],
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});

import path from "node:path";
import { defineConfig } from "vite";

import plugins from "./.build/plugins";

// https://vite.dev/config/
export default defineConfig((cnf) => {
  return {
    /**
     * 资源公共基础路径用**相对路径**（原来是写死的 `/`）。
     *
     * `base: "/"` 时产物里是 `<script src="/assets/index-xxx.js">`，浏览器从域名根目录去找，
     * 整包只能部署在根路径，放子目录（如 https://host/app/h5/）就 404 白屏。
     * 改成 `./` 后是 `<script src="./assets/index-xxx.js">`，相对 index.html 所在目录，
     * 任意子路径都能直接跑。
     *
     * 前提：路由是 hash 模式（src/manifest.json 的 h5.router.mode = "hash"），
     * URL 的路径层级不会变，`./` 永远相对 index.html；若将来改 history 模式需重新评估。
     */
    base: "./",
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

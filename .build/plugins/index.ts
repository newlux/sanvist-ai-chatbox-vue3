import type { ConfigEnv, PluginOption } from "vite";
import path from "node:path";
import * as uniModule from "@dcloudio/vite-plugin-uni";
import { codeInspectorPlugin } from "code-inspector-plugin";
// import UnoCSS from "unocss/vite";
import AutoImport from "unplugin-auto-import/vite";
import { loadEnv } from "vite";
import envTyped from "vite-plugin-env-typed";
import { h5PostBuild } from "./h5-post-build";
import createSvgIcon from "./svg-icon";

const root = path.resolve(__dirname, "../../");
const uni = (uniModule.default as unknown as { default: () => PluginOption[] }).default;

function plugins({ mode, command }: ConfigEnv): PluginOption[] {
  const env = loadEnv(mode, root);

  return [
    // UnoCSS(),
    envTyped({
      mode,
      envDir: root,
      envPrefix: "VITE_",
      filePath: path.join(root, "types", "import_meta.d.ts"),
    }),
    uni(),
    AutoImport({
      imports: ["vue"],
      eslintrc: {
        enabled: true,
      },
      dts: path.join(root, "types", "auto-imports.d.ts"),
    }),
    createSvgIcon(command === "build"),
    h5PostBuild({ outDirName: env.VITE_H5_OUT_DIR }),
    codeInspectorPlugin({
      bundler: "vite",
    }),
  ];
}

export default plugins;

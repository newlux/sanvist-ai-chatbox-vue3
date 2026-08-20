import type { ConfigEnv, PluginOption } from "vite";
import path from "node:path";
import * as uniModule from "@dcloudio/vite-plugin-uni";
import { codeInspectorPlugin } from "code-inspector-plugin";
import AutoImport from "unplugin-auto-import/vite";
import envTyped from "vite-plugin-env-typed";

const root = path.resolve(__dirname, "../../");
const uni = (uniModule.default as unknown as { default: () => PluginOption[] }).default;

function plugins({ mode }: ConfigEnv): PluginOption[] {
  return [
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
    codeInspectorPlugin({
      bundler: "vite",
      editor: "codebuddy",
    }),
  ];
}

export default plugins;

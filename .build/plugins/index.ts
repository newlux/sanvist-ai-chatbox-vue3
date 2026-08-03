import type { ConfigEnv, PluginOption } from 'vite';
import path from 'node:path';
import * as uniModule from '@dcloudio/vite-plugin-uni';
import { codeInspectorPlugin } from 'code-inspector-plugin';
import UnoCSS from 'unocss/vite';
import AutoImport from 'unplugin-auto-import/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import Components from 'unplugin-vue-components/vite';
import envTyped from 'vite-plugin-env-typed';
import createSvgIcon from './svg-icon';

const root = path.resolve(__dirname, '../../');
const uni = (uniModule.default as { default: () => PluginOption[] }).default;

function plugins({ mode, command }: ConfigEnv): PluginOption[] {
  return [
    UnoCSS(),
    envTyped({
      mode,
      envDir: root,
      envPrefix: 'VITE_',
      filePath: path.join(root, 'types', 'import_meta.d.ts'),
    }),
    uni(),
    AutoImport({
      imports: ['vue'],
      eslintrc: {
        enabled: true,
      },
      resolvers: [ElementPlusResolver()],
      dts: path.join(root, 'types', 'auto-imports.d.ts'),
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: path.join(root, 'types', 'components.d.ts'),
    }),
    createSvgIcon(command === 'build'),
    codeInspectorPlugin({
      bundler: 'vite',
    }),
  ];
}

export default plugins;

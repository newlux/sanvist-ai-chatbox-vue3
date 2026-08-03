import path from 'node:path';
import process from 'node:process';
import { defineConfig, loadEnv } from 'vite';
import plugins from './.build/plugins';

// https://vite.dev/config/
export default defineConfig((cnf) => {
  const { mode } = cnf;
  const env = loadEnv(mode, process.cwd());
  const { VITE_APP_ENV, VITE_WEB_BASE_API, VITE_PROXY_TARGET } = env;
  return {
    base: VITE_APP_ENV === 'production' ? '/' : '/',
    plugins: plugins(cnf),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    css: {
      // css全局变量使用，@/styles/variable.scss文件
      preprocessorOptions: {
        scss: {
          additionalData: '@use "@/styles/var.scss" as *;',
        },
      },
    },
    // 浏览器缓存问题
    server: {
      headers: {
        'Cache-Control': 'no-store',
      },
      proxy: {
        [VITE_WEB_BASE_API]: {
          target: VITE_PROXY_TARGET,
          changeOrigin: true,
          rewrite: (path) => path.replace(new RegExp(`^${VITE_WEB_BASE_API}`), ''),
        },
      },
    },
  };
});

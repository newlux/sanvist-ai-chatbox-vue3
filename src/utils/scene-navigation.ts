import { closeWebview, openWebview } from '@/utils/platform/mpaas';

// 只透传应用初始化需要的字段，不带旧页面的 sessionId 等业务参数。
const startupKeys = [
  'Authorization',
  'Lang',
  'lang',
  'country',
  'version',
  'username',
  'Timezone',
  'DemoMode',
  'baseUrl',
  'statusBarHeight',
  'StatusBarHeight',
  'CountryCode-User',
  'CountryCode-Position',
  'pageName',
];
let startupQuery: Record<string, unknown> = {};
let opening = false;

export function setSceneStartupQuery(query: Record<string, unknown>) {
  startupQuery = { ...query };
}

/** 当前 H5 使用 hash 路由，保留离线包入口路径及部署子目录。 */
export function buildSceneWindowUrl(route: string, href: string) {
  const url = new URL(href);
  const [path, query = ''] = route.split('?');
  const params = new URLSearchParams();
  for (const key of startupKeys) {
    const value = startupQuery[key];
    if (value != null) params.set(key, String(value));
  }
  new URLSearchParams(query).forEach((value, key) => params.set(key, value));
  params.set('nativeSceneWindow', '1');
  url.search = '';
  url.hash = `${path}?${params}`;
  return url.href;
}

export async function navigateToScene(url: string) {
  if (opening) return;
  opening = true;
  try {
    const fallback = () => uni.navigateTo({ url });
    if (typeof location === 'undefined') fallback();
    else await openWebview(buildSceneWindowUrl(url, location.href), fallback);
  } finally {
    // 防止连续点击在 bridge 等待或原生转场期间重复开窗。
    setTimeout(() => {
      opening = false;
    }, 600);
  }
}

export function isSceneWindowRoot() {
  return startupQuery.nativeSceneWindow === '1' && getCurrentPages().length <= 1;
}

export function backFromScene() {
  const fallback = () => {
    if (getCurrentPages().length > 1) uni.navigateBack({ delta: 1 });
    else uni.redirectTo({ url: '/pages/index/index' });
  };
  if (isSceneWindowRoot()) void closeWebview().catch(fallback);
  else fallback();
}

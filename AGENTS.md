## 架构

本项目的运行形态是**以 H5 内嵌在宿主 App 的 mPaaS WebView 里**（非支付宝小程序）。前端由 uni-app 编译为 H5，原生能力统一通过 `AlipayJSBridge`（mPaaS JSAPI）调用，所有原生调用都必须能优雅降级回 Web 方案。

### 技术栈

- 使用组合式 API（`<script setup>`）的 **Vue 3**
- 用于类型安全的 **TypeScript**
- 用于运行期状态管理的 **Pinia**；持久化数据使用 `uni.setStorage` 管理
- 富文本渲染使用 **markdown-it + mp-html**；图表用 **echarts + html2canvas**
- 网络请求统一走 `src/utils/request.ts`（底层是 `uni.request` / `uni.uploadFile`）
- 流式对话走 **fetch + SSE**（`AbortController` + `ReadableStream`），无需 WebSocket
- mPaaS 原生能力封装在 `src/utils/platform/mpaas.ts`（`AlipayJSBridge`）

### 目录结构

```
src/
├── api/ # API 模块（chat、user-role）及类型定义
├── assets/ # 静态资源（img 下的图标）
├── components/ # 业务组件（气泡、输入栏、头部、消息列表、海报等）
│   └── ai-bubble-v2/ # AI 气泡渲染器 + blocks（Answer/Think/Chart/Table/Metric 等）
├── config/ # 应用配置常量
├── hooks/ # 自定义组合式函数（useChatStream、useChatSend、useChatShare、useChatTts 等）
├── i18n/ # 国际化与远程语言包合并
├── pages/ # 页面（index 主对话、chat 智能体对话、role-select 角色选择）
├── stores/ # Pinia 状态仓库（user、system、chat、session）
├── utils/
│   ├── ai-stream/ # SSE 解析、block 折叠、节流提交
│   ├── platform/ # http-request（uni.request 封装）、mpaas（AlipayJSBridge）
│   └── request.ts # 统一请求入口
├── uni_modules/ # 第三方 uni 插件（uni-popup、uni-transition、z-paging）
└── main.ts # 应用入口
```

### 关键模式

**API 层**（`src/api/`）：

- 每个模块使用 `index.ts` 编写 API 调用，使用 `types.ts` 定义 TypeScript 接口
- 统一从 `@/utils/request` 导入 `request`，用 `request.get(...).json()`、`request.post(...).json()`、`request.upload(...).json()` 发起请求
- `request` 会剥掉 `{ code, message, data }` 外层，调用方拿到的直接是 `data`；分页接口拿到的是 `{ limit, hasMore, data: [] }`，**不要再多剥一层**
- 应用启动时在 `App.vue` 调用 `setRequestAuth` / `setRequestBaseURL` 注入 token 与地址；请求模块不直接依赖 Pinia 或 uni Storage
- 鉴权失效只对 401 触发（403 是「游客模式权限不足」这类正常业务响应），并发 401 时 1 秒内只通知一次

**流式对话**（`src/hooks/useChatStream.ts` + `src/utils/ai-stream/`）：

- 浏览器环境用 `fetch` POST `/chat/send` 直接消费 SSE（`response.body.getReader()`）；个别 WebView 不暴露 `ReadableStream` 时退化成一次性读取整包再解析
- SSE 事件先经 `chatStreamParser` 折叠成 blocks（answer / think / suggestion / chart / table / metric），再经 `streamFlusher` 按固定节奏提交快照，避免高频 setData
- 静默超时（距上一个事件超过阈值）与传输层总超时分开处理；端上先判超时会 abort 连接，需大于网关 `algorithm.idle-timeout-ms`
- 会话切换 / 停止生成通过 `requestSeq` 作废在途流，旧回包按消息 `id`（而非下标）patch，避免串写

**状态管理**（`src/stores/`）：

- 状态仓库使用组合式 API 风格的 `defineStore`，仅管理运行期状态
- `user` / `system` 管身份与设备信息；`chat` / `session` 管对话消息与会话列表
- `chat` 按「会话域」（scope）动态建 store：首页（`main`）与智能体页（`subagent`）各持一份消息，通过 `provideChatScope` / `useChatScope` 区分，来回切换互不干扰
- token、用户信息等需要保留的数据通过 `uni.setStorage` / `uni.getStorage` 读写；同一份数据不得由 Pinia 与存储 API 重复持久化

**mPaaS 桥接**（`src/utils/platform/mpaas.ts`）：

- 页面脚本先执行、bridge 后注入是常态，必须监听 `AlipayJSBridgeReady`，不能假设一上来就有；所有调用都能优雅降级回 Web 方案
- 原生事件订阅同时挂 `AlipayJSBridge.on` 和 DOM 事件两条通道，宿主用哪条不确定
- 已封装能力：录音（microphoneStart/End/Play/Pause）、选图（imageChoose）、存相册（saveImageToAlbum）、权限申请（requestPermission）、设置标题（setTitle）、关闭 WebView（popWindow）、token 过期通知（tokenExpiration）
- 启动参数（Authorization、Lang、country、baseUrl、statusBarHeight 等）由宿主通过 launch query 注入，`App.vue` 的 `onLaunch` 里解析并写入 store / request

**uni API 使用范围**：

- 网络请求（含 SSE / 文件上传）统一走 `src/utils/request.ts`，不要在业务代码里直接调 `uni.request`
- `uni.uploadFile` 在支付宝容器下必须带 `fileType`，`request.upload` 已封装
- 需要跨页面、重启后保留的轻量数据使用 `uni.setStorage` / `uni.getStorage` / `uni.removeStorage`；不存储密码、验证码等敏感数据，也不存储图片、文件或大量聊天记录
- 页面跳转、返回及页面栈操作使用 `uni.navigateTo`、`uni.redirectTo`、`uni.navigateBack` 等 uni 导航 API
- 跨端 UI 反馈与设备能力优先使用 `uni.*` API，例如 `uni.showToast`、`uni.showLoading`、`uni.showModal`、`uni.getSystemInfo`
- 原生能力走 mPaaS JSBridge；标准浏览器能力（fetch、AbortController、document、ResizeObserver、FileReader 等）在 H5 形态下可直接使用

### 环境变量

在 `.env.development` / `.env.production` 中配置：

- `VITE_WEB_ENV`：环境标识（development / production）
- `VITE_H5_OUT_DIR`：H5 产物目录名
- `VITE_LOG_LEVEL`：日志级别（debug / info / warn / error / silent）
- `VITE_AI_QUESTION_BASE_URL`：后端 API 基础地址
- `VITE_STATIC_BASE_URL`：远程语言包地址

### 代码风格

- 使用 `@antfu/eslint-config` 配置 ESLint
- Vue 区块顺序：script → template → style
- 使用单引号、分号和 2 空格缩进
- 提交信息遵循 Conventional Commits，并由 commitlint 校验

## 架构

主打包目标是**支付宝小程序（mp-alipay）**，H5 为次要目标。任何新代码都要先确认在支付宝小程序里可用。

### 技术栈

- 使用组合式 API（`<script setup>`）的 **Vue 3**
- 用于类型安全的 **TypeScript**
- 用于运行期状态管理的 **Pinia**；持久化数据使用 `uni.setStorage` 管理
- 富文本渲染使用 **markdown-it + mp-html**
- 网络请求统一走 `src/utils/request.ts`（底层是 `uni.request` / `uni.uploadFile` / `uni.connectSocket`）

### 目录结构

```
src/
├── api/ # API 模块（chat、user-role）及类型定义
├── assets/ # 静态资源（img 下的图标）
├── common/ # 尚未迁移完的遗留 GCP 接口层（不要新增）
├── components/ # 业务组件（气泡、输入栏、头部、海报等）
├── config/ # 应用配置常量
├── hooks/ # 自定义组合式函数（useChatStream、useSafeArea）
├── i18n/ # 国际化与远程语言包
├── pages/ # 页面（index 聊天页、role-select 角色选择页）
├── stores/ # Pinia 状态仓库（user、system、chat、session）
├── utils/
│   ├── ai-stream/ # SSE 事件解析、block 折叠、节流提交
│   ├── platform/ # 支付宝专属实现（request/socket/stream/poster）
│   ├── fetch/ # 遗留 gcpFetch（不要新增）
│   └── request.ts # 统一请求入口
└── main.ts # 应用入口
```

### 关键模式

**API 层**（`src/api/`）：

- 每个模块使用 `index.ts` 编写 API 调用，使用 `types.ts` 定义 TypeScript 接口
- 统一从 `@/utils/request` 导入 `request`，用 `request.get(...).json()`、`request.post(...).json()`、`request.upload(...).json()` 发起请求
- `request` 会剥掉 `{ code, message, data }` 外层，调用方拿到的直接是 `data`；分页接口拿到的是 `{ limit, hasMore, data: [] }`，**不要再多剥一层**
- 应用启动时在 `App.vue` 调用 `setRequestAuth` / `setRequestBaseURL` 注入 token 与地址；请求模块不直接依赖 Pinia 或 uni Storage

**流式对话**（`src/hooks/useChatStream.ts` + `src/utils/ai-stream/`）：

- 支付宝的 `my.request` 不支持分块响应，真流式只能走 WebSocket（`VITE_AI_CHAT_WS_PATH`）
- WebSocket 握手失败或未收到任何事件时，自动回落到 HTTP 整包响应
- SSE 事件先折叠成 blocks，再按固定节奏提交快照，避免高频 setData

**状态管理**（`src/stores/`）：

- 状态仓库使用组合式 API 风格的 `defineStore`，仅管理运行期状态
- `user` / `system` 管身份与设备信息；`chat` / `session` 管对话消息与会话列表
- token、用户信息等需要保留的数据通过 `uni.setStorage` / `uni.getStorage` 读写；同一份数据不得由 Pinia 与存储 API 重复持久化

**uni API 使用范围**：

- 网络请求（含 SSE / WebSocket / 文件上传）统一走 `src/utils/request.ts`，不要在业务代码里直接调 `uni.request`
- `uni.uploadFile` 在支付宝下必须带 `fileType`，`request.upload` 已封装
- 需要跨页面、重启后保留的轻量数据使用 `uni.setStorage` / `uni.getStorage` / `uni.removeStorage`；不存储密码、验证码等敏感数据，也不存储图片、文件或大量聊天记录
- 页面跳转、返回及页面栈操作使用 `uni.navigateTo`、`uni.redirectTo`、`uni.navigateBack` 等 uni 导航 API
- 跨端 UI 反馈与设备能力优先使用 `uni.*` API，例如 `uni.showToast`、`uni.showLoading`、`uni.showModal`、`uni.getSystemInfo`
- mPaaS 专属能力通过其 JSBridge 调用；仅限 H5 的标准浏览器能力必须放在 `// #ifndef MP-ALIPAY` 条件编译块内

**支付宝小程序禁区**：

- 不支持内联 SVG 元素（`<svg>` / `linearGradient` / `animate` 等），动效用 CSS 实现
- 不支持 DOM API（`document`、`ResizeObserver`、`FileReader`、`fetch`、`AbortController`）
- `v-for` 的 `:key` 必须写在 `<template v-for>` 上，否则编译不出 `a:key`，动态组件列表会错位

### 环境变量

在 `.env.development` / `.env.production` 中配置：

- `VITE_AI_QUESTION_BASE_URL`：后端 API 基础地址
- `VITE_AI_CHAT_WS_PATH`：对话 WebSocket 路径，留空则只走 HTTP
- `VITE_STATIC_BASE_URL`：远程语言包地址
- `VITE_H5_OUT_DIR`：H5 产物目录名

### 代码风格

- 使用 `@antfu/eslint-config` 配置 ESLint
- Vue 区块顺序：script → template → style
- 使用单引号、分号和 2 空格缩进
- 提交信息遵循 Conventional Commits，并由 commitlint 校验

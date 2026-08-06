## 架构

### 技术栈
- 使用组合式 API（`<script setup>`）的 **Vue 3**
- 用于类型安全的 **TypeScript**
- 用于运行期状态管理的 **Pinia**；持久化数据使用 `uni.setStorage` 管理
- 用于 UI 组件的 `uni-ui`
- 用于原子化 CSS 的 **UnoCSS**
- 支持 SSE 的 **hook-fetch** HTTP 请求库

### 目录结构

```
src/
├── api/           # API 模块（认证、聊天、模型、会话）及类型定义
├── assets/        # 静态资源（按类别组织的 SVG 图标）
├── components/    # 可复用组件（如 LoginDialog、ModelSelect）
├── config/        # 应用配置常量
├── hooks/         # 自定义 Vue 组合式函数
├── layouts/       # 布局组件（LayoutVertical、LayoutMobile）
├── pages/         # 页面组件（聊天页、错误页）
├── stores/        # Pinia 状态仓库（用户、聊天、会话、模型、设计）
├── styles/        # 全局 SCSS 样式与变量
├── utils/         # 工具函数（请求封装、Markdown 渲染器）
└── main.ts        # 应用入口
```

### 关键模式

**API 层**（`src/api/`）：
- 每个模块使用 `index.ts` 编写 API 调用，使用 `types.ts` 定义 TypeScript 接口
- 使用集成 JWT 插件的 `hook-fetch` 进行认证
- 通过环境变量 `AI_QUESTION_BASE_URL` 配置基础地址
- API 模块从 `@/utils/request` 导入 `request`；使用 `request.get(...).json()`、`request.post(...).json()` 等方法发起 JSON 请求
- 登录或应用启动时调用 `setRequestAuth` 注入 token 与 ClientID；请求模块不直接依赖 Pinia 或 uni Storage

**状态管理**（`src/stores/`）：
- 状态仓库使用组合式 API 风格的 `defineStore`，仅管理运行期状态
- token、用户信息等需要保留的数据通过 `uni.setStorage` / `uni.getStorage` 读写；同一份数据不得由 Pinia 与存储 API 重复持久化
- 会话仓库负责带分页的聊天会话管理
- 聊天仓库管理消息与深度思考状态

**HTTP 请求**（`src/utils/request.ts`）：
- 自动注入 `Bearer` token 请求头
- 处理 401（退出登录）和 403（重定向）响应
- 通过 `sseTextDecoderPlugin` 支持 SSE 流式响应

**uni API 使用范围**：
- 应用运行于支付宝 mPaaS WebView 的 H5 环境；网络请求（含 SSE）统一使用 `hook-fetch`，不使用 `uni.request`
- 需要跨页面、重启后保留的轻量数据使用 `uni.setStorage` / `uni.getStorage` / `uni.removeStorage`；不存储密码、验证码等敏感数据，也不存储图片、文件或大量聊天记录
- 页面跳转、返回及页面栈操作使用 `uni.navigateTo`、`uni.redirectTo`、`uni.navigateBack` 等 uni 导航 API
- 跨端 UI 反馈与设备能力优先使用 `uni.*` API，例如 `uni.showToast`、`uni.showLoading`、`uni.showModal`、`uni.getSystemInfo`
- mPaaS 专属能力通过其 JSBridge 调用；仅限 H5 的标准浏览器能力可直接使用 Web API

### 环境变量

在 `.env.development` 中配置：
- `AI_QUESTION_BASE_URL`：后端 API 基础地址
- `VITE_CLIENT_ID`：认证客户端标识
- `VITE_WEB_TITLE`：页面标题

### 代码风格

- 使用 `@antfu/eslint-config` 配置 ESLint
- Vue 区块顺序：script → template → style
- 使用单引号、分号和 2 空格缩进
- 提交信息遵循 Conventional Commits，并由 commitlint 校验

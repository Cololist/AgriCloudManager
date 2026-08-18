# 云上农管家（AgriCloudManager）

面向种植户的 uni-app 应用，包含作物管理、行情与未来七天价格预测、销路匹配、AI 问诊、语音能力和营销文案生成。生产 API 为 `https://ysngj.cn/api`。

## 仓库内容

- `src/`：uni-app / Vue 3 前端源码、页面、组件、字体和图片资源。
- `backend/`：Node.js API、SQLite 数据结构、行情采集与生产验证脚本。
- `model-service/`：价格预测服务、算法测试和可公开的历史行情数据。
- `rag/`：知识检索服务配置示例。
- `deploy/`：服务器部署模板、HTTPS Nginx 配置和最终交付清单。
- `package-lock.json`、`backend/package-lock.json`：锁定依赖版本，必须提交。

生产密钥、服务器 SSH 私钥、签名证书、数据库、用户上传、构建缓存和本机私有配置不会进入 Git。

## 环境要求

- Node.js 22 或兼容版本。
- npm。
- 最新稳定版 HBuilderX，用于正式 Android 云打包。
- 有权使用 DCloud AppID `__UNI__A0763C1` 的账号。
- 队伍自己保管的 Android 签名证书、别名和密码。

## 克隆后构建

```bash
git clone <仓库地址>
cd AgriCloudManager
npm ci
npm run build:app
```

构建成功会显示 `DONE Build complete`，App 编译资源位于 `dist/build/app`。H5 验证可执行：

```bash
npm run build:h5
```

前端生产地址已经写入 `.env.app`，队员打包 APK 不需要生产服务器密钥，也不要自行修改 API 地址。

## HBuilderX 正式打包

1. 使用 HBuilderX 打开仓库根目录。
2. 登录有权管理 AppID `__UNI__A0763C1` 的 DCloud 账号。
3. 选择“发行 → 原生 App-云打包”。
4. 只选择 Android，选择 Release/正式包。
5. 包名保持 `cn.ysngj.agricloud`。
6. 使用队伍自己的 Android 签名证书，不使用公共测试证书或调试基座。
7. 可选择 vivo 渠道，并按 HBuilderX 支持情况开启安心打包、防重签。
8. 下载 APK 后记录 SHA-256 和签名证书指纹，并在目标 vivo/iQOO 手机上验收。

更详细的人工操作和真机验收步骤见 [`deploy/FINAL-HANDOFF-2026-08-23.md`](deploy/FINAL-HANDOFF-2026-08-23.md)。

## 本地后端（可选）

打包 APK 不需要启动本地后端。如需开发后端：

```bash
cd backend
npm ci
copy .env.example .env
npm start
```

`.env.example` 只包含配置模板。蓝心、地图、JWT、模型服务等实际密钥必须由负责人通过安全渠道提供，禁止提交到 GitHub。

答辩账号和密码也不保存在公开仓库中，由项目负责人单独提供；这不影响前端构建和 APK 打包。

## 提交前安全要求

- 禁止提交任何 `.env`、`.keystore`、`.jks`、`.pem`、`.key` 文件。
- 禁止提交 `deploy/.rendered/`、`backend/data/*.sqlite`、`backend/public/uploads/`。
- 修改依赖时同步提交对应 `package-lock.json`。
- 提交前至少执行 `npm ci` 和 `npm run build:app`。

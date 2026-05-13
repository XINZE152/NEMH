# 全栈 Monorepo 项目模版

> **使用说明**：将文首标题、简介与下方「占位说明」替换为你的项目信息；端口、包名、接口路径等以各 `package.json` 与代码为准，本文默认值仅作示例。

三端分离的 Web 应用骨架：**用户端（Client）**、**管理后台（Admin）**、**API 服务（Server）**，根目录用脚本聚合各子包（**未使用 npm workspaces**，便于在 Windows 上安装依赖），适合作为中小型业务系统的起点。

---

## 模版定位

| 维度 | 说明 |
|------|------|
| **适用场景** | 内容站点、后台 CMS、带登录管理端的 B 端工具等 |
| **协作方式** | 根目录统一安装依赖，子包职责清晰，便于分工与 CI |
| **扩展方式** | 在 `server/src` 按领域拆文件；前端按页面/模块拆组件；可继续增加 workspace（如 `packages/shared`） |

---

## 架构概览

```
┌─────────────┐     ┌─────────────┐
│   Client    │     │    Admin    │
│  (Vite+React)     │ (Vite+React+UI库)
└──────┬──────┘     └──────┬──────┘
       │  /api 代理        │
       └────────┬─────────┘
                ▼
         ┌─────────────┐
         │   Server    │
         │ Express+DB  │
         └─────────────┘
```

- 开发环境下，前端 dev server 将 **`/api` 代理到后端**，生产环境由网关/Nginx 将同路径转发到 Node。
- 公开读、管理写等权限模型可按业务在服务端中间件中扩展。

---

## 技术栈（可按需替换）

| 层级 | 默认选型 | 备注 |
|------|----------|------|
| 根工程 | 根 `package.json` 聚合脚本、`concurrently`、各子目录独立 `npm install` | 可换 pnpm/yarn、Turborepo 等 |
| 服务端 | Node.js 18+、Express、ESM | 可换 Fastify/Nest 等 |
| 数据与鉴权 | SQLite、JWT、密码哈希 | 可换 PostgreSQL + ORM、Session 等 |
| 用户端 | React 18、Vite 6 | 可换 Vue/Svelte 等 |
| 管理端 | React 18、Vite 6、Ant Design 5 | UI 库可整体替换 |

---

## 仓库结构约定

```
./
├── package.json              # 聚合脚本 dev / build、install:all
├── server/                   # 后端 API
│   ├── package.json
│   ├── src/                    # 建议：入口、db、auth、按业务域拆分路由
│   └── data/                   # 本地数据库等运行时文件（勿提交）
├── inventory-web/              # 新能源材料进销存（静态页 + Vite，对接 server）
│   ├── package.json
│   ├── index.html
│   ├── app.js
│   ├── inventory-api.js
│   └── style.css
├── client/                     # 模版用户端 SPA（占位）
│   ├── package.json
│   └── src/
└── admin/                      # 模版管理端 SPA
    ├── package.json
    └── src/
```

**命名建议**：子包使用 **作用域包名**（如 `@your-scope/server`），与根目录 `npm --prefix server run dev` 等脚本风格保持一致。

---

## 环境要求

- **Node.js**：与根目录及各子包 `engines.node` 一致（本模版为 `>= 18`）。
- **包管理器**：npm 9+ 推荐；根目录执行 `npm run install:all` 安装根与各子包依赖。

---

## 快速开始

```bash
# 在仓库根目录安装根与各子包依赖（推荐）
npm run install:all

# 并行启动 server + client + admin
npm run dev

# 仅本仓库「新能源进销存」：后端 + 业务静态前端（推荐日常联调）
npm run dev:inventory
```

**默认本地地址（可在各包 Vite / Server 配置中修改）**

| 服务 | URL |
|------|-----|
| API | http://localhost:3001 |
| 进销存业务前端（`inventory-web`） | http://localhost:5173 |
| 用户端模版（`client`，占位） | http://localhost:5175 |
| 管理端模版（`admin`） | http://localhost:5174 |

**单独启动某一子包（根目录执行）**

```bash
npm --prefix server run dev
npm --prefix inventory-web run dev
npm --prefix client run dev
npm --prefix admin run dev
```

> 将 `@nodejs/*` 替换为你实际在子包 `package.json` 中声明的 `name`。

**生产构建**

```bash
npm run build
```

**仅启动 API（常用于服务器环境）**

```bash
cd server && npm start
```

---

## 脚本约定（模版规范）

| 位置 | 脚本 | 含义 |
|------|------|------|
| 各子包 | `dev` | 本地开发（含热更新或 watch） |
| 各子包 | `build` | 生产构建或语法检查（纯 Node 服务可用 `node --check` 等） |
| 根目录 | `dev` | 并行调用各子包 `dev` |
| 根目录 | `build` | 按依赖顺序依次 `build` 各子包 |

新增子包时，请同时补齐 `dev` / `build`，并更新根目录脚本。

---

## HTTP API 约定（推荐全行业务沿用）

1. **格式**：默认 `application/json`；错误响应建议统一为 `{ "error": "人类可读说明" }`。
2. **鉴权**：需登录接口使用请求头 `Authorization: Bearer <token>`。
3. **状态码**：`400` 参数问题、`401` 未授权、`404` 资源不存在、`409` 冲突、`500` 服务端错误等语义化使用。

**本仓库示例业务**：提供管理端登录与用户 CRUD、健康检查等；具体路径与字段以 `server/src` 为准，扩展新资源时复制同一套约定即可。

---

## 安全与认证清单

- [ ] 生产环境设置强随机 **`JWT_SECRET`**（或等价密钥配置）。
- [ ] 关闭或修改**默认管理员账号**，避免弱口令入库。
- [ ] 响应中**永不返回**密码哈希等敏感字段。
- [ ] 对外服务启用 **HTTPS**，并限制 CORS 来源（按需由 `cors` 或网关配置）。
- [ ] 数据库文件或连接串**勿提交**到 Git（`.gitignore` 已覆盖常见本地库文件）。

---

## 环境变量（服务端，示例）

| 变量 | 说明 |
|------|------|
| `PORT` | HTTP 监听端口，默认以代码为准（如 `3001`） |
| `JWT_SECRET` | JWT 签名密钥，**生产必填** |

可按业务增加 `DATABASE_URL`、第三方 SDK Key 等，并在 README 本节同步文档化。

---

## 开发规范（模版推荐）

### 工程

- 根目录执行 `npm run install:all`；各子包可有独立 `package-lock.json`，版本以各子包为准。
- `engines`、CI 镜像与本地 Node 版本对齐。

### 前端

- 优先函数组件 + Hooks；路由、请求层与页面分层，便于测试与复用。
- 若项目中存在**路由跳转**（多路径、深链、返回栈等），请在对应前端子包安装并使用 **`react-router-dom`**（如 `BrowserRouter`、`Routes`、`Route`、`NavLink`）。
- 开发期依赖反向代理访问 API；生产使用同源代理或显式 `VITE_*` 基地址（若引入环境变量方案）。

### 后端

- ESM 项目保持 `import`/`export` 一致；路由按业务拆文件，避免单文件过长。
- 数据库访问通过薄封装（如 `run` / `all` / `get`）集中管理，复杂查询再抽 Repository。

### Git

- 忽略 `node_modules`、`dist`、本地数据库与密钥文件。
- 提交说明写清「做了什么、为何」，便于评审与回溯。

---

## 部署要点

1. **构建**：`npm run build`，将 `client/dist`、`admin/dist` 部署到静态资源服务或对象存储。
2. **反向代理**：将浏览器访问的 **`/api`**（或你约定前缀）转发到 Node 进程。
3. **进程守护**：使用 systemd、pm2、K8s 等，保证崩溃自启；数据目录挂载持久卷。
4. **配置**：通过环境变量注入密钥与连接信息，勿写死在仓库中。

本仓库在 `deploy/` 下提供了 **systemd 单元 `nemh-api`**（默认监听 `PORT=8003`，工作目录为仓库下的 `server/`）。首次或单元文件变更后，在服务器**仓库根目录**执行（将路径换成你的部署目录）：

```bash
sudo bash deploy/install-nemh-api-systemd.sh /home/ubuntu/var/www/nemh-app/NEMH
```

脚本会创建 `logs/`、安装 `/etc/systemd/system/nemh-api.service` 并 `enable` + `restart` 服务。

### 服务器常用命令（`nemh-api`）

以下命令在任意目录均可执行；查看日志建议在**仓库根目录**下使用相对路径 `logs/`。

| 操作 | 命令 |
|------|------|
| 拉取代码后重启（使新代码生效） | `sudo systemctl restart nemh-api` |
| 查看运行状态（不分页） | `sudo systemctl status nemh-api --no-pager` |
| 停止 / 启动 | `sudo systemctl stop nemh-api` / `sudo systemctl start nemh-api` |
| 重载 systemd 配置（修改了 `.service` 文件后） | `sudo systemctl daemon-reload` 然后再次 `restart` |
| 实时查看应用日志 | `tail -f logs/api.log`（路径相对仓库根，下同） |
| 查看服务启停时间戳 | `tail -f logs/service.log` |
| 从 journal 看 systemd 汇总输出 | `sudo journalctl -u nemh-api -f` |

**更新代码后的典型顺序**：进入仓库根目录 → `git pull` →（若 `package.json` / lock 有变则对对应子包执行 **`npm ci`**，见下节）→ `sudo systemctl restart nemh-api` → `tail -f logs/api.log` 或 `status` 确认无误。

### 服务器上同步后端与进销存前端（不含拉代码）

以下均在**仓库根目录**执行；`<仓库根目录>`、`<进销存静态站点目录>` 请替换为你本机实际路径（与 Nginx 中 `location` 的 `alias` / `root` 一致）。

**后端（`server/`）**

1. 若 `server/package.json` 或 `package-lock.json` 有变更：在仓库根目录执行 **`npm --prefix server ci`**（推荐；与已提交 lock 严格一致）。若尚未提交 lock 或本地无 lock，再使用 `npm --prefix server install`。
2. 加载新代码：`sudo systemctl restart nemh-api`。

**前端（进销存 `inventory-web/`，部署在子路径时）**

1. 若 `inventory-web/package.json` 或 `package-lock.json` 有变更：在仓库根目录执行 **`npm --prefix inventory-web ci`**（推荐）。要求仓库中的 `package-lock.json` 已与 `package.json` 同步并提交；否则会报错，需在开发机修好锁文件后再部署。
2. 构建：`INVENTORY_BASE=/project3/ npm --prefix inventory-web run build`（将 `/project3/` 换成你线上实际子路径，须与 Vite `base` 及 Nginx 前缀一致。）
3. 将构建产物同步到静态站点目录：  
   `sudo rsync -a --delete <仓库根目录>/inventory-web/dist/ <进销存静态站点目录>/`  
   `sudo chown -R www-data:www-data <进销存静态站点目录>`  
   （运行用户、`chown` 目标以你环境为准。）

**为何服务器上 `package-lock.json` 会被改、如何避免**

- 在 **Linux 服务器**上执行 **`npm install`** 时，npm 可能按当前环境重写锁文件（例如 Vite/Rollup 的可选平台包在 Windows 与 Linux 下元数据不一致，出现删除或新增 `"libc"` 等字段），即使你没有手改文件，Git 也会显示 `package-lock.json` 有变更。
- **推荐**：部署安装依赖时使用 **`npm ci`**，按锁文件安装且**不会**像 `npm install` 那样随意改写 `package-lock.json`。
- **可选**：在 CI 或本机执行 `npm ci` + `build`，只把 **`inventory-web/dist/`** 同步到服务器，则服务器上**无需**再执行 npm 安装，也就不会出现锁文件在服务器上被改动的问题。
- **不能省略的步骤**：若仍在服务器上执行 `vite build`，则**必须**先安装依赖（`npm ci` 或 `npm install`）；不能长期跳过安装直接构建。

**Vite 构建时的脚本提示**：若出现 `index.html` 中 `<script src="/inventory-api.js">`、`app.js` 无法被打包（缺少 `type="module"`）的提示，属于当前「多脚本 + 传统全局」结构的说明性日志，**不影响**生成 `dist/`；除非你要改造成单入口 ESM，否则可忽略。

**说明**：仅重启 `nemh-api` 不会更新浏览器中的 HTML/JS；改前端须完成构建并覆盖静态目录。若只改了 Nginx 配置，再执行 `sudo nginx -t && sudo systemctl reload nginx`。部署后建议浏览器强制刷新（Ctrl+F5），减少旧脚本缓存。

**后端日志环境变量**（可在 `nemh-api.service` 的 `[Service]` 中增加 `Environment=...`）：`LOG_LEVEL`（`debug` / `info` / `warn` / `error`，默认 `info`）、`LOG_HTTP=0`（关闭每条 HTTP 访问日志）、`LOG_AUTH=1` 且 `LOG_LEVEL=debug`（可选的鉴权调试行）。详见 `server/src/logger.js` 文件头注释。

---

## 基于本模版定制时的检查清单

- [ ] 修改根目录与子包 `name`、README 标题与简介。
- [ ] 调整各端端口、代理 `target`、`vite.config` / `index.html` 标题。
- [ ] 替换或扩展数据模型与 REST 路径，并同步前端调用。
- [ ] 落实生产环境变量与密钥管理策略。
- [ ] 按需补充：E2E 测试、Dockerfile、GitHub Actions 等。

---

## 许可证

请根据你的项目替换本节内容（如 MIT、Apache-2.0 或「保留所有权利」）。使用本模版产生的业务与合规责任由使用者自行承担。

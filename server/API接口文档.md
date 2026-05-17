# 新能源材料进销存 — HTTP API 说明

本文档根据 `server/src` 下当前实现整理。浏览器可访问 **`/docs`（Swagger UI）** 与 **`/openapi.json`（OpenAPI 3）** 查看带 Curl 示例与 Try it out 的交互文档；下文为 Markdown 详述，可与规格对照维护。

## 基础信息

| 项 | 说明 |
|----|------|
| 默认地址 | `http://localhost:3001` |
| 端口 | 环境变量 `PORT`，未设置时默认为 `3001` |
| 内容类型 | `Content-Type: application/json` |
| 数据库 | SQLite（`server/data/app.sqlite`），首次启动自动建表 |

### 进销存业务前端（`inventory-web/` 目录，与 `server/` 同仓库）

| 项 | 说明 |
|----|------|
| 开发命令 | 在仓库根目录执行 `npm install` 后 **`npm run dev:inventory`**（同时起后端与本前端），或单独在 `inventory-web/` 下 `npm run dev`（须已另开后端 **3001**） |
| 默认地址 | **http://localhost:5173** |
| 代理 | `inventory-web/vite.config.js` 将 **`/api`**、`/docs`、`/openapi.json` 代理到 **http://127.0.0.1:3001** |
| 开关 | `index.html` 内 `window.__USE_BACKEND_API__ = true` 且 `window.__API_BASE__ = ''` 时使用同源代理；`file://` 打开时设 `__API_BASE__` 为 `http://127.0.0.1:3001` |
| 脚本 | `inventory-api.js`、`app.js`、`style.css`、`index.html` |
| 规格路径 | 从前端到本文档：`../server/API接口文档.md` |
| 分页 | 列表接口 `pageSize` 上限多为 **100**；`refreshAppStateFromServer` 内按页循环直至取完 `total` |

## 认证与角色

### 登录

`POST /api/admin/login` 成功后返回 JWT，有效期 **7 天**。

### 请求头（除明确标注「无需登录」的接口外）

```http
Authorization: Bearer <token>
```

### 角色 `role`

| 值 | 说明 |
|----|------|
| `statistics` | 统计部：用户管理、发布对外统一报价等 |
| `warehouse` | 财务部管理员（展示名）：收货定价、入库录入、出库与磅单解析等 |

登录成功 `user` 含 `roleDisplayName`（如 `财务部管理员`）。内置 `admin` 账号同时拥有统计部与财务部 API 权限。

JWT 内虽含 `role`，服务端每次请求会**按用户 id 从数据库重新读取角色**，改角色后重新请求即可生效。

### 环境变量

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | JWT 签名密钥；生产环境务必设置 |
| `PORT` | 监听端口 |
| `DISABLE_PUBLIC_REGISTER` | 设为 `1` 时关闭 `POST /api/register` 自助注册（返回 403） |
| `BAOCHI_WAREHOUSE_API_URL` | 宝驰库房列表 GET 地址；配置后可用同步接口，默认禁止本地库房增删改 |
| `BAOCHI_WAREHOUSE_API_TOKEN` | 可选，访问宝驰接口的 Bearer Token |
| `BAOCHI_ALLOW_LOCAL_WAREHOUSE_CRUD` | 设为 `1` 时即使配置了宝驰 URL 也允许本地 POST/PUT/DELETE 库房 |
| `TL_API_BASE_URL` | TL 比价系统基址（同机示例 `http://127.0.0.1:8001`）；配置后可同步库房 |
| `TL_API_USERNAME` | TL 登录用户名 |
| `TL_API_PASSWORD` | TL 登录密码 |
| `TL_ALLOW_LOCAL_WAREHOUSE_CRUD` | 设为 `1` 时即使配置了 TL 也允许本地 POST/PUT/DELETE 库房 |
| `TL_API_TIMEOUT_MS` | 可选，请求超时毫秒，默认 30000 |
| `TL_API_TOKEN_REFRESH_MARGIN` | 可选，token 提前刷新秒数，默认 300 |

### 常见 HTTP 状态

| 状态码 | 含义 |
|--------|------|
| 400 | 参数不合法 |
| 401 | 未登录、Token 无效/过期、用户不存在 |
| 403 | 已登录但角色不允许（如「仅统计部可操作」「仅财务部管理员可操作」） |
| 404 | 资源不存在 |
| 409 | 唯一约束冲突（如用户名、单号重复） |
| 500 | 服务器内部错误 |

错误体一般为：`{ "error": "中文说明" }`。

---

## 无需登录

### `GET /api/health`

健康检查。

**响应示例：** `{ "ok": true }`

### `POST /api/admin/login`

管理员登录。

**请求体：**

```json
{
  "username": "admin",
  "password": "admin123"
}
```

**成功 200：** `{ "token": "...", "user": { "id": 1, "username": "admin", "role": "statistics", "roleDisplayName": "统计部" } }`

**失败：** 400（缺字段）、401（用户名或密码错误）、500。

### `POST /api/register`

自助注册（**无需登录、无需 Token**）。

**行为：** 新建用户 **`role` 固定为 `warehouse`（财务部管理员）**；请求体里若带 `role` 会被忽略，**不可**通过本接口注册为统计部。统计部账号仍须由已有统计部用户调用 `POST /api/admin/users` 创建。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | 是 | 去首尾空格后非空，最长 64 字符 |
| `password` | string | 是 | 至少 4 位 |

**成功 201：** 与 `POST /api/admin/users` 成功时类似，返回新建用户对象（含 `id`, `username`, `role`, `created_at`, `updated_at`），不含密码。

**失败：** 400（校验失败）、403（已设置 `DISABLE_PUBLIC_REGISTER=1`）、409（用户名已存在）、500。

注册成功后使用 **`POST /api/admin/login`** 同上表，用新用户名、密码登录即可获取 JWT。

---

## 用户管理（仅 `statistics`）

### `GET /api/admin/users`

用户列表。

**响应：** `User[]`，字段含 `id`, `username`, `role`, `created_at`, `updated_at`（时间戳为 SQLite 文本格式）。

### `POST /api/admin/users`

创建用户。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | 是 | 非空 |
| `password` | string | 是 | 至少 4 位 |
| `role` | string | 否 | `warehouse` 或 `statistics`，默认 `warehouse` |

**成功 201：** 新建用户对象。

**失败：** 400、409（用户名已存在）。

### `PUT /api/admin/users/:id`

更新用户；若 `username`、`password`、`role` 均未传，则**不更新**，直接返回当前用户。

**请求体（均可选）：** `username`, `password`（≥4 位）, `role`。

**成功 200：** 更新后的用户对象。

### `DELETE /api/admin/users/:id`

删除用户。至少保留一个用户。

**成功 204：** 无响应体。

---

## 库房（已登录任意角色）

### `POST /api/admin/warehouses/sync-from-baoche`

从宝驰接口同步库房到本地（需 `BAOCHI_WAREHOUSE_API_URL`）。**成功 200：** `{ ok, synced, total }`。

### `POST /api/admin/warehouses/sync-from-tl`

从 TL 比价系统（`GET /tl/get_warehouses`，只读）同步库房到本地 SQLite。需 `TL_API_BASE_URL`、`TL_API_USERNAME`、`TL_API_PASSWORD`。**成功 200：** `{ ok, synced, total, source: "tl" }`。

### `GET /api/integrations/tl/warehouses`

代理 TL 库房列表（已规范化，不含写操作）。需登录 NEMH 且已配置 TL 环境变量。

### `GET /api/admin/warehouses`

**Query：** `search`（可选）— 按代码、名称、地址模糊匹配；`sync=1` 时若已配置则先执行宝驰/TL 同步再返回列表。

**响应：** 数组，元素为 `{ id, code, name, address, externalSource, externalId, createdAt, updatedAt }`（camelCase）。

### `GET /api/admin/warehouses/:id`

单条库房。

### `POST /api/admin/warehouses`

**请求体：** `code`, `name` 必填；`address` 可选。

### `PUT /api/admin/warehouses/:id`

**请求体：** 可选 `code`, `name`, `address`；若三者均未传则返回当前记录。

### `DELETE /api/admin/warehouses/:id`

删除条件：至少保留一个库房；且该库房下无入库单、无出库单记录。

**成功 204。**

---

## 品种与收货定价

### `GET /api/admin/materials`

品种列表（只读）。已登录即可。

**响应字段示例：** `id`, `code`, `name`, `description`, `createdAt`, `latestPurchaseUnitPrice`, `latestUnifiedQuote`。

### `GET /api/admin/purchase-prices/latest-by-material/:materialId`

某品种**当前生效**的收货定价（按 `entered_at`、`id` 取最新一条）。

**成功 200：** `{ "latest": null }` 或 `{ "latest": { "id", "materialId", "unitPrice", "enteredAt" } }`。

### `GET /api/admin/purchase-prices`

分页列表。

**Query：**

| 参数 | 说明 |
|------|------|
| `page` | 默认 1 |
| `pageSize` | 默认 10，最大 100 |
| `materialId` | 可选，按品种筛选 |
| `keyword` 或 `q` | 可选，品种编码/名称模糊搜索 |

**响应：** `{ "prices": [...], "total", "page", "pageSize" }`。单条含 `materialId`, `materialCode`, `materialName`, `unitPrice`, `enteredAt`, `marketPriceProof`, `receivePriceProof`, `description`, `createdBy`, `creatorUsername`, `pricingNo`（同 `materialCode`）, `priceProof`（同行情凭证）等。

### `GET /api/admin/purchase-prices/:id`

单条收货定价详情。

### `POST /api/admin/purchase-prices`（仅 `warehouse`）

单条创建。

**请求体（支持 camelCase / snake_case 混用）：**

| 逻辑字段 | 别名示例 |
|----------|----------|
| 品种 | `materialId` / `material_id` |
| 单价 | `unitPrice` / `price` / `unit_price`，须 **> 0** |
| 录入时间 | `enteredAt` / `entered_at` / `priceDate` / `price_date` / `entryTime`；不传则当前 ISO 时间 |
| 行情价凭证（URL 或 DataURL 字符串，**可选**；多图可用英文逗号拼接） | `marketPriceProof`, `market_price_proof`, `priceProof`, `行情价凭证` |
| 收货价凭证（**可选**；同上） | `receivePriceProof`, `receive_price_proof`, `selfReceivePriceProof`, `收货价格凭证` |
| 说明 | `description`, `priceDescription`, `价格说明` |

### `POST /api/admin/purchase-prices/batch`（仅 `warehouse`）

同一批凭证、同一 `enteredAt` 下多条「品种 + 单价」。

**请求体：**

```json
{
  "enteredAt": "2026-04-24T08:00:00.000Z",
  "marketPriceProof": "https://...",
  "receivePriceProof": "https://...",
  "description": "可选",
  "lines": [
    { "materialId": 1, "unitPrice": 3200 },
    { "materialId": 2, "price": 3100 }
  ]
}
```

**成功 201：** `{ "count": n, "prices": [...] }`。

### `PUT /api/admin/purchase-prices/:id`（仅 `warehouse`）

部分更新；凭证字段若传入则更新为新值，**允许传空字符串表示清空凭证**。

### `DELETE /api/admin/purchase-prices/:id`（仅 `warehouse`）

**成功 204。**

---

## 对外统一报价（销售价）

### `GET /api/admin/sale-prices`

分页列表；**任意已登录角色**可读。

**Query：** `page`, `pageSize`（≤100）, `materialId`。

**响应：** `{ "prices": [...], "total", "page", "pageSize" }`。单条含 `publishDate`, `quotePrice`, `material`, `quoteType: "unified_market"` 等扩展字段。

### `GET /api/admin/sale-prices/latest/:materialId`

最新一条对外报价；无记录时 `latest` 可能为映射后的空结构（以实际响应为准）。

### `GET /api/warehouse/unified-market-quotes`

与 `GET /api/admin/sale-prices` **相同处理函数**（库房端路径别名）。

### `GET /api/warehouse/unified-market-quotes/latest/:materialId`

与 admin 下 `latest` 行为一致。

### `POST /api/admin/sale-prices`（仅 `statistics`）

发布对外报价。

**请求体：** `materialId` / `material_id`；单价 `unitPrice` / `quotePrice` / `price` / `unit_price`（>0）；发布时间 `publishedAt` / `publishDate` / `published_at`（合法日期字符串，不传为当前时间）。

### `GET /api/admin/sale-prices/:id`

单条详情。

> 当前代码中**无**对外报价的 `PUT`/`DELETE` 路由。

---

## 入库单

### `GET /api/admin/inbound-orders`

**Query：** `page`, `pageSize`（≤100）, `materialId`, `auditStatus`（`pending` | `approved` | `rejected`）。

**响应：** `{ "orders": [...], "total", "page", "pageSize" }`。单条含 `auditStatusText`, `varietyName`, `price`, `inboundPhoto`, `inboundTime`, `latestUnifiedQuote` 等。

### `GET /api/admin/inbound-orders/:id`

详情额外包含：`latestPurchaseUnitPrice`（该品种最新收货定价）。

### `POST /api/admin/inbound-orders`（仅 `warehouse`）

创建入库单（**自动审核通过**，`audit_status` 为 `approved`）。

**规则：** 录入单价必须与该品种**当前最新收货定价**一致（元/吨比较保留两位小数），否则 400 并带 `latestPurchaseUnitPrice`。

**请求体主要字段：**

| 字段 | 说明 |
|------|------|
| `materialId` | 必填 |
| `weight` | 必填，>0 |
| `unitPrice` / `unit_price` / `price` | 必填，>0，且须与最新收货定价一致 |
| `photo` / `inboundPhoto` | 入库照片（URL 或 DataURL 字符串，**可选**；多图可用英文逗号拼接） |
| `inboundAt` / `inbound_at` / `inboundTime` | 可选 |
| `warehouseId` / `warehouse_id` | 可选，默认 `1` |
| `orderNo` / `order_no` | 可选；不传则服务端生成 `RK-YYYYMMDD-####` |

**成功 201。** **409：** 单号重复。

### `PUT /api/admin/inbound-orders/:id`（仅 `warehouse`）

修改入库单。`approved` 且未关联出库 FIFO 时可改；已驳回不可改；若已存在 `outbound_fifo_lines` 关联则不可修改。

**请求体：** 与 `POST` 相同（`materialId`、`weight`、`unitPrice` 必填；`photo` / `inboundPhoto`、`inboundAt`、`warehouseId` 可选）。不传 `photo` / `inboundPhoto` 时保留原照片。

**规则：** 单价须与当前品种最新收货定价一致（同创建）。

**成功 200：** 返回更新后的入库单对象。

### `PUT /api/admin/inbound-orders/:id/approve`（仅 `statistics`）

**兼容接口**：新建入库已自动通过；仅对历史 `pending` 单有效。已为 `approved` 时幂等返回 200。

### `PUT /api/admin/inbound-orders/:id/reject`（仅 `statistics`）

**已关闭**：返回 400，`code`: `INBOUND_AUDIT_DISABLED`。

### `DELETE /api/admin/inbound-orders/:id`（仅 `warehouse`）

物理删除入库单。`approved` 且未关联出库 FIFO 时可删；已驳回不可删。

**成功 204**（无响应体）。

---

## 出库单与磅单

### `POST /api/admin/weighbridge-slip/parse`（仅 `warehouse`）

根据 OCR 文本解析磅单建议（**不调用外部 OCR**，需前端或其它服务提供 `ocrText`）。

**请求体：** `imageUrl` 或 `weighbridgePhoto`；`ocrText` / `ocr_text` / `text`（字符串）。

**响应：** `{ "imageUrl", ...parse结果 }`（具体字段见 `weighbridgeParse.js`）。

### `GET /api/admin/outbound-orders`

**Query：** `page`, `pageSize`（≤100）, `materialId`, `status`（`pending` | `completed`）。

### `GET /api/admin/outbound-orders/:id`

含 `fifoLines`（先进先出子行，含 `inboundAt`、`inboundUnitPrice`、`actualWeight`、`plannedWeight`）；`completedAt` / `outboundTime`（已完成时为 `updatedAt`，含时分秒）；已完成单含 `salesRevenue`（实际重量×出库单价）；另含 `defaultOutboundUnitPrice`。

列表 `GET /api/admin/outbound-orders` 每条同样包含 `completedAt`、`outboundTime`；已完成单含 `salesRevenue`（不含 `fifoLines`，详情接口含完整 `fifoLines`）。

### `POST /api/admin/outbound-orders`（仅 `warehouse`）

创建出库单，`status` 为 `pending`；按 FIFO 自动写 `outbound_fifo_lines`。

**请求体：** `warehouseId`（默认 1）, `materialId`, `plannedWeight`（>0）, `unitPrice`（可选；不传则尝试用当日/最新对外报价）, `orderNo`（可选，不传则生成 `CK-YYYYMMDD-####`）。**禁止** `materialIds` 多品种或 `materials` 数组长度 > 1（`code`: `MULTIPLE_MATERIALS`）。

**失败 400 示例：** 库存不足（`code`: `FIFO_INSUFFICIENT`），体中可能含 `shortfall`、`availableWeight`、`plannedWeight` 等。服务端 `api.log` 中可检索 `nemh.api` 查看 FIFO 明细。

### `PUT /api/admin/outbound-orders/:id/complete`（仅 `warehouse`）

确认实际出库；仅 `pending` 可操作。

**请求体：** `actualWeight` / `actual_weight`（>0）；磅单图 `weighbridgePhoto` / `weighbridge_photo` / `poundSlipPhoto`（必填 URL 字符串）。

### `DELETE /api/admin/outbound-orders/:id`（仅 `warehouse`）

仅 `pending` 可删；会回滚预出库占用并删除 FIFO 行。

**成功 204。**

---

## 库存与预警

### `GET /api/admin/inbound-summary-alerts`

入库汇总预警（库房 + 品种维度）。出库占用重量从 **`outbound_orders` 实时汇总**（与 FIFO 一致），不读 `warehouse_material_outbound` 缓存表。

**Query：**

| 参数 | 说明 |
|------|------|
| `basis` | `actual` 或 `combined`（默认 `combined`） |
| `thresholdTon` / `threshold_ton` | 正数，默认 `30`（吨） |
| `onlyThirtyTonReminder` / `only_thirty_ton_reminder` | `1` 或 `true` 时仅返回累计已审核入库 ≥ 阈值的项 |

**`basis` 扣减规则：**

| `basis` | 扣减重量 | 可用库存（`remainingWeightByBasis`） |
|---------|----------|--------------------------------------|
| `combined` | 已完成 **实际出库** + 待完成 **预出库**（完成出库后预出库回滚，不与实际重复） | 总入库 − 扣减 |
| `actual` | 仅 **实际出库** | 总入库 − 实际出库 |

**响应：** `basis`, `defaultBasis`, `combinedRuleDescription`, `thresholdTon`, `onlyThirtyTonReminder`, `hasInboundTonReminder`, `items`（含 `deductionWeightByBasis`, `combinedOutboundDeductionWeight`, `remainingWeightByBasis` 等）。

### `GET /api/admin/inventory/available-stock`

查询指定库房 + 品种的可出库库存（**FIFO 行级可用量之和**，与 `POST /api/admin/outbound-orders` 库存校验一致）。

**Query（必填）：** `warehouseId` / `warehouse_id`, `materialId` / `material_id`

**响应：** `availableWeight`, `totalApprovedInboundWeight`, `actualOutboundWeight`, `plannedOutboundWeight`, `combinedOutboundDeductionWeight`, `remainingByCombinedBasis`, `remainingByActualBasis`, `fifoLines`（每行 `inboundOrderId`, `availableWeight` 等）。

### `GET /api/admin/reports/profit-summary`

按品种汇总已完成出库的利润（服务端 FIFO 成本，避免仅前端聚合误差）。

**Query（均可选）：** `startDate` / `start_date`, `endDate` / `end_date`（`YYYY-MM-DD`，按出库单 **`updated_at` 日期**筛选完成时间）, `materialId`, `warehouseId`

**响应：** `completedAtBasis`, `totals`（`salesWeight`, `salesRevenue`, `salesCost`, `salesProfit`, `profitMarginPercent`）, `items`（每品种含 `avgSaleUnitPrice` 加权均价、便于与对外报价对照）。

### `GET /api/admin/inventory/warehouse-stock-report`

库房库存报表（按入库单展开，有 FIFO 子单则多行）。

**Query：** `page`（默认 1）, `pageSize`（默认 20，最大 200）, `warehouseId`, `materialId`, `inventoryStatus` / `inventory_status`。

**`inventoryStatus` 合法值：** `pending_audit` | `pending_outbound` | `outbounding` | `partial_outbound` | `fully_outbound`。

**响应：** `{ "rows", "total", "page", "pageSize" }`。

---

## 路由注册顺序说明

Express 按注册顺序匹配。例如 `GET /api/admin/sale-prices/latest/:materialId` 注册在 `GET /api/admin/sale-prices/:id` 之前，避免 `latest` 被当成 `id`。

---

## 与浏览器访问 `/docs` 的说明

服务已挂载 **`GET /docs`**：返回 Swagger UI（静态资源自 jsDelivr CDN 加载），规格来源为 **`GET /openapi.json`**（`server/openapi.json`）。在 Swagger 中展开接口可查看 **Example Value / 响应示例**，使用 **Try it out** 后会出现 **Curl** 与 **Request URL**、**Server response**。若 CDN 不可达，页面可能空白，可改用可访问外网的环境或后续改为本地静态资源。

维护约定：接口行为以 `server/src` 为准；更新接口时请同步修改 **`server/openapi.json`** 与本 Markdown。

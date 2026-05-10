# 数据库模型设计

## 核心实体

### 1. 用户 (User)
- id: 主键
- username: 用户名
- password: 密码（加密）
- email: 邮箱
- realName: 真实姓名
- phone: 电话
- status: 状态（active/inactive）
- createdAt: 创建时间
- updatedAt: 更新时间

### 2. 角色 (Role)
- id: 主键
- name: 角色名称（库房管理员、统计部、系统管理员）
- description: 角色描述
- permissions: 权限列表（JSON数组）

### 3. 用户角色关联 (UserRole)
- userId: 用户ID
- roleId: 角色ID

### 4. 品种 (Material)
- id: 主键
- code: 品种编码（唯一）
- name: 品种名称（如：碳酸锂、磷酸铁锂）
- description: 描述
- status: 状态（active/inactive）
- createdAt: 创建时间

### 5. 库房 (Warehouse)
- id: 主键
- code: 库房编码（唯一）
- name: 库房名称
- address: 详细地址
- managerId: 负责人ID（关联用户）
- status: 状态（active/inactive）
- createdAt: 创建时间

### 6. 收货定价 (PurchasePrice)
- id: 主键
- materialId: 品种ID
- price: 单价（元/吨）
- priceDate: 定价日期
- priceProof: 行情价凭证图片URL
- description: 价格说明
- createdBy: 创建人ID
- createdAt: 创建时间

### 7. 入库单 (InboundOrder)
- id: 主键
- orderNo: 入库单号（RK-YYYYMMDD-XXXX）
- warehouseId: 库房ID
- materialId: 品种ID
- weight: 重量（吨）
- unitPrice: 单价（元/吨）
- totalAmount: 总金额
- inboundDate: 入库时间
- photo: 入库单照片URL
- status: 状态（pending/reviewed/outbounding/partial_outbound/fully_outbound/rejected）
- reviewedBy: 审核人ID
- reviewedAt: 审核时间
- rejectReason: 驳回原因
- createdBy: 创建人ID
- createdAt: 创建时间

### 8. 对外报价 (SalePrice)
- id: 主键
- materialId: 品种ID
- price: 报价（元/吨）
- priceDate: 发布日期
- createdBy: 创建人ID
- createdAt: 创建时间

### 9. 出库单 (OutboundOrder)
- id: 主键
- orderNo: 出库单号（CK-YYYYMMDD-XXXX）
- materialId: 品种ID
- plannedWeight: 预出库重量（吨）
- salePrice: 出库价格（元/吨）
- status: 状态（planned/executing/completed）
- createdBy: 创建人ID
- createdAt: 创建时间

### 10. 出库子单 (OutboundSubOrder)
- id: 主键
- outboundOrderId: 出库单ID
- inboundOrderId: 来源入库单ID
- plannedWeight: 预占重量（吨）
- actualWeight: 实际出库重量（吨）
- weightPhoto: 磅单图片URL
- actualOutboundDate: 实际出库日期
- status: 状态（planned/executed）
- createdBy: 创建人ID
- createdAt: 创建时间

### 11. 库存状态 (InventoryStatus)
- warehouseId: 库房ID
- materialId: 品种ID
- totalWeight: 总入库重量
- availableWeight: 可出库重量
- lockedWeight: 锁定重量（预出库）
- outboundWeight: 已出库重量
- lastUpdated: 最后更新时间

## API接口设计

### 认证相关
- POST /api/auth/login - 用户登录
- POST /api/auth/logout - 用户登出
- GET /api/auth/me - 获取当前用户信息

### 用户管理
- GET /api/users - 获取用户列表
- POST /api/users - 创建用户
- GET /api/users/:id - 获取用户详情
- PUT /api/users/:id - 更新用户
- DELETE /api/users/:id - 删除用户（逻辑删除）
- PUT /api/users/:id/reset-password - 重置密码

### 角色管理
- GET /api/roles - 获取角色列表
- POST /api/roles - 创建角色
- GET /api/roles/:id - 获取角色详情
- PUT /api/roles/:id - 更新角色
- DELETE /api/roles/:id - 删除角色

### 品种管理
- GET /api/materials - 获取品种列表
- POST /api/materials - 创建品种
- GET /api/materials/:id - 获取品种详情
- PUT /api/materials/:id - 更新品种
- DELETE /api/materials/:id - 删除品种（逻辑删除）

### 库房管理
- GET /api/warehouses - 获取库房列表
- POST /api/warehouses - 创建库房
- GET /api/warehouses/:id - 获取库房详情
- PUT /api/warehouses/:id - 更新库房
- DELETE /api/warehouses/:id - 删除库房（逻辑删除）

### 收货定价
- GET /api/purchase-prices - 获取定价列表
- POST /api/purchase-prices - 创建定价
- GET /api/purchase-prices/latest/:materialId - 获取品种最新定价

### 入库单管理
- GET /api/inbound-orders - 获取入库单列表
- POST /api/inbound-orders - 创建入库单
- GET /api/inbound-orders/:id - 获取入库单详情
- PUT /api/inbound-orders/:id/review - 审核入库单
- GET /api/inbound-orders/available/:materialId - 获取可出库的入库单

### 对外报价
- GET /api/sale-prices - 获取报价列表
- POST /api/sale-prices - 发布报价
- GET /api/sale-prices/latest/:materialId - 获取品种最新报价
- GET /api/sale-prices/history/:materialId - 获取品种历史报价

### 出库管理
- GET /api/outbound-orders - 获取出库单列表
- POST /api/outbound-orders - 创建出库计划
- GET /api/outbound-orders/:id - 获取出库单详情
- POST /api/outbound-orders/:id/execute - 执行实际出库
- GET /api/outbound-orders/:id/sub-orders - 获取出库子单

### 库存相关
- GET /api/inventory/status - 获取库存状态
- GET /api/inventory/alerts - 获取库存预警
- GET /api/inventory/report - 获取库存报表
- GET /api/inventory/profit - 获取毛利预估报表
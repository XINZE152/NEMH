const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

// 初始化 Sequelize
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, '../../database.sqlite'),
  logging: false,
});

// 定义模型
const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  username: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  realName: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive'),
    defaultValue: 'active',
  },
}, {
  tableName: 'users',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

const Role = sequelize.define('Role', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  name: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  description: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  permissions: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: [],
  },
}, {
  tableName: 'roles',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

const UserRole = sequelize.define('UserRole', {
  userId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
  },
  roleId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
  },
}, {
  tableName: 'user_roles',
  timestamps: false,
});

const Material = sequelize.define('Material', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  description: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive'),
    defaultValue: 'active',
  },
}, {
  tableName: 'materials',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

const Warehouse = sequelize.define('Warehouse', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  address: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  managerId: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive'),
    defaultValue: 'active',
  },
}, {
  tableName: 'warehouses',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

const PurchasePrice = sequelize.define('PurchasePrice', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  materialId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  priceDate: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  priceProof: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: '行情价凭证图片',
  },
  receivePriceProof: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: '自己收货价格凭证图片',
  },
  description: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
}, {
  tableName: 'purchase_prices',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

const InboundOrder = sequelize.define('InboundOrder', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  orderNo: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  warehouseId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  materialId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  weight: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  unitPrice: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  totalAmount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  inboundDate: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  photo: {
    type: DataTypes.STRING(500),
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('pending', 'reviewed', 'outbounding', 'partial_outbound', 'fully_outbound', 'rejected'),
    defaultValue: 'pending',
  },
  reviewedBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  reviewedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  rejectReason: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
}, {
  tableName: 'inbound_orders',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

const SalePrice = sequelize.define('SalePrice', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  materialId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  priceDate: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
}, {
  tableName: 'sale_prices',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

const OutboundOrder = sequelize.define('OutboundOrder', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  orderNo: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  materialId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  plannedWeight: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  salePrice: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('planned', 'executing', 'completed'),
    defaultValue: 'planned',
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
}, {
  tableName: 'outbound_orders',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

const OutboundSubOrder = sequelize.define('OutboundSubOrder', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  outboundOrderId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  inboundOrderId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  plannedWeight: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  actualWeight: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
  },
  weightPhoto: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  actualOutboundDate: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('planned', 'executed'),
    defaultValue: 'planned',
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
}, {
  tableName: 'outbound_sub_orders',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
});

const InventoryStatus = sequelize.define('InventoryStatus', {
  warehouseId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
  },
  materialId: {
    type: DataTypes.INTEGER,
    primaryKey: true,
  },
  totalWeight: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  availableWeight: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  lockedWeight: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  outboundWeight: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  lastUpdated: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'inventory_status',
  timestamps: false,
});

// 定义关联关系
User.belongsToMany(Role, { through: UserRole, foreignKey: 'userId' });
Role.belongsToMany(User, { through: UserRole, foreignKey: 'roleId' });

Warehouse.belongsTo(User, { foreignKey: 'managerId', as: 'manager' });

PurchasePrice.belongsTo(Material, { foreignKey: 'materialId' });
PurchasePrice.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

InboundOrder.belongsTo(Warehouse, { foreignKey: 'warehouseId' });
InboundOrder.belongsTo(Material, { foreignKey: 'materialId' });
InboundOrder.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
InboundOrder.belongsTo(User, { foreignKey: 'reviewedBy', as: 'reviewer' });

SalePrice.belongsTo(Material, { foreignKey: 'materialId' });
SalePrice.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

OutboundOrder.belongsTo(Material, { foreignKey: 'materialId' });
OutboundOrder.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

OutboundSubOrder.belongsTo(OutboundOrder, { foreignKey: 'outboundOrderId' });
OutboundSubOrder.belongsTo(InboundOrder, { foreignKey: 'inboundOrderId' });
OutboundSubOrder.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

InventoryStatus.belongsTo(Warehouse, { foreignKey: 'warehouseId' });
InventoryStatus.belongsTo(Material, { foreignKey: 'materialId' });

// 导出模型
module.exports = {
  sequelize,
  User,
  Role,
  UserRole,
  Material,
  Warehouse,
  PurchasePrice,
  InboundOrder,
  SalePrice,
  OutboundOrder,
  OutboundSubOrder,
  InventoryStatus,
};
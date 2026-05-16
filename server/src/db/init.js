const { sequelize, User, Role, Material, Warehouse } = require('../models');
const bcrypt = require('bcryptjs');

async function initDatabase() {
  try {
    // 同步数据库
    await sequelize.sync({ force: true });
    console.log('数据库同步完成');

    // 创建初始角色
    const roles = await Role.bulkCreate([
      {
        name: '系统管理员',
        description: '拥有系统所有权限',
        permissions: ['*']
      },
      {
        name: '统计部',
        description: '负责数据审核、报价发布、报表分析',
        permissions: [
          'inbound:review',
          'sale-price:manage',
          'report:view',
          'inventory:view'
        ]
      },
      {
        name: '财务部管理员',
        description: '负责收货定价、入库与出库等操作',
        permissions: [
          'purchase-price:create',
          'inbound:create',
          'outbound:manage',
          'inventory:view'
        ]
      }
    ]);
    console.log('初始角色创建完成');

    // 创建初始用户（管理员）
    const hashedPassword = await bcrypt.hash('admin123', 10);
    const adminUser = await User.create({
      username: 'admin',
      password: hashedPassword,
      email: 'admin@example.com',
      realName: '系统管理员',
      phone: '13800138000',
      status: 'active'
    });

    // 为用户分配角色
    await adminUser.addRole(roles[0]); // 系统管理员角色
    console.log('初始管理员用户创建完成');

    // 创建示例品种
    const materials = await Material.bulkCreate([
      { code: 'CL-001', name: '碳酸锂', description: '电池级碳酸锂' },
      { code: 'LFP-001', name: '磷酸铁锂', description: '正极材料磷酸铁锂' },
      { code: 'NMC-001', name: '三元材料', description: '镍钴锰三元材料' },
      { code: 'GR-001', name: '石墨', description: '负极材料石墨' },
      { code: 'CU-001', name: '铜箔', description: '电池用铜箔' }
    ]);
    console.log('示例品种创建完成');

    // 创建示例库房
    const warehouses = await Warehouse.bulkCreate([
      { code: 'WH-001', name: '北京仓库', address: '北京市朝阳区仓库路1号', managerId: adminUser.id },
      { code: 'WH-002', name: '上海仓库', address: '上海市浦东新区仓库路2号', managerId: adminUser.id },
      { code: 'WH-003', name: '广州仓库', address: '广州市白云区仓库路3号', managerId: adminUser.id }
    ]);
    console.log('示例库房创建完成');

    console.log('数据库初始化完成！');
    console.log('管理员账号: admin');
    console.log('管理员密码: admin123');

  } catch (error) {
    console.error('数据库初始化失败:', error);
    throw error;
  }
}

// 如果直接运行此文件
if (require.main === module) {
  initDatabase()
    .then(() => {
      console.log('初始化完成');
      process.exit(0);
    })
    .catch(error => {
      console.error('初始化失败:', error);
      process.exit(1);
    });
}

module.exports = initDatabase;
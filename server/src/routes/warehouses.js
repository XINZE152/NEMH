const express = require('express');
const router = express.Router();
const { Warehouse, User } = require('../models');
const { authenticate, checkPermission } = require('../middleware/auth');

// 获取库房列表
router.get('/', authenticate, checkPermission(['warehouse:view']), async (req, res) => {
  try {
    const { page = 1, pageSize = 10, search } = req.query;
    const offset = (page - 1) * pageSize;
    
    const where = { status: 'active' };
    if (search) {
      where.$or = [
        { code: { $like: `%${search}%` } },
        { name: { $like: `%${search}%` } },
        { address: { $like: `%${search}%` } }
      ];
    }

    const { count, rows } = await Warehouse.findAndCountAll({
      where,
      include: [{
        model: User,
        as: 'manager',
        attributes: ['id', 'realName']
      }],
      limit: parseInt(pageSize),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: {
        warehouses: rows.map(warehouse => ({
          id: warehouse.id,
          code: warehouse.code,
          name: warehouse.name,
          address: warehouse.address,
          manager: warehouse.manager ? {
            id: warehouse.manager.id,
            realName: warehouse.manager.realName
          } : null,
          status: warehouse.status,
          createdAt: warehouse.createdAt
        })),
        total: count,
        page: parseInt(page),
        pageSize: parseInt(pageSize)
      }
    });
  } catch (error) {
    console.error('获取库房列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 获取所有库房（用于下拉选择）
router.get('/all', authenticate, async (req, res) => {
  try {
    const warehouses = await Warehouse.findAll({
      where: { status: 'active' },
      attributes: ['id', 'code', 'name'],
      order: [['name', 'ASC']]
    });

    res.json({
      success: true,
      data: {
        warehouses
      }
    });
  } catch (error) {
    console.error('获取所有库房错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 创建库房
router.post('/', authenticate, checkPermission(['warehouse:create']), async (req, res) => {
  try {
    const { code, name, address, managerId } = req.body;

    if (!code || !name) {
      return res.status(400).json({ error: '库房编码和名称不能为空' });
    }

    // 检查编码是否已存在
    const existingWarehouse = await Warehouse.findOne({ where: { code } });
    if (existingWarehouse) {
      return res.status(400).json({ error: '库房编码已存在' });
    }

    // 检查负责人是否存在
    if (managerId) {
      const manager = await User.findByPk(managerId);
      if (!manager) {
        return res.status(400).json({ error: '指定的负责人不存在' });
      }
    }

    const warehouse = await Warehouse.create({
      code,
      name,
      address,
      managerId,
      status: 'active'
    });

    res.json({
      success: true,
      data: {
        warehouse: {
          id: warehouse.id,
          code: warehouse.code,
          name: warehouse.name,
          address: warehouse.address,
          managerId: warehouse.managerId,
          status: warehouse.status
        }
      },
      message: '库房创建成功'
    });
  } catch (error) {
    console.error('创建库房错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 获取库房详情
router.get('/:id', authenticate, checkPermission(['warehouse:view']), async (req, res) => {
  try {
    const warehouse = await Warehouse.findByPk(req.params.id, {
      include: [{
        model: User,
        as: 'manager',
        attributes: ['id', 'realName', 'username']
      }]
    });
    
    if (!warehouse) {
      return res.status(404).json({ error: '库房不存在' });
    }

    res.json({
      success: true,
      data: {
        warehouse: {
          id: warehouse.id,
          code: warehouse.code,
          name: warehouse.name,
          address: warehouse.address,
          manager: warehouse.manager ? {
            id: warehouse.manager.id,
            realName: warehouse.manager.realName,
            username: warehouse.manager.username
          } : null,
          status: warehouse.status,
          createdAt: warehouse.createdAt,
          updatedAt: warehouse.updatedAt
        }
      }
    });
  } catch (error) {
    console.error('获取库房详情错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 更新库房
router.put('/:id', authenticate, checkPermission(['warehouse:edit']), async (req, res) => {
  try {
    const { code, name, address, managerId, status } = req.body;
    
    const warehouse = await Warehouse.findByPk(req.params.id);
    if (!warehouse) {
      return res.status(404).json({ error: '库房不存在' });
    }

    // 检查编码是否重复（如果修改了编码）
    if (code && code !== warehouse.code) {
      const existingWarehouse = await Warehouse.findOne({ where: { code } });
      if (existingWarehouse) {
        return res.status(400).json({ error: '库房编码已存在' });
      }
    }

    // 检查负责人是否存在
    if (managerId) {
      const manager = await User.findByPk(managerId);
      if (!manager) {
        return res.status(400).json({ error: '指定的负责人不存在' });
      }
    }

    await warehouse.update({
      code: code || warehouse.code,
      name: name || warehouse.name,
      address: address || warehouse.address,
      managerId: managerId !== undefined ? managerId : warehouse.managerId,
      status: status || warehouse.status
    });

    res.json({
      success: true,
      data: {
        warehouse: {
          id: warehouse.id,
          code: warehouse.code,
          name: warehouse.name,
          address: warehouse.address,
          managerId: warehouse.managerId,
          status: warehouse.status
        }
      },
      message: '库房更新成功'
    });
  } catch (error) {
    console.error('更新库房错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 删除库房（逻辑删除）
router.delete('/:id', authenticate, checkPermission(['warehouse:delete']), async (req, res) => {
  try {
    const warehouse = await Warehouse.findByPk(req.params.id);
    if (!warehouse) {
      return res.status(404).json({ error: '库房不存在' });
    }

    // 逻辑删除：将状态设为inactive
    await warehouse.update({ status: 'inactive' });

    res.json({
      success: true,
      message: '库房已禁用'
    });
  } catch (error) {
    console.error('删除库房错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const { Role } = require('../models');
const { authenticate, checkPermission } = require('../middleware/auth');

// 获取角色列表
router.get('/', authenticate, checkPermission(['role:view']), async (req, res) => {
  try {
    const roles = await Role.findAll({
      order: [['createdAt', 'ASC']]
    });

    res.json({
      success: true,
      data: {
        roles: roles.map(role => ({
          id: role.id,
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          createdAt: role.createdAt
        }))
      }
    });
  } catch (error) {
    console.error('获取角色列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 创建角色
router.post('/', authenticate, checkPermission(['role:create']), async (req, res) => {
  try {
    const { name, description, permissions } = req.body;

    if (!name) {
      return res.status(400).json({ error: '角色名称不能为空' });
    }

    // 检查角色名是否已存在
    const existingRole = await Role.findOne({ where: { name } });
    if (existingRole) {
      return res.status(400).json({ error: '角色名称已存在' });
    }

    const role = await Role.create({
      name,
      description,
      permissions: permissions || []
    });

    res.json({
      success: true,
      data: {
        role: {
          id: role.id,
          name: role.name,
          description: role.description,
          permissions: role.permissions
        }
      },
      message: '角色创建成功'
    });
  } catch (error) {
    console.error('创建角色错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 获取角色详情
router.get('/:id', authenticate, checkPermission(['role:view']), async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.id);
    
    if (!role) {
      return res.status(404).json({ error: '角色不存在' });
    }

    res.json({
      success: true,
      data: {
        role: {
          id: role.id,
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          createdAt: role.createdAt,
          updatedAt: role.updatedAt
        }
      }
    });
  } catch (error) {
    console.error('获取角色详情错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 更新角色
router.put('/:id', authenticate, checkPermission(['role:edit']), async (req, res) => {
  try {
    const { name, description, permissions } = req.body;
    
    const role = await Role.findByPk(req.params.id);
    if (!role) {
      return res.status(404).json({ error: '角色不存在' });
    }

    // 检查角色名是否重复（如果修改了名称）
    if (name && name !== role.name) {
      const existingRole = await Role.findOne({ where: { name } });
      if (existingRole) {
        return res.status(400).json({ error: '角色名称已存在' });
      }
    }

    await role.update({
      name: name || role.name,
      description: description || role.description,
      permissions: permissions || role.permissions
    });

    res.json({
      success: true,
      data: {
        role: {
          id: role.id,
          name: role.name,
          description: role.description,
          permissions: role.permissions
        }
      },
      message: '角色更新成功'
    });
  } catch (error) {
    console.error('更新角色错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 删除角色
router.delete('/:id', authenticate, checkPermission(['role:delete']), async (req, res) => {
  try {
    const role = await Role.findByPk(req.params.id);
    if (!role) {
      return res.status(404).json({ error: '角色不存在' });
    }

    // 检查是否有用户使用此角色
    const userCount = await role.countUsers();
    if (userCount > 0) {
      return res.status(400).json({ error: '该角色已被用户使用，无法删除' });
    }

    await role.destroy();

    res.json({
      success: true,
      message: '角色删除成功'
    });
  } catch (error) {
    console.error('删除角色错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;
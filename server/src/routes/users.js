const express = require('express');
const router = express.Router();
const { User, Role } = require('../models');
const { authenticate, checkPermission } = require('../middleware/auth');
const { hashPassword } = require('../utils/helpers');

// 获取用户列表
router.get('/', authenticate, checkPermission(['user:view']), async (req, res) => {
  try {
    const { page = 1, pageSize = 10, search } = req.query;
    const offset = (page - 1) * pageSize;
    
    const where = {};
    if (search) {
      where.$or = [
        { username: { $like: `%${search}%` } },
        { realName: { $like: `%${search}%` } },
        { email: { $like: `%${search}%` } }
      ];
    }

    const { count, rows } = await User.findAndCountAll({
      where,
      include: [{
        model: Role,
        through: { attributes: [] }
      }],
      limit: parseInt(pageSize),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: {
        users: rows.map(user => ({
          id: user.id,
          username: user.username,
          email: user.email,
          realName: user.realName,
          phone: user.phone,
          status: user.status,
          createdAt: user.createdAt,
          roles: user.Roles.map(role => ({
            id: role.id,
            name: role.name
          }))
        })),
        total: count,
        page: parseInt(page),
        pageSize: parseInt(pageSize)
      }
    });
  } catch (error) {
    console.error('获取用户列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 创建用户
router.post('/', authenticate, checkPermission(['user:create']), async (req, res) => {
  try {
    const { username, password, email, realName, phone, roleIds } = req.body;

    // 验证必填字段
    if (!username || !password || !realName) {
      return res.status(400).json({ error: '用户名、密码和真实姓名不能为空' });
    }

    // 检查用户名是否已存在
    const existingUser = await User.findOne({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    // 加密密码
    const hashedPassword = await hashPassword(password);

    // 创建用户
    const user = await User.create({
      username,
      password: hashedPassword,
      email,
      realName,
      phone,
      status: 'active'
    });

    // 分配角色
    if (roleIds && roleIds.length > 0) {
      const roles = await Role.findAll({ where: { id: roleIds } });
      await user.setRoles(roles);
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          realName: user.realName,
          phone: user.phone,
          status: user.status
        }
      },
      message: '用户创建成功'
    });
  } catch (error) {
    console.error('创建用户错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 获取用户详情
router.get('/:id', authenticate, checkPermission(['user:view']), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      include: [{
        model: Role,
        through: { attributes: [] }
      }]
    });

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          realName: user.realName,
          phone: user.phone,
          status: user.status,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          roles: user.Roles.map(role => ({
            id: role.id,
            name: role.name
          }))
        }
      }
    });
  } catch (error) {
    console.error('获取用户详情错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 更新用户
router.put('/:id', authenticate, checkPermission(['user:edit']), async (req, res) => {
  try {
    const { email, realName, phone, status, roleIds } = req.body;
    
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 更新用户信息
    await user.update({
      email: email || user.email,
      realName: realName || user.realName,
      phone: phone || user.phone,
      status: status || user.status
    });

    // 更新角色
    if (roleIds) {
      const roles = await Role.findAll({ where: { id: roleIds } });
      await user.setRoles(roles);
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          realName: user.realName,
          phone: user.phone,
          status: user.status
        }
      },
      message: '用户更新成功'
    });
  } catch (error) {
    console.error('更新用户错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 重置密码
router.put('/:id/reset-password', authenticate, checkPermission(['user:edit']), async (req, res) => {
  try {
    const { newPassword } = req.body;
    
    if (!newPassword) {
      return res.status(400).json({ error: '新密码不能为空' });
    }

    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 加密新密码
    const hashedPassword = await hashPassword(newPassword);
    await user.update({ password: hashedPassword });

    res.json({
      success: true,
      message: '密码重置成功'
    });
  } catch (error) {
    console.error('重置密码错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 删除用户（逻辑删除）
router.delete('/:id', authenticate, checkPermission(['user:delete']), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 逻辑删除：将状态设为inactive
    await user.update({ status: 'inactive' });

    res.json({
      success: true,
      message: '用户已禁用'
    });
  } catch (error) {
    console.error('删除用户错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;
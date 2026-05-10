const express = require('express');
const router = express.Router();
const { User, Role } = require('../models');
const { generateToken, authenticate } = require('../middleware/auth');
const { verifyPassword } = require('../utils/helpers');

// 用户登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    // 查找用户并包含角色信息
    const user = await User.findOne({
      where: { username },
      include: [{
        model: Role,
        through: { attributes: [] }
      }]
    });

    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    if (user.status !== 'active') {
      return res.status(401).json({ error: '用户已被禁用' });
    }

    // 验证密码
    const isValidPassword = await verifyPassword(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 生成token
    const token = generateToken(user);

    // 返回用户信息和token
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          realName: user.realName,
          phone: user.phone,
          roles: user.Roles.map(role => ({
            id: role.id,
            name: role.name,
            permissions: role.permissions
          }))
        }
      }
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 用户登出
router.post('/logout', authenticate, (req, res) => {
  res.json({ success: true, message: '登出成功' });
});

// 获取当前用户信息
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
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
          roles: user.Roles.map(role => ({
            id: role.id,
            name: role.name,
            permissions: role.permissions
          }))
        }
      }
    });
  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;
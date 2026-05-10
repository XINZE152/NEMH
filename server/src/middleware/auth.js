const jwt = require('jsonwebtoken');
const { User, Role } = require('../models');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// 生成JWT token
function generateToken(user) {
  const payload = {
    userId: user.id,
    username: user.username,
    roles: user.Roles ? user.Roles.map(role => role.name) : []
  };
  
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

// 验证JWT token中间件
async function authenticate(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: '未提供认证令牌' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    // 查找用户并包含角色信息
    const user = await User.findByPk(decoded.userId, {
      include: [{
        model: Role,
        through: { attributes: [] }
      }]
    });

    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: '用户不存在或已被禁用' });
    }

    req.user = user;
    req.userRoles = user.Roles.map(role => role.name);
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: '无效的认证令牌' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '认证令牌已过期' });
    }
    console.error('认证错误:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
}

// 检查权限中间件
function checkPermission(requiredPermissions) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: '未认证' });
    }

    // 系统管理员拥有所有权限
    if (req.userRoles.includes('系统管理员')) {
      return next();
    }

    // 获取用户所有权限
    const userPermissions = req.user.Roles.flatMap(role => role.permissions);
    
    // 检查是否包含所需权限
    const hasPermission = requiredPermissions.some(permission => 
      userPermissions.includes(permission) || userPermissions.includes('*')
    );

    if (!hasPermission) {
      return res.status(403).json({ error: '权限不足' });
    }

    next();
  };
}

// 检查角色中间件
function checkRole(requiredRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: '未认证' });
    }

    const hasRole = requiredRoles.some(role => req.userRoles.includes(role));
    
    if (!hasRole) {
      return res.status(403).json({ error: '角色权限不足' });
    }

    next();
  };
}

module.exports = {
  generateToken,
  authenticate,
  checkPermission,
  checkRole
};
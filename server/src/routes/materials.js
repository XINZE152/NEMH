const express = require('express');
const router = express.Router();
const { Material } = require('../models');
const { authenticate, checkPermission } = require('../middleware/auth');

// 获取品种列表
router.get('/', authenticate, checkPermission(['material:view']), async (req, res) => {
  try {
    const { page = 1, pageSize = 10, search } = req.query;
    const offset = (page - 1) * pageSize;
    
    const where = { status: 'active' };
    if (search) {
      where.$or = [
        { code: { $like: `%${search}%` } },
        { name: { $like: `%${search}%` } },
        { description: { $like: `%${search}%` } }
      ];
    }

    const { count, rows } = await Material.findAndCountAll({
      where,
      limit: parseInt(pageSize),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: {
        materials: rows.map(material => ({
          id: material.id,
          code: material.code,
          name: material.name,
          description: material.description,
          status: material.status,
          createdAt: material.createdAt
        })),
        total: count,
        page: parseInt(page),
        pageSize: parseInt(pageSize)
      }
    });
  } catch (error) {
    console.error('获取品种列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 获取所有品种（用于下拉选择）
router.get('/all', authenticate, async (req, res) => {
  try {
    const materials = await Material.findAll({
      where: { status: 'active' },
      attributes: ['id', 'code', 'name'],
      order: [['name', 'ASC']]
    });

    res.json({
      success: true,
      data: {
        materials
      }
    });
  } catch (error) {
    console.error('获取所有品种错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 创建品种
router.post('/', authenticate, checkPermission(['material:create']), async (req, res) => {
  try {
    const { code, name, description } = req.body;

    if (!code || !name) {
      return res.status(400).json({ error: '品种编码和名称不能为空' });
    }

    // 检查编码是否已存在
    const existingMaterial = await Material.findOne({ where: { code } });
    if (existingMaterial) {
      return res.status(400).json({ error: '品种编码已存在' });
    }

    const material = await Material.create({
      code,
      name,
      description,
      status: 'active'
    });

    res.json({
      success: true,
      data: {
        material: {
          id: material.id,
          code: material.code,
          name: material.name,
          description: material.description,
          status: material.status
        }
      },
      message: '品种创建成功'
    });
  } catch (error) {
    console.error('创建品种错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 获取品种详情
router.get('/:id', authenticate, checkPermission(['material:view']), async (req, res) => {
  try {
    const material = await Material.findByPk(req.params.id);
    
    if (!material) {
      return res.status(404).json({ error: '品种不存在' });
    }

    res.json({
      success: true,
      data: {
        material: {
          id: material.id,
          code: material.code,
          name: material.name,
          description: material.description,
          status: material.status,
          createdAt: material.createdAt,
          updatedAt: material.updatedAt
        }
      }
    });
  } catch (error) {
    console.error('获取品种详情错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 更新品种
router.put('/:id', authenticate, checkPermission(['material:edit']), async (req, res) => {
  try {
    const { code, name, description, status } = req.body;
    
    const material = await Material.findByPk(req.params.id);
    if (!material) {
      return res.status(404).json({ error: '品种不存在' });
    }

    // 检查编码是否重复（如果修改了编码）
    if (code && code !== material.code) {
      const existingMaterial = await Material.findOne({ where: { code } });
      if (existingMaterial) {
        return res.status(400).json({ error: '品种编码已存在' });
      }
    }

    await material.update({
      code: code || material.code,
      name: name || material.name,
      description: description || material.description,
      status: status || material.status
    });

    res.json({
      success: true,
      data: {
        material: {
          id: material.id,
          code: material.code,
          name: material.name,
          description: material.description,
          status: material.status
        }
      },
      message: '品种更新成功'
    });
  } catch (error) {
    console.error('更新品种错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 删除品种（逻辑删除）
router.delete('/:id', authenticate, checkPermission(['material:delete']), async (req, res) => {
  try {
    const material = await Material.findByPk(req.params.id);
    if (!material) {
      return res.status(404).json({ error: '品种不存在' });
    }

    // 逻辑删除：将状态设为inactive
    await material.update({ status: 'inactive' });

    res.json({
      success: true,
      message: '品种已禁用'
    });
  } catch (error) {
    console.error('删除品种错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;
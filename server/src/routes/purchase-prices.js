const express = require('express');
const router = express.Router();
const { PurchasePrice, Material, User } = require('../models');
const { authenticate, checkPermission } = require('../middleware/auth');

// 获取定价列表
router.get('/', authenticate, checkPermission(['purchase-price:view']), async (req, res) => {
  try {
    const { page = 1, pageSize = 10, materialId, startDate, endDate } = req.query;
    const offset = (page - 1) * pageSize;
    
    const where = {};
    
    if (materialId) {
      where.materialId = materialId;
    }
    
    if (startDate || endDate) {
      where.priceDate = {};
      if (startDate) {
        where.priceDate.$gte = new Date(startDate);
      }
      if (endDate) {
        where.priceDate.$lte = new Date(endDate);
      }
    }

    const { count, rows } = await PurchasePrice.findAndCountAll({
      where,
      include: [
        {
          model: Material,
          attributes: ['id', 'code', 'name']
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'realName']
        }
      ],
      limit: parseInt(pageSize),
      offset: parseInt(offset),
      order: [['priceDate', 'DESC'], ['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: {
        prices: rows.map(price => ({
          id: price.id,
          material: price.Material ? {
            id: price.Material.id,
            code: price.Material.code,
            name: price.Material.name
          } : null,
          price: price.price,
          priceDate: price.priceDate,
          priceProof: price.priceProof,
          receivePriceProof: price.receivePriceProof,
          description: price.description,
          creator: price.creator ? {
            id: price.creator.id,
            realName: price.creator.realName
          } : null,
          createdAt: price.createdAt
        })),
        total: count,
        page: parseInt(page),
        pageSize: parseInt(pageSize)
      }
    });
  } catch (error) {
    console.error('获取定价列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 获取品种最新定价
router.get('/latest/:materialId', authenticate, async (req, res) => {
  try {
    const price = await PurchasePrice.findOne({
      where: { materialId: req.params.materialId },
      order: [['priceDate', 'DESC'], ['createdAt', 'DESC']],
      include: [{
        model: Material,
        attributes: ['id', 'code', 'name']
      }]
    });

    if (!price) {
      return res.json({
        success: true,
        data: { price: null }
      });
    }

    res.json({
      success: true,
      data: {
        price: {
          id: price.id,
          material: price.Material ? {
            id: price.Material.id,
            code: price.Material.code,
            name: price.Material.name
          } : null,
          price: price.price,
          priceDate: price.priceDate,
          priceProof: price.priceProof,
          receivePriceProof: price.receivePriceProof,
          description: price.description,
          createdAt: price.createdAt
        }
      }
    });
  } catch (error) {
    console.error('获取最新定价错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 创建定价
router.post('/', authenticate, checkPermission(['purchase-price:create']), async (req, res) => {
  try {
    const { materialId, price, priceDate, priceProof, receivePriceProof, description } = req.body;

    if (!materialId || !price) {
      return res.status(400).json({ error: '品种和单价不能为空' });
    }
    if (!priceProof || !String(priceProof).trim()) {
      return res.status(400).json({ error: '请上传或填写行情价凭证图片' });
    }
    if (!receivePriceProof || !String(receivePriceProof).trim()) {
      return res.status(400).json({ error: '请上传或填写收货价格凭证图片' });
    }

    // 检查品种是否存在
    const material = await Material.findByPk(materialId);
    if (!material) {
      return res.status(400).json({ error: '品种不存在' });
    }

    // 验证价格
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      return res.status(400).json({ error: '单价必须为正数' });
    }

    const purchasePrice = await PurchasePrice.create({
      materialId,
      price: priceNum,
      priceDate: priceDate || new Date(),
      priceProof: String(priceProof).trim(),
      receivePriceProof: String(receivePriceProof).trim(),
      description,
      createdBy: req.user.id
    });

    res.json({
      success: true,
      data: {
        price: {
          id: purchasePrice.id,
          materialId: purchasePrice.materialId,
          price: purchasePrice.price,
          priceDate: purchasePrice.priceDate,
          priceProof: purchasePrice.priceProof,
          receivePriceProof: purchasePrice.receivePriceProof,
          description: purchasePrice.description,
          createdAt: purchasePrice.createdAt
        }
      },
      message: '定价创建成功'
    });
  } catch (error) {
    console.error('创建定价错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

module.exports = router;
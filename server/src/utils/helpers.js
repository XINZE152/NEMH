const bcrypt = require('bcryptjs');

// 生成入库单号
function generateInboundOrderNo() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `RK-${year}${month}${day}-${random}`;
}

// 生成出库单号
function generateOutboundOrderNo() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `CK-${year}${month}${day}-${random}`;
}

// 密码加密
async function hashPassword(password) {
  return await bcrypt.hash(password, 10);
}

// 验证密码
async function verifyPassword(password, hashedPassword) {
  return await bcrypt.compare(password, hashedPassword);
}

// 格式化日期
function formatDate(date, format = 'YYYY-MM-DD HH:mm:ss') {
  if (!date) return '';
  
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

// 计算金额
function calculateAmount(weight, price) {
  const weightNum = parseFloat(weight) || 0;
  const priceNum = parseFloat(price) || 0;
  return (weightNum * priceNum).toFixed(2);
}

// 验证数字输入
function validateNumber(value, min = 0, max = 999999999) {
  const num = parseFloat(value);
  if (isNaN(num)) return false;
  if (num < min) return false;
  if (num > max) return false;
  return true;
}

// 获取状态文本
function getStatusText(status) {
  const statusMap = {
    'pending': '待审核',
    'reviewed': '已审核待出库',
    'outbounding': '出库中',
    'partial_outbound': '部分已出库',
    'fully_outbound': '全部已出库',
    'rejected': '已驳回',
    'planned': '预出库完成',
    'executing': '执行中',
    'completed': '已完成'
  };
  return statusMap[status] || status;
}

// 获取状态颜色
function getStatusColor(status) {
  const colorMap = {
    'pending': 'warning',
    'reviewed': 'success',
    'outbounding': 'processing',
    'partial_outbound': 'info',
    'fully_outbound': 'default',
    'rejected': 'error',
    'planned': 'success',
    'executing': 'processing',
    'completed': 'default'
  };
  return colorMap[status] || 'default';
}

module.exports = {
  generateInboundOrderNo,
  generateOutboundOrderNo,
  hashPassword,
  verifyPassword,
  formatDate,
  calculateAmount,
  validateNumber,
  getStatusText,
  getStatusColor
};
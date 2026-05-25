// 电动/新能源材料进销存管理系统 - 核心 JavaScript（已合并定價雙憑證、入庫照片上傳等整合能力）

// 全局状态管理
const AppState = {
    currentUser: null,
    currentRole: null,
    currentPage: 'workbench',

    // 数据存储
    users: [],
    roles: [],
    materials: [],
    warehouses: [],
    pricingRecords: [],
    inboundOrders: [],
    outboundOrders: [],
    outboundSuborders: [],
    quotations: [],
    actions: [],

    // 临时存储上传的图片（定價憑證可多張、入庫照片可多張）
    tempMarketImages: [],
    tempSelfImages: [],
    tempInboundImages: []
};

/** 是否对接后端（与 inventory-api.js、index.html 中 __USE_BACKEND_API__ 一致） */
function useApiMode() {
    return typeof window !== 'undefined' && window.InventoryApi && window.InventoryApi.useApiMode();
}

/** 对接模式下当前登录者的后端角色（见 localStorage apiUser） */
function getApiUserRole() {
    if (!useApiMode()) return null;
    try {
        const raw = localStorage.getItem('apiUser');
        if (!raw) return null;
        const u = JSON.parse(raw);
        return u.role === 'warehouse' ? 'warehouse' : 'statistics';
    } catch {
        return null;
    }
}

function isWarehouseApiRole() {
    return getApiUserRole() === 'warehouse';
}

/** 当前登录用户是否为系统管理员（全权限，含离线演示 roleId=1） */
function isSystemAdministrator() {
    if (!AppState.currentRole) return false;
    return AppState.currentRole.permissions.includes('all');
}

/** 下拉菜单仅保留「退出登录」，清除缓存或旧版注入的多余项 */
function ensureUserInfoMenuOnlyLogout() {
    const menu = document.getElementById('user-info-menu');
    if (!menu) return;
    Array.from(menu.children).forEach((child) => {
        if (child.id !== 'logout-btn') child.remove();
    });
}

function closeUserInfoMenu() {
    const wrap = document.getElementById('header-user-info');
    const menu = document.getElementById('user-info-menu');
    const trigger = document.getElementById('user-info-trigger');
    if (!wrap || !menu || !trigger) return;
    wrap.classList.remove('open');
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
}

function toggleUserInfoMenu() {
    const wrap = document.getElementById('header-user-info');
    const menu = document.getElementById('user-info-menu');
    const trigger = document.getElementById('user-info-trigger');
    if (!wrap || !menu || !trigger) return;
    const open = wrap.classList.toggle('open');
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) ensureUserInfoMenuOnlyLogout();
}

function updateHeaderUserInfo() {
    const wrap = document.getElementById('header-user-info');
    const trigger = document.getElementById('user-info-trigger');
    if (!wrap || !trigger) return;

    const nameEl = document.getElementById('current-user');
    const roleEl = document.getElementById('user-role');
    if (AppState.currentUser && nameEl) {
        nameEl.textContent = AppState.currentUser.name;
    }
    if (AppState.currentRole && roleEl) {
        roleEl.textContent = AppState.currentRole.name;
    }

    closeUserInfoMenu();

    trigger.setAttribute('aria-haspopup', 'menu');
    const menu = document.getElementById('user-info-menu');
    if (menu) {
        menu.hidden = true;
    }
}

/** API 模式下：库房角色，或内置 admin（与后端超级管理员一致，可操作收货定价等） */
function isWarehouseApiRoleOrSuperAdmin() {
    if (!useApiMode()) return true;
    if (isWarehouseApiRole()) return true;
    try {
        const raw = localStorage.getItem('apiUser');
        if (!raw) return false;
        const u = JSON.parse(raw);
        return u && u.username === 'admin';
    } catch {
        return false;
    }
}

// 初始化应用
function initApp() {
    loadDemoData();
    setupEventListeners();
    if (useApiMode()) {
        document.querySelectorAll('.account-item.offline-demo-account').forEach(function (el) {
            el.style.display = 'none';
        });
    }
    checkLoginStatus().catch(function () {});
    updateDashboardStats();
}

// 加载演示数据
function loadDemoData() {
    if (useApiMode()) {
        AppState.roles = [
            { id: 1, name: '系统管理员', permissions: ['all'] },
            { id: 2, name: '统计部人员', permissions: ['quotation', 'report'] },
            { id: 3, name: '财务', permissions: ['pricing', 'inbound', 'outbound'] },
        ];
        AppState.users = [];
        return;
    }
    // 如果本地存储有数据，则加载
    if (localStorage.getItem('inventorySystemData')) {
        loadFromLocalStorage();
    } else {
        // 否则创建演示数据
        createDemoData();
    }
}

// 创建演示数据
function createDemoData() {
    // 角色数据
    AppState.roles = [
        { id: 1, name: '系统管理员', permissions: ['all'] },
        { id: 2, name: '统计部人员', permissions: ['quotation', 'report'] },
        { id: 3, name: '财务', permissions: ['pricing', 'inbound', 'outbound'] }
    ];

    // 用户数据
    AppState.users = [
        { id: 1, username: 'admin', password: 'admin123', name: '系统管理员', roleId: 1, warehouseId: null },
        { id: 2, username: 'statistics', password: 'stat123', name: '统计部人员', roleId: 2, warehouseId: null },
        { id: 3, username: 'warehouse1', password: 'ware123', name: '财务部管理员A', roleId: 3, warehouseId: 1 },
        { id: 4, username: 'warehouse2', password: 'ware123', name: '财务部管理员B', roleId: 3, warehouseId: 2 }
    ];

    // 品种数据（仅新能源、电瓶两类）
    AppState.materials = [
        { id: 1, code: 'NE-001', name: '新能源', unit: '吨' },
        { id: 2, code: 'BT-001', name: '电瓶', unit: '吨' }
    ];

    // 库房数据
    AppState.warehouses = [
        { id: 1, code: 'WH-001', name: '华东一号库', address: '上海市浦东新区' },
        { id: 2, code: 'WH-002', name: '华南二号库', address: '广州市白云区' },
        { id: 3, code: 'WH-003', name: '华北三号库', address: '北京市大兴区' }
    ];

    // 收货定价数据（含雙憑證欄位；datetime 用於列表與篩選）
    AppState.pricingRecords = [
        {
            id: 1,
            materialId: 1,
            price: 285000,
            date: '2023-10-25',
            datetime: '2023-10-25 00:00',
            note: '市场采购价',
            marketImages: [],
            selfImages: []
        },
        {
            id: 2,
            materialId: 2,
            price: 125000,
            date: '2023-10-26',
            datetime: '2023-10-26 00:00',
            note: '长期协议价',
            marketImages: [],
            selfImages: []
        },
        {
            id: 3,
            materialId: 1,
            price: 290000,
            date: '2023-10-27',
            datetime: '2023-10-27 00:00',
            note: '最新采购价',
            marketImages: [],
            selfImages: []
        },
        {
            id: 4,
            materialId: 2,
            price: 118000,
            date: '2023-10-26',
            datetime: '2023-10-26 00:00',
            note: '供应商报价',
            marketImages: [],
            selfImages: []
        }
    ];

    // 入库单数据
    AppState.inboundOrders = [
        { 
            id: 1, 
            orderNo: 'RK-20231025-0001',
            warehouseId: 1,
            materialId: 1,
            weight: 50,
            unitPrice: 285000,
            totalPrice: 14250000,
            status: 'approved',
            date: '2023-10-25 09:15',
            images: [],
            reviewerId: 2,
            reviewDate: '2023-10-25',
            actualOutboundWeight: 0,
            preOutboundWeight: 20
        },
        { 
            id: 2, 
            orderNo: 'RK-20231026-0001',
            warehouseId: 2,
            materialId: 2,
            weight: 40,
            unitPrice: 125000,
            totalPrice: 5000000,
            status: 'approved',
            date: '2023-10-26 10:30',
            images: [],
            reviewerId: 2,
            reviewDate: '2023-10-26',
            actualOutboundWeight: 0,
            preOutboundWeight: 0
        },
        { 
            id: 3, 
            orderNo: 'RK-20231027-0001',
            warehouseId: 1,
            materialId: 1,
            weight: 30,
            unitPrice: 290000,
            totalPrice: 8700000,
            status: 'approved',
            date: '2023-10-27 14:20',
            images: [],
            actualOutboundWeight: 0,
            preOutboundWeight: 0
        },
        { 
            id: 4, 
            orderNo: 'RK-20231027-0002',
            warehouseId: 3,
            materialId: 2,
            weight: 25,
            unitPrice: 118000,
            totalPrice: 2950000,
            status: 'outbounding',
            date: '2023-10-27 16:45',
            images: [],
            reviewerId: 2,
            reviewDate: '2023-10-27',
            actualOutboundWeight: 10,
            preOutboundWeight: 15
        }
    ];

    // 对外报价数据（date 为发布时间，精确到秒）
    AppState.quotations = [
        { id: 1, materialId: 1, price: 305000, date: '2023-10-25 09:00:15', isActive: false },
        { id: 2, materialId: 2, price: 135000, date: '2023-10-26 11:20:42', isActive: false },
        { id: 3, materialId: 1, price: 308000, date: '2023-10-26 15:45:08', isActive: false },
        { id: 4, materialId: 2, price: 138000, date: '2023-10-27 08:30:55', isActive: false },
        { id: 5, materialId: 1, price: 310000, date: '2023-10-27 14:25:33', isActive: true },
        { id: 6, materialId: 2, price: 140000, date: '2023-10-27 10:00:01', isActive: true }
    ];

    // 出库单数据
    AppState.outboundOrders = [
        {
            id: 1,
            orderNo: 'CK-20231027-0001',
            materialId: 1,
            preWeight: 20,
            actualWeight: 0,
            price: 310000,
            status: 'pre_outbound',
            date: '2023-10-27 11:00:05',
            warehouseId: 1
        }
    ];

    // 出库子单数据
    AppState.outboundSuborders = [
        {
            id: 1,
            outboundOrderId: 1,
            inboundOrderId: 1,
            preWeight: 20,
            actualWeight: 0,
            status: 'pre_outbound'
        }
    ];

    // 操作日志
    AppState.actions = [
        { id: 1, type: 'login', detail: '用户登录系统', userId: 1, time: '2023-10-27 09:00:00' },
        { id: 2, type: 'pricing', detail: '新增新能源定价 ¥290,000/吨', userId: 3, time: '2023-10-27 09:30:00' },
        { id: 3, type: 'inbound', detail: '创建入库单 RK-20231027-0001', userId: 3, time: '2023-10-27 10:00:00' },
        { id: 4, type: 'inbound', detail: '入库通过 RK-20231027-0002', userId: 2, time: '2023-10-27 10:30:00' },
        { id: 5, type: 'outbound', detail: '创建预出库计划 CK-20231027-0001', userId: 3, time: '2023-10-27 11:00:00' }
    ];

    normalizePricingRecords();
    normalizeInboundOrders();
    recalculateInboundOrdersOutboundWeights();
    saveToLocalStorage();
}

// 保存到本地存储
function saveToLocalStorage() {
    if (useApiMode()) return;
    recalculateInboundOrdersOutboundWeights();
    const data = {
        users: AppState.users,
        roles: AppState.roles,
        materials: AppState.materials,
        warehouses: AppState.warehouses,
        pricingRecords: AppState.pricingRecords,
        inboundOrders: AppState.inboundOrders,
        outboundOrders: AppState.outboundOrders,
        outboundSuborders: AppState.outboundSuborders,
        quotations: AppState.quotations,
        actions: AppState.actions
    };
    localStorage.setItem('inventorySystemData', JSON.stringify(data));
}

// 从本地存储加载
function loadFromLocalStorage() {
    if (useApiMode()) return;
    const data = JSON.parse(localStorage.getItem('inventorySystemData'));
    if (data) {
        AppState.users = data.users || [];
        AppState.roles = data.roles || [];
        AppState.materials = data.materials || [];
        AppState.warehouses = data.warehouses || [];
        AppState.pricingRecords = data.pricingRecords || [];
        AppState.inboundOrders = data.inboundOrders || [];
        AppState.outboundOrders = data.outboundOrders || [];
        AppState.outboundSuborders = data.outboundSuborders || [];
        AppState.quotations = data.quotations || [];
        AppState.actions = data.actions || [];
        normalizePricingRecords();
        normalizeInboundOrders();
        recalculateInboundOrdersOutboundWeights();
    }
}

const PRICING_MAX_IMAGES_PER_GROUP = 20;
const INBOUND_MAX_IMAGES = 20;

/**
 * 多图入库 photo 字段用英文逗号拼接；单张 Data URL 形如 data:image/png;base64,xxxx，
 * 逗号在「base64,」处——若对整个字符串 split(',') 会把每张图拆成两段（因而 2 张变 4 个无效 src）。
 * 与 inventory-api.js 中 splitCombinedImageUrls 保持一致。
 */
function splitInboundStoredPhotos(storage) {
    if (!storage || typeof storage !== 'string') return [];
    const s = storage.trim();
    if (!s) return [];
    return s
        .split(/,(?=(?:data:|https?:\/\/))/i)
        .map((x) => x.trim())
        .filter(Boolean);
}

/** 修复旧版 split(',') 误拆：data:image/png;base64 + iVBORw0... → 完整 Data URL */
function repairInboundImageFragments(parts) {
    if (!Array.isArray(parts) || !parts.length) return [];
    const out = [];
    for (let i = 0; i < parts.length; i++) {
        const cur = String(parts[i] || '').trim();
        if (!cur) continue;
        const isDataHeaderOnly = /^data:image\/[^;]+;base64$/i.test(cur);
        const next = i + 1 < parts.length ? String(parts[i + 1] || '').trim() : '';
        if (isDataHeaderOnly && next && !/^data:/i.test(next) && !/^https?:\/\//i.test(next)) {
            out.push(`${cur},${next}`);
            i += 1;
            continue;
        }
        if (/^data:/i.test(cur) || /^https?:\/\//i.test(cur)) {
            out.push(cur);
            continue;
        }
        const prev = out[out.length - 1];
        if (prev && /^data:image\/[^;]+;base64$/i.test(prev)) {
            out[out.length - 1] = `${prev},${cur}`;
        }
    }
    return out;
}

/** 入庫單照片：統一為 images[]，兼容舊單張 image；對接後端時優先按原始 photo 再拆分 */
function inboundOrderImages(order) {
    if (!order) return [];
    const raw =
        (typeof order.photo === 'string' && order.photo.trim()) ||
        (typeof order.inboundPhoto === 'string' && order.inboundPhoto.trim()) ||
        '';
    if (raw) return splitInboundStoredPhotos(raw);
    const arr = Array.isArray(order.images) ? order.images.filter(Boolean) : [];
    if (arr.length) return repairInboundImageFragments(arr);
    if (order.image) {
        const one = String(order.image).trim();
        return repairInboundImageFragments(splitInboundStoredPhotos(one).length ? splitInboundStoredPhotos(one) : [one]);
    }
    return [];
}

/** 定價記錄：補齊 datetime / date；憑證統一為 marketImages / selfImages（兼容舊單張欄位） */
function normalizePricingRecords() {
    AppState.pricingRecords = (AppState.pricingRecords || []).map((r) => {
        const datetime = r.datetime || (r.date ? `${r.date} 00:00` : '') || '';
        const date = r.date || extractDatePart(datetime);

        let marketImages = Array.isArray(r.marketImages) ? r.marketImages.filter(Boolean) : [];
        if (marketImages.length === 0 && r.marketImage) marketImages = [r.marketImage];

        let selfImages = Array.isArray(r.selfImages) ? r.selfImages.filter(Boolean) : [];
        if (selfImages.length === 0 && r.selfImage) selfImages = [r.selfImage];

        const { marketImage, selfImage, marketImages: _m0, selfImages: _s0, ...rest } = r;
        return {
            ...rest,
            datetime,
            date,
            marketImages,
            selfImages
        };
    });
}

function pricingRecordDateKey(record) {
    if (!record) return '';
    if (record.date) return String(record.date).slice(0, 10);
    return extractDatePart(record.datetime || '');
}

/** 定價記錄用於排序的時間戳（與列表錄入時間一致） */
function pricingRecordSortTime(record) {
    if (!record) return 0;
    const src = record.datetime || (record.date ? `${String(record.date).slice(0, 10)} 00:00:00` : '');
    return parseQuotationDateTime(src);
}

/** 某品種最新一條收貨定價（按錄入時間） */
function getLatestPricingRecordForMaterial(materialId) {
    const list = AppState.pricingRecords.filter((r) => Number(r.materialId) === Number(materialId));
    if (!list.length) return null;
    return list.reduce((best, r) => (pricingRecordSortTime(r) >= pricingRecordSortTime(best) ? r : best));
}

/** 某品種最新一條對外報價（按發布時間） */
function getLatestQuotationRecordForMaterial(materialId) {
    const list = AppState.quotations.filter((q) => Number(q.materialId) === Number(materialId));
    if (!list.length) return null;
    return list.reduce((best, q) => (parseQuotationDateTime(q.date) >= parseQuotationDateTime(best.date) ? q : best));
}

function renderDashboardLatestPrices() {
    const container = document.getElementById('dashboard-latest-prices');
    if (!container) return;
    container.innerHTML = '';
    const mats = AppState.materials || [];
    if (!mats.length) {
        container.innerHTML = '<div class="dashboard-price-block muted">暂无品种数据</div>';
        return;
    }
    mats.forEach((m) => {
        const pr = getLatestPricingRecordForMaterial(m.id);
        const qt = getLatestQuotationRecordForMaterial(m.id);
        const unit = m.unit || '吨';
        const pricingHtml = pr
            ? `<div class="dashboard-price-block"><span class="dashboard-price-label">收货定价</span><strong>${formatCurrency(
                  pr.price
              )}</strong><span class="unit">/${unit}</span><div class="dashboard-price-time">${formatQuotationPublishDisplay(
                  pr.datetime || pr.date
              )}</div></div>`
            : '<div class="dashboard-price-block muted"><span class="dashboard-price-label">收货定价</span><span>暂无</span></div>';
        const quoteHtml = qt
            ? `<div class="dashboard-price-block"><span class="dashboard-price-label">对外报价</span><strong>${formatCurrency(
                  qt.price
              )}</strong><span class="unit">/${unit}</span><div class="dashboard-price-time">${formatQuotationPublishDisplay(
                  qt.date
              )}</div></div>`
            : '<div class="dashboard-price-block muted"><span class="dashboard-price-label">对外报价</span><span>暂无</span></div>';
        const row = document.createElement('div');
        row.className = 'dashboard-price-material-row';
        row.innerHTML = `<div class="dashboard-price-material-title">${m.name}</div><div class="dashboard-price-pair">${pricingHtml}${quoteHtml}</div>`;
        container.appendChild(row);
    });
}

/** 入庫業務狀態：創建即通過，歷史 pending 視同 approved */
function normalizeInboundFlowStatus(status) {
    if (status === 'pending') return 'approved';
    return status;
}

function inboundOrderHasOutboundLink(order) {
    if (!order) return false;
    const w = Number(order.actualOutboundWeight) || 0;
    const p = Number(order.preOutboundWeight) || 0;
    const st = normalizeInboundFlowStatus(order.status);
    return w > 0 || p > 0 || st === 'outbounding' || st === 'partial' || st === 'completed';
}

function canEditInboundOrder(order) {
    if (!order || order.status === 'rejected') return false;
    return !inboundOrderHasOutboundLink(order);
}

function canDeleteInboundOrder(order) {
    return canEditInboundOrder(order);
}

function formatInboundTonShort(w, unit) {
    const n = Number(w) || 0;
    const u = unit || '吨';
    const text = n % 1 === 0 ? String(n) : n.toFixed(2);
    return `${text}${u}`;
}

/** 依 FIFO 子单从入库单重算已出库/预出库（已完成出库单不显示预出库差额） */
function recalculateInboundOrdersOutboundWeights() {
    if (useApiMode() || !window.InventoryApi?.sumInboundOutboundWeightsFromSubs) return;
    const outboundById = new Map(
        (AppState.outboundOrders || []).map((o) => [o.id, o])
    );
    const subsByInbound = new Map();
    (AppState.outboundSuborders || []).forEach((sub) => {
        const iid = sub.inboundOrderId;
        if (iid == null) return;
        if (!subsByInbound.has(iid)) subsByInbound.set(iid, []);
        subsByInbound.get(iid).push(sub);
    });
    const sum = window.InventoryApi.sumInboundOutboundWeightsFromSubs;
    AppState.inboundOrders = (AppState.inboundOrders || []).map((order) => {
        if (order.status === 'rejected') return order;
        const weights = sum(subsByInbound.get(order.id) || [], outboundById);
        const weight = Number(order.weight) || 0;
        let status = 'approved';
        if (weights.actualOutboundWeight >= weight && weight > 0) status = 'completed';
        else if (weights.actualOutboundWeight > 0) status = 'partial';
        else if (weights.preOutboundWeight > 0) status = 'outbounding';
        return Object.assign({}, order, weights, { status });
    });
}

/** 仅展示大于 0 的已出库/预出库吨数，用 · 连接（pre 仅含待完成出库单的预分配） */
function formatInboundOutboundWeightHint(actual, pre, unit) {
    const parts = [];
    const a = Number(actual) || 0;
    const p = Number(pre) || 0;
    if (a > 0) parts.push(`已出库 ${formatInboundTonShort(a, unit)}`);
    if (p > 0) parts.push(`预出库 ${formatInboundTonShort(p, unit)}`);
    return parts.join(' · ');
}

function formatInboundOutboundWeightCell(w, unit) {
    const n = Number(w) || 0;
    if (n <= 0) return '-';
    return formatInboundTonShort(n, unit);
}

function inboundStatusBadgeHtml(orderOrStatus) {
    const order = orderOrStatus && typeof orderOrStatus === 'object' ? orderOrStatus : null;
    const status = order ? order.status : orderOrStatus;
    const st = normalizeInboundFlowStatus(status);

    switch (st) {
        case 'approved':
            return '<span class="badge badge-success">待出库</span>';
        case 'rejected':
            return '<span class="badge badge-danger">已驳回</span>';
        case 'outbounding':
            return '<span class="badge badge-info">出库中</span>';
        case 'partial':
            return '<span class="badge badge-secondary">部分已出库</span>';
        case 'completed':
            return '<span class="badge badge-success">全部已出库</span>';
        default:
            return `<span class="badge badge-secondary">${status || '-'}</span>`;
    }
}

function inboundStatusDetailText(orderOrStatus, unit) {
    const order = orderOrStatus && typeof orderOrStatus === 'object' ? orderOrStatus : null;
    const status = order ? order.status : orderOrStatus;
    const st = normalizeInboundFlowStatus(status);
    const u = unit || '吨';
    const map = {
        approved: '待出库',
        rejected: '已驳回',
        outbounding: '出库中',
        partial: '部分已出库',
        completed: '全部已出库',
    };
    let base = map[st] || st || '-';
    if (order && st === 'partial') {
        const hint = formatInboundOutboundWeightHint(
            order.actualOutboundWeight,
            order.preOutboundWeight,
            u
        );
        if (hint) base += `（${hint}）`;
    } else if (order && st === 'outbounding' && Number(order.preOutboundWeight) > 0) {
        base += `（预出库 ${formatInboundTonShort(order.preOutboundWeight, u)}）`;
    }
    return base;
}

/** 入庫單：date 補齊；images[] 與舊 image 合併後寫入 images，移除 image */
function normalizeInboundOrders() {
    AppState.inboundOrders = (AppState.inboundOrders || []).map((o) => {
        if (!o) return o;
        const { image, ...rest } = o;
        let images = Array.isArray(o.images) ? o.images.filter(Boolean) : [];
        if (!images.length && image) images = [image];
        let next = { ...rest, images };

        if (next.date != null) {
            const s = String(next.date).trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
                next = { ...next, date: `${s} 00:00` };
            }
        }
        if (next.status === 'pending') {
            next = { ...next, status: 'approved' };
        }
        return next;
    });
}

// 设置事件监听器
function setupEventListeners() {
    // 登录按钮
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    
    // 演示账号点击（对接后端时仅 admin 有效，其余为离线演示数据）
    document.querySelectorAll('.account-item').forEach(item => {
        item.addEventListener('click', function() {
            if (useApiMode() && this.classList.contains('offline-demo-account')) {
                showMessage('对接后端时不能使用离线演示账号，请使用 admin / admin123 登录', 'error');
                return;
            }
            const username = this.dataset.username;
            const password = this.dataset.password;
            document.getElementById('username').value = username;
            document.getElementById('password').value = password;
        });
    });
    
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            closeUserInfoMenu();
            handleLogout();
        });
    }

    initUsersManagementEvents();
    ensureUserInfoMenuOnlyLogout();

    const userInfoTrigger = document.getElementById('user-info-trigger');
    if (userInfoTrigger) {
        userInfoTrigger.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleUserInfoMenu();
        });
    }
    const userInfoMenu = document.getElementById('user-info-menu');
    if (userInfoMenu) {
        userInfoMenu.addEventListener('click', function (e) {
            e.stopPropagation();
        });
    }
    document.addEventListener('click', function () {
        closeUserInfoMenu();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            closeUserInfoMenu();
        }
    });
    
    // 导航菜单
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const page = this.dataset.page;
            switchPage(page);
        });
    });

    const workbenchPage = document.getElementById('workbench-page');
    if (workbenchPage) {
        workbenchPage.addEventListener('click', function (e) {
            const entry = e.target.closest('.workbench-entry');
            if (!entry || entry.disabled || entry.style.display === 'none') return;
            const page = entry.dataset.page;
            if (page) switchPage(page);
        });
    }
    
    // 收货定价相关
    document.getElementById('add-pricing-btn').addEventListener('click', showAddPricingModal);
    initPricingTableSort();
    initImageLightbox();
    const pricingMarketInput = document.getElementById('pricing-market-image');
    if (pricingMarketInput) {
        pricingMarketInput.addEventListener('change', (e) => {
            void handlePricingImageUpload(e, 'market');
        });
    }
    const pricingSelfInput = document.getElementById('pricing-self-image');
    if (pricingSelfInput) {
        pricingSelfInput.addEventListener('change', (e) => {
            void handlePricingImageUpload(e, 'self');
        });
    }

    // 收货入库相关
    document.getElementById('add-inbound-btn').addEventListener('click', showAddInboundModal);
    const inboundImageInput = document.getElementById('inbound-image');
    if (inboundImageInput) {
        inboundImageInput.addEventListener('change', (e) => {
            void handleInboundImageUpload(e);
        });
    }
    document.getElementById('inbound-status-filter').addEventListener('change', filterInboundList);
    const inboundWarehouseFilter = document.getElementById('inbound-warehouse-filter');
    const inboundMaterialFilter = document.getElementById('inbound-material-filter');
    if (inboundWarehouseFilter) inboundWarehouseFilter.addEventListener('change', filterInboundList);
    if (inboundMaterialFilter) inboundMaterialFilter.addEventListener('change', filterInboundList);

    // 出库管理：创建预出库计划
    document.getElementById('add-pre-outbound-btn').addEventListener('click', showAddOutboundModal);

    const publishQuotationBtn = document.getElementById('btn-open-publish-quotation');
    if (publishQuotationBtn) {
        publishQuotationBtn.addEventListener('click', openPickMaterialForQuotationModal);
    }
    const pickMaterialQuotationConfirm = document.getElementById('pick-material-quotation-confirm-btn');
    if (pickMaterialQuotationConfirm) {
        pickMaterialQuotationConfirm.addEventListener('click', confirmPickMaterialForQuotation);
    }
    
    // 标签页切换（出库、库存等）
    document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
        btn.addEventListener('click', function() {
            const tab = this.dataset.tab;
            switchTab(tab);
        });
    });
    
    // 库存预警相关
    document.getElementById('warning-threshold').addEventListener('change', updateWarningList);
    document.getElementById('deduction-mode').addEventListener('change', updateWarningList);
    const warningStatusFilter = document.getElementById('warning-status-filter');
    if (warningStatusFilter) {
        warningStatusFilter.addEventListener('change', updateWarningList);
    }
    document.getElementById('search-report-btn').addEventListener('click', loadInventoryReport);
    
    // 报表相关
    document.getElementById('generate-report-btn').addEventListener('click', generateProfitReport);
    document.getElementById('export-report-btn').addEventListener('click', exportReportToExcel);
    initProfitReportPagination();
    
    // 回车键登录
    document.getElementById('password').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            handleLogin();
        }
    });
}

// 检查登录状态
async function checkLoginStatus() {
    if (useApiMode()) {
        const token = localStorage.getItem('apiToken');
        const user = localStorage.getItem('currentUser');
        const role = localStorage.getItem('currentRole');
        if (token && user && role) {
            AppState.currentUser = JSON.parse(user);
            AppState.currentRole = JSON.parse(role);
            try {
                const apiRaw = localStorage.getItem('apiUser');
                if (apiRaw && window.InventoryApi && window.InventoryApi.mapLoginUser) {
                    const mapped = window.InventoryApi.mapLoginUser(JSON.parse(apiRaw));
                    AppState.currentUser = mapped.user;
                    AppState.currentRole = mapped.role;
                    localStorage.setItem('currentUser', JSON.stringify(mapped.user));
                    localStorage.setItem('currentRole', JSON.stringify(mapped.role));
                }
            } catch (e) {
                /* 保持已解析的 user/role */
            }
            showAppPage();
            window.InventoryApi.refreshAppStateFromServer(AppState).then(function () {
                loadCurrentPage();
                updateDashboardStats();
            }).catch(function () {});
            return;
        }

        if (window.InventoryApi && window.InventoryApi.trySsoFromProject2) {
            try {
                const data = await window.InventoryApi.trySsoFromProject2();
                if (data && data.token && data.user) {
                    const mapped = window.InventoryApi.mapLoginUser(data.user);
                    AppState.currentUser = mapped.user;
                    AppState.currentRole = mapped.role;
                    localStorage.setItem('apiToken', data.token);
                    localStorage.setItem('apiUser', JSON.stringify(data.user));
                    localStorage.setItem('currentUser', JSON.stringify(mapped.user));
                    localStorage.setItem('currentRole', JSON.stringify(mapped.role));
                    addAction('login', '从 Project2 单点登录（SSO）');
                    showAppPage();
                    await window.InventoryApi.refreshAppStateFromServer(AppState);
                    loadCurrentPage();
                    updateDashboardStats();
                    return;
                }
            } catch (e) {
                /* 无 P2 会话时停留在登录页 */
            }
        }
        return;
    }
    const user = localStorage.getItem('currentUser');
    const role = localStorage.getItem('currentRole');
    
    if (user && role) {
        AppState.currentUser = JSON.parse(user);
        AppState.currentRole = JSON.parse(role);
        showAppPage();
    }
}

// 处理登录
async function handleLogin() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    
    if (!username || !password) {
        showMessage('请输入用户名和密码', 'error');
        return;
    }

    if (useApiMode()) {
        try {
            const data = await window.InventoryApi.login(username, password);
            const mapped = window.InventoryApi.mapLoginUser(data.user);
            AppState.currentUser = mapped.user;
            AppState.currentRole = mapped.role;
            localStorage.setItem('apiToken', data.token);
            localStorage.setItem('apiUser', JSON.stringify(data.user));
            localStorage.setItem('currentUser', JSON.stringify(mapped.user));
            localStorage.setItem('currentRole', JSON.stringify(mapped.role));
            addAction('login', '用户登录系统（API）');
            await window.InventoryApi.refreshAppStateFromServer(AppState);
            showAppPage();
            showMessage('登录成功！', 'success');
        } catch (e) {
            showMessage(e.message || '登录失败', 'error');
        }
        return;
    }
    
    const user = AppState.users.find(u => u.username === username && u.password === password);
    
    if (user) {
        const role = AppState.roles.find(r => r.id === user.roleId);
        
        AppState.currentUser = user;
        AppState.currentRole = role;
        
        // 保存到本地存储
        localStorage.setItem('currentUser', JSON.stringify(user));
        localStorage.setItem('currentRole', JSON.stringify(role));
        
        // 记录操作日志
        addAction('login', '用户登录系统');
        
        showAppPage();
        showMessage('登录成功！', 'success');
    } else {
        showMessage('用户名或密码错误', 'error');
    }
}

// 处理退出
function handleLogout() {
    closeUserInfoMenu();
    AppState.currentUser = null;
    AppState.currentRole = null;
    
    localStorage.removeItem('currentUser');
    localStorage.removeItem('currentRole');
    if (useApiMode()) {
        localStorage.removeItem('apiToken');
        localStorage.removeItem('apiUser');
    }
    
    showLoginPage();
    showMessage('已退出登录', 'info');
}

// 显示登录页面
function showLoginPage() {
    document.getElementById('login-page').classList.add('active');
    document.getElementById('app-page').classList.remove('active');
    
    // 清空表单
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
}

// 显示应用页面
function showAppPage() {
    document.getElementById('login-page').classList.remove('active');
    document.getElementById('app-page').classList.add('active');
    
    updateHeaderUserInfo();
    
    // 根据权限显示/隐藏菜单项
    updateMenuVisibility();
    
    // 加载当前页面
    loadCurrentPage();
}

/** 当前角色是否可进入某业务页（与顶栏/工作台共用） */
function hasPagePermission(page) {
    const permissions = AppState.currentRole?.permissions || [];
    if (permissions.includes('all')) return true;

    switch (page) {
        case 'dashboard':
        case 'workbench':
            return true;
        case 'pricing':
            return permissions.includes('pricing');
        case 'inbound':
        case 'outbound':
        case 'warehouse':
            return (
                permissions.includes('pricing') ||
                permissions.includes('inbound') ||
                permissions.includes('outbound')
            );
        case 'quotation':
            return permissions.includes('quotation');
        case 'inventory':
        case 'reports':
            return permissions.includes('report');
        case 'users':
            return isSystemAdministrator();
        default:
            return false;
    }
}

// 更新菜单可见性
function updateMenuVisibility() {
    document.querySelectorAll('.nav-item').forEach((item) => {
        const page = item.dataset.page;
        item.style.display = hasPagePermission(page) ? 'flex' : 'none';
    });
    updateWorkbenchVisibility();
}

function updateWorkbenchVisibility() {
    document.querySelectorAll('.workbench-entry').forEach((entry) => {
        const page = entry.dataset.page;
        const allowed = hasPagePermission(page);
        entry.style.display = allowed ? '' : 'none';
        entry.disabled = !allowed;
    });

    document.querySelectorAll('.workbench-panel').forEach((panel) => {
        const entries = panel.querySelectorAll('.workbench-entry');
        const anyVisible = Array.from(entries).some((el) => el.style.display !== 'none');
        panel.style.display = anyVisible ? '' : 'none';
    });
}

function loadWorkbench() {
    updateWorkbenchVisibility();
}

const WORKBENCH_BACK_PAGES = new Set([
    'pricing',
    'quotation',
    'inbound',
    'outbound',
    'warehouse',
    'inventory',
    'reports',
    'users',
]);

function updateBackToWorkbenchButton(page) {
    document.querySelectorAll('.back-to-workbench-wrap').forEach((el) => el.remove());
    if (!WORKBENCH_BACK_PAGES.has(page)) return;

    const pageEl = document.getElementById(`${page}-page`);
    const header = pageEl?.querySelector('.page-header');
    if (!header) return;

    const wrap = document.createElement('div');
    wrap.className = 'back-to-workbench-wrap';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-primary back-to-workbench-btn';
    btn.innerHTML = '<i class="fas fa-arrow-left" aria-hidden="true"></i> 返回首页';
    btn.addEventListener('click', function () {
        switchPage('workbench');
    });
    wrap.appendChild(btn);
    header.insertBefore(wrap, header.firstChild);
}

// 切换页面
function switchPage(page) {
    if (page === 'review' || page === 'dashboard') {
        page = 'workbench';
    }
    if (page === 'users' && !isSystemAdministrator()) {
        page = 'workbench';
    }
    AppState.currentPage = page;
    
    // 更新导航激活状态
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === page) {
            item.classList.add('active');
        }
    });
    
    // 隐藏所有页面
    document.querySelectorAll('.content-page').forEach(pageEl => {
        pageEl.classList.remove('active');
    });
    
    // 显示目标页面
    const targetPage = document.getElementById(`${page}-page`);
    if (targetPage) {
        targetPage.classList.add('active');
        loadPageContent(page);
        updateBackToWorkbenchButton(page);
    }
}

// 加载页面内容
function loadPageContent(page) {
    switch(page) {
        case 'dashboard':
        case 'workbench':
            loadDashboard();
            break;
        case 'pricing':
            loadPricingPage();
            break;
        case 'inbound':
            loadInboundPage();
            break;
        case 'warehouse':
            loadWarehousePage();
            break;
        case 'quotation':
            loadQuotationPage();
            break;
        case 'outbound':
            loadOutboundPage();
            break;
        case 'inventory':
            loadInventoryPage();
            break;
        case 'reports':
            loadReportsPage();
            break;
        case 'warehouse-daily':
            loadWarehouseDailyPage();
            break;
        case 'users':
            loadUsersPage();
            break;
    }
}

let systemUsersCache = [];
let systemUserEditingId = null;

/** 与后端 roleLabels.js 展示名一致 */
function formatSystemUserRole(role, user) {
    if (user && user.roleDisplayName) return user.roleDisplayName;
    if (role === 'statistics') return '统计部';
    if (role === 'warehouse') return '财务部管理员';
    return role || '-';
}

function loadUsersPage() {
    const list = document.getElementById('users-list');
    const addBtn = document.getElementById('add-user-btn');
    if (!list) return;

    if (!useApiMode()) {
        if (addBtn) addBtn.disabled = true;
        list.innerHTML =
            '<tr><td colspan="5" style="text-align:center;color:#95a5a6;">请使用后端 API 模式登录后管理用户</td></tr>';
        return;
    }
    if (addBtn) addBtn.disabled = false;
    list.innerHTML =
        '<tr><td colspan="5" style="text-align:center;color:#95a5a6;">加载中…</td></tr>';
    void loadSystemUsersList();
}

async function loadSystemUsersList() {
    const tbody = document.getElementById('users-list');
    if (!tbody || !window.InventoryApi) return;
    try {
        const list = await window.InventoryApi.listUsers();
        systemUsersCache = Array.isArray(list) ? list : [];
        if (systemUsersCache.length === 0) {
            tbody.innerHTML =
                '<tr><td colspan="5" style="text-align:center;color:#95a5a6;">暂无用户</td></tr>';
            return;
        }
        tbody.innerHTML = systemUsersCache
            .map((u) => {
                const canDelete = systemUsersCache.length > 1;
                return `<tr>
                    <td>${u.id}</td>
                    <td>${escapeHtml(u.username)}</td>
                    <td>${escapeHtml(formatSystemUserRole(u.role, u))}</td>
                    <td>${escapeHtml(u.created_at || '-')}</td>
                    <td>
                        <button type="button" class="btn btn-sm btn-icon" onclick="editUser(${u.id})" title="编辑">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-icon btn-danger" onclick="deleteUser(${u.id})" title="删除" ${canDelete ? '' : 'disabled'}>
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>`;
            })
            .join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#c0392b;">${escapeHtml(e.message || '加载失败')}</td></tr>`;
    }
}

function showAddUserModal() {
    openSystemUserForm(null);
}

function editUser(id) {
    const row = systemUsersCache.find((x) => x.id === id);
    if (row) openSystemUserForm(row);
}

function deleteUser(id) {
    void deleteSystemUser(id);
}

function openSystemUserForm(record) {
    systemUserEditingId = record ? record.id : null;
    const titleEl = document.getElementById('system-user-form-title');
    const pwdLabel = document.getElementById('system-user-password-label');
    const pwdInput = document.getElementById('system-user-password');
    const usernameInput = document.getElementById('system-user-username');
    const roleSelect = document.getElementById('system-user-role');
    if (!titleEl || !pwdLabel || !pwdInput || !usernameInput || !roleSelect) return;

    if (record) {
        titleEl.innerHTML = '<i class="fas fa-user-edit"></i> 编辑用户';
        pwdLabel.textContent = '新密码（留空则不修改）';
        pwdInput.placeholder = '不修改请留空';
        pwdInput.value = '';
        usernameInput.value = record.username || '';
        roleSelect.value = record.role === 'statistics' ? 'statistics' : 'warehouse';
    } else {
        titleEl.innerHTML = '<i class="fas fa-user-plus"></i> 新建用户';
        pwdLabel.textContent = '密码';
        pwdInput.placeholder = '至少 4 位';
        pwdInput.value = '';
        usernameInput.value = '';
        roleSelect.value = 'warehouse';
    }

    const modal = document.getElementById('system-user-form-modal');
    if (modal) openModal(modal);
}

async function submitSystemUserForm() {
    if (!useApiMode() || !window.InventoryApi) {
        showMessage('请使用 API 模式', 'error');
        return;
    }
    const username = (document.getElementById('system-user-username')?.value || '').trim();
    const password = document.getElementById('system-user-password')?.value || '';
    const role = document.getElementById('system-user-role')?.value || 'warehouse';

    if (!username) {
        showMessage('请输入用户名', 'error');
        return;
    }

    try {
        if (systemUserEditingId) {
            const body = { username, role };
            if (password.trim()) {
                if (password.length < 4) {
                    showMessage('密码至少 4 位', 'error');
                    return;
                }
                body.password = password;
            }
            await window.InventoryApi.updateUser(systemUserEditingId, body);
            showMessage('用户已更新', 'success');
        } else {
            if (!password || password.length < 4) {
                showMessage('密码至少 4 位', 'error');
                return;
            }
            await window.InventoryApi.createUser({ username, password, role });
            showMessage('用户已创建', 'success');
        }
        closeModal('system-user-form-modal');
        loadUsersPage();
    } catch (e) {
        showMessage(e.message || '保存失败', 'error');
    }
}

async function deleteSystemUser(id) {
    if (!useApiMode() || !window.InventoryApi) return;
    const row = systemUsersCache.find((x) => x.id === id);
    if (!row) return;
    if (systemUsersCache.length <= 1) {
        showMessage('至少保留一个用户', 'error');
        return;
    }
    const currentApiUser = (() => {
        try {
            const raw = localStorage.getItem('apiUser');
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    })();
    const msg =
        currentApiUser && currentApiUser.id === id
            ? '将删除当前登录用户，删除后需重新登录，确定？'
            : `确定删除用户「${row.username}」？`;
    if (!confirm(msg)) return;

    try {
        await window.InventoryApi.deleteUser(id);
        showMessage('用户已删除', 'success');
        if (currentApiUser && currentApiUser.id === id) {
            handleLogout();
            return;
        }
        loadUsersPage();
    } catch (e) {
        showMessage(e.message || '删除失败', 'error');
    }
}

function initUsersManagementEvents() {
    const addBtn = document.getElementById('add-user-btn');
    if (addBtn) {
        addBtn.addEventListener('click', showAddUserModal);
    }

    const saveBtn = document.getElementById('system-user-form-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => void submitSystemUserForm());
    }
}

// 加载当前页面
function loadCurrentPage() {
    loadPageContent(AppState.currentPage);
}

// 切换标签页
function switchTab(tab) {
    // 更新按钮状态
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tab) {
            btn.classList.add('active');
        }
    });
    
    // 更新内容显示
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    const targetContent = document.getElementById(`${tab}-tab`);
    if (targetContent) {
        targetContent.classList.add('active');
    }
    
    // 加载标签页内容
    switch(tab) {
        case 'pre-outbound':
        case 'actual-outbound':
        case 'outbound-history':
            loadOutboundTab(tab);
            break;
        case 'inventory-warning':
        case 'inventory-report':
            loadInventoryTab(tab);
            break;
    }
}

// 显示消息
function showMessage(message, type = 'info') {
    // 创建消息元素
    const messageEl = document.createElement('div');
    messageEl.className = `message message-${type}`;
    messageEl.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;
    
    // 添加到页面
    document.body.appendChild(messageEl);
    
    // 显示动画
    setTimeout(() => {
        messageEl.classList.add('show');
    }, 10);
    
    // 自动消失
    setTimeout(() => {
        messageEl.classList.remove('show');
        setTimeout(() => {
            if (messageEl.parentNode) {
                messageEl.parentNode.removeChild(messageEl);
            }
        }, 300);
    }, 3000);
}

// 添加操作日志
function addAction(type, detail) {
    const action = {
        id: AppState.actions.length + 1,
        type: type,
        detail: detail,
        userId: AppState.currentUser.id,
        time: new Date().toLocaleString('zh-CN')
    };
    
    AppState.actions.unshift(action);
    saveToLocalStorage();
    
    // 更新最近操作列表
    if (AppState.currentPage === 'dashboard' || AppState.currentPage === 'workbench') {
        updateRecentActions();
    }
}

// 工具函数：获取对象名称
function getMaterialName(id) {
    const material = AppState.materials.find(m => m.id === id);
    return material ? material.name : '未知';
}

function getWarehouseName(id) {
    const warehouse = AppState.warehouses.find(w => w.id === id);
    return warehouse ? warehouse.name : '未知';
}

/** 品种当前启用中的对外报价（元/吨），用于入库列表「出库单价」展示 */
function getActiveQuotationPriceForMaterial(materialId) {
    const q = AppState.quotations.find(
        (x) => Number(x.materialId) === Number(materialId) && x.isActive
    );
    return q != null && Number.isFinite(Number(q.price)) ? Number(q.price) : null;
}

function getUserName(id) {
    const user = AppState.users.find(u => u.id === id);
    return user ? user.name : '未知';
}

// 工具函数：格式化数字
function formatNumber(num) {
    const n = Number(num);
    if (!Number.isFinite(n)) return '0';
    const parts = String(n).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.length > 1 ? parts.join('.') : parts[0];
}

function formatCurrency(num) {
    return '¥' + formatNumber(num);
}

function formatDate(dateStr) {
    return dateStr;
}

function escapeHtml(text) {
    const s = text == null ? '' : String(text);
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function extractDatePart(dateTimeStr) {
    if (!dateTimeStr) return '';
    return String(dateTimeStr).split(/[\sT]/)[0] || '';
}

function formatDateTime(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    const seconds = String(dateObj.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/** 出库管理列表/详情时间展示（精确到秒） */
function formatOutboundTimeDisplay(value) {
    return formatQuotationPublishDisplay(value);
}

let imageLightboxScale = 1;

function openImageLightbox(src, caption) {
    const box = document.getElementById('image-lightbox');
    const img = document.getElementById('image-lightbox-img');
    const cap = document.getElementById('image-lightbox-caption');
    if (!box || !img || !src) return;
    img.src = src;
    img.alt = caption || '图片预览';
    if (cap) cap.textContent = caption || '';
    imageLightboxScale = 1;
    img.style.transform = 'scale(1)';
    box.hidden = false;
    box.setAttribute('aria-hidden', 'false');
}

function closeImageLightbox() {
    const box = document.getElementById('image-lightbox');
    const img = document.getElementById('image-lightbox-img');
    if (!box) return;
    box.hidden = true;
    box.setAttribute('aria-hidden', 'true');
    if (img) {
        img.src = '';
        img.style.transform = '';
    }
}

function imageLightboxZoom(delta) {
    const img = document.getElementById('image-lightbox-img');
    if (!img) return;
    imageLightboxScale = Math.min(4, Math.max(0.25, imageLightboxScale + delta));
    img.style.transform = `scale(${imageLightboxScale})`;
}

function imageLightboxResetZoom() {
    imageLightboxScale = 1;
    const img = document.getElementById('image-lightbox-img');
    if (img) img.style.transform = 'scale(1)';
}

function initImageLightbox() {
    document.addEventListener('click', function (e) {
        if (e.target.closest('.image-lightbox-toolbar, .image-lightbox-backdrop')) return;
        const img = e.target.closest(
            '.view-multi-img-wrap img, #weighing-slip-preview-img, .image-previewable'
        );
        if (!img || !img.src || img.closest('#image-lightbox')) return;
        e.preventDefault();
        openImageLightbox(img.src, img.alt || '图片预览');
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeImageLightbox();
    });
}

function getWarehouseLabel(warehouseId) {
    if (warehouseId == null || warehouseId === '') return '-';
    const w = AppState.warehouses.find((x) => x.id === warehouseId);
    return w ? `${w.code} - ${w.name}` : '-';
}

function formatPricingRecordNo(record) {
    const id = record && record.id != null ? record.id : '';
    return id !== '' ? `PP-${String(id).padStart(4, '0')}` : '-';
}

/** 收货定价列表表头排序：key 为 recordNo | material | price | datetime */
const pricingTableSort = { key: null, dir: 'asc' };

function getPricingRecordSortValue(record, key) {
    const material = AppState.materials.find((m) => m.id === record.materialId);
    switch (key) {
        case 'recordNo':
            return Number(record.id) || 0;
        case 'material':
            return material ? `${material.code}\t${material.name}` : '';
        case 'price':
            return Number(record.price) || 0;
        case 'datetime':
            return pricingRecordSortTime(record);
        default:
            return 0;
    }
}

function comparePricingRecords(a, b, key, dir) {
    const va = getPricingRecordSortValue(a, key);
    const vb = getPricingRecordSortValue(b, key);
    let cmp = 0;
    if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
    } else {
        cmp = String(va).localeCompare(String(vb), 'zh-Hans-CN', { numeric: true });
    }
    if (cmp === 0) {
        cmp = (Number(a.id) || 0) - (Number(b.id) || 0);
    }
    return dir === 'desc' ? -cmp : cmp;
}

function getSortedPricingRecordsForList() {
    const records = AppState.pricingRecords.filter((r) =>
        AppState.materials.some((m) => m.id === r.materialId)
    );
    if (!pricingTableSort.key) return records;
    return [...records].sort((a, b) =>
        comparePricingRecords(a, b, pricingTableSort.key, pricingTableSort.dir)
    );
}

function updatePricingSortableHeaders() {
    document.querySelectorAll('#pricing-page .sortable-th[data-sort]').forEach((th) => {
        const key = th.dataset.sort;
        const btn = th.querySelector('.sortable-th-btn');
        const icon = th.querySelector('.sort-indicator');
        const active = pricingTableSort.key === key;
        th.classList.toggle('sort-active', active);
        if (icon) {
            icon.className =
                'sort-indicator fas ' +
                (!active ? 'fa-sort' : pricingTableSort.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down');
        }
        if (btn) {
            btn.setAttribute(
                'aria-sort',
                active ? (pricingTableSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
            );
        }
    });
}

function onPricingHeaderSortClick(sortKey) {
    if (pricingTableSort.key === sortKey) {
        pricingTableSort.dir = pricingTableSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        pricingTableSort.key = sortKey;
        pricingTableSort.dir = 'asc';
    }
    loadPricingPage();
}

function initPricingTableSort() {
    document.querySelectorAll('#pricing-page .sortable-th[data-sort]').forEach((th) => {
        const key = th.dataset.sort;
        const btn = th.querySelector('.sortable-th-btn');
        if (!key || !btn || btn.dataset.sortBound === '1') return;
        btn.dataset.sortBound = '1';
        btn.addEventListener('click', function () {
            onPricingHeaderSortClick(key);
        });
    });
}

/** 出库历史：汇总 FIFO 关联的入库单号（去重，顿号分隔） */
/** 出库历史：入库单号及本单 FIFO 扣减吨数，如 RK-20260516-1447(20吨) */
function formatOutboundInboundOrderNos(outboundOrderId, unit) {
    const u = unit || '吨';
    const subs = AppState.outboundSuborders
        .filter((s) => s.outboundOrderId === outboundOrderId)
        .slice()
        .sort((a, b) => {
            const la = a.lineNo || 0;
            const lb = b.lineNo || 0;
            if (la !== lb) return la - lb;
            return (a.id || 0) - (b.id || 0);
        });
    if (!subs.length) return '-';

    const weightByNo = new Map();
    const orderKeys = [];
    subs.forEach((sub) => {
        const inbound = AppState.inboundOrders.find((o) => o.id === sub.inboundOrderId);
        const no =
            (sub.inboundOrderNo && String(sub.inboundOrderNo).trim()) ||
            inbound?.orderNo ||
            (sub.inboundOrderId != null ? `#${sub.inboundOrderId}` : '');
        if (!no) return;
        const w =
            Number(sub.actualWeight) > 0
                ? Number(sub.actualWeight)
                : Number(sub.preWeight) || 0;
        if (!weightByNo.has(no)) orderKeys.push(no);
        weightByNo.set(no, (weightByNo.get(no) || 0) + w);
    });

    const parts = orderKeys.map((no) => {
        const w = weightByNo.get(no) || 0;
        const wText = w % 1 === 0 ? String(w) : w.toFixed(2);
        return `${no}(${wText}${u})`;
    });
    return parts.length ? parts.join('、') : '-';
}

/** 按子单 FIFO 分摊出库成本（与报表、出库历史一致） */
function allocateOutboundOrderCost(order) {
    const actualW = Number(order.actualWeight) || 0;
    if (actualW <= 0) return 0;
    let cost = 0;
    let remainingWeight = actualW;
    const suborders = AppState.outboundSuborders.filter((s) => s.outboundOrderId === order.id);
    for (const suborder of suborders) {
        if (remainingWeight <= 0) break;
        const inboundOrder = AppState.inboundOrders.find((o) => o.id === suborder.inboundOrderId);
        if (!inboundOrder) continue;
        const subAct = Number(suborder.actualWeight) || 0;
        const subPre = Number(suborder.preWeight) || 0;
        const lineWeight = subAct > 0 ? subAct : subPre;
        if (lineWeight <= 0) continue;
        const allocateWeight = Math.min(lineWeight, remainingWeight);
        cost += allocateWeight * (Number(inboundOrder.unitPrice) || 0);
        remainingWeight -= allocateWeight;
    }
    return cost;
}

function parseDateTime(dateTimeStr) {
    if (!dateTimeStr) return null;
    const s = String(dateTimeStr).trim();
    if (s.includes('T')) {
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }
    const parts = s.split(' ');
    if (parts.length >= 2) {
        const dateParts = parts[0].split('-');
        const timeParts = parts[1].split(':');
        return new Date(
            parseInt(dateParts[0], 10),
            parseInt(dateParts[1], 10) - 1,
            parseInt(dateParts[2], 10),
            parseInt(timeParts[0], 10) || 0,
            parseInt(timeParts[1], 10) || 0
        );
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
        return new Date(`${parts[0]}T00:00:00`);
    }
    return null;
}

/** 解析报价发布时间（支持 YYYY-MM-DD、YYYY-MM-DD HH:mm[:ss]、含 T 的 ISO） */
function parseQuotationDateTime(value) {
    if (!value) return 0;
    const v = String(value).trim();
    if (v.includes('T')) {
        const t = new Date(v).getTime();
        return isNaN(t) ? 0 : t;
    }
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v)) {
        let isoish = v.replace(' ', 'T');
        if (!/T\d{2}:\d{2}:\d{2}$/.test(isoish)) {
            isoish = `${isoish}:00`;
        }
        const t = new Date(isoish).getTime();
        return isNaN(t) ? 0 : t;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const t = new Date(v + 'T00:00:00').getTime();
        return isNaN(t) ? 0 : t;
    }
    const t = new Date(v).getTime();
    return isNaN(t) ? 0 : t;
}

/** 报价发布时间展示为 YYYY-MM-DD HH:mm:ss（精确到秒） */
function formatQuotationPublishDisplay(value) {
    const ts = parseQuotationDateTime(value);
    if (!ts) return value || '-';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 存储值转为 datetime-local 控件值（含秒） */
function quotationStoredToDatetimeLocal(stored) {
    if (!stored) return '';
    const s = String(stored).trim();
    if (s.includes('T')) {
        const noZ = s.replace(/Z.*$/i, '').split('.')[0];
        return noZ.length >= 19 ? noZ.slice(0, 19) : `${noZ.slice(0, 16)}:00`;
    }
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) {
        const [datePart, rest] = s.split(' ');
        const seg = rest.split(':');
        const hh = (seg[0] || '00').padStart(2, '0').slice(0, 2);
        const mm = (seg[1] || '00').padStart(2, '0').slice(0, 2);
        const ss = (seg[2] != null ? String(seg[2]) : '00').padStart(2, '0').slice(0, 2);
        return `${datePart}T${hh}:${mm}:${ss}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00`;
    return '';
}

/** datetime-local 提交为统一存储格式 YYYY-MM-DD HH:mm:ss */
function normalizeQuotationDatetimeLocal(inputVal) {
    if (!inputVal) return '';
    const parts = inputVal.split('T');
    if (parts.length < 2) return inputVal.trim();
    const [datePart, timePartRaw] = parts;
    const timePart = (timePartRaw || '').replace(/Z.*$/i, '').split('.')[0];
    const seg = timePart.split(':');
    const hh = (seg[0] || '00').padStart(2, '0').slice(0, 2);
    const mm = (seg[1] || '00').padStart(2, '0').slice(0, 2);
    const ss = (seg[2] != null ? String(seg[2]) : '00').padStart(2, '0').slice(0, 2);
    return `${datePart} ${hh}:${mm}:${ss}`;
}

function nowDatetimeLocalValue() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 安全写入文案（元素不存在时不抛错）
function setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// 更新仪表板统计数据（与 index.html 中 stat 卡片 id 一致）
function updateDashboardStats() {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthInboundCount = AppState.inboundOrders.filter((order) => {
        const st = normalizeInboundFlowStatus(order.status);
        if (st === 'rejected') return false;
        const d = order.date ? String(order.date).slice(0, 7) : '';
        return d === ym;
    }).length;

    const thresholdEl = document.getElementById('warning-threshold');
    const threshold = thresholdEl ? parseInt(thresholdEl.value, 10) || 30 : 30;
    const deductionEl = document.getElementById('deduction-mode');
    const deductionMode = deductionEl ? deductionEl.value : 'both';

    const inventoryByMaterialWarehouse = {};
    AppState.inboundOrders.forEach((order) => {
        if (order.status !== 'approved' && order.status !== 'outbounding') return;
        const key = `${order.materialId}-${order.warehouseId}`;
        if (!inventoryByMaterialWarehouse[key]) {
            inventoryByMaterialWarehouse[key] = { totalAvailable: 0 };
        }
        const availRaw =
            order.weight - order.actualOutboundWeight - (deductionMode === 'both' ? order.preOutboundWeight : 0);
        inventoryByMaterialWarehouse[key].totalAvailable += Math.max(0, availRaw);
    });
    let warningCount = 0;
    Object.values(inventoryByMaterialWarehouse).forEach((inv) => {
        if (inv.totalAvailable > threshold) warningCount++;
    });

    const monthCompleted = AppState.outboundOrders.filter(
        (o) => o.status === 'completed' && o.date && String(o.date).slice(0, 7) === ym
    );
    let monthProfit = 0;
    monthCompleted.forEach((order) => {
        const revenue = order.actualWeight * order.price;
        monthProfit += revenue - allocateOutboundOrderCost(order);
    });

    renderDashboardLatestPrices();
    setElementText('month-inbound-count', String(monthInboundCount));
    setElementText('warning-count', String(warningCount));
    setElementText('month-profit', formatCurrency(monthProfit));

    updateRecentActions();
}

function actionTypeLabel(type) {
    const map = {
        login: '登录',
        pricing: '收货定价',
        inbound: '收货入库',
        warehouse: '库房管理',
        review: '收货入库',
        outbound: '出库管理',
        quotation: '对外报价',
        report: '报表'
    };
    return map[type] || type || '其他';
}

// 更新最近操作列表（首页表格 tbody#recent-actions-list）
function updateRecentActions() {
    const recentActions = AppState.actions.slice(0, 10);
    const tbody = document.getElementById('recent-actions-list');
    if (!tbody) return;

    tbody.innerHTML = '';

    recentActions.forEach((action) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${action.time || '-'}</td>
            <td>${actionTypeLabel(action.type)}</td>
            <td>${action.detail || '-'}</td>
            <td>${getUserName(action.userId)}</td>
        `;
        tbody.appendChild(row);
    });
}

// 加载首页工作台（已合并原仪表板数据区）
function loadDashboard() {
    loadWorkbench();
    updateDashboardStats();
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('read'));
        reader.readAsDataURL(file);
    });
}

function renderPricingTempPreviews(type) {
    const containerId = type === 'market' ? 'pricing-market-previews' : 'pricing-self-previews';
    const container = document.getElementById(containerId);
    if (!container) return;
    const arr = type === 'market' ? AppState.tempMarketImages : AppState.tempSelfImages;
    container.innerHTML = '';
    arr.forEach((src, idx) => {
        const wrap = document.createElement('div');
        wrap.className = 'pricing-preview-item';
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pricing-preview-remove';
        btn.title = '移除';
        btn.innerHTML = '&times;';
        btn.addEventListener('click', () => removePricingTempImage(type, idx));
        wrap.appendChild(img);
        wrap.appendChild(btn);
        container.appendChild(wrap);
    });
}

function removePricingTempImage(type, index) {
    const arr = type === 'market' ? AppState.tempMarketImages : AppState.tempSelfImages;
    if (index < 0 || index >= arr.length) return;
    arr.splice(index, 1);
    renderPricingTempPreviews(type);
}

async function handlePricingImageUpload(event, type) {
    const input = event.target;
    const files = Array.from(input.files || []);
    input.value = '';

    const arr = type === 'market' ? AppState.tempMarketImages : AppState.tempSelfImages;

    for (const file of files) {
        if (arr.length >= PRICING_MAX_IMAGES_PER_GROUP) {
            showMessage(`每类凭证最多${PRICING_MAX_IMAGES_PER_GROUP}张`, 'warning');
            break;
        }
        if (!file.type.startsWith('image/')) {
            showMessage('请选择图片文件', 'error');
            continue;
        }
        if (file.size > 5 * 1024 * 1024) {
            showMessage('图片大小不能超过5MB', 'error');
            continue;
        }
        try {
            arr.push(await readFileAsDataURL(file));
        } catch {
            showMessage('图片读取失败', 'error');
        }
    }
    renderPricingTempPreviews(type);
}

function renderInboundTempPreviews() {
    const container = document.getElementById('inbound-image-previews');
    if (!container) return;
    container.innerHTML = '';
    AppState.tempInboundImages.forEach((src, idx) => {
        const wrap = document.createElement('div');
        wrap.className = 'pricing-preview-item';
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pricing-preview-remove';
        btn.title = '移除';
        btn.innerHTML = '&times;';
        btn.addEventListener('click', () => removeInboundTempImage(idx));
        wrap.appendChild(img);
        wrap.appendChild(btn);
        container.appendChild(wrap);
    });
}

function removeInboundTempImage(index) {
    if (index < 0 || index >= AppState.tempInboundImages.length) return;
    AppState.tempInboundImages.splice(index, 1);
    renderInboundTempPreviews();
}

async function handleInboundImageUpload(event) {
    const input = event.target;
    const files = Array.from(input.files || []);
    input.value = '';

    for (const file of files) {
        if (AppState.tempInboundImages.length >= INBOUND_MAX_IMAGES) {
            showMessage(`入库照片最多${INBOUND_MAX_IMAGES}张`, 'warning');
            break;
        }
        if (!file.type.startsWith('image/')) {
            showMessage('请选择图片文件', 'error');
            continue;
        }
        if (file.size > 5 * 1024 * 1024) {
            showMessage('图片大小不能超过5MB', 'error');
            continue;
        }
        try {
            AppState.tempInboundImages.push(await readFileAsDataURL(file));
        } catch {
            showMessage('图片读取失败', 'error');
        }
    }
    renderInboundTempPreviews();
}

function pricingRecordMarketImages(record) {
    if (!record) return [];
    if (Array.isArray(record.marketImages) && record.marketImages.length) return record.marketImages.filter(Boolean);
    if (record.marketImage) return [record.marketImage];
    return [];
}

function pricingRecordSelfImages(record) {
    if (!record) return [];
    if (Array.isArray(record.selfImages) && record.selfImages.length) return record.selfImages.filter(Boolean);
    if (record.selfImage) return [record.selfImage];
    return [];
}

function viewPricingImages(id) {
    const record = AppState.pricingRecords.find((r) => r.id === id);
    if (!record) return;

    const marketContainer = document.getElementById('view-market-image-container');
    const selfContainer = document.getElementById('view-self-image-container');
    if (!marketContainer || !selfContainer) return;

    const marketImgs = pricingRecordMarketImages(record);
    const selfImgs = pricingRecordSelfImages(record);

    marketContainer.innerHTML = marketImgs.length
        ? `<div class="view-multi-img-grid">${marketImgs
              .map(
                  (src, i) =>
                      `<div class="view-multi-img-wrap"><img class="image-previewable" src="${src}" alt="行情凭证 ${i + 1}"></div>`
              )
              .join('')}</div>`
        : '<div class="no-image">暂无行情凭证</div>';

    selfContainer.innerHTML = selfImgs.length
        ? `<div class="view-multi-img-grid">${selfImgs
              .map(
                  (src, i) =>
                      `<div class="view-multi-img-wrap"><img class="image-previewable" src="${src}" alt="收货价格凭证 ${i + 1}"></div>`
              )
              .join('')}</div>`
        : '<div class="no-image">暂无收货价格凭证</div>';

    const modal = document.getElementById('view-images-modal');
    if (modal) openModal(modal);
}

function viewInboundImage(id) {
    const order = AppState.inboundOrders.find((o) => o.id === id);
    if (!order) return;

    const container = document.getElementById('view-inbound-image-container');
    if (!container) return;

    const imgs = inboundOrderImages(order);
    if (imgs.length) {
        container.innerHTML = `<div class="view-multi-img-grid">${imgs
            .map(
                (src, i) =>
                    `<div class="view-multi-img-wrap"><img class="image-previewable" src="${src}" alt="入库照片 ${i + 1}"></div>`
            )
            .join('')}</div>`;
    } else {
        container.innerHTML = '<div class="no-image">暂无入库照片</div>';
    }

    const modal = document.getElementById('view-image-modal');
    if (modal) openModal(modal);
}

// 加载收货定价页面
function loadPricingPage() {
    const pricingList = document.getElementById('pricing-list');
    if (!pricingList) return;

    const addBtn = document.getElementById('add-pricing-btn');
    if (addBtn) {
        addBtn.style.display = !useApiMode() || isWarehouseApiRoleOrSuperAdmin() ? '' : 'none';
    }

    pricingList.innerHTML = '';

    if (AppState.pricingRecords.length === 0) {
        pricingList.innerHTML =
            '<tr><td colspan="5" style="text-align: center; color: #999;">暂无数据</td></tr>';
        updatePricingSortableHeaders();
        return;
    }

    const canMutatePricing = !useApiMode() || isWarehouseApiRoleOrSuperAdmin();

    getSortedPricingRecordsForList().forEach((record) => {
        const material = AppState.materials.find((m) => m.id === record.materialId);
        if (!material) return;

        const displayTime = record.datetime || record.date || '-';

        const editDelete = canMutatePricing
            ? `<button class="btn btn-sm btn-icon" onclick="editPricing(${record.id})">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-icon btn-danger" onclick="deletePricing(${record.id})">
                    <i class="fas fa-trash"></i>
                </button>`
            : '';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${formatPricingRecordNo(record)}</td>
            <td>${material.code} - ${material.name}</td>
            <td>${formatCurrency(record.price)}/${material.unit}</td>
            <td class="datetime-display">${displayTime}</td>
            <td>
                ${editDelete}
                <button type="button" class="btn btn-sm btn-icon btn-view" onclick="viewPricingImages(${record.id})" title="查看凭证">
                    <i class="fas fa-eye"></i>
                </button>
            </td>
        `;
        pricingList.appendChild(row);
    });
    updatePricingSortableHeaders();
}

// 显示新增定价模态框
function showAddPricingModal() {
    if (useApiMode() && !isWarehouseApiRoleOrSuperAdmin()) {
        showMessage('收货定价的新增/修改/删除仅库房角色可操作，请使用库房账号登录或由统计部创建库房用户', 'error');
        return;
    }
    const modal = document.getElementById('add-pricing-modal');
    if (!modal) return;

    document.getElementById('pricing-material').value = '';
    document.getElementById('pricing-price').value = '';

    const dateInput = document.getElementById('pricing-date');
    if (dateInput) dateInput.value = nowDatetimeLocalValue();

    AppState.tempMarketImages = [];
    AppState.tempSelfImages = [];
    renderPricingTempPreviews('market');
    renderPricingTempPreviews('self');
    const mi = document.getElementById('pricing-market-image');
    const si = document.getElementById('pricing-self-image');
    if (mi) mi.value = '';
    if (si) si.value = '';

    const materialSelect = document.getElementById('pricing-material');
    materialSelect.innerHTML = '<option value="">选择品种</option>';
    AppState.materials.forEach((material) => {
        const option = document.createElement('option');
        option.value = material.id;
        option.textContent = `${material.code} - ${material.name}`;
        materialSelect.appendChild(option);
    });

    const saveBtn = modal.querySelector('.modal-footer .btn-primary');
    if (saveBtn) {
        saveBtn.onclick = savePricing;
        saveBtn.textContent = '保存';
    }

    openModal(modal);
}

// 保存定价记录
function savePricing() {
    const materialId = parseInt(document.getElementById('pricing-material').value, 10);
    const price = parseFloat(document.getElementById('pricing-price').value);
    const datetimeLocal = document.getElementById('pricing-date').value;

    if (!materialId || !price || !datetimeLocal) {
        showMessage('请填写完整信息', 'error');
        return;
    }

    if (useApiMode()) {
        const market = (AppState.tempMarketImages || []).filter(Boolean).join(',');
        const recv = (AppState.tempSelfImages || []).filter(Boolean).join(',');
        const enteredAt = new Date(datetimeLocal).toISOString();
        void (async function () {
            try {
                await window.InventoryApi.createPurchasePrice({
                    materialId: materialId,
                    unitPrice: price,
                    enteredAt: enteredAt,
                    marketPriceProof: market,
                    receivePriceProof: recv,
                });
                await window.InventoryApi.refreshAppStateFromServer(AppState);
                document.getElementById('add-pricing-modal').style.display = 'none';
                loadPricingPage();
                updateDashboardStats();
                const material = AppState.materials.find((m) => m.id === materialId);
                showMessage(`已添加${material?.name}定价 ¥${formatNumber(price)}/吨`, 'success');
                addAction('pricing', `新增${material?.name}定价（API）`);
            } catch (e) {
                showMessage(e.message || '保存失败', 'error');
            }
        })();
        return;
    }

    const dateObj = new Date(datetimeLocal);
    const formattedDateTime = formatDateTime(dateObj);
    const dateKey = extractDatePart(formattedDateTime);

    const newPricing = {
        id: AppState.pricingRecords.length ? Math.max(...AppState.pricingRecords.map((r) => r.id)) + 1 : 1,
        materialId,
        price,
        date: dateKey,
        datetime: formattedDateTime,
        note: '',
        marketImages: [...AppState.tempMarketImages],
        selfImages: [...AppState.tempSelfImages]
    };

    AppState.pricingRecords.push(newPricing);
    saveToLocalStorage();

    document.getElementById('add-pricing-modal').style.display = 'none';

    loadPricingPage();

    const material = AppState.materials.find((m) => m.id === materialId);
    showMessage(`已添加${material?.name}定价 ¥${formatNumber(price)}/吨`, 'success');
    addAction('pricing', `新增${material?.name}定价 ¥${formatNumber(price)}/吨`);
}

// 编辑定价记录
function editPricing(id) {
    if (useApiMode() && !isWarehouseApiRoleOrSuperAdmin()) {
        showMessage('收货定价仅库房角色可编辑', 'error');
        return;
    }
    const record = AppState.pricingRecords.find((r) => r.id === id);
    if (!record) return;

    const materialSelect = document.getElementById('pricing-material');
    materialSelect.innerHTML = '<option value="">选择品种</option>';
    AppState.materials.forEach((material) => {
        const option = document.createElement('option');
        option.value = material.id;
        option.textContent = `${material.code} - ${material.name}`;
        option.selected = material.id === record.materialId;
        materialSelect.appendChild(option);
    });

    document.getElementById('pricing-price').value = record.price;

    const dtSrc = record.datetime || (record.date ? `${record.date} 00:00` : '');
    const dateObj = parseDateTime(dtSrc) || (record.date ? new Date(`${record.date}T00:00`) : null);
    const dateInput = document.getElementById('pricing-date');
    if (dateInput && dateObj) {
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        const hours = String(dateObj.getHours()).padStart(2, '0');
        const minutes = String(dateObj.getMinutes()).padStart(2, '0');
        dateInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    AppState.tempMarketImages = [...pricingRecordMarketImages(record)];
    AppState.tempSelfImages = [...pricingRecordSelfImages(record)];
    renderPricingTempPreviews('market');
    renderPricingTempPreviews('self');
    const mi = document.getElementById('pricing-market-image');
    const si = document.getElementById('pricing-self-image');
    if (mi) mi.value = '';
    if (si) si.value = '';

    const modal = document.getElementById('add-pricing-modal');
    openModal(modal);

    const saveBtn = modal.querySelector('.modal-footer .btn-primary');
    if (saveBtn) {
        saveBtn.onclick = function () {
            updatePricing(id);
        };
        saveBtn.textContent = '更新定价';
    }
}

// 更新定价记录
function updatePricing(id) {
    const materialId = parseInt(document.getElementById('pricing-material').value, 10);
    const price = parseFloat(document.getElementById('pricing-price').value);
    const datetimeLocal = document.getElementById('pricing-date').value;

    if (!materialId || !price || !datetimeLocal) {
        showMessage('请填写完整信息', 'error');
        return;
    }

    if (useApiMode()) {
        const market = (AppState.tempMarketImages || []).filter(Boolean).join(',');
        const recv = (AppState.tempSelfImages || []).filter(Boolean).join(',');
        const enteredAt = new Date(datetimeLocal).toISOString();
        void (async function () {
            try {
                await window.InventoryApi.updatePurchasePrice(id, {
                    materialId: materialId,
                    unitPrice: price,
                    enteredAt: enteredAt,
                    marketPriceProof: market,
                    receivePriceProof: recv,
                });
                await window.InventoryApi.refreshAppStateFromServer(AppState);
                document.getElementById('add-pricing-modal').style.display = 'none';
                loadPricingPage();
                const modal = document.getElementById('add-pricing-modal');
                const saveBtn = modal && modal.querySelector('.modal-footer .btn-primary');
                if (saveBtn) {
                    saveBtn.onclick = savePricing;
                    saveBtn.textContent = '保存';
                }
                showMessage('已更新定价', 'success');
            } catch (e) {
                showMessage(e.message || '更新失败', 'error');
            }
        })();
        return;
    }

    const recordIndex = AppState.pricingRecords.findIndex((r) => r.id === id);
    if (recordIndex === -1) return;

    const dateObj = new Date(datetimeLocal);
    const formattedDateTime = formatDateTime(dateObj);
    const dateKey = extractDatePart(formattedDateTime);

    const prevRec = AppState.pricingRecords[recordIndex];
    const { marketImage: _rm, selfImage: _rs, ...prevRest } = prevRec;

    AppState.pricingRecords[recordIndex] = {
        ...prevRest,
        materialId,
        price,
        date: dateKey,
        datetime: formattedDateTime,
        marketImages: [...AppState.tempMarketImages],
        selfImages: [...AppState.tempSelfImages]
    };

    saveToLocalStorage();

    document.getElementById('add-pricing-modal').style.display = 'none';

    loadPricingPage();

    const material = AppState.materials.find((m) => m.id === materialId);
    showMessage(`已更新${material?.name}定价`, 'success');
    addAction('pricing', `更新${material?.name}定价为 ¥${formatNumber(price)}/吨`);

    const modal = document.getElementById('add-pricing-modal');
    const saveBtn = modal.querySelector('.modal-footer .btn-primary');
    if (saveBtn) {
        saveBtn.onclick = savePricing;
        saveBtn.textContent = '保存';
    }
}

// 删除定价记录
function deletePricing(id) {
    if (useApiMode() && !isWarehouseApiRoleOrSuperAdmin()) {
        showMessage('收货定价仅库房角色可删除', 'error');
        return;
    }
    if (!confirm('确定要删除这条定价记录吗？')) return;

    if (useApiMode()) {
        void (async function () {
            try {
                await window.InventoryApi.deletePurchasePrice(id);
                await window.InventoryApi.refreshAppStateFromServer(AppState);
                loadPricingPage();
                showMessage('已删除定价记录', 'success');
            } catch (e) {
                showMessage(e.message || '删除失败', 'error');
            }
        })();
        return;
    }

    const recordIndex = AppState.pricingRecords.findIndex((r) => r.id === id);
    if (recordIndex === -1) return;

    const record = AppState.pricingRecords[recordIndex];
    const material = AppState.materials.find((m) => m.id === record.materialId);

    AppState.pricingRecords.splice(recordIndex, 1);
    saveToLocalStorage();

    loadPricingPage();

    showMessage(`已删除${material?.name || '该'}定价记录`, 'success');
    addAction('pricing', `删除${material?.name || ''}定价记录`);
}

function fillInboundFilters() {
    const wSel = document.getElementById('inbound-warehouse-filter');
    const mSel = document.getElementById('inbound-material-filter');
    if (!wSel || !mSel) return;
    const wv = wSel.value;
    const mv = mSel.value;
    wSel.innerHTML = '<option value="">全部库房</option>';
    AppState.warehouses.forEach((w) => {
        wSel.appendChild(new Option(`${w.code} - ${w.name}`, String(w.id)));
    });
    mSel.innerHTML = '<option value="">全部品种</option>';
    AppState.materials.forEach((m) => {
        mSel.appendChild(new Option(`${m.code} - ${m.name}`, String(m.id)));
    });
    if ([...wSel.options].some((o) => o.value === wv)) wSel.value = wv;
    if ([...mSel.options].some((o) => o.value === mv)) mSel.value = mv;
}

// 加载收货入库页面
function loadInboundPage() {
    const inboundList = document.getElementById('inbound-list');
    if (!inboundList) return;

    fillInboundFilters();
    inboundList.innerHTML = '';
    
    AppState.inboundOrders.forEach(order => {
        const material = AppState.materials.find(m => m.id === order.materialId);
        const warehouse = AppState.warehouses.find(w => w.id === order.warehouseId);
        if (!material || !warehouse) return;
        
        const flowStatus = normalizeInboundFlowStatus(order.status);
        const statusBadge = inboundStatusBadgeHtml(order);
        const actualOutCell = formatInboundOutboundWeightCell(
            order.actualOutboundWeight,
            material.unit
        );
        const preOutCell = formatInboundOutboundWeightCell(
            order.preOutboundWeight,
            material.unit
        );
        const showMutate = canEditInboundOrder(order);

        const whLabel = `${warehouse.code} - ${warehouse.name}`;
        const matLabel = `${material.code} - ${material.name}`;
        const timeIn = formatQuotationPublishDisplay(order.date);
        const outboundPx = getActiveQuotationPriceForMaterial(order.materialId);
        const outboundPriceCell =
            outboundPx != null
                ? `${formatCurrency(outboundPx)}/${material.unit}`
                : '<span style="color:#888;">-</span>';

        const row = document.createElement('tr');
        row.dataset.inboundStatus = flowStatus;
        row.dataset.inboundWarehouseId = String(order.warehouseId ?? '');
        row.dataset.inboundMaterialId = String(order.materialId ?? '');
        row.innerHTML = `
            <td>${order.orderNo}</td>
            <td>${whLabel}</td>
            <td>${matLabel}</td>
            <td>${order.weight} ${material.unit}</td>
            <td>${formatCurrency(order.unitPrice)}/${material.unit}</td>
            <td>${statusBadge}</td>
            <td>${actualOutCell}</td>
            <td>${preOutCell}</td>
            <td>${outboundPriceCell}</td>
            <td>${timeIn}</td>
            <td>
                ${showMutate ? `
                    <button class="btn btn-sm btn-icon" onclick="editInbound(${order.id})" title="编辑">
                        <i class="fas fa-edit"></i>
                    </button>
                ` : ''}
                <button type="button" class="btn btn-sm btn-icon btn-info" onclick="viewInbound(${order.id})" title="详情">
                    <i class="fas fa-eye"></i>
                </button>
                <button type="button" class="btn btn-sm btn-icon btn-view" onclick="viewInboundImage(${order.id})" title="入库凭证照片">
                    <i class="fas fa-image"></i>
                </button>
                ${showMutate ? `
                    <button class="btn btn-sm btn-icon btn-danger" onclick="deleteInbound(${order.id})" title="删除">
                        <i class="fas fa-trash"></i>
                    </button>
                ` : ''}
            </td>
        `;
        inboundList.appendChild(row);
    });

    filterInboundList();
}

// 过滤入库单列表（库房 / 品种 / 状态）
function filterInboundList() {
    const statusFilter = document.getElementById('inbound-status-filter')?.value || '';
    const warehouseFilter = document.getElementById('inbound-warehouse-filter')?.value || '';
    const materialFilter = document.getElementById('inbound-material-filter')?.value || '';
    const rows = document.querySelectorAll('#inbound-list tr');

    rows.forEach((row) => {
        const matchStatus =
            !statusFilter || statusFilter === 'all' || (row.dataset.inboundStatus || '') === statusFilter;
        const matchWarehouse =
            !warehouseFilter || String(row.dataset.inboundWarehouseId || '') === warehouseFilter;
        const matchMaterial =
            !materialFilter || String(row.dataset.inboundMaterialId || '') === materialFilter;
        row.style.display = matchStatus && matchWarehouse && matchMaterial ? '' : 'none';
    });
}

/** 对接后端：入库单价须与该品种最新收货定价一致（见 API 文档） */
function clearInboundUnitPriceHint() {
    const h = document.getElementById('inbound-unit-price-hint');
    if (h) {
        h.textContent = '';
        h.style.color = '';
    }
}

function syncInboundUnitPriceFromLatest(materialId) {
    clearInboundUnitPriceHint();
    if (!useApiMode() || !materialId) return;
    void (async function () {
        const hintEl = document.getElementById('inbound-unit-price-hint');
        const priceInput = document.getElementById('inbound-unit-price');
        try {
            const data = await window.InventoryApi.latestPurchaseByMaterial(materialId);
            if (!data || !data.latest) {
                if (hintEl) {
                    hintEl.style.color = '#c0392b';
                    hintEl.textContent =
                        '该品种暂无收货定价，无法创建入库单。请先在「收货定价」中录入一条定价。';
                }
                if (priceInput) priceInput.value = '';
                calculateInboundTotal();
                return;
            }
            const latest = data.latest.unitPrice;
            const fixed = Number(Number(latest).toFixed(2));
            if (hintEl) {
                hintEl.style.color = '#1565C0';
                hintEl.textContent =
                    '规则：入库单价须与最新收货定价一致（' + fixed + ' 元/吨），已自动填入，可核对后保存。';
            }
            if (priceInput) {
                priceInput.value = String(fixed);
                calculateInboundTotal();
            }
        } catch (e) {
            if (hintEl) {
                hintEl.style.color = '#856404';
                hintEl.textContent = '无法拉取最新定价：' + (e.message || '请稍后重试');
            }
        }
    })();
}

// 显示新增入库模态框
function showAddInboundModal() {
    const modal = document.getElementById('add-inbound-modal');
    if (!modal) return;

    clearInboundUnitPriceHint();
    AppState.tempInboundImages = [];
    renderInboundTempPreviews();
    const fileInput = document.getElementById('inbound-image');
    if (fileInput) fileInput.value = '';

    // 清空表单
    document.getElementById('inbound-material').value = '';
    document.getElementById('inbound-warehouse').value = '';
    document.getElementById('inbound-weight').value = '';
    document.getElementById('inbound-unit-price').value = '';
    document.getElementById('inbound-date').value = nowDatetimeLocalValue();
    
    // 填充品种下拉框
    const materialSelect = document.getElementById('inbound-material');
    materialSelect.innerHTML = '<option value="">选择品种</option>';
    AppState.materials.forEach(material => {
        const option = document.createElement('option');
        option.value = material.id;
        option.textContent = `${material.code} - ${material.name}`;
        materialSelect.appendChild(option);
    });
    materialSelect.onchange = function () {
        const v = parseInt(materialSelect.value, 10);
        syncInboundUnitPriceFromLatest(Number.isFinite(v) && v > 0 ? v : 0);
    };
    
    // 填充库房下拉框
    const warehouseSelect = document.getElementById('inbound-warehouse');
    warehouseSelect.innerHTML = '<option value="">选择库房</option>';
    AppState.warehouses.forEach(warehouse => {
        const option = document.createElement('option');
        option.value = warehouse.id;
        option.textContent = `${warehouse.code} - ${warehouse.name}`;
        warehouseSelect.appendChild(option);
    });
    
    const saveBtn = modal.querySelector('.modal-footer .btn-primary');
    if (saveBtn) {
        saveBtn.onclick = saveInbound;
        saveBtn.textContent = '保存';
    }

    const photoLabel = document.getElementById('inbound-photo-label');
    const photoHint = document.getElementById('inbound-photo-hint');
    if (photoLabel) {
        photoLabel.textContent = '上传入库照片（可选）';
    }
    if (photoHint) {
        photoHint.textContent = '可多选添加，最多 20 张，单张不超过 5MB。';
    }

    // 显示模态框
    openModal(modal);
}

// 计算入库总价
function calculateInboundTotal() {
    const weight = parseFloat(document.getElementById('inbound-weight').value) || 0;
    const unitPrice = parseFloat(document.getElementById('inbound-unit-price').value) || 0;
    const totalPrice = weight * unitPrice;
    
    document.getElementById('inbound-total-price').textContent = formatCurrency(totalPrice);
}

// 保存入库单
function saveInbound() {
    const materialId = parseInt(document.getElementById('inbound-material').value);
    const warehouseId = parseInt(document.getElementById('inbound-warehouse').value);
    const weight = parseFloat(document.getElementById('inbound-weight').value);
    const unitPrice = parseFloat(document.getElementById('inbound-unit-price').value);
    const dtLocal = document.getElementById('inbound-date').value;

    if (!materialId || !warehouseId || !weight || !unitPrice || !dtLocal) {
        showMessage('请填写完整信息', 'error');
        return;
    }

    if (useApiMode()) {
        const imgs = AppState.tempInboundImages && AppState.tempInboundImages.length
            ? AppState.tempInboundImages
            : [];
        const photo = imgs.length ? imgs.join(',') : '';
        const inboundAt = new Date(dtLocal).toISOString();
        void (async function () {
            try {
                await window.InventoryApi.createInbound({
                    warehouseId: warehouseId,
                    materialId: materialId,
                    weight: weight,
                    unitPrice: unitPrice,
                    photo: photo,
                    inboundAt: inboundAt,
                });
                await window.InventoryApi.refreshAppStateFromServer(AppState);
                AppState.tempInboundImages = [];
                document.getElementById('add-inbound-modal').style.display = 'none';
                loadInboundPage();
                updateDashboardStats();
                showMessage('已创建入库单', 'success');
                addAction('inbound', '创建入库单（API）');
            } catch (e) {
                showMessage(e.message || '创建失败', 'error');
            }
        })();
        return;
    }

    const storedDate = normalizeQuotationDatetimeLocal(dtLocal);
    const dayKey = storedDate.slice(0, 10).replace(/-/g, '');
    const orderCount = AppState.inboundOrders.filter((order) => order.orderNo.startsWith(`RK-${dayKey}`)).length + 1;
    const orderNo = `RK-${dayKey}-${orderCount.toString().padStart(4, '0')}`;
    
    const newInbound = {
        id: AppState.inboundOrders.length ? Math.max(...AppState.inboundOrders.map((o) => o.id)) + 1 : 1,
        orderNo: orderNo,
        warehouseId: warehouseId,
        materialId: materialId,
        weight: weight,
        unitPrice: unitPrice,
        totalPrice: weight * unitPrice,
        status: 'approved',
        date: storedDate,
        images: [...AppState.tempInboundImages],
        actualOutboundWeight: 0,
        preOutboundWeight: 0
    };

    AppState.tempInboundImages = [];

    AppState.inboundOrders.push(newInbound);
    saveToLocalStorage();
    
    // 关闭模态框
    document.getElementById('add-inbound-modal').style.display = 'none';
    
    // 重新加载页面
    loadInboundPage();
    
    // 更新仪表板
    updateDashboardStats();
    
    // 显示成功消息
    const material = AppState.materials.find(m => m.id === materialId);
    showMessage(`已创建入库单 ${orderNo}`, 'success');
    
    // 记录操作日志
    addAction('inbound', `创建入库单 ${orderNo} - ${material?.name} ${weight}吨`);
}

/** 入库详情：展示关联的出库单及 FIFO 子单 */
function renderInboundLinkedOutboundRows(inboundOrderId, unit) {
    const section = document.getElementById('view-inbound-outbound-section');
    const tbody = document.getElementById('view-inbound-outbound-list');
    if (!section || !tbody) return;

    const u = unit || '吨';
    const subs = AppState.outboundSuborders
        .filter((s) => s.inboundOrderId === inboundOrderId)
        .slice()
        .sort((a, b) => {
            const la = a.lineNo || 0;
            const lb = b.lineNo || 0;
            if (la !== lb) return la - lb;
            return (a.id || 0) - (b.id || 0);
        });

    if (!subs.length) {
        section.style.display = 'none';
        tbody.innerHTML = '';
        return;
    }

    section.style.display = 'block';
    tbody.innerHTML = '';

    subs.forEach((sub) => {
        const outbound = AppState.outboundOrders.find((o) => o.id === sub.outboundOrderId);
        const outNo = outbound ? outbound.orderNo : '-';
        const subNo =
            (sub.subOrderNo && String(sub.subOrderNo).trim()) ||
            (outbound ? `${outbound.orderNo}-子${sub.id}` : `子单${sub.id}`);
        const preW = Number(sub.preWeight) || 0;
        const actW = Number(sub.actualWeight) || 0;
        const price =
            outbound != null && Number.isFinite(Number(outbound.price))
                ? `${formatCurrency(outbound.price)}/${u}`
                : '<span style="color:#888;">-</span>';
        const stLabel = outbound ? outboundOrderStatusLabel(outbound) : '-';
        const stClass = outbound ? outboundStatusBadgeClass(outbound) : 'badge-secondary';
        const outNoCell = outbound
            ? `<button type="button" class="btn btn-sm btn-info" onclick="viewOutboundDetails(${outbound.id})">${escapeHtml(outNo)}</button>`
            : escapeHtml(outNo);

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${outNoCell}</td>
            <td>${escapeHtml(subNo)}</td>
            <td>${preW.toFixed(2)} ${u}</td>
            <td>${actW.toFixed(2)} ${u}</td>
            <td>${price}</td>
            <td><span class="badge ${stClass}">${escapeHtml(stLabel)}</span></td>
        `;
        tbody.appendChild(row);
    });
}

// 查看入库单详情
function viewInbound(id) {
    const order = AppState.inboundOrders.find(o => o.id === id);
    if (!order) return;
    
    const material = AppState.materials.find(m => m.id === order.materialId);
    const warehouse = AppState.warehouses.find(w => w.id === order.warehouseId);
    // 填充详情
    document.getElementById('view-order-no').textContent = order.orderNo;
    document.getElementById('view-material').textContent = material ? `${material.code} - ${material.name}` : '-';
    document.getElementById('view-warehouse').textContent = warehouse ? `${warehouse.code} - ${warehouse.name}` : '-';
    document.getElementById('view-weight').textContent = `${order.weight} ${material?.unit || '吨'}`;
    document.getElementById('view-unit-price').textContent = formatCurrency(order.unitPrice);
    document.getElementById('view-total-price').textContent = formatCurrency(order.totalPrice);
    document.getElementById('view-date').textContent = formatQuotationPublishDisplay(order.date);
    
    document.getElementById('view-status').textContent = inboundStatusDetailText(
        order,
        material?.unit || '吨'
    );
    document.getElementById('view-actual-outbound').textContent = `${order.actualOutboundWeight} ${material?.unit || '吨'}`;
    document.getElementById('view-pre-outbound').textContent = `${order.preOutboundWeight} ${material?.unit || '吨'}`;

    const imgSection = document.getElementById('view-inbound-image-section');
    const imgWrap = document.getElementById('view-inbound-detail-images');
    const imgs = inboundOrderImages(order);
    if (imgSection && imgWrap) {
        if (imgs.length) {
            imgSection.style.display = 'block';
            imgWrap.innerHTML = `<div class="view-multi-img-grid">${imgs
                .map(
                    (src, i) =>
                        `<div class="view-multi-img-wrap"><img class="image-previewable" src="${src}" alt="入库凭证 ${i + 1}"></div>`
                )
                .join('')}</div>`;
        } else {
            imgSection.style.display = 'none';
            imgWrap.innerHTML = '';
        }
    }

    renderInboundLinkedOutboundRows(id, material?.unit || '吨');

    // 显示模态框
    openModal('view-inbound-modal');
}

// 编辑入库单
function editInbound(id) {
    const order = AppState.inboundOrders.find(o => o.id === id);
    if (!canEditInboundOrder(order)) {
        showMessage('该入库单已关联出库或已出库，不可修改', 'error');
        return;
    }
    
    // 填充表单
    document.getElementById('inbound-material').value = order.materialId;
    document.getElementById('inbound-warehouse').value = order.warehouseId;
    document.getElementById('inbound-weight').value = order.weight;
    document.getElementById('inbound-unit-price').value = order.unitPrice;
    document.getElementById('inbound-date').value = quotationStoredToDatetimeLocal(order.date);

    AppState.tempInboundImages = [...inboundOrderImages(order)];
    renderInboundTempPreviews();
    const fileInput = document.getElementById('inbound-image');
    if (fileInput) fileInput.value = '';

    // 填充品种下拉框
    const materialSelect = document.getElementById('inbound-material');
    materialSelect.innerHTML = '<option value="">选择品种</option>';
    AppState.materials.forEach(material => {
        const option = document.createElement('option');
        option.value = material.id;
        option.textContent = `${material.code} - ${material.name}`;
        option.selected = material.id === order.materialId;
        materialSelect.appendChild(option);
    });
    
    // 填充库房下拉框
    const warehouseSelect = document.getElementById('inbound-warehouse');
    warehouseSelect.innerHTML = '<option value="">选择库房</option>';
    AppState.warehouses.forEach(warehouse => {
        const option = document.createElement('option');
        option.value = warehouse.id;
        option.textContent = `${warehouse.code} - ${warehouse.name}`;
        option.selected = warehouse.id === order.warehouseId;
        warehouseSelect.appendChild(option);
    });
    
    // 计算总价
    calculateInboundTotal();
    
    // 显示模态框
    const modal = document.getElementById('add-inbound-modal');
    openModal(modal);
    
    // 修改保存按钮行为
    const saveBtn = modal.querySelector('.modal-footer .btn-primary');
    saveBtn.onclick = function() {
        updateInbound(id);
    };
    saveBtn.textContent = '更新入库单';
}

// 更新入库单
function updateInbound(id) {
    const materialId = parseInt(document.getElementById('inbound-material').value);
    const warehouseId = parseInt(document.getElementById('inbound-warehouse').value);
    const weight = parseFloat(document.getElementById('inbound-weight').value);
    const unitPrice = parseFloat(document.getElementById('inbound-unit-price').value);
    const dtLocal = document.getElementById('inbound-date').value;

    if (!materialId || !warehouseId || !weight || !unitPrice || !dtLocal) {
        showMessage('请填写完整信息', 'error');
        return;
    }

    if (useApiMode()) {
        const orderBefore = AppState.inboundOrders.find((o) => o.id === id);
        if (!orderBefore) return;
        if (!canEditInboundOrder(orderBefore)) {
            showMessage('该入库单已关联出库或已出库，不可修改', 'error');
            return;
        }
        const imgs =
            AppState.tempInboundImages && AppState.tempInboundImages.length
                ? AppState.tempInboundImages
                : [];
        const photo = imgs.length ? imgs.join(',') : '';
        const inboundAt = new Date(dtLocal).toISOString();
        const label = orderBefore.orderNo || '#' + id;
        void (async function () {
            try {
                await window.InventoryApi.updateInbound(id, {
                    warehouseId: warehouseId,
                    materialId: materialId,
                    weight: weight,
                    unitPrice: unitPrice,
                    photo: photo,
                    inboundAt: inboundAt,
                });
                await window.InventoryApi.refreshAppStateFromServer(AppState);
                AppState.tempInboundImages = [];
                const modalEl = document.getElementById('add-inbound-modal');
                if (modalEl) modalEl.style.display = 'none';
                const saveBtnReset =
                    modalEl && modalEl.querySelector('.modal-footer .btn-primary');
                if (saveBtnReset) {
                    saveBtnReset.onclick = saveInbound;
                    saveBtnReset.textContent = '保存';
                }
                loadInboundPage();
                updateDashboardStats();
                showMessage('已更新入库单 ' + label, 'success');
                addAction('inbound', '更新入库单（API） ' + label);
            } catch (e) {
                showMessage(e.message || '更新失败', 'error');
            }
        })();
        return;
    }

    const storedDate = normalizeQuotationDatetimeLocal(dtLocal);

    const orderIndex = AppState.inboundOrders.findIndex(o => o.id === id);
    if (orderIndex === -1) return;
    
    const prevOrder = AppState.inboundOrders[orderIndex];
    if (!canEditInboundOrder(prevOrder)) {
        showMessage('该入库单已关联出库或已出库，不可修改', 'error');
        return;
    }
    const { image: _legacyImg, ...prevRest } = prevOrder;

    AppState.inboundOrders[orderIndex] = {
        ...prevRest,
        materialId: materialId,
        warehouseId: warehouseId,
        weight: weight,
        unitPrice: unitPrice,
        totalPrice: weight * unitPrice,
        date: storedDate,
        images: [...AppState.tempInboundImages]
    };

    AppState.tempInboundImages = [];

    saveToLocalStorage();

    const modalEl = document.getElementById('add-inbound-modal');
    if (modalEl) modalEl.style.display = 'none';
    const saveBtnReset = modalEl && modalEl.querySelector('.modal-footer .btn-primary');
    if (saveBtnReset) {
        saveBtnReset.onclick = saveInbound;
        saveBtnReset.textContent = '保存';
    }

    loadInboundPage();

    const material = AppState.materials.find((m) => m.id === materialId);
    showMessage(`已更新入库单`, 'success');
    addAction('inbound', `更新入库单 - ${material?.name} ${weight}吨`);
}

// 删除入库单
function deleteInbound(id) {
    if (!confirm('确定要删除这条入库单吗？')) return;

    if (useApiMode()) {
        const orderBefore = AppState.inboundOrders.find((o) => o.id === id);
        if (!orderBefore) return;
        if (!canDeleteInboundOrder(orderBefore)) {
            showMessage('该入库单已关联出库或已出库，不可删除', 'error');
            return;
        }
        const label = orderBefore.orderNo || '#' + id;
        void (async function () {
            try {
                await window.InventoryApi.deleteInbound(id);
                await window.InventoryApi.refreshAppStateFromServer(AppState);
                loadInboundPage();
                updateDashboardStats();
                showMessage('已删除入库单 ' + label, 'success');
                addAction('inbound', '删除入库单（API） ' + label);
            } catch (e) {
                showMessage(e.message || '删除失败', 'error');
            }
        })();
        return;
    }
    
    const orderIndex = AppState.inboundOrders.findIndex(o => o.id === id);
    if (orderIndex === -1) return;
    
    const order = AppState.inboundOrders[orderIndex];
    if (!canDeleteInboundOrder(order)) {
        showMessage('该入库单已关联出库或已出库，不可删除', 'error');
        return;
    }
    
    const material = AppState.materials.find(m => m.id === order.materialId);
    
    AppState.inboundOrders.splice(orderIndex, 1);
    saveToLocalStorage();
    
    // 重新加载页面
    loadInboundPage();
    
    // 更新仪表板
    updateDashboardStats();
    
    // 显示成功消息
    showMessage(`已删除入库单 ${order.orderNo}`, 'success');
    
    // 记录操作日志
    addAction('inbound', `删除入库单 ${order.orderNo}`);
}

function loadWarehousePage() {
    const list = document.getElementById('warehouse-list');
    if (!list) return;
    list.innerHTML = '';
    if (!AppState.warehouses.length) {
        list.innerHTML =
            '<tr><td colspan="3" style="text-align: center; color: #999;">暂无库房数据</td></tr>';
        return;
    }
    AppState.warehouses.forEach((w) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${w.code}</td>
            <td>${w.name}</td>
            <td>${w.address || '-'}</td>
        `;
        list.appendChild(row);
    });
}

// 打开模态框（居中、无灰底遮罩）
function openModal(modalIdOrEl) {
    const modal =
        typeof modalIdOrEl === 'string'
            ? document.getElementById(modalIdOrEl)
            : modalIdOrEl;
    if (modal) modal.style.display = 'flex';
}

// 关闭模态框
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }

    if (modalId === 'add-pricing-modal' && modal) {
        const saveBtn = modal.querySelector('.modal-footer .btn-primary');
        if (saveBtn) {
            saveBtn.onclick = savePricing;
            saveBtn.textContent = '保存';
        }
    }

    if (modalId === 'add-inbound-modal' && modal) {
        AppState.tempInboundImages = [];
        renderInboundTempPreviews();
        const fi = document.getElementById('inbound-image');
        if (fi) fi.value = '';
        const saveBtn = modal.querySelector('.modal-footer .btn-primary');
        if (saveBtn) {
            saveBtn.onclick = saveInbound;
            saveBtn.textContent = '保存';
        }
    }

}

// 加载对外报价页面
function loadQuotationPage() {
    // 更新报价看板
    updateQuotationBoard();
    
    // 更新历史报价列表
    updateQuotationHistory();
}

// 更新报价看板
function updateQuotationBoard() {
    const quotationCards = document.getElementById('quotation-cards');
    if (!quotationCards) return;
    
    quotationCards.innerHTML = '';
    
    const activeQuotations = AppState.quotations.filter(q => q.isActive);
    // 每个品种仅保留一条当前有效（若有多条则取发布时间最新）
    const latestActiveByMaterial = new Map();
    activeQuotations.forEach((q) => {
        const mid = Number(q.materialId);
        if (!Number.isFinite(mid)) return;
        const prev = latestActiveByMaterial.get(mid);
        if (!prev || parseQuotationDateTime(q.date) > parseQuotationDateTime(prev.date)) {
            latestActiveByMaterial.set(mid, q);
        }
    });
    // 按各品类最新发布时间倒序，优先展示最近更新的报价
    const sorted = Array.from(latestActiveByMaterial.values()).sort(
        (a, b) => parseQuotationDateTime(b.date) - parseQuotationDateTime(a.date)
    );
    
    sorted.forEach((quotation) => {
        const material = AppState.materials.find(
            (m) => Number(m.id) === Number(quotation.materialId)
        );
        if (!material) return;
        
        const card = document.createElement('div');
        card.className = 'quotation-card';
        card.innerHTML = `
            <div class="quotation-card-header">
                <h4>${material.name}</h4>
                <span class="badge badge-success">有效</span>
            </div>
            <div class="quotation-card-body">
                <div class="quotation-price">${formatCurrency(quotation.price)}/${material.unit}</div>
                <div class="quotation-meta">
                    <span class="quotation-meta-code"><i class="fas fa-barcode"></i> ${material.code}</span>
                    <span class="quotation-meta-time"><i class="fas fa-calendar"></i> ${formatQuotationPublishDisplay(quotation.date)}</span>
                </div>
            </div>
            <div class="quotation-card-footer">
                <button class="btn btn-sm btn-primary" onclick="showSetQuotationModal(${material.id})">
                    <i class="fas fa-edit"></i> 修改
                </button>
                <button class="btn btn-sm btn-info" onclick="showQuotationHistory(${material.id})">
                    <i class="fas fa-history"></i> 历史
                </button>
            </div>
        `;
        quotationCards.appendChild(card);
    });

    if (!sorted.length) {
        const empty = document.createElement('div');
        empty.className = 'quotation-board-empty';
        empty.innerHTML =
            '<p>当前没有「有效」对外报价卡片。首次发布或看板异常时，可点击下方按钮选择品种并填写报价。</p>' +
            '<button type="button" class="btn btn-primary" onclick="openPickMaterialForQuotationModal()">' +
            '<i class="fas fa-plus"></i> 发布对外报价</button>';
        quotationCards.appendChild(empty);
    }
}

/** 打开「选择品种」后进入设置报价（看板为空时也可维护报价） */
function openPickMaterialForQuotationModal() {
    const sel = document.getElementById('pick-material-quotation-select');
    const modal = document.getElementById('pick-material-quotation-modal');
    if (!sel || !modal) return;
    if (!AppState.materials || !AppState.materials.length) {
        showMessage('暂无品种数据，请先在基础资料中维护品种', 'error');
        return;
    }
    sel.innerHTML = '';
    sel.appendChild(new Option('请选择品种', ''));
    const mats = [...AppState.materials].sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
    mats.forEach((m) => {
        sel.appendChild(new Option(`${m.code} - ${m.name}`, String(m.id)));
    });
    openModal(modal);
}

function confirmPickMaterialForQuotation() {
    const sel = document.getElementById('pick-material-quotation-select');
    if (!sel) return;
    const materialId = parseInt(sel.value, 10);
    if (!materialId) {
        showMessage('请选择品种', 'error');
        return;
    }
    closeModal('pick-material-quotation-modal');
    showSetQuotationModal(materialId);
}

// 各品种最近一次报价时间（用于排序：优先展示最近有更新的品类）
function latestQuotationTimeForMaterial(materialId) {
    const qs = AppState.quotations.filter((q) => Number(q.materialId) === Number(materialId));
    if (!qs.length) return 0;
    return Math.max(...qs.map((q) => parseQuotationDateTime(q.date)));
}

// 更新历史报价列表
function updateQuotationHistory() {
    const historyList = document.getElementById('quotation-history-list');
    if (!historyList) return;
    
    historyList.innerHTML = '';
    
    const materialsSorted = [...AppState.materials].sort(
        (ma, mb) => latestQuotationTimeForMaterial(mb.id) - latestQuotationTimeForMaterial(ma.id)
    );
    
    materialsSorted.forEach((material) => {
        const materialQuotations = AppState.quotations
            .filter((q) => Number(q.materialId) === Number(material.id))
            .sort((a, b) => parseQuotationDateTime(b.date) - parseQuotationDateTime(a.date))
            .slice(0, 5);
        
        materialQuotations.forEach((quotation) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${material.name} (${material.code})</td>
                <td>${formatCurrency(quotation.price)}</td>
                <td>${formatQuotationPublishDisplay(quotation.date)}</td>
                <td>
                    ${quotation.isActive ? 
                        '<span class="badge badge-success">有效</span>' : 
                        '<span class="badge badge-secondary">历史</span>'}
                </td>
                <td>
                    <button type="button" class="btn btn-sm btn-primary" onclick="showSetQuotationModal(${material.id})">
                        <i class="fas fa-edit"></i> 更新
                    </button>
                </td>
            `;
            historyList.appendChild(row);
        });
    });
}

// 显示设置报价模态框
function showSetQuotationModal(materialId) {
    const material = AppState.materials.find((m) => Number(m.id) === Number(materialId));
    if (!material) return;
    
    // 获取当前有效报价
    const activeQuotation = AppState.quotations.find(
        (q) => Number(q.materialId) === Number(materialId) && q.isActive
    );
    
    // 填充表单
    document.getElementById('quotation-material').textContent = `${material.code} - ${material.name}`;
    document.getElementById('quotation-price').value = activeQuotation ? activeQuotation.price : '';
    const dateInput = document.getElementById('quotation-date');
    // 看板「修改」時發布時間預設為當前時間（可再手動調整）
    dateInput.value = nowDatetimeLocalValue();
    
    // 显示模态框
    const modal = document.getElementById('set-quotation-modal');
    openModal(modal);
    
    // 设置保存按钮行为
    const saveBtn = modal.querySelector('.modal-footer .btn-primary');
    saveBtn.onclick = function() {
        saveQuotation(materialId);
    };
}

// 保存报价
function saveQuotation(materialId) {
    const price = parseFloat(document.getElementById('quotation-price').value);
    const dateRaw = document.getElementById('quotation-date').value;
    const date = normalizeQuotationDatetimeLocal(dateRaw);
    
    if (!price || !date) {
        showMessage('请填写完整信息', 'error');
        return;
    }

    if (useApiMode()) {
        const publishedAt = new Date(dateRaw).toISOString();
        void (async function () {
            try {
                await window.InventoryApi.createSalePrice({
                    materialId: materialId,
                    unitPrice: price,
                    publishedAt: publishedAt,
                });
                await window.InventoryApi.refreshAppStateFromServer(AppState);
                document.getElementById('set-quotation-modal').style.display = 'none';
                loadQuotationPage();
                const material = AppState.materials.find((m) => Number(m.id) === Number(materialId));
                showMessage(`已发布${material?.name || ''}对外报价`, 'success');
            } catch (e) {
                showMessage(e.message || '发布失败', 'error');
            }
        })();
        return;
    }
    
    // 将当前有效报价设为无效
    AppState.quotations.forEach(quotation => {
        if (Number(quotation.materialId) === Number(materialId) && quotation.isActive) {
            quotation.isActive = false;
        }
    });
    
    const nextId = AppState.quotations.reduce((max, q) => Math.max(max, q.id || 0), 0) + 1;
    // 添加新报价
    const newQuotation = {
        id: nextId,
        materialId: materialId,
        price: price,
        date: date,
        isActive: true
    };
    
    AppState.quotations.push(newQuotation);
    saveToLocalStorage();
    
    // 关闭模态框
    document.getElementById('set-quotation-modal').style.display = 'none';
    
    // 重新加载页面
    loadQuotationPage();
    
    // 显示成功消息
    const material = AppState.materials.find(m => m.id === materialId);
    showMessage(`已设置${material?.name}报价为 ¥${formatNumber(price)}/吨`, 'success');
    
    // 记录操作日志
    addAction('quotation', `设置${material?.name}报价为 ¥${formatNumber(price)}/吨`);
}

// 显示报价历史
function showQuotationHistory(materialId) {
    const material = AppState.materials.find((m) => Number(m.id) === Number(materialId));
    if (!material) return;
    
    const historyList = document.getElementById('quotation-history-list-modal');
    if (!historyList) return;
    
    historyList.innerHTML = '';
    
    // 获取该品种的所有报价
    const materialQuotations = AppState.quotations
        .filter((q) => Number(q.materialId) === Number(materialId))
        .sort((a, b) => parseQuotationDateTime(b.date) - parseQuotationDateTime(a.date));
    
    materialQuotations.forEach(quotation => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${formatCurrency(quotation.price)}</td>
            <td>${formatQuotationPublishDisplay(quotation.date)}</td>
            <td>
                ${quotation.isActive ? 
                    '<span class="badge badge-success">有效</span>' : 
                    '<span class="badge badge-secondary">历史</span>'}
            </td>
        `;
        historyList.appendChild(row);
    });
    
    // 显示模态框
    openModal('quotation-history-modal');
}

// 加载出库管理页面
function loadOutboundPage() {
    // 默认显示预出库标签页
    switchTab('pre-outbound');
}

/** API pending 在「实际出库」Tab 展示为待完成 */
function isOutboundActualTabOrder(order) {
    if (!order) return false;
    if (order.status === 'actual_outbound') return true;
    return useApiMode() && order.apiStatus === 'pending';
}

function outboundOrderStatusLabel(orderOrStatus) {
    const order =
        orderOrStatus && typeof orderOrStatus === 'object' ? orderOrStatus : null;
    const status = order ? order.status : orderOrStatus;
    if (order && useApiMode() && order.apiStatus === 'pending') {
        return '待完成出库';
    }
    switch (status) {
        case 'pre_outbound':
            return '预出库';
        case 'actual_outbound':
            return '出库中';
        case 'completed':
            return '已完成';
        default:
            return status || '-';
    }
}

function outboundStatusBadgeClass(orderOrStatus) {
    const order =
        orderOrStatus && typeof orderOrStatus === 'object' ? orderOrStatus : null;
    const status = order ? order.status : orderOrStatus;
    if (order && useApiMode() && order.apiStatus === 'pending') {
        return 'badge-warning';
    }
    switch (status) {
        case 'pre_outbound':
            return 'badge-info';
        case 'actual_outbound':
            return 'badge-warning';
        case 'completed':
            return 'badge-success';
        default:
            return 'badge-secondary';
    }
}

/** 已完成出库单：按子单汇总成本（与报表中心逻辑一致） */
function computeCompletedOutboundTotalCost(order) {
    return allocateOutboundOrderCost(order);
}

// 加载出库标签页内容（表格列与 index.html 表头严格一致）
function loadOutboundTab(tab) {
    const listId = `${tab}-list`;
    const listElement = document.getElementById(listId);
    if (!listElement) return;
    
    listElement.innerHTML = '';
    
    let filteredOrders = [];
    switch (tab) {
        case 'pre-outbound':
            filteredOrders = AppState.outboundOrders.filter((order) => order.status === 'pre_outbound');
            break;
        case 'actual-outbound':
            filteredOrders = AppState.outboundOrders.filter((order) =>
                isOutboundActualTabOrder(order)
            );
            break;
        case 'outbound-history':
            filteredOrders = AppState.outboundOrders.filter((order) => order.status === 'completed');
            break;
    }
    
    filteredOrders.forEach((order) => {
        const material = AppState.materials.find((m) => m.id === order.materialId);
        if (!material) return;
        
        const row = document.createElement('tr');
        const stLabel = outboundOrderStatusLabel(order);
        const stClass = outboundStatusBadgeClass(order);
        
        if (tab === 'pre-outbound') {
            row.innerHTML = `
                <td>${order.orderNo}</td>
                <td>${material.name}</td>
                <td>${order.preWeight} ${material.unit}</td>
                <td>${formatCurrency(order.price)}/${material.unit}</td>
                <td><span class="badge ${stClass}">${stLabel}</span></td>
                <td>${formatOutboundTimeDisplay(order.date)}</td>
                <td>
                    <button class="btn btn-sm btn-info" onclick="viewOutboundDetails(${order.id})">
                        <i class="fas fa-eye"></i> 详情
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="cancelOutbound(${order.id})">
                        <i class="fas fa-times"></i> 取消
                    </button>
                </td>
            `;
        } else if (tab === 'actual-outbound') {
            row.innerHTML = `
                <td>${order.orderNo}</td>
                <td>${material.name}</td>
                <td>${order.preWeight} ${material.unit}</td>
                <td>${order.actualWeight} ${material.unit}</td>
                <td>${formatCurrency(order.price)}/${material.unit}</td>
                <td><span class="badge ${stClass}">${stLabel}</span></td>
                <td>
                    <button type="button" class="btn btn-sm btn-warning" onclick="triggerWeighingSlipUpload(${order.id})">
                        <i class="fas fa-upload"></i> 上传磅单
                    </button>
                    <button type="button" class="btn btn-sm btn-info" onclick="viewOutboundDetails(${order.id})">
                        <i class="fas fa-eye"></i> 详情
                    </button>
                </td>
            `;
        } else {
            const totalCost = computeCompletedOutboundTotalCost(order);
            const revenue = order.actualWeight * order.price;
            const profit = revenue - totalCost;
            const avgUnitCost =
                order.actualWeight > 0 ? totalCost / order.actualWeight : 0;
            row.innerHTML = `
                <td>${order.orderNo}</td>
                <td>${getWarehouseLabel(order.warehouseId)}</td>
                <td>${material.name}</td>
                <td>${formatOutboundInboundOrderNos(order.id, material.unit)}</td>
                <td>${order.actualWeight} ${material.unit}</td>
                <td>${formatCurrency(order.price)}/${material.unit}</td>
                <td>${formatCurrency(avgUnitCost)}/${material.unit}</td>
                <td>${formatCurrency(profit)}</td>
                <td>${formatOutboundTimeDisplay(order.date)}</td>
                <td>
                    <button type="button" class="btn btn-sm btn-info" onclick="viewOutboundDetails(${order.id})" title="查看详情">
                        <i class="fas fa-eye"></i> 详情
                    </button>
                </td>
            `;
        }
        
        listElement.appendChild(row);
    });
}

let weighingSlipTargetOutboundId = null;

function closeWeighingSlipUploadModal() {
    const w = document.getElementById('weighing-slip-actual-weight');
    const f = document.getElementById('weighing-slip-file-modal');
    if (w) w.value = '';
    if (f) f.value = '';
    weighingSlipTargetOutboundId = null;
    closeModal('weighing-slip-upload-modal');
}

/** 实际出库页：打开弹窗，填写实际出库重量并上传磅单，提交后即完成出库 */
function triggerWeighingSlipUpload(outboundOrderId) {
    const order = AppState.outboundOrders.find((o) => o.id === outboundOrderId);
    const apiPending = useApiMode() && order && order.apiStatus === 'pending';
    if (!order || (!apiPending && order.status !== 'actual_outbound')) return;
    weighingSlipTargetOutboundId = outboundOrderId;
    const material = AppState.materials.find((m) => m.id === order.materialId);
    const unit = material?.unit || '吨';
    const summary = document.getElementById('weighing-slip-modal-summary');
    if (summary) {
        summary.textContent = `出库单 ${order.orderNo} · 预出库 ${order.preWeight} ${unit}`;
    }
    const hint = document.getElementById('weighing-slip-modal-legacy-hint');
    const reqMark = document.getElementById('weighing-slip-file-required-mark');
    if (order.weighingSlipImage) {
        if (hint) {
            hint.style.display = 'block';
            hint.textContent =
                '已保存过磅单，可仅填写实际出库重量并完成；若要更换图片请重新选择文件。';
        }
        if (reqMark) reqMark.style.display = 'none';
    } else {
        if (hint) {
            hint.style.display = 'none';
            hint.textContent = '';
        }
        if (reqMark) reqMark.style.display = 'inline';
    }
    const w = document.getElementById('weighing-slip-actual-weight');
    const f = document.getElementById('weighing-slip-file-modal');
    if (w) w.value = '';
    if (f) f.value = '';
    const modal = document.getElementById('weighing-slip-upload-modal');
    if (modal) openModal(modal);
}

/**
 * 填写实际重量并（可选）更新磅单图后完成出库（扣减子单与入库单）
 * @returns {{ ok: boolean, msg?: string }}
 */
function finalizeActualOutboundWithWeighingSlip(outboundId, actualWeight, newSlipDataUrl, newSlipName) {
    const orderIndex = AppState.outboundOrders.findIndex((o) => o.id === outboundId);
    if (orderIndex === -1) return { ok: false, msg: '出库单不存在' };

    const order = AppState.outboundOrders[orderIndex];
    if (order.status !== 'actual_outbound') {
        return { ok: false, msg: '出库单状态不允许完成' };
    }

    const aw = Number(actualWeight);
    if (!aw || aw <= 0) return { ok: false, msg: '请输入有效的出库重量' };
    if (aw > order.preWeight) return { ok: false, msg: '实际出库重量不能大于预出库重量' };

    if (newSlipDataUrl) {
        AppState.outboundOrders[orderIndex].weighingSlipImage = newSlipDataUrl;
        AppState.outboundOrders[orderIndex].weighingSlipName = newSlipName || '磅单';
    } else if (!order.weighingSlipImage) {
        return { ok: false, msg: '请选择磅单图片' };
    }

    AppState.outboundOrders[orderIndex].actualWeight = aw;
    AppState.outboundOrders[orderIndex].status = 'completed';
    AppState.outboundOrders[orderIndex].date = formatOutboundTimeDisplay(new Date());

    let remainingWeight = aw;
    const suborders = AppState.outboundSuborders.filter((s) => s.outboundOrderId === outboundId);

    for (const suborder of suborders) {
        if (remainingWeight <= 0) break;

        const suborderIndex = AppState.outboundSuborders.findIndex((s) => s.id === suborder.id);
        const inboundIndex = AppState.inboundOrders.findIndex((o) => o.id === suborder.inboundOrderId);

        if (suborderIndex !== -1 && inboundIndex !== -1) {
            const allocateWeight = Math.min(suborder.preWeight, remainingWeight);

            AppState.outboundSuborders[suborderIndex].actualWeight = allocateWeight;
            AppState.outboundSuborders[suborderIndex].status = 'completed';

            AppState.inboundOrders[inboundIndex].actualOutboundWeight += allocateWeight;
            AppState.inboundOrders[inboundIndex].preOutboundWeight -= allocateWeight;

            if (
                AppState.inboundOrders[inboundIndex].actualOutboundWeight >=
                AppState.inboundOrders[inboundIndex].weight
            ) {
                AppState.inboundOrders[inboundIndex].status = 'completed';
            } else if (AppState.inboundOrders[inboundIndex].preOutboundWeight === 0) {
                AppState.inboundOrders[inboundIndex].status = 'approved';
            }

            remainingWeight -= allocateWeight;
        }
    }

    saveToLocalStorage();
    loadOutboundTab('actual-outbound');
    loadOutboundTab('outbound-history');
    updateDashboardStats();

    const material = AppState.materials.find((m) => m.id === order.materialId);
    const u = material?.unit || '吨';
    showMessage(`已完成出库 ${order.orderNo}，实际出库 ${aw} ${u}`, 'success');
    addAction(
        'outbound',
        `上传磅单并完成出库 ${order.orderNo} - ${material?.name || ''} ${aw}${u}`
    );

    return { ok: true };
}

async function submitWeighingSlipAndComplete() {
    const oid = weighingSlipTargetOutboundId;
    if (oid == null) {
        showMessage('请先选择出库单', 'error');
        return;
    }
    const order = AppState.outboundOrders.find((o) => o.id === oid);
    if (!order) {
        showMessage('出库单不存在', 'error');
        closeWeighingSlipUploadModal();
        return;
    }
    const weightEl = document.getElementById('weighing-slip-actual-weight');
    const fileEl = document.getElementById('weighing-slip-file-modal');
    const actualWeight = parseFloat(weightEl?.value);
    if (!actualWeight || actualWeight <= 0) {
        showMessage('请填写实际出库重量', 'error');
        return;
    }
    if (actualWeight > order.preWeight) {
        showMessage('实际出库重量不能大于预出库重量', 'error');
        return;
    }
    const file = fileEl?.files?.[0];
    let newSlip = null;
    let newName = null;
    if (file) {
        if (!file.type.startsWith('image/')) {
            showMessage('请选择图片格式的磅单', 'error');
            return;
        }
        if (file.size > 4 * 1024 * 1024) {
            showMessage('图片请小于 4MB', 'error');
            return;
        }
        try {
            newSlip = await readFileAsDataURL(file);
            newName = file.name;
        } catch {
            showMessage('读取图片失败', 'error');
            return;
        }
    } else if (!order.weighingSlipImage) {
        showMessage('请选择磅单图片', 'error');
        return;
    }
    if (useApiMode()) {
        const photo = newSlip || order.weighingSlipImage;
        if (!photo) {
            showMessage('请选择磅单图片', 'error');
            return;
        }
        try {
            await window.InventoryApi.completeOutbound(oid, {
                actualWeight: actualWeight,
                weighbridgePhoto: photo,
            });
            await window.InventoryApi.refreshAppStateFromServer(AppState);
            loadOutboundTab('pre-outbound');
            loadOutboundTab('actual-outbound');
            loadOutboundTab('outbound-history');
            updateDashboardStats();
            showMessage('已完成出库', 'success');
            closeWeighingSlipUploadModal();
        } catch (e) {
            showMessage(e.message || '完成出库失败', 'error');
        }
        return;
    }
    const res = finalizeActualOutboundWithWeighingSlip(oid, actualWeight, newSlip, newName);
    if (!res.ok) {
        showMessage(res.msg || '操作失败', 'error');
        return;
    }
    closeWeighingSlipUploadModal();
}

/** 查看磅单：打开出库详情并定位到磅单图片 */
function viewWeighingSlip(outboundOrderId) {
    viewOutboundDetails(outboundOrderId);
    setTimeout(function () {
        const section = document.getElementById('outbound-detail-weighing-section');
        if (section && section.style.display !== 'none') {
            section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return;
        }
        const order = AppState.outboundOrders.find((o) => o.id === outboundOrderId);
        if (order && !order.weighingSlipImage) {
            showMessage('暂无磅单图片', 'info');
        }
    }, useApiMode() ? 450 : 80);
}

// 预出库弹窗：按品种刷新对外报价下拉（发布时间新→旧，默认第一条为最新）
function refreshOutboundQuotationSelect() {
    const materialId = parseInt(document.getElementById('outbound-material').value, 10);
    const sel = document.getElementById('outbound-quotation-select');
    const priceInput = document.getElementById('outbound-sale-price');
    if (!sel || !priceInput) return;
    sel.innerHTML = '';
    if (!materialId) {
        sel.disabled = true;
        sel.appendChild(new Option('请先选择品种', ''));
        priceInput.value = '';
        return;
    }
    const list = AppState.quotations
        .filter((q) => Number(q.materialId) === Number(materialId))
        .sort((a, b) => parseQuotationDateTime(b.date) - parseQuotationDateTime(a.date));
    if (!list.length) {
        sel.disabled = true;
        sel.appendChild(new Option('该品类暂无报价，请先在对外报价中维护', ''));
        priceInput.value = '';
        return;
    }
    sel.disabled = false;
    list.forEach((q) => {
        const label = `${formatCurrency(q.price)}/吨 · ${formatQuotationPublishDisplay(q.date)}${q.isActive ? '（有效）' : ''}`;
        sel.appendChild(new Option(label, String(q.id)));
    });
    sel.selectedIndex = 0;
    applySelectedQuotationPriceToOutboundInput();
}

function applySelectedQuotationPriceToOutboundInput() {
    const sel = document.getElementById('outbound-quotation-select');
    const priceInput = document.getElementById('outbound-sale-price');
    if (!sel || !priceInput || sel.disabled) return;
    const id = parseInt(sel.value, 10);
    const q = AppState.quotations.find((x) => x.id === id);
    if (q) priceInput.value = String(q.price);
}

// 显示新增出库计划模态框
function showAddOutboundModal() {
    const modal = document.getElementById('add-outbound-modal');
    if (!modal) return;
    
    // 清空表单
    document.getElementById('outbound-material').value = '';
    document.getElementById('outbound-warehouse').value = '';
    document.getElementById('outbound-weight').value = '';
    document.getElementById('outbound-date').value = new Date().toISOString().split('T')[0];
    
    // 填充品种下拉框
    const materialSelect = document.getElementById('outbound-material');
    materialSelect.innerHTML = '<option value="">选择品种</option>';
    AppState.materials.forEach(material => {
        const option = document.createElement('option');
        option.value = material.id;
        option.textContent = `${material.code} - ${material.name}`;
        materialSelect.appendChild(option);
    });
    
    // 填充库房下拉框
    const warehouseSelect = document.getElementById('outbound-warehouse');
    warehouseSelect.innerHTML = '<option value="">选择库房</option>';
    AppState.warehouses.forEach(warehouse => {
        const option = document.createElement('option');
        option.value = warehouse.id;
        option.textContent = `${warehouse.code} - ${warehouse.name}`;
        warehouseSelect.appendChild(option);
    });
    
    const quotationSelect = document.getElementById('outbound-quotation-select');
    materialSelect.onchange = function () {
        refreshOutboundQuotationSelect();
        void refreshOutboundAvailableHint();
    };
    if (warehouseSelect) {
        warehouseSelect.onchange = function () {
            void refreshOutboundAvailableHint();
        };
    }
    if (quotationSelect) {
        quotationSelect.onchange = function () {
            applySelectedQuotationPriceToOutboundInput();
        };
    }
    refreshOutboundQuotationSelect();
    void refreshOutboundAvailableHint();
    
    // 显示模态框
    openModal(modal);
}

async function refreshOutboundAvailableHint() {
    const hint = document.getElementById('outbound-available-hint');
    const materialId = parseInt(document.getElementById('outbound-material')?.value, 10);
    const warehouseId = parseInt(document.getElementById('outbound-warehouse')?.value, 10);
    if (!hint) return;
    if (!materialId || !warehouseId) {
        hint.style.display = 'none';
        return;
    }
    const av = await fetchOutboundAvailableTon(materialId, warehouseId);
    if (av == null) {
        hint.textContent = '可用库存加载失败，请稍后重试';
    } else {
        hint.textContent = `参考可用库存：约 ${av.toFixed(2)} 吨`;
    }
    hint.style.display = 'block';
}

async function fetchOutboundAvailableTon(materialId, warehouseId) {
    if (!useApiMode() || !window.InventoryApi) {
        return calculateAvailableInventory(materialId, warehouseId);
    }
    try {
        const data = await window.InventoryApi.inboundSummaryAlerts({
            basis: 'combined',
            thresholdTon: 1,
            onlyReminder: false,
        });
        const it = (data.items || []).find(
            (x) =>
                x.material &&
                x.warehouse &&
                Number(x.material.id) === materialId &&
                Number(x.warehouse.id) === warehouseId
        );
        return it ? Number(it.remainingWeightByBasis || 0) : 0;
    } catch {
        return null;
    }
}

// 保存出库计划
function saveOutbound() {
    const materialId = parseInt(document.getElementById('outbound-material').value);
    const warehouseId = parseInt(document.getElementById('outbound-warehouse').value);
    const weight = parseFloat(document.getElementById('outbound-weight').value);
    const date = document.getElementById('outbound-date').value;
    
    if (!materialId || !warehouseId || !weight || !date) {
        showMessage('请填写完整信息', 'error');
        return;
    }
    
    const salePrice = parseFloat(document.getElementById('outbound-sale-price').value);
    if (!salePrice || salePrice <= 0) {
        showMessage('请填写有效的出库单价（可先选择品种并从对外报价中选择，或自行修改单价）', 'error');
        return;
    }

    if (useApiMode()) {
        void (async function () {
            const availableInventory = await fetchOutboundAvailableTon(materialId, warehouseId);
            if (availableInventory != null && availableInventory < weight) {
                showMessage(`库存不足，可用库存约 ${availableInventory.toFixed(2)} 吨`, 'error');
                return;
            }
            try {
                await window.InventoryApi.createOutbound({
                    warehouseId: warehouseId,
                    materialId: materialId,
                    plannedWeight: weight,
                    unitPrice: salePrice,
                });
                await window.InventoryApi.refreshAppStateFromServer(AppState);
                document.getElementById('add-outbound-modal').style.display = 'none';
                loadOutboundTab('pre-outbound');
                loadOutboundTab('actual-outbound');
                updateDashboardStats();
                showMessage('已创建出库计划', 'success');
            } catch (e) {
                showMessage(e.message || '创建失败', 'error');
            }
        })();
        return;
    }

    const availableInventory = calculateAvailableInventory(materialId, warehouseId);
    if (availableInventory < weight) {
        showMessage(`库存不足，可用库存约 ${availableInventory.toFixed(2)} 吨`, 'error');
        return;
    }
    
    // 生成出库单号
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const orderCount = AppState.outboundOrders.filter(order => 
        order.orderNo.startsWith(`CK-${today}`)
    ).length + 1;
    const orderNo = `CK-${today}-${orderCount.toString().padStart(4, '0')}`;
    
    // 创建出库单
    const newOutbound = {
        id: AppState.outboundOrders.length + 1,
        orderNo: orderNo,
        materialId: materialId,
        warehouseId: warehouseId,
        preWeight: weight,
        actualWeight: 0,
        price: salePrice,
        status: 'pre_outbound',
        date: formatOutboundTimeDisplay(new Date())
    };
    
    AppState.outboundOrders.push(newOutbound);
    
    // 创建出库子单（按FIFO原则分配）
    createOutboundSuborders(newOutbound.id, materialId, warehouseId, weight);
    
    saveToLocalStorage();
    
    // 关闭模态框
    document.getElementById('add-outbound-modal').style.display = 'none';
    
    // 重新加载页面
    loadOutboundTab('pre-outbound');
    
    // 更新仪表板
    updateDashboardStats();
    
    // 显示成功消息
    const material = AppState.materials.find(m => m.id === materialId);
    showMessage(`已创建出库计划 ${orderNo}`, 'success');
    
    // 记录操作日志
    addAction('outbound', `创建出库计划 ${orderNo} - ${material?.name} ${weight}吨`);
}

// 计算可用库存
function calculateAvailableInventory(materialId, warehouseId) {
    let totalWeight = 0;
    
    AppState.inboundOrders.forEach(order => {
        if (order.materialId === materialId && 
            order.warehouseId === warehouseId && 
            (order.status === 'approved' || order.status === 'outbounding')) {
            const availableWeight = order.weight - order.actualOutboundWeight - order.preOutboundWeight;
            totalWeight += Math.max(0, availableWeight);
        }
    });
    
    return totalWeight;
}

// 创建出库子单（FIFO原则）
function createOutboundSuborders(outboundOrderId, materialId, warehouseId, totalWeight) {
    // 获取该库房该品种的所有入库单（按日期排序，FIFO）
    const inboundOrders = AppState.inboundOrders
        .filter(order => 
            order.materialId === materialId && 
            order.warehouseId === warehouseId && 
            (order.status === 'approved' || order.status === 'outbounding')
        )
        .sort((a, b) => parseQuotationDateTime(a.date) - parseQuotationDateTime(b.date));

    let remainingWeight = totalWeight;
    let suborderId = AppState.outboundSuborders.length + 1;
    
    for (const inboundOrder of inboundOrders) {
        if (remainingWeight <= 0) break;
        
        const availableWeight = inboundOrder.weight - inboundOrder.actualOutboundWeight - inboundOrder.preOutboundWeight;
        if (availableWeight <= 0) continue;
        
        const allocateWeight = Math.min(availableWeight, remainingWeight);
        
        // 更新入库单的预出库重量
        const inboundIndex = AppState.inboundOrders.findIndex(o => o.id === inboundOrder.id);
        if (inboundIndex !== -1) {
            AppState.inboundOrders[inboundIndex].preOutboundWeight += allocateWeight;
            
            // 如果预出库重量大于0，更新状态为出库中
            if (AppState.inboundOrders[inboundIndex].preOutboundWeight > 0 && 
                AppState.inboundOrders[inboundIndex].status === 'approved') {
                AppState.inboundOrders[inboundIndex].status = 'outbounding';
            }
        }
        
        // 创建出库子单
        const suborder = {
            id: suborderId++,
            outboundOrderId: outboundOrderId,
            inboundOrderId: inboundOrder.id,
            preWeight: allocateWeight,
            actualWeight: 0,
            status: 'pre_outbound'
        };
        
        AppState.outboundSuborders.push(suborder);
        remainingWeight -= allocateWeight;
    }
}

/** 解析 FIFO 子行展示用字段（兼容 API 与离线） */
function resolveFifoLineDisplay(sub, material) {
    const unit = material?.unit || '吨';
    const inbound = AppState.inboundOrders.find((o) => o.id === sub.inboundOrderId);
    const orderNo =
        (sub.inboundOrderNo && String(sub.inboundOrderNo).trim()) ||
        inbound?.orderNo ||
        (sub.inboundOrderId != null ? `#${sub.inboundOrderId}` : '-');
    const inboundTimeRaw = sub.inboundAt || inbound?.date || '';
    const inboundTime = inboundTimeRaw
        ? formatQuotationPublishDisplay(inboundTimeRaw)
        : '-';
    const unitPrice =
        sub.inboundUnitPrice != null && Number.isFinite(Number(sub.inboundUnitPrice))
            ? Number(sub.inboundUnitPrice)
            : inbound?.unitPrice;
    const preW = Number(sub.preWeight) || 0;
    const actW = Number(sub.actualWeight) || 0;
    const costW = actW > 0 ? actW : preW;
    const lineCost =
        unitPrice != null && Number.isFinite(unitPrice) ? costW * unitPrice : null;
    return {
        lineNo: sub.lineNo || 0,
        subOrderNo: sub.subOrderNo || '-',
        orderNo,
        inboundTime,
        preW,
        actW,
        unit,
        unitPrice,
        lineCost,
    };
}

function renderOutboundFifoSuborderRows(outboundId, material) {
    const tbody = document.getElementById('outbound-suborder-list');
    if (!tbody) return;

    const subs = AppState.outboundSuborders
        .filter((s) => s.outboundOrderId === outboundId)
        .slice()
        .sort((a, b) => {
            const la = a.lineNo || 0;
            const lb = b.lineNo || 0;
            if (la !== lb) return la - lb;
            return (a.id || 0) - (b.id || 0);
        });

    tbody.innerHTML = '';
    if (!subs.length) {
        tbody.innerHTML =
            '<tr><td colspan="8" style="text-align:center;color:#888;">暂无 FIFO 子单数据</td></tr>';
        return;
    }

    let sumPre = 0;
    let sumAct = 0;
    let sumCost = 0;
    const unit = material?.unit || '吨';

    subs.forEach((sub, idx) => {
        const d = resolveFifoLineDisplay(sub, material);
        sumPre += d.preW;
        sumAct += d.actW;
        if (d.lineCost != null) sumCost += d.lineCost;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${d.lineNo || idx + 1}</td>
            <td>${escapeHtml(d.subOrderNo)}</td>
            <td>${escapeHtml(d.orderNo)}</td>
            <td>${escapeHtml(d.inboundTime)}</td>
            <td>${d.preW.toFixed(2)} ${unit}</td>
            <td>${d.actW.toFixed(2)} ${unit}</td>
            <td>${
                d.unitPrice != null
                    ? `${formatCurrency(d.unitPrice)}/${unit}`
                    : '<span style="color:#888;">-</span>'
            }</td>
            <td>${
                d.lineCost != null ? formatCurrency(d.lineCost) : '<span style="color:#888;">-</span>'
            }</td>
        `;
        tbody.appendChild(row);
    });

    const foot = document.createElement('tr');
    foot.className = 'fifo-total-row';
    foot.innerHTML = `
        <td colspan="4" style="text-align:right;font-weight:600;">合计</td>
        <td style="font-weight:600;">${sumPre.toFixed(2)} ${unit}</td>
        <td style="font-weight:600;">${sumAct.toFixed(2)} ${unit}</td>
        <td></td>
        <td style="font-weight:600;">${sumCost > 0 ? formatCurrency(sumCost) : '-'}</td>
    `;
    tbody.appendChild(foot);
}

function fillOutboundDetailHeader(order, material, warehouse) {
    document.getElementById('outbound-detail-order-no').textContent = order.orderNo;
    document.getElementById('outbound-detail-material').textContent = material
        ? `${material.code} - ${material.name}`
        : '-';
    document.getElementById('outbound-detail-warehouse').textContent = warehouse
        ? `${warehouse.code} - ${warehouse.name}`
        : '-';
    document.getElementById('outbound-detail-pre-weight').textContent = `${order.preWeight} ${
        material?.unit || '吨'
    }`;
    document.getElementById('outbound-detail-actual-weight').textContent = `${order.actualWeight} ${
        material?.unit || '吨'
    }`;
    document.getElementById('outbound-detail-price').textContent = formatCurrency(order.price);
    document.getElementById('outbound-detail-total-price').textContent = formatCurrency(
        order.actualWeight * order.price
    );
    document.getElementById('outbound-detail-date').textContent = formatOutboundTimeDisplay(order.date);
    document.getElementById('outbound-detail-status').textContent = outboundOrderStatusLabel(order);
    renderOutboundWeighingSlip(order);
}

function renderOutboundWeighingSlip(order) {
    const section = document.getElementById('outbound-detail-weighing-section');
    const empty = document.getElementById('outbound-detail-weighing-empty');
    const img = document.getElementById('outbound-detail-weighing-img');
    const nameEl = document.getElementById('outbound-detail-weighing-name');
    const src = order?.weighingSlipImage && String(order.weighingSlipImage).trim();
    if (src && section && img) {
        section.style.display = 'block';
        if (empty) empty.style.display = 'none';
        img.src = src;
        img.alt = order.weighingSlipName || '磅单';
        img.className = 'image-previewable';
        if (nameEl) {
            nameEl.textContent = `文件：${order.weighingSlipName || '磅单'}（点击可放大）`;
        }
    } else {
        if (section) section.style.display = 'none';
        if (empty) empty.style.display = 'block';
        if (img) img.removeAttribute('src');
        if (nameEl) nameEl.textContent = '';
    }
}

// 查看出库详情（含 FIFO 子行）
function viewOutboundDetails(id) {
    const order = AppState.outboundOrders.find((o) => o.id === id);
    if (!order) return;

    const material = AppState.materials.find((m) => m.id === order.materialId);
    const warehouse = AppState.warehouses.find((w) => w.id === order.warehouseId);

    fillOutboundDetailHeader(order, material, warehouse);
    renderOutboundFifoSuborderRows(id, material);
    openModal('outbound-detail-modal');

    if (!useApiMode() || !window.InventoryApi?.fetchOutboundDetail) return;

    void (async function () {
        try {
            const det = await window.InventoryApi.fetchOutboundDetail(id);
            const photo = det.weighbridgePhoto || det.weighbridge_photo || '';
            const orderIdx = AppState.outboundOrders.findIndex((o) => o.id === id);
            if (orderIdx !== -1 && photo) {
                AppState.outboundOrders[orderIdx].weighingSlipImage = photo;
            }
            const freshSubs = window.InventoryApi.fifoLinesToSuborders(id, det.fifoLines || []);
            AppState.outboundSuborders = AppState.outboundSuborders.filter(
                (s) => s.outboundOrderId !== id
            ).concat(freshSubs);
            renderOutboundFifoSuborderRows(id, material);
            renderOutboundWeighingSlip(AppState.outboundOrders.find((o) => o.id === id));
        } catch (e) {
            const tbody = document.getElementById('outbound-suborder-list');
            if (tbody && !tbody.querySelector('tr')) {
                tbody.innerHTML =
                    '<tr><td colspan="8" style="text-align:center;color:#c00;">' +
                    escapeHtml(e.message || '加载 FIFO 明细失败') +
                    '</td></tr>';
            }
        }
    })();
}

// 执行出库（从预出库转为实际出库）
function executeOutbound(id) {
    if (useApiMode()) {
        triggerWeighingSlipUpload(id);
        return;
    }
    const orderIndex = AppState.outboundOrders.findIndex(o => o.id === id);
    if (orderIndex === -1) return;
    
    const order = AppState.outboundOrders[orderIndex];
    if (order.status !== 'pre_outbound') return;
    
    // 更新出库单状态
    AppState.outboundOrders[orderIndex].status = 'actual_outbound';
    
    // 更新子单状态
    AppState.outboundSuborders.forEach(suborder => {
        if (suborder.outboundOrderId === id) {
            suborder.status = 'actual_outbound';
        }
    });
    
    saveToLocalStorage();
    
    // 重新加载页面
    loadOutboundTab('pre-outbound');
    loadOutboundTab('actual-outbound');
    
    // 显示成功消息
    showMessage(`已开始执行出库 ${order.orderNo}`, 'success');
    
    // 记录操作日志
    const material = AppState.materials.find(m => m.id === order.materialId);
    addAction('outbound', `开始执行出库 ${order.orderNo} - ${material?.name}`);
}

// 取消出库计划
function cancelOutbound(id) {
    if (!confirm('确定要取消这个出库计划吗？')) return;
    
    const orderIndex = AppState.outboundOrders.findIndex(o => o.id === id);
    if (orderIndex === -1) return;
    
    const order = AppState.outboundOrders[orderIndex];
    if (order.status !== 'pre_outbound') return;

    if (useApiMode()) {
        void (async function () {
            try {
                await window.InventoryApi.deleteOutbound(id);
                await window.InventoryApi.refreshAppStateFromServer(AppState);
                loadOutboundTab('pre-outbound');
                loadOutboundTab('actual-outbound');
                updateDashboardStats();
                showMessage('已取消出库计划', 'success');
            } catch (e) {
                showMessage(e.message || '取消失败', 'error');
            }
        })();
        return;
    }
    
    // 恢复入库单的预出库重量
    const suborders = AppState.outboundSuborders.filter(s => s.outboundOrderId === id);
    suborders.forEach(suborder => {
        const inboundIndex = AppState.inboundOrders.findIndex(o => o.id === suborder.inboundOrderId);
        if (inboundIndex !== -1) {
            AppState.inboundOrders[inboundIndex].preOutboundWeight -= suborder.preWeight;
            
            // 如果预出库重量为0且状态为出库中，恢复为已审核
            if (AppState.inboundOrders[inboundIndex].preOutboundWeight === 0 && 
                AppState.inboundOrders[inboundIndex].status === 'outbounding') {
                AppState.inboundOrders[inboundIndex].status = 'approved';
            }
        }
    });
    
    // 删除出库单和子单
    AppState.outboundOrders.splice(orderIndex, 1);
    AppState.outboundSuborders = AppState.outboundSuborders.filter(s => s.outboundOrderId !== id);
    
    saveToLocalStorage();
    
    // 重新加载页面
    loadOutboundTab('pre-outbound');
    
    // 更新仪表板
    updateDashboardStats();
    
    // 显示成功消息
    showMessage(`已取消出库计划 ${order.orderNo}`, 'success');
    
    // 记录操作日志
    const material = AppState.materials.find(m => m.id === order.materialId);
    addAction('outbound', `取消出库计划 ${order.orderNo} - ${material?.name}`);
}

function inboundStatusLabelForReport(status) {
    return inboundStatusDetailText(status);
}

// 加载库存预警页面
function loadInventoryPage() {
    // 默认显示库存预警标签页
    switchTab('inventory-warning');
}

// 加载库存标签页内容
function loadInventoryTab(tab) {
    if (tab === 'inventory-warning') {
        updateWarningList();
    } else if (tab === 'inventory-report') {
        loadInventoryReport();
    }
}

function getInventoryWarningThreshold() {
    const el = document.getElementById('warning-threshold');
    return el ? parseInt(el.value, 10) || 30 : 30;
}

function getInventoryWarningStatusFilter() {
    const el = document.getElementById('warning-status-filter');
    return el ? el.value : 'overstock';
}

function isInventoryOverstock(availableWeight, threshold) {
    return Number(availableWeight) > threshold;
}

function matchesInventoryWarningStatusFilter(isOverstock, filter) {
    if (filter === 'all') return true;
    if (filter === 'overstock') return isOverstock;
    if (filter === 'normal') return !isOverstock;
    return true;
}

function inventoryWarningStatusBadgeHtml(isOverstock) {
    return isOverstock
        ? '<span class="badge badge-warning">库存积压</span>'
        : '<span class="badge badge-success">库存正常</span>';
}

function renderWarningListEmptyRow(warningList, message) {
    warningList.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#95a5a6;">${escapeHtml(
        message || '暂无符合条件的数据'
    )}</td></tr>`;
}

// 更新预警列表（列与 index.html 表头一致：库房、品种、总入库重量、待出库重量、预出库重量、实际出库重量、可用库存、预警状态）
function updateWarningList() {
    const warningList = document.getElementById('warning-list');
    if (!warningList) return;
    
    warningList.innerHTML = '';
    
    const threshold = getInventoryWarningThreshold();
    const deductionMode = document.getElementById('deduction-mode').value;
    const statusFilter = getInventoryWarningStatusFilter();

    if (useApiMode()) {
        const basis = deductionMode === 'both' ? 'combined' : 'actual';
        void (async function () {
            try {
                const data = await window.InventoryApi.inboundSummaryAlerts({
                    basis: basis,
                    thresholdTon: threshold,
                    onlyReminder: false,
                });
                warningList.innerHTML = '';
                let visibleCount = 0;
                (data.items || []).forEach(function (it) {
                    const wh = it.warehouse || {};
                    const mat = it.material || {};
                    const rem = Number(
                        it.remainingWeightByBasis != null ? it.remainingWeightByBasis : 0
                    );
                    const actualOutTon = Number(it.actualOutboundWeight || 0);
                    const isOverstock = isInventoryOverstock(rem, threshold);
                    if (!matchesInventoryWarningStatusFilter(isOverstock, statusFilter)) return;

                    visibleCount += 1;
                    const row = document.createElement('tr');
                    row.className = isOverstock ? 'warning-row' : '';
                    row.innerHTML = `
            <td>${wh.code} - ${wh.name}</td>
            <td>${mat.code} - ${mat.name}</td>
            <td>${Number(it.totalApprovedInboundWeight || 0).toFixed(2)} 吨</td>
            <td>${Number(it.waitingNotActuallyOutboundWeight || 0).toFixed(2)} 吨</td>
            <td>${Number(it.plannedOutboundWeight || 0).toFixed(2)} 吨</td>
            <td>${actualOutTon.toFixed(2)} 吨</td>
            <td>${rem.toFixed(2)} 吨</td>
            <td>${inventoryWarningStatusBadgeHtml(isOverstock)}</td>
        `;
                    warningList.appendChild(row);
                });
                if (visibleCount === 0) {
                    renderWarningListEmptyRow(warningList);
                }
            } catch (e) {
                warningList.innerHTML =
                    '<tr><td colspan="8" style="text-align:center;color:#c00;">加载预警失败：' +
                    escapeHtml(e.message || '') +
                    '</td></tr>';
            }
        })();
        return;
    }
    
    const inventoryByMaterialWarehouse = {};
    
    AppState.inboundOrders.forEach((order) => {
        if (order.status === 'rejected') return;

        const key = `${order.materialId}-${order.warehouseId}`;
        if (!inventoryByMaterialWarehouse[key]) {
            inventoryByMaterialWarehouse[key] = {
                materialId: order.materialId,
                warehouseId: order.warehouseId,
                totalInbound: 0,
                pendingOutbound: 0,
                totalPreOutbound: 0,
                totalActualOutbound: 0,
                totalAvailable: 0
            };
        }
        const agg = inventoryByMaterialWarehouse[key];

        agg.totalActualOutbound += Number(order.actualOutboundWeight) || 0;

        if (order.status !== 'approved' && order.status !== 'outbounding') return;
        
        agg.totalInbound += order.weight;
        agg.pendingOutbound += Math.max(0, order.weight - order.actualOutboundWeight);
        agg.totalPreOutbound += order.preOutboundWeight;
        
        const availRaw =
            order.weight - order.actualOutboundWeight - (deductionMode === 'both' ? order.preOutboundWeight : 0);
        agg.totalAvailable += Math.max(0, availRaw);
    });
    
    let visibleCount = 0;
    Object.values(inventoryByMaterialWarehouse).forEach((inventory) => {
        const material = AppState.materials.find((m) => m.id === inventory.materialId);
        const warehouse = AppState.warehouses.find((w) => w.id === inventory.warehouseId);
        if (!material || !warehouse) return;
        
        const isOverstock = isInventoryOverstock(inventory.totalAvailable, threshold);
        if (!matchesInventoryWarningStatusFilter(isOverstock, statusFilter)) return;

        visibleCount += 1;
        const row = document.createElement('tr');
        row.className = isOverstock ? 'warning-row' : '';
        row.style.cursor = 'pointer';
        row.title = '点击查看库房品种库存详情';
        row.onclick = () => viewInventoryDetails(inventory.materialId, inventory.warehouseId);
        row.innerHTML = `
            <td>${warehouse.code} - ${warehouse.name}</td>
            <td>${material.code} - ${material.name}</td>
            <td>${inventory.totalInbound.toFixed(2)} ${material.unit}</td>
            <td>${inventory.pendingOutbound.toFixed(2)} ${material.unit}</td>
            <td>${inventory.totalPreOutbound.toFixed(2)} ${material.unit}</td>
            <td>${(inventory.totalActualOutbound || 0).toFixed(2)} ${material.unit}</td>
            <td>${inventory.totalAvailable.toFixed(2)} ${material.unit}</td>
            <td>${inventoryWarningStatusBadgeHtml(isOverstock)}</td>
        `;
        warningList.appendChild(row);
    });
    if (visibleCount === 0) {
        renderWarningListEmptyRow(warningList);
    }
}

// 查看库存详情
function viewInventoryDetails(materialId, warehouseId) {
    const material = AppState.materials.find(m => m.id === materialId);
    const warehouse = AppState.warehouses.find(w => w.id === warehouseId);
    
    if (!material || !warehouse) return;
    
    // 获取该库房该品种的所有入库单
    const inboundOrders = AppState.inboundOrders
        .filter(order => 
            order.materialId === materialId && 
            order.warehouseId === warehouseId &&
            (order.status === 'approved' || order.status === 'outbounding')
        )
        .sort((a, b) => parseQuotationDateTime(a.date) - parseQuotationDateTime(b.date));

    // 填充基本信息
    document.getElementById('inventory-detail-material').textContent = `${material.code} - ${material.name}`;
    document.getElementById('inventory-detail-warehouse').textContent = `${warehouse.code} - ${warehouse.name}`;
    
    // 计算总库存
    let totalWeight = 0;
    let totalValue = 0;
    
    inboundOrders.forEach(order => {
        const availableWeight = order.weight - order.actualOutboundWeight - order.preOutboundWeight;
        if (availableWeight > 0) {
            totalWeight += availableWeight;
            totalValue += availableWeight * order.unitPrice;
        }
    });
    
    document.getElementById('inventory-detail-total-weight').textContent = `${totalWeight.toFixed(2)} ${material.unit}`;
    document.getElementById('inventory-detail-total-value').textContent = formatCurrency(totalValue);
    
    // 填充入库单列表
    const inboundList = document.getElementById('inventory-inbound-list');
    inboundList.innerHTML = '';
    
    inboundOrders.forEach(order => {
        const availableWeight = order.weight - order.actualOutboundWeight - order.preOutboundWeight;
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${order.orderNo}</td>
            <td>${formatQuotationPublishDisplay(order.date)}</td>
            <td>${order.weight} ${material.unit}</td>
            <td>${order.actualOutboundWeight} ${material.unit}</td>
            <td>${order.preOutboundWeight} ${material.unit}</td>
            <td>${availableWeight.toFixed(2)} ${material.unit}</td>
            <td>${formatCurrency(order.unitPrice)}/${material.unit}</td>
            <td>
                ${order.status === 'approved' ? '已审核' : 
                  order.status === 'outbounding' ? '出库中' : order.status}
            </td>
        `;
        inboundList.appendChild(row);
    });
    
    // 显示模态框
    openModal('inventory-detail-modal');
}

function fillInventoryReportFilters() {
    const wSel = document.getElementById('report-warehouse-filter');
    const mSel = document.getElementById('report-material-filter');
    if (!wSel || !mSel) return;
    const wVal = wSel.value;
    const mVal = mSel.value;
    wSel.innerHTML = '<option value="">全部库房</option>';
    AppState.warehouses.forEach((w) => {
        wSel.appendChild(new Option(`${w.code} - ${w.name}`, String(w.id)));
    });
    mSel.innerHTML = '<option value="">全部品种</option>';
    AppState.materials.forEach((m) => {
        mSel.appendChild(new Option(`${m.code} - ${m.name}`, String(m.id)));
    });
    wSel.value = wVal;
    mSel.value = mVal;
}

// 加载库存报表（列与 index.html 表头一致：含库存状态与出库单号之间的出库单价；tbody 为 #inventory-report-list）
function loadInventoryReport() {
    fillInventoryReportFilters();
    
    const tbody = document.getElementById('inventory-report-list');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    const wf = document.getElementById('report-warehouse-filter')?.value || '';
    const mf = document.getElementById('report-material-filter')?.value || '';
    const sf = document.getElementById('report-status-filter')?.value || '';

    if (useApiMode()) {
        const statusMap = {
            approved: 'pending_outbound',
            outbounding: 'outbounding',
            partial: 'partial_outbound',
            completed: 'fully_outbound',
        };
        const invStatus = sf ? statusMap[sf] : '';
        void (async function () {
            try {
                const data = await window.InventoryApi.warehouseStockReport({
                    page: 1,
                    pageSize: 500,
                    warehouseId: wf ? Number(wf) : undefined,
                    materialId: mf ? Number(mf) : undefined,
                    inventoryStatus: invStatus || undefined,
                });
                tbody.innerHTML = '';
                (data.rows || []).forEach(function (r) {
                    const wh = r.warehouse || {};
                    const mat = r.material || {};
                    const qPx = getActiveQuotationPriceForMaterial(mat.id);
                    const qHtml =
                        qPx != null ? `${formatCurrency(qPx)}/吨` : '<span style="color:#888">-</span>';
                    const ow =
                        r.outboundWeight != null ? `${r.outboundWeight} 吨` : '-';
                    const row = document.createElement('tr');
                    row.innerHTML = `
            <td>${wh.code} - ${wh.name}</td>
            <td>${r.inboundOrderNo || '-'}</td>
            <td>${mat.code} - ${mat.name}</td>
            <td>${r.inboundWeight} 吨</td>
            <td>${r.inventoryStatusLabel || '-'}</td>
            <td>${qHtml}</td>
            <td>${r.outboundOrderNo || '-'}</td>
            <td>${r.subOrderNo || '-'}</td>
            <td>${ow}</td>
        `;
                    tbody.appendChild(row);
                });
            } catch (e) {
                tbody.innerHTML =
                    '<tr><td colspan="9" style="text-align:center;color:#c00;">' +
                    escapeHtml(e.message || '加载失败') +
                    '</td></tr>';
            }
        })();
        return;
    }
    
    const inboundFiltered = AppState.inboundOrders.filter((order) => {
        if (wf && String(order.warehouseId) !== wf) return false;
        if (mf && String(order.materialId) !== mf) return false;
        if (sf && normalizeInboundFlowStatus(order.status) !== sf) return false;
        return true;
    });
    
    inboundFiltered.forEach((order) => {
        const material = AppState.materials.find((m) => m.id === order.materialId);
        const warehouse = AppState.warehouses.find((w) => w.id === order.warehouseId);
        if (!material || !warehouse) return;
        
        const baseCols = `
            <td>${warehouse.code} - ${warehouse.name}</td>
            <td>${order.orderNo}</td>
            <td>${material.code} - ${material.name}</td>
            <td>${order.weight} ${material.unit}</td>
            <td>${inboundStatusLabelForReport(order.status)}</td>
        `;

        const quotationPx = getActiveQuotationPriceForMaterial(order.materialId);
        const quotationPxHtml =
            quotationPx != null
                ? `${formatCurrency(quotationPx)}/${material.unit}`
                : '<span style="color:#888">-</span>';
        
        const subs = AppState.outboundSuborders.filter((s) => s.inboundOrderId === order.id);
        
        if (!subs.length) {
            const row = document.createElement('tr');
            row.innerHTML = `${baseCols}<td>${quotationPxHtml}</td><td>-</td><td>-</td><td>-</td>`;
            tbody.appendChild(row);
            return;
        }
        
        subs.forEach((sub) => {
            const outbound = AppState.outboundOrders.find((o) => o.id === sub.outboundOrderId);
            const outNo = outbound ? outbound.orderNo : '-';
            const subNo = outbound ? `${outbound.orderNo}-子${sub.id}` : `子单${sub.id}`;
            const wOut = sub.actualWeight > 0 ? sub.actualWeight : sub.preWeight;
            const outboundPriceHtml =
                outbound != null && Number.isFinite(Number(outbound.price))
                    ? `${formatCurrency(outbound.price)}/${material.unit}`
                    : quotationPxHtml;
            const row = document.createElement('tr');
            row.innerHTML = `${baseCols}<td>${outboundPriceHtml}</td><td>${outNo}</td><td>${subNo}</td><td>${wOut} ${material.unit}</td>`;
            tbody.appendChild(row);
        });
    });
}

// 查看品种库存分布
function viewMaterialInventory(materialId) {
    const material = AppState.materials.find(m => m.id === materialId);
    if (!material) return;
    
    // 按库房统计
    const inventoryByWarehouse = {};
    
    AppState.inboundOrders.forEach(order => {
        if (order.materialId === materialId && 
            (order.status === 'approved' || order.status === 'outbounding')) {
            const warehouseId = order.warehouseId;
            if (!inventoryByWarehouse[warehouseId]) {
                inventoryByWarehouse[warehouseId] = {
                    warehouseId: warehouseId,
                    totalWeight: 0,
                    totalValue: 0
                };
            }
            
            const availableWeight = order.weight - order.actualOutboundWeight - order.preOutboundWeight;
            if (availableWeight > 0) {
                inventoryByWarehouse[warehouseId].totalWeight += availableWeight;
                inventoryByWarehouse[warehouseId].totalValue += availableWeight * order.unitPrice;
            }
        }
    });
    
    // 填充分布信息
    const distributionList = document.getElementById('material-distribution-list');
    if (!distributionList) return;
    
    distributionList.innerHTML = '';
    
    Object.values(inventoryByWarehouse).forEach(inventory => {
        const warehouse = AppState.warehouses.find(w => w.id === inventory.warehouseId);
        if (!warehouse) return;
        
        const percentage = (inventory.totalWeight / 
            Object.values(inventoryByWarehouse).reduce((sum, item) => sum + item.totalWeight, 0) * 100).toFixed(1);
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${warehouse.code}</td>
            <td>${warehouse.name}</td>
            <td>${inventory.totalWeight.toFixed(2)} ${material.unit}</td>
            <td>${formatCurrency(inventory.totalValue)}</td>
            <td>${percentage}%</td>
            <td>
                <div class="progress">
                    <div class="progress-bar" style="width: ${percentage}%"></div>
                </div>
            </td>
        `;
        distributionList.appendChild(row);
    });
    
    // 显示模态框
    openModal('material-distribution-modal');
}

function fillProfitReportFilters() {
    const mSel = document.getElementById('report-material-select');
    const wSel = document.getElementById('report-warehouse-select');
    if (!mSel || !wSel) return;
    const mv = mSel.value;
    const wv = wSel.value;
    mSel.innerHTML = '<option value="">全部品种</option>';
    AppState.materials.forEach((m) => {
        mSel.appendChild(new Option(`${m.code} - ${m.name}`, String(m.id)));
    });
    wSel.innerHTML = '<option value="">全部库房</option>';
    AppState.warehouses.forEach((w) => {
        wSel.appendChild(new Option(`${w.code} - ${w.name}`, String(w.id)));
    });
    if ([...mSel.options].some((o) => o.value === mv)) mSel.value = mv;
    if ([...wSel.options].some((o) => o.value === wv)) wSel.value = wv;
}

function parseReportDayToTime(dateStr) {
    if (!dateStr) return null;
    const t = new Date(`${dateStr}T00:00:00`).getTime();
    return Number.isNaN(t) ? null : t;
}

/** 报表中心：筛选后的全部汇总行 + 分页状态 */
const profitReportPagination = {
    rows: [],
    page: 1,
    pageSize: 20
};

function initProfitReportPagination() {
    const pageSizeEl = document.getElementById('profit-report-page-size');
    const prevBtn = document.getElementById('profit-report-prev');
    const nextBtn = document.getElementById('profit-report-next');
    if (pageSizeEl) {
        pageSizeEl.value = String(profitReportPagination.pageSize);
        pageSizeEl.addEventListener('change', () => {
            profitReportPagination.pageSize = parseInt(pageSizeEl.value, 10) || 20;
            profitReportPagination.page = 1;
            renderProfitReportTablePage();
        });
    }
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (profitReportPagination.page > 1) {
                profitReportPagination.page -= 1;
                renderProfitReportTablePage();
            }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = getProfitReportTotalPages();
            if (profitReportPagination.page < totalPages) {
                profitReportPagination.page += 1;
                renderProfitReportTablePage();
            }
        });
    }
}

function getProfitReportTotalPages() {
    const total = profitReportPagination.rows.length;
    if (total === 0) return 1;
    return Math.ceil(total / profitReportPagination.pageSize);
}

function buildProfitReportRowData(profit, material) {
    const profitMargin =
        profit.salesRevenue > 0 ? ((profit.profit / profit.salesRevenue) * 100).toFixed(2) : '0.00';
    const avgSalePrice = profit.salesWeight > 0 ? profit.salesRevenue / profit.salesWeight : 0;
    const salesWeightText = `${profit.salesWeight.toFixed(2)} ${material.unit}`;
    const avgPriceText = `${formatCurrency(avgSalePrice)}/${material.unit}`;
    return {
        sortKey: `${getWarehouseLabel(profit.warehouseId)}|${material.code}`,
        warehouseLabel: getWarehouseLabel(profit.warehouseId),
        materialCode: material.code,
        materialName: material.name,
        salesWeightText,
        avgPriceText,
        revenueText: formatCurrency(profit.salesRevenue),
        costText: formatCurrency(profit.cost),
        profitText: formatCurrency(profit.profit),
        marginText: `${profitMargin}%`,
        marginValue: profitMargin,
        salesRevenue: profit.salesRevenue,
        cost: profit.cost,
        profit: profit.profit
    };
}

function renderProfitReportTablePage() {
    const tbody = document.getElementById('profit-report-list');
    if (!tbody) return;

    const { rows, page, pageSize } = profitReportPagination;
    const total = rows.length;
    const totalPages = getProfitReportTotalPages();

    if (total === 0) {
        tbody.innerHTML =
            '<tr><td colspan="9" style="text-align: center; color: #999;">暂无数据，请调整筛选条件后生成报表</td></tr>';
    } else {
        if (page > totalPages) profitReportPagination.page = totalPages;
        const safePage = profitReportPagination.page;
        const start = (safePage - 1) * pageSize;
        const pageRows = rows.slice(start, start + pageSize);
        tbody.innerHTML = pageRows
            .map(
                (r) => `
            <tr>
            <td>${r.warehouseLabel}</td>
            <td>${r.materialCode}</td>
            <td>${r.materialName}</td>
            <td>${r.salesWeightText}</td>
            <td>${r.avgPriceText}</td>
            <td>${r.revenueText}</td>
            <td>${r.costText}</td>
            <td>${r.profitText}</td>
            <td>${r.marginText}</td>
        `
            )
            .join('');
    }

    const infoEl = document.getElementById('profit-report-pagination-info');
    const indicatorEl = document.getElementById('profit-report-page-indicator');
    const prevBtn = document.getElementById('profit-report-prev');
    const nextBtn = document.getElementById('profit-report-next');
    const currentPage = total === 0 ? 1 : profitReportPagination.page;

    if (infoEl) {
        if (total === 0) {
            infoEl.textContent = '共 0 条';
        } else {
            const from = (currentPage - 1) * pageSize + 1;
            const to = Math.min(currentPage * pageSize, total);
            infoEl.textContent = `共 ${total} 条，当前显示第 ${from}–${to} 条`;
        }
    }
    if (indicatorEl) {
        indicatorEl.textContent = `第 ${currentPage} / ${totalPages} 页`;
    }
    if (prevBtn) prevBtn.disabled = total === 0 || currentPage <= 1;
    if (nextBtn) nextBtn.disabled = total === 0 || currentPage >= totalPages;
}

// 加载报表中心页面
function loadReportsPage() {
    fillProfitReportFilters();
    const startEl = document.getElementById('report-start-date');
    const endEl = document.getElementById('report-end-date');
    if (startEl && !startEl.value) {
        const d = new Date();
        startEl.value = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
    }
    if (endEl && !endEl.value) {
        endEl.value = new Date().toISOString().split('T')[0];
    }
    generateProfitReport();
}

// 生成利润报表（支持日期/品种/库房筛选与分页展示）
function generateProfitReport() {
    try {
        const tbody = document.getElementById('profit-report-list');
        if (!tbody) {
            showMessage('未找到利润报表表格', 'error');
            return;
        }

        const startVal = document.getElementById('report-start-date')?.value || '';
        const endVal = document.getElementById('report-end-date')?.value || '';
        const materialFilter = document.getElementById('report-material-select')?.value || '';
        const warehouseFilter = document.getElementById('report-warehouse-select')?.value || '';

        const tStart = parseReportDayToTime(startVal);
        const tEndDay = parseReportDayToTime(endVal);

        let completedOutbounds = AppState.outboundOrders.filter((o) => o.status === 'completed');

        completedOutbounds = completedOutbounds.filter((o) => {
            if (materialFilter && String(o.materialId) !== materialFilter) return false;
            if (warehouseFilter && String(o.warehouseId || '') !== warehouseFilter) return false;
            const dayStr = String(o.date || '').slice(0, 10);
            const od = parseReportDayToTime(dayStr);
            if (tStart != null && od != null && od < tStart) return false;
            if (tEndDay != null && od != null && od > tEndDay) return false;
            return true;
        });

        const profitByMaterialWarehouse = {};

        completedOutbounds.forEach((order) => {
            const materialId = order.materialId;
            const warehouseId = order.warehouseId;
            const key = `${materialId}-${warehouseId}`;
            const actualW = Number(order.actualWeight) || 0;
            const price = Number(order.price) || 0;
            if (!profitByMaterialWarehouse[key]) {
                profitByMaterialWarehouse[key] = {
                    materialId,
                    warehouseId,
                    salesWeight: 0,
                    salesRevenue: 0,
                    cost: 0,
                    profit: 0
                };
            }
            profitByMaterialWarehouse[key].salesWeight += actualW;
            profitByMaterialWarehouse[key].salesRevenue += actualW * price;
            profitByMaterialWarehouse[key].cost += allocateOutboundOrderCost(order);
            profitByMaterialWarehouse[key].profit =
                profitByMaterialWarehouse[key].salesRevenue - profitByMaterialWarehouse[key].cost;
        });

        let totalSalesRevenue = 0;
        let totalCost = 0;
        let totalProfit = 0;
        const reportRows = [];

        Object.values(profitByMaterialWarehouse).forEach((profit) => {
            const material = AppState.materials.find((m) => m.id === profit.materialId);
            if (!material) return;

            const rowData = buildProfitReportRowData(profit, material);
            reportRows.push(rowData);
            totalSalesRevenue += rowData.salesRevenue;
            totalCost += rowData.cost;
            totalProfit += rowData.profit;
        });

        reportRows.sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'zh-CN'));

        const pageSizeEl = document.getElementById('profit-report-page-size');
        profitReportPagination.rows = reportRows;
        profitReportPagination.page = 1;
        profitReportPagination.pageSize = pageSizeEl
            ? parseInt(pageSizeEl.value, 10) || 20
            : profitReportPagination.pageSize;

        setElementText('total-sales', formatCurrency(totalSalesRevenue));
        setElementText('total-cost', formatCurrency(totalCost));
        setElementText('total-profit', formatCurrency(totalProfit));
        setElementText(
            'avg-profit-rate',
            totalSalesRevenue > 0 ? ((totalProfit / totalSalesRevenue) * 100).toFixed(2) + '%' : '0%'
        );

        renderProfitReportTablePage();

        const n = reportRows.length;
        showMessage(n > 0 ? `已生成 ${n} 条汇总记录` : '当前筛选条件下没有已完成的出库记录', n > 0 ? 'success' : 'info');
    } catch (e) {
        console.error(e);
        showMessage('生成报表失败：' + (e.message || String(e)), 'error');
    }
}

// 导出报表到Excel（导出当前筛选条件下的全部汇总行，不限于当前页）
function exportReportToExcel() {
    const rows = profitReportPagination.rows;
    if (!rows.length) {
        showMessage('没有可导出的数据', 'error');
        return;
    }

    let csv = '所属库房,品种代码,品种名称,销售重量(吨),销售均价(元/吨),销售收入(元),销售成本(元),销售利润(元),利润率(%)\n';

    rows.forEach((r) => {
        const rawCells = [
            r.warehouseLabel,
            r.materialCode,
            r.materialName,
            r.salesWeightText,
            r.avgPriceText,
            r.revenueText,
            r.costText,
            r.profitText,
            r.marginValue
        ];
        const cells = rawCells.map((text, index) => {
            let t = String(text)
                .replace(/¥/g, '')
                .replace(/,/g, '');
            // 利润率不带 %：Excel 会把 "-53997.86%" 当百分比解析，列宽不足时显示 #######
            if (index === rawCells.length - 1) {
                t = t.replace(/%$/, '');
            }
            return `"${t}"`;
        });
        csv += cells.join(',') + '\n';
    });
    
    // 创建下载链接
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `利润报表_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showMessage('报表已导出为CSV文件', 'success');
}

let warehouseDailyPageInited = false;

function isStatisticsOrAdmin() {
    return isSystemAdministrator() || getApiUserRole() === 'statistics';
}

function fmtDailyCell(v, kind) {
    if (v == null || v === '') return '—';
    if (kind === 'ton') return formatNumber(v);
    if (kind === 'money') return formatCurrency(v);
    return String(v);
}

function fillWarehouseDailyFilterSelects() {
    const whSel = document.getElementById('warehouse-daily-warehouse-select');
    const matSel = document.getElementById('warehouse-daily-material-select');
    if (whSel) {
        const cur = whSel.value;
        whSel.innerHTML = '<option value="">全部库房</option>';
        (AppState.warehouses || []).forEach((w) => {
            const opt = document.createElement('option');
            opt.value = String(w.id);
            opt.textContent = w.name || w.code || String(w.id);
            whSel.appendChild(opt);
        });
        if (cur) whSel.value = cur;
    }
    if (matSel) {
        const cur = matSel.value;
        matSel.innerHTML = '<option value="">全部品类</option>';
        (AppState.materials || []).forEach((m) => {
            const opt = document.createElement('option');
            opt.value = String(m.id);
            opt.textContent = m.name || m.code || String(m.id);
            matSel.appendChild(opt);
        });
        if (cur) matSel.value = cur;
    }
}

function applyWarehouseDailyManagerOptions(managers) {
    const sel = document.getElementById('warehouse-daily-manager-select');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">全部大区经理</option>';
    (managers || []).forEach((rm) => {
        const opt = document.createElement('option');
        opt.value = rm;
        opt.textContent = rm;
        sel.appendChild(opt);
    });
    if (cur) sel.value = cur;
}

function buildWarehouseDailyDisplayRows(data) {
    const rows = [];
    (data.blocks || []).forEach((block) => {
        (block.categories || []).forEach((cat) => {
            const lines =
                cat.lines && cat.lines.length
                    ? cat.lines
                    : [
                          {
                              lineType: 'balance',
                              openingStockTon: cat.openingStockTon,
                              closingStockTon: cat.closingStockTon,
                              inbound: null,
                              outbound: null,
                          },
                      ];
            lines.forEach((line, lineIdx) => {
                rows.push({
                    regionalManager: block.regionalManager,
                    warehouseName: block.warehouseName,
                    materialName: cat.materialName,
                    openingStockTon:
                        lineIdx === 0 ? cat.openingStockTon : null,
                    closingStockTon: line.closingStockTon,
                    benchmark: cat.benchmarkReferencePrice,
                    collective: cat.collectiveProfitHalf,
                    inbound: line.inbound,
                    outbound: line.outbound,
                });
            });
        });
    });
    return rows;
}

function renderWarehouseDailyTable(data) {
    const tbody = document.getElementById('warehouse-daily-tbody');
    if (!tbody) return;
    const displayRows = buildWarehouseDailyDisplayRows(data);
    if (!displayRows.length) {
        tbody.innerHTML =
            '<tr><td colspan="25" class="empty-hint">当前条件下无数据</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    let lastManager = '\0';
    let lastWarehouse = '\0';
    displayRows.forEach((r) => {
        const tr = document.createElement('tr');
        if (r.regionalManager !== lastManager) {
            lastManager = r.regionalManager;
            lastWarehouse = '\0';
            const mgrCount = displayRows.filter(
                (x) => x.regionalManager === r.regionalManager
            ).length;
            const td = document.createElement('td');
            td.rowSpan = mgrCount;
            td.textContent = r.regionalManager || '—';
            tr.appendChild(td);
        }
        if (r.warehouseName !== lastWarehouse) {
            lastWarehouse = r.warehouseName;
            const whCount = displayRows.filter(
                (x) =>
                    x.regionalManager === r.regionalManager &&
                    x.warehouseName === r.warehouseName
            ).length;
            const td = document.createElement('td');
            td.rowSpan = whCount;
            td.textContent = r.warehouseName || '—';
            tr.appendChild(td);
        }
        const ib = r.inbound;
        const ob = r.outbound;
        const cells = [
            r.materialName || '—',
            r.openingStockTon != null ? formatNumber(r.openingStockTon) : '—',
            ib ? ib.date || '—' : '—',
            ib ? ib.materialName || '—' : '—',
            ib ? fmtDailyCell(ib.unitPrice, 'money') : '—',
            ib ? fmtDailyCell(ib.freight, 'money') : '—',
            ib ? fmtDailyCell(ib.costUnitPrice, 'money') : '—',
            ib ? fmtDailyCell(ib.grossProfitPerTon, 'money') : '—',
            ib ? fmtDailyCell(ib.netWeightTon, 'ton') : '—',
            ib ? fmtDailyCell(ib.costAmount, 'money') : '—',
            ob ? ob.weighbridgeDate || '—' : '—',
            ob ? ob.vehicleNo || '—' : '—',
            ob ? ob.materialName || '—' : '—',
            ob ? fmtDailyCell(ob.weightTon, 'ton') : '—',
            ob ? fmtDailyCell(ob.fifoUnitPrice, 'money') : '—',
            ob ? fmtDailyCell(ob.amount, 'money') : '—',
            ob ? fmtDailyCell(ob.pickupUnitPrice, 'money') : '—',
            ob ? fmtDailyCell(ob.paymentAmount, 'money') : '—',
            ob ? fmtDailyCell(ob.storageServiceFeePerTon, 'money') : '—',
            ob ? fmtDailyCell(ob.profitAmount, 'money') : '—',
            fmtDailyCell(r.closingStockTon, 'ton'),
            fmtDailyCell(r.benchmark, 'money'),
            r.collective != null ? fmtDailyCell(r.collective, 'money') : '—',
        ];
        cells.forEach((text, i) => {
            const td = document.createElement('td');
            td.textContent = text;
            if (i === 8 || i === 13) td.classList.add('col-highlight');
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

async function queryWarehouseDailySummary() {
    const dateEl = document.getElementById('warehouse-daily-date');
    const date = dateEl?.value || '';
    if (!date) {
        showMessage('请选择统计日', 'error');
        return;
    }
    const regionalManager =
        document.getElementById('warehouse-daily-manager-select')?.value || '';
    const warehouseId =
        document.getElementById('warehouse-daily-warehouse-select')?.value || '';
    const materialId =
        document.getElementById('warehouse-daily-material-select')?.value || '';

    if (!window.InventoryApi?.useApiMode?.()) {
        showMessage('请使用后端 API 模式登录后查询', 'error');
        return;
    }

    try {
        const data = await window.InventoryApi.warehouseDailySummary({
            date,
            regionalManager: regionalManager || undefined,
            warehouseId: warehouseId || undefined,
            materialId: materialId || undefined,
        });
        if (data.filterOptions?.regionalManagers) {
            applyWarehouseDailyManagerOptions(data.filterOptions.regionalManagers);
        }
        renderWarehouseDailyTable(data);
        const lineCount = (data.blocks || []).reduce(
            (n, b) =>
                n +
                (b.categories || []).reduce(
                    (m, c) => m + (c.lines?.length || 1),
                    0
                ),
            0
        );
        showMessage(
            lineCount > 0
                ? `已加载 ${data.blocks.length} 个库房、${lineCount} 行明细`
                : '当前条件下无明细数据',
            lineCount > 0 ? 'success' : 'info'
        );
    } catch (e) {
        console.error(e);
        showMessage('查询失败：' + (e.message || String(e)), 'error');
    }
}

function loadWarehouseDailyPage() {
    fillWarehouseDailyFilterSelects();
    const dateEl = document.getElementById('warehouse-daily-date');
    if (dateEl && !dateEl.value) {
        dateEl.value = '2026-05-16';
    }
    const syncBtn = document.getElementById('warehouse-daily-sync-rm-btn');
    if (syncBtn) {
        syncBtn.hidden = !isStatisticsOrAdmin();
    }
    if (!warehouseDailyPageInited) {
        warehouseDailyPageInited = true;
        document
            .getElementById('warehouse-daily-query-btn')
            ?.addEventListener('click', () => queryWarehouseDailySummary());
        document
            .getElementById('warehouse-daily-sync-rm-btn')
            ?.addEventListener('click', async () => {
                if (!window.InventoryApi?.syncRegionalManagersFromPd2) return;
                try {
                    const r =
                        await window.InventoryApi.syncRegionalManagersFromPd2(180);
                    showMessage(
                        `已更新 ${r.updated} 个库房大区经理（跳过手工 ${r.skippedManual}，无匹配 ${r.unmatched}）`,
                        'success'
                    );
                    await queryWarehouseDailySummary();
                } catch (e) {
                    showMessage(
                        '同步失败：' + (e.message || String(e)),
                        'error'
                    );
                }
            });
    }
}

// 初始化页面加载
document.addEventListener('DOMContentLoaded', initApp);
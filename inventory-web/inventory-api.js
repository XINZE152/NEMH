/**
 * 后端 API 客户端（与主项目 `server/src` 及规格文档对齐）
 * 规格说明：`../server/API接口文档.md`
 * OpenAPI：`../server/openapi.json`
 * 注意：文件名不要用 api-*.js，以免 Vite 将 `/api` 代理误匹配到静态资源。
 * Vite（5173）开发：`index.html` 中 `__API_BASE__ = ''` 走同源代理 → 127.0.0.1:3001；`file://` 打开时设 `__API_BASE__ = 'http://127.0.0.1:3001'`。
 */
(function () {
  function apiBase() {
    if (typeof window === 'undefined') return '';
    const b = window.__API_BASE__;
    if (b == null || b === '') return '';
    return String(b).replace(/\/$/, '');
  }

  function apiUrl(path) {
    const p = path.startsWith('/') ? path : '/' + path;
    const base = apiBase();
    return base ? base + p : p;
  }

  function getToken() {
    try {
      return localStorage.getItem('apiToken') || '';
    } catch {
      return '';
    }
  }

  async function apiFetch(path, options) {
    const opts = options || {};
    const headers = Object.assign({}, opts.headers || {});
    let body = opts.body;
    if (body != null && typeof body === 'object' && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(apiUrl(path), Object.assign({}, opts, { headers, body }));
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    if (!res.ok) {
      let msg = (data && data.error) || res.statusText || '请求失败';
      if (data && data.code) {
        msg = '[' + data.code + '] ' + msg;
      }
      if (data && data.detail) {
        msg += '（' + data.detail + '）';
      }
      if (data && data.path) {
        msg += ' path=' + data.path;
      }
      if (data && data.latestPurchaseUnitPrice != null) {
        const p = Number(data.latestPurchaseUnitPrice);
        if (Number.isFinite(p)) {
          msg += '（当前品种最新收货定价：' + p + ' 元/吨）';
        }
      }
      const err = new Error(msg);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  /**
   * 拉取分页列表直到取完（服务端 pageSize 上限多为 100，见主项目 API 文档）
   */
  async function fetchAllPaged(path, listKey, maxPageSize) {
    const cap = Math.min(100, Math.max(1, maxPageSize || 100));
    const aggregated = [];
    let page = 1;
    let total = Infinity;
    while (aggregated.length < total) {
      const sep = path.includes('?') ? '&' : '?';
      const data = await apiFetch(
        path + sep + 'page=' + page + '&pageSize=' + cap
      );
      const chunk = (data && data[listKey]) || [];
      aggregated.push.apply(aggregated, chunk);
      total = data && data.total != null ? Number(data.total) : aggregated.length;
      if (!chunk.length) break;
      page += 1;
    }
    return aggregated;
  }

  function useApiMode() {
    return typeof window !== 'undefined' && window.__USE_BACKEND_API__ === true;
  }

  /**
   * 与后端一致：username=admin 且非库房 DB 角色时，映射为全权限（与离线「系统管理员」一致）。
   * 其他 statistics 用户仅统计部菜单；库房为 warehouse。服务端对 admin 同时放行统计/库房接口。
   */
  function mapLoginUser(apiUser) {
    const roleStr = apiUser.role === 'warehouse' ? 'warehouse' : 'statistics';
    const isWarehouse = roleStr === 'warehouse';

    if (apiUser.username === 'admin' && !isWarehouse) {
      const user = {
        id: apiUser.id,
        username: apiUser.username,
        name: apiUser.username,
        roleId: 1,
        warehouseId: null,
        apiRole: 'statistics',
      };
      const role = { id: 1, name: '系统管理员', permissions: ['all'] };
      return { user, role };
    }

    const role = isWarehouse
      ? { id: 3, name: '财务', permissions: ['pricing', 'inbound', 'outbound'] }
      : {
          id: 2,
          name: '统计部',
          permissions: ['quotation', 'report'],
        };
    const user = {
      id: apiUser.id,
      username: apiUser.username,
      name: apiUser.username,
      roleId: role.id,
      warehouseId: isWarehouse ? 1 : null,
      apiRole: roleStr,
    };
    return { user, role };
  }

  /**
   * 多图在库里用英文逗号拼接（与 app.js 中 imgs.join(',') 一致）。
   * 单张 Data URL 形如 data:image/png;base64,xxxx —— 逗号在「base64,」处，不能整段 split(',')。
   * 仅当逗号后为另一张图的开头（data: 或 http(s)）时才拆分。
   */
  function splitCombinedImageUrls(storage) {
    if (!storage || typeof storage !== 'string') return [];
    const s = storage.trim();
    if (!s) return [];
    return s
      .split(/,(?=(?:data:|https?:\/\/))/i)
      .map(function (x) {
        return x.trim();
      })
      .filter(Boolean);
  }

  function proofToImages(url) {
    return splitCombinedImageUrls(url);
  }

  function normalizeMaterial(m) {
    return {
      id: m.id,
      code: m.code,
      name: m.name,
      unit: '吨',
      description: m.description || '',
    };
  }

  function normalizeWarehouse(w) {
    return {
      id: w.id,
      code: w.code,
      name: w.name,
      address: w.address != null ? w.address : '',
    };
  }

  function normalizePurchasePrice(p) {
    const entered = p.enteredAt || p.entered_at || '';
    const day = entered.slice(0, 10).replace(/T.*/, '') || new Date().toISOString().slice(0, 10);
    return {
      id: p.id,
      materialId: p.materialId,
      price: Number(p.unitPrice),
      date: day,
      datetime: formatApiTimeToDisplay(entered),
      note: p.description || '',
      marketImages: proofToImages(p.marketPriceProof),
      selfImages: proofToImages(p.receivePriceProof),
    };
  }

  function formatApiTimeToDisplay(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return y + '-' + mo + '-' + da + ' ' + h + ':' + mi + ':' + s;
  }

  function normalizeInbound(io) {
    const st = io.auditStatus || io.audit_status || 'approved';
    let status = 'approved';
    if (st === 'rejected') status = 'rejected';
    const inboundAt = io.inboundAt || io.inbound_at || '';
    const photoRaw = io.photo != null ? io.photo : io.inboundPhoto;
    const photo = typeof photoRaw === 'string' ? photoRaw.trim() : '';
    const images = splitCombinedImageUrls(photo);
    return {
      id: io.id,
      orderNo: io.orderNo || io.order_no,
      warehouseId: io.warehouseId != null ? io.warehouseId : io.warehouse_id,
      materialId: io.materialId != null ? io.materialId : io.material_id,
      weight: Number(io.weight),
      unitPrice: Number(io.unitPrice != null ? io.unitPrice : io.unit_price),
      totalPrice: Number(io.totalAmount != null ? io.totalAmount : io.total_amount),
      status,
      date: inboundAt || formatApiTimeToDisplay(io.createdAt),
      /** 多图仍以逗号拼接存库；展示时需配合 splitCombinedImageUrls，禁止简单 split(',') */
      photo,
      images,
      reviewerId: io.reviewedBy != null ? io.reviewedBy : io.reviewed_by,
      reviewerUsername: io.reviewerUsername || io.reviewer_username || '',
      reviewDate: io.reviewedAt || io.reviewed_at || null,
      rejectReason: io.rejectReason || io.reject_reason || '',
      rejectAt: io.reviewedAt || io.reviewed_at || '',
      actualOutboundWeight: 0,
      preOutboundWeight: 0,
    };
  }

  function normalizeOutboundHeader(o) {
    const apiStatus = o.status === 'completed' ? 'completed' : 'pending';
    const pending = apiStatus === 'pending';
    const rawCreated = o.createdAt || o.created_at || '';
    const rawUpdated = o.updatedAt || o.updated_at || '';
    const displayTime = pending
      ? formatApiTimeToDisplay(rawCreated)
      : formatApiTimeToDisplay(rawUpdated || rawCreated);
    return {
      id: o.id,
      orderNo: o.orderNo,
      materialId: o.materialId,
      warehouseId: o.warehouseId,
      preWeight: Number(o.plannedWeight != null ? o.plannedWeight : o.planned_weight),
      actualWeight: Number(o.actualWeight != null ? o.actualWeight : o.actual_weight || 0),
      price: Number(o.unitPrice != null ? o.unitPrice : o.unit_price),
      /** 后端原始状态：pending | completed */
      apiStatus: apiStatus,
      /** 界面 Tab：pending 映射为 pre_outbound，实际出库 Tab 另按 apiStatus 纳入 */
      status: pending ? 'pre_outbound' : 'completed',
      date: displayTime || formatApiTimeToDisplay(new Date().toISOString()),
      createdAt: rawCreated,
      updatedAt: rawUpdated,
      weighingSlipImage: o.weighbridgePhoto || o.weighbridge_photo || '',
      weighingSlipName: '磅单',
    };
  }

  function fifoLinesToSuborders(outboundId, lines) {
    if (!Array.isArray(lines)) return [];
    return lines.map(function (ln) {
      const actualWeight = Number(
        ln.actualWeight != null ? ln.actualWeight : ln.actual_weight || 0
      );
      const preWeight = Number(ln.plannedWeight != null ? ln.plannedWeight : ln.planned_weight);
      const inboundUnitPrice = Number(
        ln.inboundUnitPrice != null ? ln.inboundUnitPrice : ln.inbound_unit_price
      );
      return {
        id: ln.id,
        outboundOrderId: outboundId,
        inboundOrderId: ln.inboundOrderId,
        inboundOrderNo: ln.inboundOrderNo || ln.inbound_order_no || '',
        lineNo: Number(ln.lineNo != null ? ln.lineNo : ln.line_no) || 0,
        subOrderNo: ln.subOrderNo || ln.sub_order_no || '',
        inboundAt: ln.inboundAt || ln.inbound_at || '',
        inboundUnitPrice: Number.isFinite(inboundUnitPrice) ? inboundUnitPrice : null,
        preWeight: preWeight,
        actualWeight: actualWeight,
        status: actualWeight > 0 ? 'completed' : 'pre_outbound',
      };
    });
  }

  function fetchOutboundDetail(id) {
    return apiFetch('/api/admin/outbound-orders/' + id);
  }

  function buildQuotationsFromSalePrices(prices) {
    const byMat = new Map();
    (prices || []).forEach(function (p) {
      const mid = Number(p.materialId ?? p.material_id);
      if (!Number.isFinite(mid)) return;
      const t = new Date(p.publishedAt || p.published_at || 0).getTime();
      const prev = byMat.get(mid);
      if (!prev || t > prev.t) byMat.set(mid, { t: t, row: p });
    });
    const list = [];
    (prices || []).forEach(function (p) {
      const mid = Number(p.materialId ?? p.material_id);
      if (!Number.isFinite(mid)) return;
      const latest = byMat.get(mid);
      const lid = latest && latest.row ? Number(latest.row.id) : NaN;
      const pid = Number(p.id);
      const isActive = Number.isFinite(lid) && Number.isFinite(pid) && lid === pid;
      list.push({
        id: pid,
        materialId: mid,
        price: Number(p.unitPrice ?? p.unit_price),
        date: p.publishedAt || p.published_at,
        isActive: !!isActive,
      });
    });
    return list;
  }

  async function login(username, password) {
    return apiFetch('/api/admin/login', {
      method: 'POST',
      body: { username: username, password: password },
    });
  }

  function findPd2Token() {
    try {
      const keys = ['token', 'access_token', 'authToken', 'redspider_sso_token'];
      for (let i = 0; i < keys.length; i++) {
        const v = localStorage.getItem(keys[i]);
        if (v && String(v).trim()) return String(v).trim();
      }
    } catch {
      /* ignore */
    }
    return '';
  }

  async function ssoLogin(pd2Token) {
    return apiFetch('/api/auth/sso', {
      method: 'POST',
      body: { token: pd2Token },
    });
  }

  async function trySsoFromProject2() {
    const pd2Token = findPd2Token();
    if (!pd2Token) return null;
    try {
      return await ssoLogin(pd2Token);
    } catch {
      return null;
    }
  }

  async function refreshAppStateFromServer(appState) {
    const materials = await apiFetch('/api/admin/materials');
    appState.materials = (materials || []).map(normalizeMaterial);

    const warehouses = await apiFetch('/api/admin/warehouses');
    appState.warehouses = (warehouses || []).map(normalizeWarehouse);

    const ppRows = await fetchAllPaged('/api/admin/purchase-prices', 'prices', 100);
    appState.pricingRecords = ppRows.map(normalizePurchasePrice);

    const inboundRows = await fetchAllPaged('/api/admin/inbound-orders', 'orders', 100);
    appState.inboundOrders = inboundRows.map(normalizeInbound);

    const spRows = await fetchAllPaged('/api/admin/sale-prices', 'prices', 100);
    appState.quotations = buildQuotationsFromSalePrices(spRows);

    const rawList = await fetchAllPaged('/api/admin/outbound-orders', 'orders', 100);
    const orders = rawList.map(normalizeOutboundHeader);
    appState.outboundOrders = orders;
    appState.outboundSuborders = [];
    for (let i = 0; i < rawList.length; i++) {
      const det = await apiFetch('/api/admin/outbound-orders/' + rawList[i].id);
      const subs = fifoLinesToSuborders(rawList[i].id, det.fifoLines || []);
      appState.outboundSuborders = appState.outboundSuborders.concat(subs);
    }

    try {
      const apiUserRaw = localStorage.getItem('apiUser');
      if (apiUserRaw) {
        const au = JSON.parse(apiUserRaw);
        if (au && au.role === 'statistics') {
          const users = await apiFetch('/api/admin/users');
          appState.users = (users || []).map(function (row) {
            return {
              id: row.id,
              username: row.username,
              name: row.username,
              roleId: row.role === 'warehouse' ? 3 : 2,
              warehouseId: row.role === 'warehouse' ? 1 : null,
            };
          });
        } else {
          appState.users = [];
        }
      }
    } catch (e) {
      appState.users = [];
    }

    enrichInboundOrdersFromFifo(appState);
  }

  function isOutboundOrderCompleted(ob) {
    if (!ob) return false;
    if (ob.apiStatus === 'completed') return true;
    if (ob.status === 'completed') return true;
    return false;
  }

  /**
   * 已出库 = 子单 actual 合计；
   * 预出库 = 仅待完成出库单上尚未实际出库的预分配（pre − actual），已完成出库单不计预出库差额。
   */
  function sumInboundOutboundWeightsFromSubs(subs, outboundOrderById) {
    let preOutboundWeight = 0;
    let actualOutboundWeight = 0;
    (subs || []).forEach(function (s) {
      const pre = Number(s.preWeight) || 0;
      const actual = Number(s.actualWeight) || 0;
      actualOutboundWeight += actual;
      const ob =
        outboundOrderById && typeof outboundOrderById.get === 'function'
          ? outboundOrderById.get(s.outboundOrderId)
          : null;
      if (!isOutboundOrderCompleted(ob)) {
        preOutboundWeight += Math.max(0, pre - actual);
      }
    });
    return { preOutboundWeight: preOutboundWeight, actualOutboundWeight: actualOutboundWeight };
  }

  function enrichInboundOrdersFromFifo(appState) {
    const outboundById = new Map(
      (appState.outboundOrders || []).map(function (o) {
        return [o.id, o];
      })
    );
    const subsByInbound = new Map();
    (appState.outboundSuborders || []).forEach(function (sub) {
      const iid = sub.inboundOrderId;
      if (iid == null) return;
      if (!subsByInbound.has(iid)) subsByInbound.set(iid, []);
      subsByInbound.get(iid).push(sub);
    });
    appState.inboundOrders = (appState.inboundOrders || []).map(function (order) {
      if (order.status === 'rejected') return order;
      const subs = subsByInbound.get(order.id) || [];
      const weights = sumInboundOutboundWeightsFromSubs(subs, outboundById);
      const preOutboundWeight = weights.preOutboundWeight;
      const actualOutboundWeight = weights.actualOutboundWeight;
      const weight = Number(order.weight) || 0;
      let status = 'approved';
      if (actualOutboundWeight >= weight && weight > 0) status = 'completed';
      else if (actualOutboundWeight > 0) status = 'partial';
      else if (preOutboundWeight > 0) status = 'outbounding';
      return Object.assign({}, order, {
        preOutboundWeight: preOutboundWeight,
        actualOutboundWeight: actualOutboundWeight,
        status: status,
      });
    });
  }

  window.InventoryApi = {
    useApiMode: useApiMode,
    mapLoginUser: mapLoginUser,
    login: login,
    findPd2Token: findPd2Token,
    ssoLogin: ssoLogin,
    trySsoFromProject2: trySsoFromProject2,
    refreshAppStateFromServer: refreshAppStateFromServer,
    sumInboundOutboundWeightsFromSubs: sumInboundOutboundWeightsFromSubs,
    enrichInboundOrdersFromFifo: enrichInboundOrdersFromFifo,
    apiFetch: apiFetch,
    splitCombinedImageUrls: splitCombinedImageUrls,
    createPurchasePrice: function (body) {
      return apiFetch('/api/admin/purchase-prices', { method: 'POST', body: body });
    },
    updatePurchasePrice: function (id, body) {
      return apiFetch('/api/admin/purchase-prices/' + id, { method: 'PUT', body: body });
    },
    deletePurchasePrice: function (id) {
      return apiFetch('/api/admin/purchase-prices/' + id, { method: 'DELETE' });
    },
    createInbound: function (body) {
      return apiFetch('/api/admin/inbound-orders', { method: 'POST', body: body });
    },
    updateInbound: function (id, body) {
      return apiFetch('/api/admin/inbound-orders/' + id, { method: 'PUT', body: body });
    },
    deleteInbound: function (id) {
      return apiFetch('/api/admin/inbound-orders/' + id, { method: 'DELETE' });
    },
    approveInbound: function (id) {
      return apiFetch('/api/admin/inbound-orders/' + id + '/approve', { method: 'PUT', body: {} });
    },
    rejectInbound: function (id, reason) {
      return apiFetch('/api/admin/inbound-orders/' + id + '/reject', {
        method: 'PUT',
        body: { rejectReason: reason || '' },
      });
    },
    createWarehouse: function (body) {
      return apiFetch('/api/admin/warehouses', { method: 'POST', body: body });
    },
    updateWarehouse: function (id, body) {
      return apiFetch('/api/admin/warehouses/' + id, { method: 'PUT', body: body });
    },
    deleteWarehouse: function (id) {
      return apiFetch('/api/admin/warehouses/' + id, { method: 'DELETE' });
    },
    createSalePrice: function (body) {
      return apiFetch('/api/admin/sale-prices', { method: 'POST', body: body });
    },
    createOutbound: function (body) {
      return apiFetch('/api/admin/outbound-orders', { method: 'POST', body: body });
    },
    deleteOutbound: function (id) {
      return apiFetch('/api/admin/outbound-orders/' + id, { method: 'DELETE' });
    },
    completeOutbound: function (id, body) {
      return apiFetch('/api/admin/outbound-orders/' + id + '/complete', { method: 'PUT', body: body });
    },
    fetchOutboundDetail: fetchOutboundDetail,
    fifoLinesToSuborders: fifoLinesToSuborders,
    inboundSummaryAlerts: function (query) {
      const q = query || {};
      const params = new URLSearchParams();
      if (q.basis) params.set('basis', q.basis);
      if (q.thresholdTon != null) params.set('thresholdTon', String(q.thresholdTon));
      if (q.onlyReminder) params.set('onlyThirtyTonReminder', '1');
      const s = params.toString();
      return apiFetch('/api/admin/inbound-summary-alerts' + (s ? '?' + s : ''));
    },
    warehouseStockReport: function (query) {
      const params = new URLSearchParams();
      if (query.page != null && query.page !== '') params.set('page', String(query.page));
      if (query.pageSize != null && query.pageSize !== '')
        params.set('pageSize', String(query.pageSize));
      if (query.warehouseId != null && query.warehouseId !== '' && !Number.isNaN(Number(query.warehouseId)))
        params.set('warehouseId', String(query.warehouseId));
      if (query.materialId != null && query.materialId !== '' && !Number.isNaN(Number(query.materialId)))
        params.set('materialId', String(query.materialId));
      if (query.inventoryStatus) params.set('inventoryStatus', query.inventoryStatus);
      const s = params.toString();
      return apiFetch('/api/admin/inventory/warehouse-stock-report' + (s ? '?' + s : ''));
    },
    latestPurchaseByMaterial: function (materialId) {
      return apiFetch('/api/admin/purchase-prices/latest-by-material/' + materialId);
    },
    /** POST /api/admin/weighbridge-slip/parse（仅 warehouse），需 ocrText + imageUrl/weighbridgePhoto */
    parseWeighbridgeSlip: function (body) {
      return apiFetch('/api/admin/weighbridge-slip/parse', {
        method: 'POST',
        body: body || {},
      });
    },
    /** GET /api/health，无需登录 */
    fetchHealth: function () {
      return apiFetch('/api/health');
    },
    /** GET /api/admin/users（仅 statistics） */
    listUsers: function () {
      return apiFetch('/api/admin/users');
    },
    createUser: function (body) {
      return apiFetch('/api/admin/users', { method: 'POST', body: body || {} });
    },
    updateUser: function (id, body) {
      return apiFetch('/api/admin/users/' + id, { method: 'PUT', body: body || {} });
    },
    deleteUser: function (id) {
      return apiFetch('/api/admin/users/' + id, { method: 'DELETE' });
    },
  };
})();

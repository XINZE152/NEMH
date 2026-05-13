# 在 redspiderbc.cn 上配置 project3（HTTPS，对齐 multi-https-nginx-guide）

本文与仓库内 **`multi-https-nginx-guide.md`** 同一套路：在 **`pd.conf` 的 443 server** 里增加路径 **`/project3/`**，证书仍用主域名已有 Let’s Encrypt / 腾讯云证书，**不单独为 project3 申请证书**。

---

## 1. 架构说明

| 入口 | 作用 |
|------|------|
| `https://redspiderbc.cn/project3/` | 进销存前端静态页（Vite build） |
| `https://redspiderbc.cn/project3/api/...` | 反代到 **`127.0.0.1:8003`**（NEMH `nemh-api`） |

**为何不用主站已有 `/api/`？**  
指南里 **`/api/`** 已指向 **`127.0.0.1:8001`**。NEMH 在 **8003**，必须用 **`/project3/api/`** 前缀区分，避免和 8001 冲突。

---

## 2. 前置条件

1. 域名 **`redspiderbc.cn`** 已解析到本机，**443** 上已有 SSL（与指南一致）。  
2. **`nemh-api`** 已运行：`curl -sS http://127.0.0.1:8003/api/health` 返回 `{"ok":true}`。  
3. 本机可 **`sudo`** 编辑 **`/etc/nginx/sites-available/pd.conf`**。

---

## 3. 构建前端（在仓库根目录）

```bash
cd /home/ubuntu/var/www/nemh-app/NEMH
git pull
npm install
INVENTORY_BASE=/project3/ npm --prefix inventory-web run build
```

说明：环境变量 **`INVENTORY_BASE=/project3/`** 会设置 Vite `base`，并在构建时把 **`window.__API_BASE__`** 写成 **`'/project3'`**，请求会走 **`/project3/api/...`**，与下节 Nginx 一致。

---

## 4. 部署静态文件目录

约定静态根（与 `nginx-project3-redspiderbc.snippet.conf` 一致）：

```bash
sudo mkdir -p /var/www/redspider-sites/project3
sudo rsync -a --delete /home/ubuntu/var/www/nemh-app/NEMH/inventory-web/dist/ /var/www/redspider-sites/project3/
sudo chown -R www-data:www-data /var/www/redspider-sites/project3
```

以后只更新前端时，重复 **`rsync`** 即可。

---

## 5. 合并 Nginx 配置

1. 打开本仓库 **`deploy/nginx-project3-redspiderbc.snippet.conf`**，将其中 **`location`** 块复制到 **`/etc/nginx/sites-available/pd.conf`** 的 **`server { ... listen 443 ssl ... }`** 内（与 **`/project1/`、`/project2/`** 同级）。  
2. 若你静态目录不是 **`/var/www/redspider-sites`**，请同时修改 snippet 里 **`root`** 与上节 **`rsync`** 目标路径，保持一致。  
3. 权限：普通用户无法直接保存 **`pd.conf`**，可用：

```bash
sudo nano /etc/nginx/sites-available/pd.conf
# 或 sudoedit /etc/nginx/sites-available/pd.conf
```

---

## 6. 校验并重载 Nginx（与指南第 6 节一致）

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 7. 验证命令

```bash
curl -skI --max-time 10 https://redspiderbc.cn/project3/
curl -skI --max-time 10 https://redspiderbc.cn/project3/api/health
```

期望：前者 **`200`**（或 **`304`**）；后者 **`200`** 且 body 用 **`curl -sk`** 可见 **`"ok":true`**。

浏览器访问：**`https://redspiderbc.cn/project3/`**。

### 7.1 若出现 Nginx 自带「404 Not Found」页

说明请求**未命中**你写的 **`location`**，或旧版 **`root` + `try_files`** 与当前 Nginx 对 **`/project3/`** 的处理不一致。

**1）确认配置是否已加载：**

```bash
sudo nginx -T 2>/dev/null | grep -n 'project3'
```

若**没有任何输出**，说明 **`pd.conf` 里 443 的 `server` 中还没有** `project3` 的 **`location`**，请把 **`deploy/nginx-project3-redspiderbc.snippet.conf`** 中内容合并进去后，再执行 **`sudo nginx -t && sudo systemctl reload nginx`**。

**2）若已有 `project3` 仍 404**：请用仓库**最新** snippet：静态段为 **`alias /var/www/redspider-sites/project3/`**（不要用易出问题的 **`try_files ... /project3/index.html`** 与 **`root`** 组合）。

**3）确认文件权限：**

```bash
sudo -u www-data test -r /var/www/redspider-sites/project3/index.html && echo OK
```

---

## 8. 可选：Swagger 单独 HTTPS 端口（对齐指南 8443/8444）

FastAPI **`/docs`** 依赖根路径 **`/openapi.json`**，不宜塞进 **`/project3/docs`**。若需在 HTTPS 下看 NEMH 的 Swagger，可另开端口，例如 **8445** 整站反代到 8003（**`server` 块需单独 `listen 8445 ssl`**，证书路径与 443 相同即可）：

```nginx
server {
    listen 8445 ssl http2;
    server_name redspiderbc.cn;

    ssl_certificate     /etc/letsencrypt/live/redspiderbc.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/redspiderbc.cn/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8003;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

同时在腾讯云安全组放行 **TCP 8445**。访问：**`https://redspiderbc.cn:8445/docs`**。

---

## 9. 排错要点（与指南 7、9 节一致）

- **`nginx -t` 失败**：多半是 **`location`** 大括号或 **`proxy_pass`** 末尾 **`/`** 与 **`location`** 前缀不配对。  
- **页面白屏、控制台 404 静态资源**：检查是否用了 **`INVENTORY_BASE=/project3/`** 重新 build 并 **`rsync`**。  
- **接口 404**：检查 **`__API_BASE__`** 是否为 **`/project3`**，以及 Nginx 是否已有 **`location ^~ /project3/api/`**。  
- **`403 Forbidden`**：检查 **`/var/www/redspider-sites/project3`** 权限与 **`www-data`** 可读。

---

## 10. 操作顺序速查（复用指南第 10 节）

1. `ss` / `curl` 确认 **8003** 正常。  
2. **`INVENTORY_BASE=/project3/`** 构建并 **`rsync`**。  
3. 合并 snippet → **`nginx -t`** → **`reload`**。  
4. **`curl -skI`** 与浏览器验证 **`/project3/`**。

# 部署指南 (Screen + 双环境)

本文档介绍如何在服务器上配置**正式服 (Production)** 和 **测试服 (Staging)** 双环境并行运行的方案。

## 架构概览

我们通过创建两个独立的文件夹来隔离环境，利用不同端口和域名进行访问。

| 环境 | 目录 (建议) | 端口 | 访问地址 | Screen 会话名 |
| :--- | :--- | :--- | :--- | :--- |
| **正式服** | `~/wqt-auth-backend` | `8080` | `https://www.ai5000days.com` | `wqt-prod` |
| **测试服** | `~/wqt-auth-backend-test` | `3001` (内部) / `8081` (Nginx) | `https://www.ai5000days.com/staging/` | `wqt-test` |

---

## 🚀 首次初始化 (仅需做一次)

### 1. 准备正式服
假设您已经拉取了代码在 `~/wqt-auth-backend`。
确保 `.env` 配置正确 (PORT=8080)。

启动正式服：
```bash
screen -S wqt-prod
cd ~/wqt-auth-backend
npm run dev
# 按 Ctrl+A, D 挂起
```

### 2. 准备测试服
复制一份代码作为测试环境（或者重新 git clone）：

```bash
cd ~
cp -r wqt-auth-backend wqt-auth-backend-test
# 或者: git clone <repo_url> wqt-auth-backend-test
```

**关键配置**:
修改测试目录下的 `.env` 文件，将端口改为 **8081**，并建议使用独立的测试数据库：

```bash
nano ~/wqt-auth-backend-test/.env
```
修改内容：
```properties
PORT=8081
DB_PATH=./data/wqt_test.db
```

启动测试服：
```bash
screen -S wqt-test
cd ~/wqt-auth-backend-test
npm run dev
# 按 Ctrl+A, D 挂起
```

---

## 🔄 日常更新流程

### 更新测试服 (开发自测)
1. 进入测试目录：`cd ~/wqt-auth-backend-test`
2. 运行更新脚本：
   ```bash
   sh scripts/update.sh
   ```
3. 进入 Screen 重启服务：
   ```bash
   screen -r wqt-test
   # 按 Ctrl+C 停止当前进程
   npm run dev
   # 按 Ctrl+A, D 再次挂起
   ```

### 更新正式服 (发布上线)
确认测试服没问题后，再更新正式服。
1. 进入正式目录：`cd ~/wqt-auth-backend`
2. 运行更新脚本：
   ```bash
   sh scripts/update.sh
   ```
3. 进入 Screen 重启服务：
   ```bash
   screen -r wqt-prod
   # 按 Ctrl+C 停止当前进程
   npm run dev
   # 按 Ctrl+A, D 再次挂起
   ```

---

## 🌐 Nginx 配置参考 (域名绑定)

如果您使用 Nginx，可以添加两个 `server` 块分别反向代理到 8080 和 8081。

### 正式服配置 (www.ai5000days.com)
正式服已由现有的 HTTPS server 块提供，代理到 `127.0.0.1:8080`。

### 测试服配置 (路径前缀方式)
在 `www.ai5000days.com` 的 **HTTPS server 块** (443 端口) 中添加：
```nginx
# 测试服 - 通过路径前缀代理
location /staging/ {
    proxy_pass http://127.0.0.1:3001/;  # 末尾斜杠去掉 /staging/ 前缀
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 测试服直连 (可选, 保留 HTTP 8081)
参考 `scripts/nginx_staging.conf` 中的 server 块。

访问地址:
- HTTPS: `https://www.ai5000days.com/staging/`
- HTTP: `http://8.210.121.92:8081`

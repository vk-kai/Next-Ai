# Next-AI 部署文档

## 一、环境要求

| 组件 | 要求 | 检查命令 |
|---|---|---|
| Python | 3.10+（推荐 3.12） | `python3.12 --version` |
| Node.js | 18+（推荐 20） | `node -v` |
| 磁盘 | ≥ 5G（含向量模型 1.2G） | `df -h /home` |
| 内存 | ≥ 4G 空闲 | `free -g` |

> 注意：CentOS 7 等老系统默认 `python3` 是 3.6，必须使用 `python3.12`（或对应高版本二进制）。

## 二、部署向量模型（Embedding，本地免费方案）

知识库的语义检索依赖 Embedding 模型。推荐用 Ollama 本地部署 `bge-m3`（免费、数据不出内网）：

```bash
# 1. 安装 Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 2. 拉取向量模型（约 1.2G，中英双语）
ollama pull bge-m3

# 3. 验证服务已启动（Ollama 安装后默认自启，监听 11434）
curl http://localhost:11434/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model": "bge-m3", "input": "测试"}'
```

返回 JSON 中的 `data[0].embedding` 有向量值即部署成功。

设置页 Embedding 卡片填写：

```text
服务地址: http://localhost:11434/v1
API Key:  ollama       （不校验，随便填）
模型名:   bge-m3
```

> 云端替代方案：硅基流动（siliconflow.cn，bge-m3 免费）或智谱 embedding-3（按量付费，极便宜）。

## 三、后端部署

```bash
cd backend

# 1. 创建虚拟环境并安装依赖
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. 准备配置（首次部署）
cp .env.example .env
# .env 可全部留空，后续在网页"设置"页配置模型服务

# 3. 启动（默认端口 8001，8000 常被占用）
nohup .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8001 > /tmp/nextai_uvicorn.log 2>&1 &

# 4. 验证
curl http://localhost:8001/api/health
```

启动后自动完成：建表、创建 default 知识库、注册数据源的定时同步任务。

**约束**：必须单进程运行（不要加 `--workers N`），SQLite 与内置定时调度器不支持多进程共享。

## 四、前端部署

### 方式 A：开发/内网直接使用

```bash
cd frontend
npm install
npm run dev        # 默认 http://localhost:5173
```

### 方式 B：生产构建（配合 Nginx）

```bash
cd frontend
npm install
npm run build      # 产物在 dist/
```

Nginx 参考配置：

```nginx
server {
    listen 80;
    location / {
        root /path/to/Next-AI/frontend/dist;
        try_files $uri $uri/ /index.html;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_buffering off;              # 对话流式输出必须关闭缓冲
        proxy_read_timeout 300s;
    }
}
```

> 若前端与后端不同源部署，需在 `backend/.env` 中设置 `CORS_ORIGINS=https://你的前端域名`。

## 五、系统初始化（首次部署必做）

1. 浏览器打开前端地址，页面会提示**初始化管理员账号**（仅第一个用户可注册，之后只能登录）
2. 进入 **设置** 页：
   - 模型服务 → LLM：填聊天模型的服务地址 / API Key / 模型名
   - 模型服务 → Embedding：填第二步的 Ollama 配置
   - 点 **测试连接**，两项都通过即可使用
   - （可选）智能体 → 填名称和人设，如"回答要简洁，不超过三句话"
3. 进入 **知识库** 页：上传文件或添加数据源（REST 接口 / 数据库），开始学习

## 六、日常运维

```bash
# 重启后端
kill $(ss -tlnp | grep :8001 | grep -oP 'pid=\K[0-9]+')
cd backend && nohup .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8001 > /tmp/nextai_uvicorn.log 2>&1 &

# 数据备份（数据库 + 上传的原始文件 + JWT 密钥，整目录打包即可）
tar czf nextai_backup_$(date +%F).tar.gz backend/data/
```

| 路径 | 内容 |
|---|---|
| `backend/data/nextai.db` | 全部业务数据（用户、知识库、同步记录） |
| `backend/data/files/` | 上传的原始文件 |
| `backend/data/secret.key` | JWT 签名密钥（丢失则所有登录态失效） |

## 七、常见问题

| 现象 | 原因与处理 |
|---|---|
| 后端起不来：`address already in use` | 8001 被占用，换端口或 `kill` 占用进程 |
| 对话报"LLM 服务未配置" | 设置页 LLM 未填或填错，点"测试连接"看具体报错 |
| 学习报"Embedding 服务未配置/调用失败" | 检查 Ollama 是否存活：`curl http://localhost:11434/api/tags` |
| 报"向量维度与库中不一致" | 中途换过 Embedding 模型，需重建知识库（删除旧文档后重新上传/重新同步） |
| 机器配置了 `socks://` 代理导致 httpx 报错 | 后端所有出站请求已设 `trust_env=False` 不走系统代理；若服务需经代理出网，需改代码层代理配置 |
| 前端 401 弹回登录页 | token 7 天过期，正常现象；`backend/data/secret.key` 变更也会导致全部下线 |

# Next-AI

可挂载到任意项目的 AI 智能体：**对话问答 + 文件学习 + 项目数据源自动学习**。通过 RAG 检索增强，让 AI 用你项目的知识回答问题。

## 核心功能

- **智能对话**：流式输出，回答自动附带知识来源标注，支持按知识库（collection）隔离
- **文件学习**：上传 pdf / docx / xlsx / csv / html / json / md / txt，自动解析、分块、向量化入库，内容哈希去重
- **数据源自动学习**：声明式接入项目的 REST 接口或数据库，增量同步（id + 内容哈希），LLM 自动蒸馏生成知识摘要
- **定时同步**：内置 APScheduler cron 调度，同步结果生成学习报告（SyncReport）
- **模型可插拔**：LLM / Embedding 均走 OpenAI 兼容接口，网页端可配置、一键测试连接
- **账号体系**：JWT 认证，首个用户注册即管理员，API Key 永不明文回传

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | FastAPI + SQLAlchemy + SQLite |
| 前端 | Vite + React 18（无 UI 库，手写 CSS） |
| 向量检索 | SQLite + numpy 余弦相似度（自研，可换 pgvector/Qdrant） |
| 调度 | APScheduler（cron 定时同步） |
| 模型 | 任意 OpenAI 兼容服务（如 Ollama 本地 bge-m3） |

## 快速开始

> 完整部署（含 Ollama 向量模型）见 [DEPLOY.md](DEPLOY.md)。

```bash
# 1. 后端（端口 8001）
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
.venv/bin/uvicorn app.main:app --port 8001

# 2. 前端（端口 5173）
cd frontend
npm install
npm run dev
```

初始化流程：打开前端 → 注册管理员账号 → 设置页配置 LLM / Embedding 并测试连接 → 知识库页上传文件或添加数据源。

## 项目结构

```
backend/
  app/
    api/          # 路由：auth / chat / files / kb / sources / settings
    core/         # LLM、Embedding、分块器、安全（JWT/scrypt）、应用设置
    learning/     # 知识引擎：parser 解析、ingest 入库、sync 同步、scheduler 调度
      connectors/ # 采集器：rest_api / database（注册式基类，可扩展）
    main.py       # FastAPI 入口
  tests/          # pytest 测试
frontend/
  src/
    pages/        # 登录 / 对话 / 知识库 / 设置
    components/   # FileUpload 等
```

## API 概览

除认证接口外均需 `Authorization: Bearer <token>`。

| 模块 | 端点 | 说明 |
|---|---|---|
| 认证 | `POST /api/auth/register` `POST /api/auth/login` | 注册（仅首个用户）/ 登录 |
| 对话 | `POST /api/chat` | 流式问答，基于知识库检索 |
| 文件 | `POST /api/files/upload` | 上传文件并学习入库 |
| 知识库 | `GET /api/kb/collections` `GET /api/kb/documents` | 知识库与文档管理 |
| 数据源 | `POST /api/sources` `POST /api/sources/{id}/sync` | 配置数据源 / 手动同步 |
| 设置 | `GET/PUT /api/settings` `POST /api/settings/test` | 模型配置与连接测试 |

## 环境变量（backend/.env）

所有模型配置可留空，启动后在网页「设置」页填写（DB 配置优先于 .env）：

```ini
LLM_BASE_URL=          # OpenAI 兼容地址，如 https://api.openai.com/v1
LLM_API_KEY=
LLM_MODEL=
EMBEDDING_BASE_URL=    # 如 Ollama: http://localhost:11434/v1
EMBEDDING_API_KEY=
EMBEDDING_MODEL=       # 如 bge-m3
DATA_DIR=./data
CORS_ORIGINS=*
```

## 测试

```bash
cd backend
.venv/bin/python -m pytest tests/ -q
```

## 注意事项

- 后端必须**单进程**运行（不要加 `--workers`），SQLite 与内置调度器不支持多进程共享
- 数据都在 `backend/data/`（SQLite、上传文件、JWT 密钥），备份打包该目录即可

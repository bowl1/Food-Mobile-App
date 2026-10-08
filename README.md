# FridgeChef — AI Recipe Agent v1

Expo + TypeScript 移动应用，识别食材后由用户确认入库，通过 FastAPI → LangGraph → MCP → Supabase 生成受约束的菜谱。仓库仅保留 FridgeChef 第一版；旧 Firebase / Express 搜索应用、收藏与分享功能及旧演示素材已移除。

## 已实现

- Supabase 邮箱注册、登录、会话刷新；原生使用 SecureStore 保存会话，Web 仅内存保存。
- 拍照 / 选图 → 多模态 structured output → 人工编辑和确认 → 入库。识别接口本身不写库存。
- 食材添加、编辑、删除、标记已用完；六类饮食偏好与最长烹饪时间。
- LangGraph：通过 MCP 加载真实库存与偏好 → 最多五个候选 → 硬规则校验 → 独立模型评分 → 不足三份时最多再生成两次 → 排序并保存最多三份。
- 校验名称、单位、累计用量、默认调料白名单、饮食限制与烹饪时间。受限制饮食的未知食材保守拒绝；无需限制的未知食材仍可生成。
- MCP 工具 `get_inventory`、`update_inventory`、`get_user_preferences`、`save_recipe`、`get_recipe_history`。Agent 不调用库存修改工具。
- Supabase 五张表、按用户 RLS、菜谱会话归属的复合外键。后端使用用户 JWT，不使用 service-role key。
- 推荐详情、最近 100 条历史、空结果与错误状态、超时、有限重试、请求/运行/模型/tool/评分日志。
- Docker、离线评估数据集、自动化后端测试。

不包含 freshness / expiry、共享家庭、RBAC、购物、营养 API 或食品安全判断。

## 快速体验（不需要服务密钥）

需要 Python 3.10+、Node 22 LTS、npm。仓库根目录运行：

```bash
./start.sh --demo
```

通过 Expo Go 扫码，或在 Expo 中选择 iOS / Android。演示模式使用本地 SQLite，只有一个演示用户，不代表真实用户隔离。扫描返回固定 egg / spinach / mushroom，菜谱和评分是固定规则演示，界面持续显示 DEMO。默认演示库存为空，先扫码确认或手动添加食材。

手机访问开发机时，在真实模式的 `frontend/.env` 设置 `EXPO_PUBLIC_API_BASE_URL=http://你的电脑局域网IP:8000`，演示模式使用 `EXPO_PUBLIC_API_BASE_URL=http://你的电脑局域网IP:8000 ./start.sh --demo`。手机和开发机须在同一网络。iOS 模拟器默认 localhost；Android 模拟器默认 10.0.2.2。Web 预览依赖已包含，可在 Expo 中按 w，或在 frontend 中运行 `npm run web`。

## 真实模式

1. 创建 Supabase 项目，在 SQL Editor 执行 [001_fridgechef.sql](supabase/migrations/001_fridgechef.sql)，启用 Email Auth。生产环境保持邮箱确认开启。
2. 编辑 `backend/.env`（不存在时新建），填写 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`OPENAI_API_KEY`。默认使用 `gpt-6-luna`，统一用于食材识别、菜谱生成和独立评分；可通过 `OPENAI_MODEL` 覆盖。`DEMO_MODE=false`。
3. 编辑 `frontend/.env`（不存在时新建），填写 `EXPO_PUBLIC_SUPABASE_URL`、`EXPO_PUBLIC_SUPABASE_ANON_KEY` 和 `EXPO_PUBLIC_API_BASE_URL`。`EXPO_PUBLIC_DEMO_MODE=0`。
4. 运行 `./start.sh`。注册后若开启邮件验证，先点击验证邮件，再登录。在 You 页面保存偏好，然后添加食材、生成菜谱。

`EXPO_PUBLIC_*` 会进入客户端包，只允许放 public key；OpenAI key 只放后端。真实模式服务未配置时明确报错，不会回退到样例库存。

## 独立启动与检查

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
# 另一个终端
cd frontend
npm install
npm start
```

API 文档：`http://localhost:8000/docs`；健康检查 `/health` 返回当前模式。

```bash
.venv/bin/python -m pytest backend/tests -q
cd frontend && npm run typecheck
# 仓库根目录：离线数据集，无需 Supabase，但真实模式需要模型 key
DEMO_MODE=true .venv/bin/python -m evals.run_evals
DEMO_MODE=false .venv/bin/python -m evals.run_evals
```

评估输出注明 demo-fixtures 或 live-model，报告 case success、dietary compliance、inventory constraint、hallucinated ingredient、平均评分与 regeneration rate。仅统计最终返回的结构化结果；不把演示通过率视为模型效果，也不声称记录了 schema 失败率。当前测试集规模小，真实模型评估需自行配置 key 后执行。

## 结构

```
frontend/src/fridgechef/  新版移动 UI、会话与 API
backend/app/             FastAPI、认证、数据库、LangGraph、guardrails、模型调用
mcp-server/server.py     Python MCP stdio server
supabase/migrations/     Schema + RLS
backend/tests/           约束、身份保护、API → MCP → SQLite 集成测试
evals/                   固定案例和评估 runner
```

## API

除 `/health` 外，所有接口需要 `Authorization: Bearer <Supabase access token>`。demo token 仅在后端显式开启 DEMO_MODE 时接受。

| 接口 | 用途 |
| --- | --- |
| POST /vision/recognize | base64 JPEG/PNG/WebP，最多 10 MB；不自动入库 |
| GET /inventory | 未 consumed 的库存 |
| POST /inventory | 新增已确认食材 |
| PATCH /inventory/{uuid} | 编辑或 consumed=true |
| DELETE /inventory/{uuid} | 删除库存 |
| GET /preferences | 当前偏好，未设置时返回默认值 |
| PUT /preferences | 保存偏好 |
| POST /recipes/generate | 生成、校验、评分、排序、保存 |
| GET /recipes/history | 最近 100 条已保存推荐 |

MCP 每请求独立子进程，FastAPI 验证 JWT 后通过进程环境传入可信 token；MCP 再次校验。工具 schema 不接收 user_id；PostgREST 同时用用户 JWT 和用户过滤条件，数据库 RLS 最终强制隔离。stdio server 应仅由可信 API 进程启动，不直接暴露公网。MCP 失败时请求失败，不编造库存。

## Docker

完成 `backend/.env` 后运行 `docker compose up --build`。生产使用 HTTPS API 地址并设置明确的 CORS_ORIGINS；移动端需重新设置 API URL。这里提供容器配置，未创建云资源或部署。

## Render 云端部署

部署文件已提供：[render.yaml](render.yaml)。完整流程见 [Render + Supabase 部署说明](docs/DEPLOY_RENDER.md)。生产关闭演示模式，用户数据保存到 Supabase，密钥通过 Render 环境变量注入。

## 当前边界

- 单位必须与库存一致，v1 不猜测 bag → g 等单位换算。食材名称目前以简单英文为准。
- 饮食规则使用保守词典与独立 LLM 评估，不提供过敏医疗保证或精确营养数据；high-protein 是质量偏好，无营养 API 测量。
- 菜谱生成不会扣减库存；用户需手动标记 consumed。历史反映生成时库存。
- 扫描确认逐条保存；部分失败时保留未保存项，避免再次提交已保存项。菜谱历史逐条写入，数据库中途故障时可能保留部分已成功记录。
- Supabase 线上 RLS、多账号真机和真实模型验收需要你的项目配置；本地测试验证查询身份传播和演示集成，不能代替线上验证。
- 生产公开上线前需按流量加入用户配额 / 限流，并扩充真实食材、饮食分类与模型评估案例。

实现接口参考：[LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)、[官方 MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)。

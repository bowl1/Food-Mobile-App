# FridgeOut: Recipe Wizard

*Cook with what you have*

Expo SDK 57 + TypeScript 移动应用，识别食材后由用户确认入库，通过 FastAPI → LangGraph → MCP → Supabase 生成受约束的菜谱。仓库仅保留 FridgeOut 第一版；旧 Firebase / Express 搜索应用、收藏与分享功能及旧演示素材已移除。

## 已实现

- Supabase 邮箱注册、登录、会话刷新；原生使用 SecureStore 保存会话，Web 仅内存保存。
- 拍照 / 选图 → 多模态 structured output → 人工编辑和确认 → 入库。识别接口本身不写库存。
- 食材添加、编辑、删除、标记已用完；六类饮食偏好与最长烹饪时间。
- LangGraph：通过 MCP 加载真实库存与偏好 → 最多五个候选 → 硬规则校验 → 一次批量独立评分 → 不足五份时最多再生成两次 → 排序返回最多五份。
- 校验名称、单位、累计用量、默认调料白名单、饮食限制与烹饪时间。受限制饮食的未知食材保守拒绝；无需限制的未知食材仍可生成。
- MCP 工具 `get_inventory`、`update_inventory`、`get_user_preferences`、`save_recipe`、`get_favorite_recipes`。Agent 不调用库存修改工具。
- Supabase 按用户 RLS、菜谱会话归属的复合外键。库存、菜谱和图片读取使用用户 JWT；费用账本、图片上传和后台清理使用仅后端的 service-role key。
- 菜谱卡片和详情按菜名、食材与步骤生成 AI 图片，图片保存到 Supabase 私有 Storage；生成与 Favorite 保存分开，已保存图片复用，失败可手动重试。
- 首页生成结果点击 Save 才进入 Favorite，成功后立即更新该账号的收藏缓存并后台校验。收藏不限数量，用户主动删除才移除；Favorite API 用用户 JWT 读取，不启动 MCP。
- 推荐详情、主动保存的收藏、空结果与错误状态、超时、有限重试、请求/运行/模型/tool/评分日志。
- Docker、离线评估数据集、自动化后端测试。

不包含 freshness / expiry、共享家庭、RBAC、购物、营养 API 或食品安全判断。

## 快速体验（不需要服务密钥）

需要 Python 3.10+、Node 22.13+（建议 Node 22 LTS）、npm。仓库根目录运行：

```bash
./start.sh --demo
```

使用支持 SDK 57 的 Expo Go 扫码，或在 Expo 中选择 iOS / Android。演示模式使用本地 SQLite，只有一个演示用户，不代表真实用户隔离。扫描返回固定 egg / spinach / mushroom，菜谱和评分是固定规则演示，界面持续显示 DEMO。默认演示库存为空，先扫码确认或手动添加食材。

手机访问开发机时，在真实模式的 `frontend/.env` 设置 `EXPO_PUBLIC_API_BASE_URL=http://你的电脑局域网IP:8000`，演示模式使用 `EXPO_PUBLIC_API_BASE_URL=http://你的电脑局域网IP:8000 ./start.sh --demo`。手机和开发机须在同一网络。iOS 模拟器默认 localhost；Android 模拟器默认 10.0.2.2。Web 预览依赖已包含，可在 Expo 中按 w，或在 frontend 中运行 `npm run web`。

## 真实模式

1. 创建 Supabase 项目，按编号执行 `supabase/migrations/001` 到 `006` 的迁移；已有项目只执行尚未应用的迁移。推荐使用已有 GitHub Actions 自动迁移流程。启用 Email Auth，生产环境保持邮箱确认开启。
2. 编辑 `backend/.env`（不存在时新建），填写 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`OPENAI_API_KEY`。默认使用 `gpt-6-luna`，统一用于食材识别、菜谱生成和独立评分；可通过 `OPENAI_MODEL` 覆盖。菜谱配图默认 `OPENAI_IMAGE_MODEL=gpt-image-2.5-flare`，复用后端 OpenAI key，使用 1024×1024、low quality JPEG，产生额外图片 API token 费用（不再使用旧 mini 的每张价格估算）。`DEMO_MODE=false`。
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
frontend/src/fridgechef/  移动 UI、会话与 API
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
| POST /recipes/generate | 生成、校验、评分、排序，返回最多 5 个临时结果 |
| POST /recipes/{id}/image | 生成或读取已保存图片的 1 小时签名链接；`?retry=true` 手动重试失败任务 |
| POST /recipes/{id}/favorite | 主动 Save，加入收藏；重复调用不重复保存 |
| DELETE /recipes/favorites/{id} | 永久删除本人收藏，清理对应图片 |
| GET /recipes/favorites | 本人的全部收藏，不限制数量 |

MCP 每请求独立子进程，FastAPI 验证 JWT 后通过进程环境传入可信 token；MCP 再次校验。工具 schema 不接收 user_id；PostgREST 同时用用户 JWT 和用户过滤条件，数据库 RLS 最终强制隔离。stdio server 应仅由可信 API 进程启动，不直接暴露公网。MCP 失败时请求失败，不编造库存。

## Docker

完成 `backend/.env` 后运行 `docker compose up --build`。生产使用 HTTPS API 地址并设置明确的 CORS_ORIGINS；移动端需重新设置 API URL。这里提供容器配置，未创建云资源或部署。

## Render 云端部署

部署文件已提供：[render.yaml](render.yaml)。完整流程见 [Render + Supabase 部署说明](docs/DEPLOY_RENDER.md)。生产关闭演示模式，用户数据保存到 Supabase，密钥通过 Render 环境变量注入。

## 当前边界

- 单位必须与库存一致，v1 不猜测 bag → g 等单位换算。食材名称目前以简单英文为准。
- 饮食规则使用保守词典与独立 LLM 评估，不提供过敏医疗保证或精确营养数据；high-protein 是质量偏好，无营养 API 测量。
- 菜谱生成不会扣减库存；用户需手动标记 consumed。收藏反映生成时库存。
- 扫描确认逐条保存；部分失败时保留未保存项，避免再次提交已保存项。当前一批生成草稿逐条写入，数据库中途故障时可能保留部分已成功记录。
- Supabase 线上 RLS、多账号真机和真实模型验收需要你的项目配置；本地测试验证查询身份传播和演示集成，不能代替线上验证。
- 已有服务端成本额度、限流和持久请求去重；尚未接入付费订阅和会员权益。批量评估保留硬规则检查，真实模型质量仍需要线上验收。

实现接口参考：[LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)、[官方 MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)。

## 菜谱 AI 图片

新菜谱保存时标记 pending。App 展示卡片后单独请求图片，首页、Recipes、Favorite 和详情通过菜谱 ID 共用查询缓存。旧菜谱默认 none，点击 Generate image 才生成；demo 不调用图片 API。请求中断或服务重启后，generating 租约超过四分钟可重新领取。每个实例最多同时生成两张，失败不自动付费重试。图片任务由 App 的独立请求驱动，不是离线后台队列；未展示的卡片会在下次展示时补图。

新图片文件存储在私有 `recipe-images` bucket 的 `user_id/recipe_id/image.jpg`，缩略图追加 `.thumb.jpg`；旧图片路径仍可读取。重试保持原路径，数据库以独立 lease ID 防止重复任务。读取和签名使用用户 JWT 和 RLS；上传及后台清理使用仅后端的 service-role key，上传前验证用户归属和路径，客户端不能直接写入 bucket。签名 URL 一小时失效，App 缓存五十分钟后可重新获取。模型返回图片前不会阻塞菜谱保存；AI 图仅作成品示意，实际效果可能不同。

接口参考：[OpenAI Images API](https://developers.openai.com/api/reference/resources/images/methods/generate)、[Supabase Storage RLS](https://supabase.com/docs/guides/storage/security/access-control)。部署顺序：先在 Render 填写 `SUPABASE_SERVICE_ROLE_KEY`，应用 003–010 迁移，部署后端，最后更新前端；前端生成/识别接口现在需要 `Idempotency-Key` UUID。详见 [成本控制与配置](docs/COST_CONTROLS.md)。

本地 SQL 验证：使用 `psql -v ON_ERROR_STOP=1 -d <disposable_database> -f <test_file>`，每个测试文件使用独立的空临时 PostgreSQL 数据库。

- `backend/tests/test_migrations.sql`：首次与重复迁移、清除旧 History 并建立 Favorite。
- `backend/tests/test_rls.sql`：跨用户菜谱、会话、图片任务与 Storage 权限隔离。
- `backend/tests/test_recipe_image_leases.sql`：图片任务重复领取、失败重试、过期恢复。

- `backend/tests/test_cost_controls.sql`：费用额度、预算预留、请求去重和账本权限。
- `backend/tests/test_cleanup.sql`：主动收藏、不限制数量、临时草稿清理、删除缓存副本、孤立图片队列和清理权限。
- `backend/tests/test_cost_concurrency.py`：真实并发事务的用户额度和全站预算验收。

五个 SQL 测试共用 `backend/tests/sql/setup.sql` 初始化模拟 Supabase 环境与测试数据，CI 使用独立数据库运行，再验证真实并发预算事务。

## 模型与存储成本控制

免费用户下载后注册登录，每账号总共 3 次免费识别或手动生成，菜谱及 AI 图片包含在该次额度里，无到期时间、不按天或按月恢复，重装 App 不重置；全站每天最多预留 $10，失败保留内部成本计数。每轮批量评估、输出 token 上限、有限瞬时错误重试、持久幂等请求、图片恢复和缩略图减少重复消费。`favorite_recipes` 只保存主动收藏的菜谱，不限制数量；`recipe_drafts` 仅保存当前一批临时生成结果，下一轮成功生成前清掉上一批，闲置超过 24 小时由后台清理。`recipes` 是供图片和额度逻辑使用的共享视图，不再是历史表。删除会清理缓存副本、空会话与云端图片。详细规则、估价局限及上线步骤见 [COST_CONTROLS.md](docs/COST_CONTROLS.md)。

### Langfuse 生成追踪

仅开发环境使用。到 Langfuse 创建项目，在项目 Settings → API Keys 创建密钥，在本地现有 `backend/.env` 或开发专用后端填写：

```dotenv
APP_ENVIRONMENT=development
LANGFUSE_ENABLED=true
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_ENVIRONMENT=development
```

Base URL 必须与项目所在区域一致（以上是 EU）；本地填写现有 `backend/.env`，不要放前端或提交密钥。部署并生成一次后，在 Langfuse Traces 找 `recipes.generate`，按 metadata 中的 `agent_run_id` 或 `request_id` 对照 Render 日志。记录每轮候选数、校验失败类别、评分、去重数、累计接受数、最终数量，以及 MCP、模型、保存和图片清理耗时。模型调用包含 Token 和按现有后端费率估算的 USD 成本（不是账单金额）。

不上传完整提示词、库存、饮食偏好、照片、JWT 或用户 ID；异常只记录类型。使用手工 SDK spans，因为当前直接通过 OpenAI SDK 调模型，仅加 LangGraph callback 无法覆盖全部步骤。后台批量导出，应用关闭时在线程中 flush/shutdown，不在每次生成末尾等待导出。这里只追踪实际执行的生成流程（幂等缓存命中不重新创建），以及文本模型调用；独立生图请求尚未纳入。追踪 SDK 的启动、更新、结束失败均不阻断业务。

SDK 接口参考：[Langfuse instrumentation](https://langfuse.com/docs/observability/sdk/instrumentation)。

### 轻量生产监控

生产 Render 设置 `APP_ENVIRONMENT=production`、`LANGFUSE_ENABLED=false`，不需要 Langfuse 密钥。即使误留密钥或 enabled=true，生产环境仍不会创建 Langfuse 客户端或导出追踪。

保留 Render request/error logs 和 `latency_ms`。`event=provider_call` 每次实际文本/生图模型调用记录 success/failure、操作、重试序号、错误类型和耗时；失败率为同一时间窗口 failure 数 / 总调用数（包括重试），HTTP API 失败率从请求日志的 5xx / 总请求数统计，可排除 `/health`。`event=guardrails` 记录 rejected_count（拒绝菜谱数）和 failure_count（失败规则数），`event=recipe_round` / `event=recipe_result` 记录每轮和最终数量。事件关联 request_id 和生成时的 agent_run_id；不增加外部监控网络请求或额外 LLM 调用。

Token 与估算成本继续写现有 Supabase `ai_usage`，可在 SQL Editor 执行 [production_metrics.sql](docs/production_metrics.sql)，按 UTC 日、模型和模态聚合。日志同时记录 `event=model_usage`，缺失 usage 或持久化失败单独记录。已有清理策略保留 usage 90 天；无法拿到 usage 的失败调用可能仍收费，估算不能替代供应商账单。这里提供日志和 SQL 汇总，不自动配置告警或独立监控仪表盘。

# FridgeChef 云端部署：Render + Supabase

手机 App 连接 Render 的 HTTPS API；FastAPI 和 MCP 同一个容器运行，用户数据存入 Supabase。生产不使用本地 SQLite，不需要设置 DEMO_DB_PATH。

当前已部署实例：`https://fridgechef-api-0lcg.onrender.com`，部署分支 `deploy/fridgechef-render`。

## 1. Supabase

在你的 Supabase 项目 SQL Editor 执行 `supabase/migrations/001_fridgechef.sql` 一次。确认五张表存在、RLS 已启用，并开启 Email Auth。前后端使用同一个项目 URL 和 anon/publishable key；不要使用 service-role key。

## 2. 发布后端源码

将当前版本提交并推送到 GitHub 的部署分支。`.env` 不提交；`.dockerignore` 排除本地密钥、依赖和数据库文件。

## 3. Render

在 Render 创建 Blueprint，选择 GitHub 仓库与部署分支，加载根目录 `render.yaml`。配置已指定 Docker、Frankfurt、`/health` 检查和免费实例；关闭自动部署，后续发布通过 Manual Deploy。

在 Render 环境变量中设置：

| 变量 | 值 |
| --- | --- |
| SUPABASE_URL | 你的 Supabase 项目 URL |
| SUPABASE_ANON_KEY | 同项目 anon/publishable key |
| OPENAI_API_KEY | 后端 OpenAI key |
| OPENAI_MODEL | gpt-6-luna |
| DEMO_MODE | false |
| CORS_ORIGINS | Web 客户端的准确 origin，多个以逗号分隔；原生手机不受浏览器 CORS 约束 |

密钥通过 Render 控制台注入，不能写入 render.yaml、Dockerfile 或手机端。Docker 自动读取 Render 提供的 PORT，默认本地 8000。

免费实例适合首次联调，有空闲休眠与资源限制。付费实例和套餐升级需要另外确认；不要把免费部署当作正式生产可用性保证。

## 4. 验证

部署成功后，访问 Render 分配的 `https://<service>.onrender.com/health`，应返回 `{"status":"ok","mode":"live"}`。`GET /inventory` 不携带 token 应返回 401。健康检查只验证 API 进程，不代表 Supabase schema 或模型权限已验证。

再用真实用户登录完成：保存偏好 → 入库 → 拍照确认 → 生成 → 历史。两个不同账号互相看不到数据。真实 AI 调用会消耗 OpenAI API 额度。

## 5. 手机端

编辑 `frontend/.env`：

```dotenv
EXPO_PUBLIC_API_BASE_URL=https://<service>.onrender.com
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<public-key>
EXPO_PUBLIC_DEMO_MODE=0
```

重启 Expo；已经打包的 App 要重新构建才能使用新的 EXPO_PUBLIC 配置。手机端只包含 public key，OpenAI key 留在 Render。后端云端部署与 App Store / Google Play 上架是两个独立步骤。

参考：[Render Blueprint](https://render.com/docs/blueprint-spec)、[Free instances](https://render.com/docs/free)。

# iOS 月订阅

代码已接入 Apple 内购（RevenueCat SDK）、购买、恢复购买、服务端校验和账期额度。尚未创建商店商品或完成真实设备购买验收，不能仅凭部署代码开始收费。

## 方案与计数

- FridgeOut Plus：美国商店 US$6.99/月，自动续费，每个实际商店账期 20 次。其他地区显示 Apple 返回的本地价格，金额在 App Store Connect 设置。
- 每账号终身 3 次免费试用先用完，再使用订阅次数；重装、恢复购买不会重置额度。订阅账期从商店交易日期开始，未使用次数不结转。
- 一次识别包含一次生成及最多 5 个菜谱的图片；直接生成算一次。关联生成及图片不重复扣账期次数。失败的 AI 尝试也可能消耗一次，页面明确展示此规则；被预算/并发/额度检查拒绝的请求不消耗次数。
- 取消续订后可使用至当前账期结束；退款或失效经通知同步后撤销权益。续费生成新的账期，重复通知和恢复不会刷新同一账期。额度不足时再验证商店状态，弥补遗漏的续费通知。
- 原有管理员无限生成角色继续有效，仍受速率和全站预算保护。所有订阅用户也受当前全站日预算（默认 US$10）保护，上线前按付费用户规模调整容量。

## App Store Connect

1. 使用现有 Bundle ID `com.libowen.fridgetofood` 创建/选择 App；完成付费协议、税务和银行信息。
2. 创建自动续期订阅组，商品 ID **`fridgeout_pro_monthly`**，时长 **1 个月**，美国价格 **US$6.99**。填写商品本地化、审核截图和说明。此版不支持 Family Sharing，不要启用家庭共享或订阅宽限期。
3. 配置 Apple 凭据并连接 RevenueCat；首次订阅随 App 版本一起提交审核。不要另加 Apple 的免费试用优惠，现有 3 次试用由数据库管理。

## RevenueCat

1. 创建项目和 App Store 应用，关联上面的 Bundle ID 和 Apple 凭据。
2. 导入 `fridgeout_pro_monthly`，创建 entitlement **`fridgeout_pro`** 并关联商品；默认 Offering 添加 monthly package 指向该商品。
3. 在项目 Restore Behavior 选择 **Keep with original App User ID**。SDK 从第一次配置起使用 Supabase UUID，禁止匿名购买。恢复购买必须登录原账号；同一 Apple 收据不能给不同账号轮流刷新额度。
4. 创建后端可读取 REST v1 Subscriber 状态的 secret API key。iOS SDK 使用 Apple 应用的 public SDK key；不能使用 Test Store key。
5. 添加 webhook URL：`https://fridgechef-api-0lcg.onrender.com/billing/revenuecat/webhook`，Authorization 填 `Bearer <自选随机长密钥>`。接收购买、续费、取消、过期、退款等事件。后端收到事件后重新获取权威状态，不信任客户端或通知里的额度。

## 配置

Render 后端环境变量（密钥仅在后端）：

```dotenv
REVENUECAT_SECRET_KEY=<RevenueCat secret API key>
REVENUECAT_WEBHOOK_SECRET=<上面 Bearer 后的随机密钥>
REVENUECAT_ENTITLEMENT=fridgeout_pro
IOS_SUBSCRIPTION_PRODUCT_ID=fridgeout_pro_monthly
SUBSCRIPTION_MONTHLY_USES=20
BILLING_ALLOW_SANDBOX=false
```

还需要现有的 `SUPABASE_SERVICE_ROLE_KEY`。本地后端调试时填 `backend/.env`。先通过部署流水线应用迁移 `012_ios_monthly_subscriptions.sql`，再部署后端。

前端 `frontend/.env` / 对应 EAS 构建环境：

```dotenv
EXPO_PUBLIC_REVENUECAT_IOS_KEY=<Apple public SDK key>
EXPO_PUBLIC_IOS_SUBSCRIPTION_PRODUCT_ID=fridgeout_pro_monthly
EXPO_PUBLIC_PRIVACY_POLICY_URL=<真实可访问的隐私政策 HTTPS URL>
```

这些 public 值会进入 App 包，不能填 secret/service_role key。隐私政策缺失时购买按钮禁用。更改前端构建环境后重新构建 iOS App；更改 Render 配置只需重部署后端。

`eas.json` 提供 development、ios-simulator、preview、production 配置。实际内购需要包含原生 SDK 的 development/TestFlight/App Store 构建，Expo Go 不能验收购买。可使用 `npx eas-cli build --platform ios --profile development`，正式构建使用 `--profile production`；仍需配置 EAS 项目、Apple 签名凭据和构建环境。

## 沙盒与上线验收

Apple TestFlight 和 App Review 使用沙盒购买。测试/审核所访问的后端需要 `BILLING_ALLOW_SANDBOX=true`，否则购买成功也不会授予权益。优先使用独立测试 Supabase/Render/RevenueCat 环境；正式用户环境默认拒绝沙盒收据。若审核构建与正式构建共享后端，必须明确安排审核期间的沙盒支持，不能在送审时直接关闭。

在真实设备依次验证：购买后剩余额度、用满 20 次、加速续费补充 20 次、取消后到期失效、退款撤销、重装恢复不重置、另一个 App 账号不能恢复原账号权益、重复/乱序 webhook 不重复补充、RevenueCat 故障不授予新权益。测试账号应先用完 3 次免费额度以便验收订阅扣次；沙盒账期可能只有几分钟。

自动测试覆盖数据库额度与权限、恢复/续费/退款/乱序通知以及 API 权威校验；不替代原生构建、真实商店收据和 webhook 投递验收。App 上架还需有效隐私政策、商店审核资料和账户删除入口等完整审核要求；本次订阅接入不代表这些都已完成。

## 实现位置

- `frontend/src/fridgechef/SubscriptionCard.tsx`：右上角 Upgrade 打开的独立页面：方案、购买、恢复、管理订阅、条款。
- `frontend/src/fridgechef/billing.ts`：原生 SDK 和账户绑定。
- `backend/app/billing.py`：服务端 RevenueCat 校验和 webhook。
- `supabase/migrations/012_ios_monthly_subscriptions.sql`：订阅账期、受保护的额度账本、原子扣次；普通用户无权写入。
- `backend/tests/test_billing.py`、`backend/tests/test_subscriptions.sql`：API 与 PostgreSQL 验收。

参考：[RevenueCat Expo](https://www.revenuecat.com/docs/getting-started/installation/expo)、[身份与恢复规则](https://www.revenuecat.com/docs/projects/restore-behavior)、[Apple 内购](https://developer.apple.com/in-app-purchase/)、[审核沙盒配置](https://developer.apple.com/help/app-review/before-submitting-for-review/configure-in-app-purchases)。

# Agent 面板对标分析（2026-06-12）

对标对象（用户指定的三个 GitHub 产品）：

- claude-harness-desktop：多项目代码开发驾驶舱，一个驾驭智能体指挥多个
  Claude Code 终端实例（多项目终端池、广播、角色体系、插件市场）。
- Kun (DeepSeek GUI)：单人 AI 工作台，Code/Write 双模式，核心卖点是 token
  经济（cache-first、逐轮用量成本可视化）和需求澄清到计划的工作流。
- ClawPanel：OpenClaw 生态运维管理面板，服务启停、模型池管理、多 IM
  渠道、诊断修复、用量计费。

筛选基准：Honeycomb 是本地优先、可持久化、可检查的多 Agent 编排工作
系统。只吸收强化"可信赖 / 可恢复 / 可追溯 / 质量可控"的功能。

## 已经有的（不缺）

- 会话压缩/分叉/归档/恢复/中断（对标 Kun 会话操作）。
- DBOS+PG 崩溃恢复与任务持久化（三家都没有，独有优势）。
- 四种编排模式 + 测试 Agent 质量门禁（对标 harness 角色体系，更体系化）。
- 审批账本 + TTL + per-agent MCP 策略（对标 Kun 审批、ClawPanel 三档权限）。
- workspace 注册制、经验候选人工采纳、MCP 注册表+长会话、plans API、
  四类调度任务+失败自动禁用、provider 注册+DPAPI、双语、首启访谈
  （访谈生成 Agent 团队为独有）。

## 已在开发/路线图上

- web search/browser 网关（Phase 18；fetch、search、browser snapshot、
  per-agent network policy 已上线；richer browser automation 待做）。
- IM 多渠道后台 Agent（roadmap #11；飞书骨架已有）。
- 调度任务绑定模型/工作区/推理强度（roadmap #6）。
- 远程访问认证（HONEYC~3：每设备 token + 短时 SSE ticket）。
- 诊断修复动作（roadmap #12）、审批队列 SSE 刷新（roadmap #7）。

## 没有但强烈值得学（按优先级）

1. P0 Token 用量与成本可观测性（Kun + ClawPanel）：逐轮 token、成本
   估算、每日图表、按 Agent/模型排行。2026-06-12 起步：OpenClaw 适配器
   提取 usage，/runtime/usage 聚合 tokens 总量/按 Agent/按日。成本估算
   （provider 定价配置）仍待做。
2. P0 主模型+备选自动切换、批量连通性/延迟测试（ClawPanel）：现有
   verify 无 failover、无延迟检测。
3. P1 需求澄清流程（Kun）：背景/目标/验收标准 -> AI 辅助澄清 -> 生成
   实施计划；与访谈和 plans API 契合，验收标准前置可提升质量门禁效果。
4. P1 任务卡死/心跳检测（harness）：DBOS 管崩溃恢复，"活着却卡住"
   还没人管。
5. P1 系统通知（Kun）：任务完成/失败/等待审批桌面通知，小工作量高价值。
6. P2 渐进式工具发现 mcp_search（Kun）：按需查找工具，省上下文。
7. P2 记忆/经验管理界面（ClawPanel）：查看/编辑/分类/导出/按 Agent 隔离。
8. P2 配置备份与还原（ClawPanel）：导出/导入本地配置，密钥重新加密。
9. P3 会话中途引导 mid-turn steering / 旁支对话（Kun）：价值高但改动深，
   等真实 OpenClaw E2E 跑通后评估。

## 明确不学（与定位冲突）

- harness 多项目终端池/一键广播/资源市场（多项目代码驾驶舱定位）。
- Kun Write 写作编辑器（写作由 writer-agent 以产物交付）。
- ClawPanel 晴辰云接口、11 种语言（中英已够）。

## 2026-06-12 Update

- P0 runtime cost observability is now implemented beyond token totals: provider metadata can define USD pricing, optional model overrides are supported, and `GET /runtime/usage` returns estimated cost totals by summary, provider/model, agent, and day.
- Verification added: `tests/pricing-policy.test.ts` covers pricing parsing and model overrides; `npm run smoke:runtime-usage-cost` inserts a real model-call usage payload and verifies the API cost aggregation.
- Remaining P0 backend work after this slice: primary/fallback provider failover, batch latency verification, packaged OpenClaw launch/restart defaults, real provider E2E, and Phase 18 web search/browser gateway.

## 2026-06-12 Update 2

- P0 provider resilience slice is now implemented: `POST /providers/verify-batch` verifies multiple OpenAI-compatible providers, records latency in provider metadata, and returns per-provider results for future UI ranking.
- Worker model calls now resolve route candidates from the primary agent provider plus `agent.metadata.fallbackRoutes` / `fallbackProviderIds` and primary provider metadata fallbacks. If the primary route fails, the worker records a failed route attempt and tries the next provider/model before marking the model call failed.
- Remaining P0 backend work after this slice: packaged OpenClaw launch/restart defaults, real provider E2E against installed OpenClaw, and Phase 18 web search/browser gateway.

## 2026-06-12 Update 3

- Phase 19 packaged runtime-control defaults are now implemented: when explicit `HONEYCOMB_OPENCLAW_*_COMMAND` variables are absent, the API uses builtin status/start/restart/stop behavior to prepare or mark the local OpenClaw runtime directory.
- The real OpenClaw smoke script now sends the local Honeycomb API token on all API calls, so the real-provider regression is no longer blocked by the post-HONEYC~3 auth boundary.
- Remaining P0 backend work after this slice: run the real provider E2E against an installed OpenClaw runtime, then continue Phase 18 web search/browser gateway.

## 2026-06-12 Update 4

- Phase 18 minimal web/search/browser backend is now implemented: `POST /tools/web/search` and `POST /tools/browser/snapshot` reuse the approval-ledger pattern from web fetch, including exact target/command matching, private-network approval checks, DNS-pinned fetches, approval consumption, and audit events.
- Verification added: `tests/web-tools.test.ts` covers configurable search endpoints and browser snapshot extraction; `npm run smoke:web-search-browser` runs a fake local search/page server, approves both tool calls, and verifies extracted search results plus title/text/links.
- Remaining Phase 18 work after this slice: per-agent network policy and richer interactive browser automation. Real provider E2E against an installed OpenClaw runtime remains the next Phase 19 regression target.

## 2026-06-12 Update 5

- Phase 18 per-agent network policy is now implemented for web fetch, web search, and browser snapshot. Agent metadata can allow/deny operations, require explicit private-network permission, and restrict protocols or hosts with allow/block lists.
- Verification added: `tests/network-policy.test.ts` covers policy defaults, disabled operations, private-network checks, host allow/block matching, and disabled agents; the web-search/browser smoke now creates policy-scoped agents and verifies both allowed access and a real `network_policy_denied` response without consuming the approval.
- Remaining Phase 18 work after this slice: richer interactive browser automation only. Real provider E2E against an installed OpenClaw runtime remains the next Phase 19 regression target.

## 2026-06-12 Update 6

- Provider key status is now reconciled against live local secret storage before `/providers` responses and verification paths. This prevents stale database rows from showing `apiKeyConfigured=true` when the local secret file is missing or unreadable.
- Verification added: `npm run smoke:provider-secret-status` creates a temporary provider, deletes only its temporary secret file, restarts the API, and verifies `/providers` reports the provider as unconfigured with `provider_api_key_missing_in_secret_storage`.
- Product implication: the panel should stop showing a fake configured/online state when the saved key is not actually available locally.

## 2026-06-12 Update 7

- Runtime diagnostics now use the same live provider secret-state reconciliation as `/providers`, so diagnostics will not claim real-provider readiness from stale key flags.
- Added a dedicated `real_provider_e2e` diagnostic check. It requires a ready OpenClaw runtime, synced required agents, and at least one verified live external provider; localhost and `*.invalid` fake providers are excluded from real E2E readiness.
- Verification added: `npm run smoke:runtime-diagnostics-readiness` creates a temporary stale provider secret, restarts the API, and verifies diagnostics report the missing secret plus a real-provider E2E warning.

## 2026-06-12 Update 8

- Runtime diagnostics now has a first repair-action backend: `GET /runtime/repair/actions` lists available actions and `POST /runtime/repair` executes them.
- First repair actions implemented: reconcile provider secret status, prepare/start OpenClaw runtime, restart OpenClaw runtime, seed default Honeycomb agents, and apply OpenClaw sync files.
- Verification added: `npm run smoke:runtime-repair-actions` exercises the catalog and executes real repair actions against a temporary provider/runtime root, including stale secret reconciliation and OpenClaw prompt/config file generation.
- Remaining repair work: desktop diagnostics UI wiring plus more targeted WSL/Docker/database/MCP repair actions.

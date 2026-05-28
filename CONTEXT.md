# Agent OpenClaw Context Checkpoint

## 2026-05-28 Project File Organization Checkpoint

Repository files were organized for long-term platform development and future
GitHub/open-source publishing.

Current top-level ownership:

```text
apps/                  API and DBOS worker platform source.
packages/              Shared DB and type packages.
scripts/               Dev/start/smoke/maintenance scripts.
platform-assets/       OpenClaw agent templates and manual vendor workarounds.
docs/                  Project structure, boundaries, agent setup notes, historical docs.
README.md              GitHub entry point and boundary summary.
SETUP.md               Local setup and smoke-test guide.
CONTEXT.md             Agent-facing project checkpoint.
```

Moved/created files:

```text
openclaw/ -> platform-assets/openclaw-agent-templates/
scripts/patch-openclaw-ark-media.ps1 -> platform-assets/vendor-workarounds/openclaw/patch-ark-media.ps1
OPENCLAW_AGENT_CREATION.md -> docs/openclaw-agent-creation.md
openclaw-feishu-temporal-agent-pipeline-plan.md -> docs/historical/openclaw-feishu-temporal-agent-pipeline-plan.md
README.md added
docs/PROJECT_STRUCTURE.md added
docs/BOUNDARIES.md added
```

Important boundary decision:

```text
OpenClaw/ClawPanel is an external runtime/product. Platform code must call it
through apps/dbos-worker/src/adapters/openclaw.ts and environment-configured
CLI paths. Prompt/config templates belong under platform-assets/. Manual vendor
workarounds are isolated under platform-assets/vendor-workarounds/ and must
not become the default downloadable-user install path.
```

Verification:

```text
commit=7a58f6b Organize platform project files
npm run check passed
git diff --check passed, with only CRLF warnings
old repo-local openclaw/agents and openclaw/config references cleared
git status clean after commit
```

## 2026-05-27 Feishu Webhook Readiness Checkpoint

Added local Feishu webhook smoke coverage before public HTTPS ingress:

```text
1. package.json:
   - npm run smoke:feishu-webhook
2. scripts/smoke-feishu-webhook.ps1:
   - starts dev stack with FEISHU_DRY_RUN=true and OPENCLAW_AGENT_MODE=mock
   - overrides FEISHU_VERIFICATION_TOKEN with a local smoke token
   - overrides FEISHU_BOT_OPEN_ID with a local bot open_id
   - verifies challenge
   - verifies invalid token -> 401 invalid_feishu_token
   - verifies non-message event ignored
   - verifies bot self-message ignored
   - verifies normal Feishu message creates one job and starts DBOS workflow
   - verifies duplicate message_id reuses the same job
   - waits for the created job to reach succeeded
3. SETUP.md:
   - documents npm run smoke:feishu-webhook
   - documents public ingress plan: Feishu -> VPS Nginx HTTPS -> frp -> local API
   - warns to expose only /webhooks/feishu/events publicly
   - notes first production pass should keep Feishu Encrypt Key disabled
```

Verification:

```text
npm run smoke:feishu-webhook
  passed

job=JOB-20260527-DD7634DD
duplicateJobId=JOB-20260527-DD7634DD
terminalStatus=succeeded
routingMode=supervisor_pipeline
maxModelCalls=20
classicFinalGateEnabled=false
discussionRounds=2
checked=challenge,wrong_token,non_message_ignored,bot_message_ignored,normal_message_created_job,duplicate_message_id_reused_job
```

Current next step: after this smoke delta is committed, prepare the public Feishu HTTPS ingress when ICP/DNS is ready.

## 2026-05-27 discussionRounds Persistence Checkpoint

Implemented and verified `discussionRounds` as persisted job configuration:

```text
1. packages/shared/src/types.ts:
   - DEFAULT_DISCUSSION_ROUNDS=2
   - JobRecord.discussionRounds
   - CreateJobInput.discussionRounds
2. packages/db/src/migrate.ts:
   - agent.jobs.discussion_rounds int not null default 2
3. packages/db/src/jobs.ts:
   - createJob persists discussion_rounds
   - toJobRecord returns discussionRounds
   - job.created event includes discussionRounds
4. apps/orchestrator-api/src/server.ts:
   - POST /jobs accepts discussionRounds int 1..10
   - POST /jobs and Feishu webhook responses include discussionRounds
5. apps/dbos-worker/src/activities.ts:
   - getJobDiscussionRounds DBOS step reads persisted value
   - emits discussion.round_count_selected
6. apps/dbos-worker/src/workflows.ts:
   - removed DISCUSSION_ROUND_COUNT constant
   - master_slave_discussion loop uses the checkpointed step value
7. scripts/smoke-m2-recovery.ps1:
   - discussion recovery case now sends discussionRounds=3
   - asserts persisted config and 3-round recovery counts
```

Verification:

```text
npm run check
  passed

git diff --check
  passed; only Git CRLF warnings printed

npm run smoke:m2-recovery
  passed

pipeline:
  job=JOB-20260527-260F9CAC
  result=succeeded
  attempts=3
  finalTestEvents=1

master_slave_discussion:
  job=JOB-20260527-3233B7D7
  requested/configured discussionRounds=3
  result=succeeded
  stages=2
  attempts=6
  discussionRounds=3
  discussionMessages=6
  synthesisArtifacts=1
  finalTestEvents=1
```

Current next step: Feishu public HTTPS webhook setup. The discussion round hard-code is no longer current truth.

## 2026-05-26 M2.5 Quality Gates And Budget Checkpoint

已完成非监督模式质量门和通用 model-call 预算上限：

```text
1. agent.jobs 新增 max_model_calls，默认 20。
2. agent.jobs 新增 classic_final_gate_enabled，默认 false。
3. POST /jobs 支持 maxModelCalls 和 classicFinalGateEnabled。
4. workflow 在每次 OpenClaw-backed 调用前运行 enforceModelCallBudget。
5. 预算耗尽时写 budget.model_calls_exhausted，job 进入 waiting_for_human。
6. pipeline 在所有 stage 完成后跑一次 final test-agent gate。
7. master_slave_discussion 在 main-agent synthesis 后跑一次 final test-agent gate。
8. classic_master_slave 默认不跑 final gate；classicFinalGateEnabled=true 时跑。
9. final gate 生成 test_report artifact，并写 final.test_completed 事件。
10. smoke:m2-recovery 已更新，恢复后也断言 finalTestEvents=1。
```

M2.5 本地验证结果：

```text
pipeline_final_gate:
  job=JOB-20260526-C3ACA6A8
  result=succeeded
  stages=3
  attempts=3
  modelCallRows=4
  finalTestEvents=1

discussion_final_gate:
  job=JOB-20260526-C42B17BD
  result=succeeded
  stages=2
  attempts=4
  modelCallRows=6
  synthesisArtifacts=1
  finalTestEvents=1

classic_default_no_gate:
  job=JOB-20260526-22329D8E
  result=succeeded
  modelCallRows=3
  finalTestEvents=0

classic_enabled_gate:
  job=JOB-20260526-FA995683
  result=succeeded
  modelCallRows=4
  finalTestEvents=1

budget_waiting:
  job=JOB-20260526-0EB0A046
  result=waiting_for_human
  maxModelCalls=1
  attempts=1
  modelCallRows=1
  budgetEvents=1
```

更新后的恢复脚本结果：

```text
npm run smoke:m2-recovery

pipeline:
  job=JOB-20260526-7045BD80
  result=succeeded
  attempts=3
  finalTestEvents=1

master_slave_discussion:
  job=JOB-20260526-0FC11103
  result=succeeded
  attempts=4
  discussionRounds=2
  synthesisArtifacts=1
  finalTestEvents=1
```

已更新：discussion_rounds 持久化配置已于 2026-05-27 完成；当前 discussion 轮次不再是 workflow 常量 2。

## 2026-05-26 M2 Hardening Checkpoint

本轮复核结论：用户指出的主要问题是对的。M2 主体能跑，但还需要补崩溃恢复
和 discussion 模式的 main-agent 收口。已完成以下加固：

```text
1. master_slave_discussion 现在新增 mainAgentSynthesizeDiscussion DBOS step。
2. 该 step 读取 agent_events 讨论账本、discussion.round_completed 事件和各轮 stage output artifact。
3. main-agent 通过 OpenClaw idempotent model_call 执行/复用 synthesis。
4. 生成 artifact：<jobId>-ART-DISCUSSION-SYNTHESIS，type=discussion_synthesis。
5. finalizeJob 会把 discussion synthesis 纳入 final output。
6. classic_master_slave 当前确认是串行执行，不是并行；并行留作后续单独验证。
7. model_calls 新增 failed_unknown_outcome 状态，人工确认后可解除 started 黑洞。
8. 新增受 ADMIN_API_TOKEN 保护的 admin unstick endpoint：
   POST /admin/model-calls/failed-unknown-outcome
9. 新增可重复恢复冒烟脚本：npm run smoke:m2-recovery
```

M2 崩溃恢复补测已通过，均使用 `FEISHU_DRY_RUN=true` 和
`OPENCLAW_AGENT_MODE=mock`：

```text
pipeline crash smoke:
  hook=after-runStageAgent-stage-002-attempt-01
  job=JOB-20260526-08CE74AE
  result=succeeded
  stages=3
  attempts=3
  reviews=0
  stageAgentRequested=3
  stageAgentCompleted=3
  stageAgentReused=0
  stage2OutputMessages=1

master_slave_discussion crash smoke:
  hook=after-runStageAgent-stage-002-attempt-01
  job=JOB-20260526-B720C1B2
  result=succeeded
  stages=2
  attempts=4
  reviews=0
  stageAgentRequested=4
  stageAgentCompleted=4
  stageAgentReused=0
  discussionRounds=2
  discussionMessages=4
  synthesisEvents=1
  synthesisArtifacts=1
```

非监督者模式质量门决策（先记录，M2.5 再实现）：

```text
pipeline：最终输出处加一道 test-agent 终检，不做每阶段检查。
classic_master_slave：main-agent 是主合成者，后续加可选 final test-agent gate。
master_slave_discussion：main-agent synthesis 必须做；synthesis 后加一道 final test-agent gate。
all modes：后续加总 attempts / model calls / 成本预算上限。
```

## 2026-05-26 M2 Routing Modes Checkpoint

已完成 DBOS 编排内核的四种 routing mode 策略层：

```text
pipeline
supervisor_pipeline
classic_master_slave
master_slave_discussion
```

默认模式是 `supervisor_pipeline`，也就是迁移前已经验证过的现行行为：
stage-agent 产出 -> test-agent 质量闸门 -> PASS 交给下一阶段 -> FAIL 回到原
stage-agent 修复 -> 连续 3 次失败进入 waiting_for_human。

M2 新增内容：

```text
1. agent.jobs 新增 routing_mode 字段。
2. POST /jobs 支持 routingMode 入参。
3. pipeline：顺序流水线，无 test-agent，每个阶段输出直接作为下一阶段输入。
4. classic_master_slave：main-agent 独立分发给各子 agent，子 agent 输出回 main-agent 汇总。
5. master_slave_discussion：固定 2 轮讨论，每轮所有子 agent 跑一次，写 discussion.round_completed。
6. group_messages/messageType 和 agent_events payload 会记录 routingMode、handoff target、message type。
```

本地四模式验证已通过，均使用 `FEISHU_DRY_RUN=true` 和 `OPENCLAW_AGENT_MODE=mock`：

```text
supervisor_pipeline     JOB-20260526-0BC974B1 succeeded stages=2 attempts=2 reviews=2 discussionRounds=0
pipeline                JOB-20260526-0848E07B succeeded stages=3 attempts=3 reviews=0 discussionRounds=0
classic_master_slave    JOB-20260526-7F4DB40F succeeded stages=3 attempts=3 reviews=0 discussionRounds=0
master_slave_discussion JOB-20260526-284C033C succeeded stages=2 attempts=4 reviews=0 discussionRounds=2
```

当前边界：M2 只落最小可运行策略。pipeline/classic/discussion 还没有质量闸门；
后续如果要把质量控制也加进去，需要明确每种模式下 test-agent 的位置和是否允许返工。

## 2026-05-25 DBOS Migration Checkpoint

当前编排内核已从 Temporal 切换到 DBOS：

```text
orchestrator-api
  -> DBOS JobPipelineWorkflow
  -> Postgres dbos.* checkpoint tables
  -> Postgres agent.* business ledger
  -> OpenClaw / Feishu adapters
```

已完成：

```text
1. 移除本地 dev stack 里的 Temporal Server / Temporal UI，只保留 Postgres。
2. apps/dbos-worker/src/workflows.ts 使用 DBOS.registerWorkflow 和 DBOS.registerStep。
3. apps/orchestrator-api/src/server.ts 使用 DBOS.startWorkflow 启动 job workflow。
4. 业务表继续保留在 agent schema，DBOS 只作为 durable execution layer。
5. 本地 POST /jobs 已验证成功：JOB-20260525-88AF3B8F -> succeeded。
6. DBOS 表已验证：dbos.workflow_status.status = SUCCESS，dbos.operation_outputs 记录了各 step checkpoint。
7. 验证时临时使用 FEISHU_DRY_RUN=true，没有发送真实飞书消息。
```

当前优先级：

```text
1. 继续验证崩溃恢复和幂等。
2. 再实现 4 种编排模式策略。
3. 最后回到飞书公网 HTTPS webhook。
```

## 2026-05-26 DBOS Recovery Verification

已完成 DBOS 崩溃恢复实测：

```text
测试 hook：DBOS_TEST_CRASH_ONCE_AFTER=after-runStageAgent-stage-001-attempt-01
测试 job：JOB-20260526-894EDEC2
崩溃点：第一阶段 runStageAgent step 完成并 checkpoint 后，进程退出。
崩溃后状态：agent.jobs.status=planning，dbos.workflow_status.status=PENDING。
崩溃后 DBOS checkpoint：operation_outputs 已有 markJobRunning / prepareJobWorkspace / createPipelinePlan / runStageAgent。
重启方式：移除 DBOS_TEST_CRASH_ONCE_AFTER，重新 npm run dev:start。
恢复结果：DBOS 日志显示 Recovering 1 workflows，job 最终 succeeded。
幂等结果：第一阶段 attempt 行数=1，stage.agent_started 事件=1，第一阶段输出消息行=1。
```

已补外部发送幂等保护：

```text
1. agent.group_messages upsert 不再把已有 feishu_message_id 覆盖成 null。
2. postGroupMessage 若发现同一逻辑消息已有 feishu_message_id，则跳过外部 Feishu send。
3. 本地 SQL probe 验证同 ID upsert 后 fake feishu_message_id 被保留。
```

## 2026-05-26 OpenClaw Idempotency Hardening

已补 OpenClaw 调用幂等：

```text
1. 新增 agent.model_calls 表。
2. idempotency_key = jobId + stageId + attemptNo + actionType。
3. runStageAgent / runTestAgent 都通过 model_calls 保护 OpenClaw 调用。
4. 如果已有 succeeded model_call，恢复时复用结果并写 tool.openclaw_agent_reused。
5. 如果只有 started 但没有完成结果，视为 ambiguous，不静默二次调用 OpenClaw。
```

已完成 step 中途崩溃实测：

```text
测试 hook：DBOS_TEST_CRASH_ONCE_AFTER=after-openclaw-stage-agent-stage-001-attempt-01
测试 job：JOB-20260526-18E997BA
崩溃点：第一阶段 OpenClaw 调用完成、model_calls 写入 succeeded 后，但 runStageAgent DBOS step 尚未 checkpoint。
崩溃后状态：dbos.workflow_status.status=PENDING，operation_outputs 只有 markJobRunning / prepareJobWorkspace / createPipelinePlan，没有 runStageAgent。
崩溃后业务状态：agent.model_calls 已有第一阶段 stage-agent succeeded 记录，stage_attempts 只有 1 行且仍 running。
重启恢复：job 最终 succeeded。
验证结果：第一阶段 stage-agent requested=1，completed=1，reused=1；model_calls=1；attempt rows=1；输出 group message=1。
```

注意：对同步外部 LLM 调用，若进程刚好崩在“OpenClaw 已返回但 model_calls 还没写入 succeeded”之前，仍无法绝对证明外部没有执行。当前策略是在本地记录存在且 completed 时复用；如果只有 started 无 completed，则阻止静默二次调用，交给人工/后续恢复策略处理。

保存时间：2026-05-25

## 当前目标

在飞书群内搭建一个多 Agent 流水线：

```text
用户在飞书群发任务
  -> main-agent 作为唯一入口、任务拆解者、调度者和最终汇报者
  -> 子 Agent 按阶段执行
  -> 子 Agent 完成后，编排服务把产物交给 test-agent 测试
  -> test-agent PASS 后，编排服务把 artifact 交给下一个子 Agent
  -> test-agent FAIL 后，编排服务把测试报告交回原子 Agent 返工
  -> 连续 FAIL 3 次后停止并等待用户决策
```

## 最新 Agent 清单

当前保留 6 个 Agent：

```text
main-agent
research-agent
writer-agent
image-agent
video-agent
test-agent
```

已删除/不再需要：

```text
planner-agent：任务拆解归 main-agent。
executor-agent：暂时不要通用执行角色，避免职责模糊。
copy-agent：文案职责归 writer-agent。
```

## Agent 职责

```text
main-agent：接收用户任务、拆解阶段、调度子 Agent、维护状态、最终汇总和汇报。
research-agent：根据任务搜索资料、事实、来源、背景、风险和约束。
writer-agent：写文案、文章、脚本、故事、标题、总结等文字产物。
image-agent：生成图片 brief、图片提示词，必要时调用图片生成工具产出图片。
video-agent：生成视频 brief、分镜、视频提示词，必要时调用视频生成工具产出视频。
test-agent：测试每个阶段输出，只测试，不修改业务产物。
```

## 当前技术栈

```text
Feishu group：真人任务入口和可见显示屏，不作为 agent-to-agent 控制总线。
OpenClaw：Agent runtime，默认 mock，可通过 OPENCLAW_AGENT_MODE=real 调 WSL OpenClaw CLI。
Temporal：无状态 Harness，负责任务排队、重试、暂停、恢复、等待人工决策。
Postgres：append-only Session ledger + 任务状态、阶段、attempt、artifact、测试报告、群消息记录。
Tool Gateway：OpenClaw/Feishu 等外部工具边界，密钥不进入 prompt。
orchestrator-api：HTTP 任务入口。
temporal-worker：执行 JobPipelineWorkflow。
```

## 已完成

```text
Docker Compose：Postgres + Temporal + Temporal UI
API：POST /jobs, POST /webhooks/feishu/events, GET /jobs/:jobId, GET /jobs/:jobId/details
Temporal workflow：JobPipelineWorkflow
DB migration：agent.jobs / agent_events / job_stages / stage_attempts / test_reviews / artifacts / group_messages / job_events
Mock pipeline：main-agent 动态规划 research/writer/image 阶段
测试逻辑：PASS 交给下一阶段，FAIL 退回原子 Agent，连续 3 次失败进入 waiting_for_human
OpenClaw prompt 模板：6 个 Agent
```

## 关键文件

```text
apps/orchestrator-api/src/server.ts
apps/temporal-worker/src/workflows.ts
apps/temporal-worker/src/activities.ts
packages/db/src/migrate.ts
packages/db/src/jobs.ts
packages/db/src/pipeline.ts
packages/shared/src/types.ts
platform-assets/openclaw-agent-templates/agents/main-agent.md
platform-assets/openclaw-agent-templates/agents/research-agent.md
platform-assets/openclaw-agent-templates/agents/writer-agent.md
platform-assets/openclaw-agent-templates/agents/image-agent.md
platform-assets/openclaw-agent-templates/agents/video-agent.md
platform-assets/openclaw-agent-templates/agents/test-agent.md
platform-assets/openclaw-agent-templates/config/openclaw.multi-agent.example.json
docs/openclaw-agent-creation.md
```

## OpenClaw Agent 状态

OpenClaw/ClawPanel 中当前保留 6 个真实 Agent：

```text
main-agent
research-agent
writer-agent
image-agent
video-agent
test-agent
```

当前已创建并配置：

```text
main-agent：OpenClaw 默认 main agent
writer-agent：model = deepseek-writer/deepseek-v4-pro
research-agent：model = deepseek-research/deepseek-v4-pro
video-agent：model = deepseek-writer/deepseek-v4-pro
image-agent：model = deepseek-writer/deepseek-v4-pro
test-agent：model = zai/glm-5.1
```

writer-agent 已从主 DeepSeek provider 独立出来，使用 `models.providers.deepseek-writer.apiKey`，不要和 main-agent 共用 `models.providers.deepseek.apiKey`。

video-agent 不能直接把 Seedance 当聊天模型使用；OpenClaw 当前配置为：

```text
video-agent 的思考/调度模型：deepseek-writer/deepseek-v4-pro
视频生成 provider：models.providers.byteplus
视频生成 endpoint/baseUrl：https://ark.cn-beijing.volces.com/api/v3
视频默认模型：agents.defaults.videoGenerationModel.primary = byteplus/doubao-seedance-2-0-260128
视频 fallback：byteplus/seedance-1-5-pro-251215, byteplus/seedance-1-0-pro-250528, byteplus/seedance-1-0-lite-t2v-250428
```

image-agent 使用图片生成 provider：

```text
image-agent 的思考/调度模型：deepseek-writer/deepseek-v4-pro
图片生成 provider：models.providers.openai
图片生成 endpoint/baseUrl：https://ark.cn-beijing.volces.com/api/v3
图片默认模型：agents.defaults.imageGenerationModel.primary = openai/doubao-seedream-5-0-260128
图片 API key 已写入本机 WSL 的 OpenClaw 配置，不要打印或写入文档。
```

注意：本机 WSL 的 OpenClaw openai 图片 provider 已加一个小兼容补丁：当 baseUrl 是火山方舟时自动发送 `response_format: b64_json`，否则 Ark 默认返回 URL，而当前 OpenClaw 解析器会误判为没有图片。

Seedance 2.0 视频生成是火山方舟的异步任务流程，标准版经常超过 OpenClaw BytePlus provider 原本硬编码的 120 秒默认超时。本机已把 BytePlus 视频 provider 默认超时补到 600000ms，并保留 `byteplus/doubao-seedance-2-0-fast-260128` 作为 fallback。以后升级 OpenClaw 后如补丁丢失，运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\platform-assets\vendor-workarounds\openclaw\patch-ark-media.ps1
```

test-agent 已接入智谱 GLM-5.1：

```text
provider：models.providers.zai
baseUrl：https://api.z.ai/api/paas/v4
model：zai/glm-5.1
API key：已写入本机 WSL 的 OpenClaw 配置，不要打印或写入文档。
```

research-agent 已接入独立 DeepSeek provider：

```text
provider：models.providers.deepseek-research
baseUrl：https://api.deepseek.com
model：deepseek-research/deepseek-v4-pro
API key：已写入本机 WSL 的 OpenClaw 配置，不要打印或写入文档。
```

WSL 常驻修复：

```text
已执行：loginctl enable-linger administrator
已创建 Windows 计划任务：OpenClaw WSL Keepalive
作用：登录 Windows 后启动 Ubuntu-24.04，并保持 WSL 常驻，让 openclaw-gateway.service 不随 WSL session 退出而停止。
```

注意：真实 OpenClaw 安装在 WSL：

```text
/home/administrator/.openclaw
```

Windows ClawPanel 配置在：

```text
C:\Users\Administrator\ClawPanel
```

ClawPanel 指向 WSL OpenClaw 路径：

```text
\\wsl.localhost\Ubuntu-24.04\home\administrator\.openclaw
```

创建完成后继续：

```text
1. OpenClaw adapter 已确认使用 `openclaw agent --agent <id> --session-id <id> --message <prompt> --json`。
2. worker 默认 `OPENCLAW_AGENT_MODE=mock`；设置为 `real` 后调用 WSL OpenClaw CLI。
3. Feishu adapter 已接入 `im/v1/messages`，未配置凭证时 dry-run 并完整落库。
4. Postgres `agent_events` 是 append-only session ledger，Temporal + Postgres 作为状态权威。
5. 任务 session 结束后归档并设置保留期；经验库是长期记忆，不随任务清理。
```

## 2026-05-23 Prompt Draft Decisions

用户提供并正在整理的顶层 prompt 草稿目录：

```text
C:\Users\Administrator\Desktop\agent集群提示词 (1)
```

当前顶层草稿文件：

```text
main-agent-prompt.md
research-agent-prompt.md
writer-agent-prompt.md
image-agent-prompt.md
video-agent-prompt.md
test-agent-prompt.md
多智能体工作流程.md
multi-agent-machine-contract.json
```

已确认并写入顶层草稿：

```text
1. agent 命名统一为 writer-agent 和 test-agent，不再用 writing-agent / content-tester。
2. 同一阶段连续 3 次 FAIL 后停止并等待人工决策，不强制通过、不低质量通过。
3. test-agent-prompt.md 现在是测试 agent prompt；旧的中文文件名测试 prompt 已不再作为当前顶层草稿。
4. 子 agent 需要写 agent-work-log.md，提炼 3-5 条阶段工作摘要；main-agent 只传路径，不读正文。
5. 子 agent / test-agent 需要写 state/*.json，机器可读契约见 multi-agent-machine-contract.json。
6. test-agent 读取子 agent 工作摘要用于质检；最后一个阶段 PASS 后，test-agent 读取所有工作摘要并生成 final-summary.md / final-summary.json，main-agent 只转发最终汇总。
7. research-agent 必须对关键事实、数据、结论、时间线做至少两个可靠来源交叉验证；单一来源必须标注风险。
```

框架讨论后已决定并落地：

```text
1. Claude 风格 Agent(...)/resume/~/.claude/projects 已从顶层 prompt 草稿改写为 OpenClaw + Temporal + Postgres 调度语义。
2. 采用“飞书群只是显示屏，真实对话流程全部在编排服务里跑”的架构；群消息可用 `@下一个agent` 开头给用户看，但不依赖飞书 @ 触发 agent 接力。
3. 新增 Feishu webhook：POST /webhooks/feishu/events，支持 challenge、消息创建 job、message_id 去重，并可通过 `FEISHU_BOT_OPEN_ID` 忽略机器人自身消息。
4. 新增 Feishu adapter：配置单个 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_DEFAULT_CHAT_ID` 后发送真实群消息；未配置或 `FEISHU_DRY_RUN=true` 时 dry-run。
5. 新增 OpenClaw adapter：默认 mock，OPENCLAW_AGENT_MODE=real 时调 WSL OpenClaw CLI。
6. 已本地验证：正常任务 succeeded；首次失败后修复 succeeded；连续 3 次失败进入 waiting_for_human；Feishu webhook 创建 job 与重复消息去重通过；agent_events seq 连续。
7. 最新生命周期改进：jobs 新增 completed_at / archived_at / retention_until / cleanup_status / retention_policy；finalizeJob 后调用 archiveJobSession；新增 `npm run maintenance:cleanup-sessions` dry-run 清理预览脚本。
8. 生命周期验证 job：`JOB-20260523-207A9AE8`，结果 `succeeded`，`cleanupStatus=retained`，`archivedAt` 已写入，`retentionUntil=2026-06-22T13:14:48.415Z`，`job.archived` 事件数量 1。
9. 严格显示屏改进修正：不需要 6 个飞书应用；`senderAgentId` 只作为本地逻辑发送者落库，不决定飞书应用身份。群里 `@test-agent` / `@image-agent` 是展示文本。
10. 单飞书机器人显示屏验证 job：`JOB-20260523-0692993C`，结果 `succeeded`，阶段顺序为 `writer-agent -> image-agent`，群消息首行为 `@main-agent` / `@test-agent` / `@image-agent` 展示文本。
```

注意：顶层 prompt 草稿已更新桌面文件；真实 WSL OpenClaw agent 的 AGENTS.md 是否同步写入，需要在用户确认 prompt 定稿后执行。

## 2026-05-23 Context Capsule

已按用户“保存上下文”要求生成详细本地交接文件：

```text
D:\聊天记录\Codex\context-vault\agent-openclaw\20260523-084430-agent-openclaw-managed-runtime.md
```

该 capsule 记录了：

```text
1. Feishu + OpenClaw + Temporal + Postgres 的 Managed Agents 架构决策。
2. Postgres agent_events append-only session ledger 的实现位置。
3. Feishu webhook / Feishu adapter / OpenClaw adapter 的实现位置。
4. 本地端到端验证结果和 job id。
5. 下一步真实飞书群配置项。
6. 安全注意事项：不要保存或打印 API key。
```

## 2026-05-25 Latest Checkpoint

用户再次要求“保存上下文”。本次最新状态：

```text
1. 架构继续保持：飞书群只是显示屏；真正 agent-to-agent 流程全部在本地编排服务 Temporal + Postgres 中推进。
2. 已明确取消“多个飞书 app 分别代表多个 agent”的方案。当前只需要一个飞书自建应用/机器人。
3. `senderAgentId` / `mentionAgentId` 仍保留在本地数据库和 group_messages 中，用于记录逻辑发送者和逻辑目标；它们不决定飞书应用身份。
4. 群消息仍可用 `@main-agent` / `@test-agent` / `@image-agent` 这种开头，但这是给用户看的展示文本，不是飞书事件触发机制。
5. 用户提供的飞书 app 凭证、verification token 已写入 `.env`；不要在任何上下文、文档或最终答复中回显明文 secret/token。
6. 已通过飞书 API 找到机器人所在群 `chat_id`，并写入 `.env`；已找到 bot open_id 并写入 `.env`，用于过滤机器人自身回调。
7. 已真实验证单飞书机器人能向群里发消息：job `JOB-20260523-38B84C60` succeeded，4 条 group message 全部 delivered。
8. 域名 `tomorrow123.art` 已解析到 VPS `49.232.90.172`，22/80/443 当时都可连通。
9. `http://tomorrow123.art/health` 当时返回腾讯云备案/网站无法访问页面；`https://tomorrow123.art/health` 当时不能正常访问。直接把该域名填给飞书 webhook 还不可用。
10. 推荐下一步：用固定域名做公网 HTTPS 回调入口。可选路径 A：Cloudflare Tunnel 绑定固定子域名并转发到本地 `localhost:3000`；路径 B：把整套服务部署到 VPS 并处理 Nginx/HTTPS/备案问题。
11. 本次保存时，本地 `http://localhost:3000/health` 无法连接，Docker Desktop API 也无法连接。恢复工作时先启动 Docker Desktop，再运行 `npm run dev:start`。
```

当前敏感配置原则：

```text
.env 里已有 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_VERIFICATION_TOKEN / FEISHU_DEFAULT_CHAT_ID / FEISHU_BOT_OPEN_ID / FEISHU_DRY_RUN=false。
保存上下文只记录“已配置”，不得保存明文密钥。
```

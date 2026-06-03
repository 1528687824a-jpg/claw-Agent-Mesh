# Agent OpenClaw Context Checkpoint

## 2026-06-03 Dark Desktop Panel Sidebar And Guided Onboarding Checkpoint

用户给出新的桌面 UI 方向：

```text
1. 界面参考第一张图：黑色桌面应用风格，功能栏在左侧，类似 VS Code 的深色工作台。
2. 第一次打开应用时，要有演示/引导内容，介绍各区域和按钮功能，并支持“跳过 / 下一步”。
3. 左下角是设置；设置里要有很多功能，包含管理密码、忘记密码密保问题，参考第二张 ClawPanel 登录图。
4. 参考第三张 ClawPanel / Hermes 仪表盘截图，以及 qingchencloud/clawpanel 的 hermes-agent.md，但要结合 Agent OpenClaw 自主决定左侧功能栏。
```

本次参考吸收：

```text
1. 第一张图：深色背景、左侧活动栏、低干扰工具入口。
2. 第二张图：设置/登录安全入口需要有管理密码和密保问题。
3. 第三张图和 hermes-agent.md：ClawPanel / Hermes 的 Gateway、仪表盘、实时聊天、会话、日志、Skills、记忆文件、扩展主题等信息架构可借鉴。
4. Agent OpenClaw 不照搬 ClawPanel；左侧功能按本项目拆成 Dashboard、First Run、Jobs、Agents、Models、Memory、Settings。
```

本次已改：

```text
apps/desktop-app/package.json / package-lock.json：
  - 新增 lucide-react，用于桌面左栏和按钮图标。

apps/desktop-app/src/main.tsx：
  - 顶层 UI 改成黑色桌面工作台。
  - 新增窄活动栏 + 二级左侧导航。
  - 左侧功能包括：
    Dashboard / 仪表盘
    First Run / 首次启动
    Jobs / 任务
    Agents / Agent
    Models / 模型
    Memory / 记忆
    Settings / 设置
  - 新增首次打开 guided tour，本地 localStorage 记录是否完成；支持 Skip / Next / Done。
  - 设置页新增本地安全设置：管理密码、确认密码、密保问题、密保答案。
  - 安全设置使用 salt + SHA-256 hash 存 localStorage，不保存明文密码/答案。
  - 若已设置本地密码，下次新 session 进入 lock screen；忘记密码可用密保问题解锁后进入设置。
  - 保留原有 job 创建、routing mode、任务列表、搜索过滤、时间线、取消任务能力。
  - 保留 smoke 兼容 data-testid：console-view-tab / start-job-button。

apps/desktop-app/src/styles.css：
  - 全面改为深色桌面控制台样式。
  - 左侧栏、仪表盘、任务工作区、首次启动、设置、锁屏、tour overlay 均重写。
```

本次验证：

```text
npm run check                                      passed
npm run check:no-secrets                          passed
npm --prefix apps/desktop-app run build           passed
npm run smoke:desktop-ui-prod -- --skip-api-start passed
  jobId: JOB-20260603-9B980023
  terminalStatus: cancelled
  screenshot: .runtime/desktop-ui-smoke/desktop-ui-prod-smoke.png
npm run smoke:tauri-shell                         passed
git diff --check                                  only CRLF warnings
```

下一步顺序：

```text
1. 用户打开桌面应用，实际检查黑色左侧栏、首次引导、设置页密码/密保入口是否符合预期。
2. 根据用户反馈微调左侧导航名称、顺序、图标和首次引导文案。
3. 把“后端启动 / Docker / API 离线”状态放进桌面 UI 的 Dashboard 或设置里讲清楚，避免用户误解。
4. 完善 Settings：后端地址、启动方式、provider key、本地安全策略、语言都集中到设置页。
5. 做 First Run 到真实 OpenClaw agent 框架的“备份 + 写入”显式流程。
6. 再做 alpha polish：图标、签名、release tag、公开 alpha 说明和 GitHub README。
```

## 2026-06-02 Desktop App Entry Reinstated Checkpoint

用户最新决定：

```text
用户撤回上一轮“改做网页版操作面板”的方向，明确表示：
“还是想做桌面应用来启动操作面板。网页不做了，回退到上一次。”
```

本次处理：

```text
1. 已用非破坏性 git revert 回退上一轮 Web panel pivot 提交：
   - reverted commit: 9381975 Pivot owner tryout to web panel
   - revert commit:   04aceed Revert "Pivot owner tryout to web panel"
2. 代码、README、owner tryout、release checklist、package scripts 已回到上一版桌面应用主入口方向。
3. scripts/start-web-panel.ps1 已删除。
4. npm run tryout:start / tryout:desktop / tryout:shortcut 的语义恢复到上一版桌面体验路径。
```

当前产品方向恢复为：

```text
1. Agent OpenClaw 继续做桌面应用来启动/承载操作面板。
2. Tauri 桌面应用仍是 owner tryout 和本地体验主入口。
3. 网页版操作面板方向暂不做，不作为 alpha P0。
4. 但必须把用户体验讲清楚：桌面应用、后端 API、Docker Desktop/Compose 之间的关系不能让用户困惑。
5. Docker Desktop 不是“面板 UI”本身的依赖；它只是当前后端栈的一种本地启动方式。后续需要在桌面应用里把“后端未启动/正在启动/需要 Docker”的状态解释清楚。
```

本轮后续顺序任务：

```text
1. 用户继续从桌面快捷方式 Agent OpenClaw.lnk 打开桌面应用操作面板。
2. Codex 需要把桌面启动体验文案/状态做清楚：什么时候只是打开面板，什么时候需要启动后端，什么时候会触发 Docker。
3. 继续完善桌面 First Run：配置 key、工作访谈、生成并 review agent prompts。
4. 做“备份 + 写入真实 OpenClaw agent 框架”的显式流程。
5. 再补桌面启动/后端状态相关 smoke，避免黑窗、静默失败、Docker 状态不清楚这些问题回归。
6. 之后再进入 alpha polish：图标、签名、release tag、公开 alpha 说明和 GitHub README。
```

## 2026-06-02 RTK Token-Saving Evaluation Checkpoint

用户询问 `rtk-ai/rtk` 是否可以给 Agent OpenClaw 的工作省 token。

本轮外部资料判断：

```text
1. RTK 的核心不是压缩模型回答，而是过滤/压缩 shell 命令输出，再把更短的输出放进 LLM 上下文。
2. 官方 README 声称常见 dev command 可省 60-90% token；这是按命令输出场景估算，实际节省取决于项目和命令类型。
3. RTK 有 OpenClaw 插件：通过 before_tool_call 拦截 exec tool call，调用 rtk rewrite，把 git status 等命令改成 rtk git status。
4. 本机当前未安装 rtk；`rtk --version` 和 `where.exe rtk` 都失败。
5. RTK 在 Windows 原生环境可手动调用，但自动 rewrite hook 对 Bash/WSL 支持更完整；OpenClaw 插件源码里还使用 `which rtk`，在原生 Windows 上需要验证或改成跨平台检测。
```

Codex 独立判断：

```text
1. 对“我们当前 Codex 开发过程”：有潜在价值，尤其是 git diff、test output、Docker logs、rg/tree 等高噪声命令；但在当前 PowerShell/Codex Desktop 工具链里不会自动生效，最多先手动试用。
2. 对“Agent OpenClaw 产品运行时”：不是直接降低所有 DeepSeek/OpenClaw provider token；只有当 agent 大量调用 exec 并把命令输出塞进上下文时，RTK 才明显省 token。
3. 对产品可借鉴的功能：可以做成可选的“tool output compression / RTK-compatible command rewrite”能力，作为未来差异化；但当前 P0 仍是桌面 First Run 闭环，不能被它打断。
4. 若要引入，必须做 A/B benchmark：同一组 OpenClaw real jobs，在关闭/开启 RTK 后比较 provider token、输出质量、失败可诊断性；不能只信 README 的百分比。
```

后续任务里新增一个非 P0 技术验证项：

```text
在用户走完 First Run、写入流程和 installer 基础完成后，安排 RTK spike：
1. 先在隔离环境安装 rtk。
2. 验证 Windows / Docker / OpenClaw gateway 下插件是否可用。
3. 跑四种 routing mode 或至少 shell-heavy job 的 A/B token benchmark。
4. 只有确认不损失诊断信息，再决定是否作为可选插件或内置输出压缩能力。
```

## 2026-06-02 Context Update Rules And Claude Review Intake Checkpoint

用户新增/重申的硬规则：

```text
1. 每次完成一轮实际工作后，Codex 必须更新上下文/记忆文件；未更新视为未完成。
2. 必须同时更新：
   - C:\Users\Administrator\Documents\Codex\2026-05-18\agent-openclaw\CONTEXT.md
   - C:\Users\Administrator\Desktop\新产品研发\上下文记忆\20260526-103814-agent-openclaw-dbos-m2-routing-modes.md
3. 上下文更新必须写在文件最前面：最新 checkpoint 放在标题后方、旧 checkpoint 之前；不得追加到尾页。
4. 每次 final 回复必须写清楚“之后顺序任务”，按实际执行顺序列出。
5. 用户每次任务开始前可能提供 Claude 对上一轮工作的评价和下一步建议 md 文件；Codex 必须先阅读，吸收有用处，但保留独立判断，不盲信。
6. 这些规则优先于普通工作流；如果上下文更新位置放错，需要主动修正到最前面。
```

本轮已读取 Claude 建议文件：

```text
C:\Users\Administrator\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\20d984a4-bff5-4fee-8d1b-d7cb84f94ea0\9fcc6203-63e1-4bb6-98e5-063de7217ee7\local_f8d6cc4b-0943-4503-a752-3f2db911ddd6\outputs\202825~1.MD
```

可吸收的建议：

```text
1. owner tryout 仍是最高价值输入；用户需要先真实走完桌面 First Run，而不是过早发布 GitHub。
2. installer bundle 仍未产出；当前只有 release exe 可运行，不等于可公开分发安装包。
3. 黑色终端窗口 bug 已修，但应补一个 Windows release smoke 防回归，断言 release exe 不再挂 conhost.exe。
4. Docker smoke 入口应补 docker info / daemon health preflight，避免 Docker Desktop 卡住时继续长时间等待。
5. First Run 生成草稿后，产品闭环还缺“备份 + 写入真实 OpenClaw agent 框架”的显式按钮和确认流程。
6. v0.2 可考虑 experience memory、本地 Ollama 路径、waiting_for_human resume API；这些属于 alpha 之后，不应抢当前 P0。
```

Codex 独立判断：

```text
当前 P0 不是 GitHub release polish，而是让用户能从桌面快捷方式进入真实桌面应用、走完 First Run、看到并评审生成草稿。
installer bundle 和 README polish 可以推进，但不能替代 owner tryout。
写入真实 OpenClaw agent 框架必须是显式、可备份、可回滚的步骤；在用户确认草稿前不得覆盖真实 AGENTS.md。
```

下一步顺序：

```text
1. 用户确认双击 C:\Users\Administrator\Desktop\Agent OpenClaw.lnk 后，只出现桌面面板，不再出现黑色终端窗口。
2. 用户走完桌面 First Run 四段：熟悉界面、配置 provider key、回答工作访谈、生成并检查草稿。
3. 根据用户对草稿和“写入前先检查”清单的反馈，改 First Run 文案/问题/agent prompt 生成逻辑。
4. 实现“备份 + 写入真实 OpenClaw agent 框架”按钮和确认流程，并补 smoke。
5. 补 Windows 黑窗防回归 smoke 和 Docker preflight。
6. 产出 installer bundle；之后再做图标、签名、release tag、公开 alpha 说明和 GitHub README polish。
```

## Standing User Workflow Rule

```text
After each completed task, Codex must:
1. update the relevant context/memory files;
2. tell the user the next several tasks in execution order.

This rule was confirmed by the user on 2026-05-28 and applies to subsequent
work on this project unless the user changes it.
```

## 2026-06-02 Tauri Release Console Window Fix Checkpoint

用户指出：现在双击桌面快捷方式能打开 Agent OpenClaw 面板，但旁边还有一个黑色终端窗口；关闭黑色窗口时，桌面面板也会跟着关闭。

本次诊断结论：

```text
1. 不是快捷方式/VBS launcher 的黑窗；快捷方式已经是 wscript.exe 隐藏 launcher。
2. 进程树显示 agent-openclaw.exe 自己下面挂了 conhost.exe。
3. apps/desktop-app/src-tauri/src/main.rs 缺少 Windows GUI 子系统配置。
4. 因此 release exe 被 Windows 当作控制台程序启动，系统给它分配终端；关闭终端会结束 agent-openclaw.exe，所以面板跟着关。
```

本次修复：

```text
apps/desktop-app/src-tauri/src/main.rs
  - 新增：
    #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
  - 只影响 release 构建；debug 构建仍保留控制台，方便开发日志。
```

本次验证：

```text
npm run check                                            passed
npm run check:no-secrets                                 passed
npm --prefix apps/desktop-app exec tauri build -- --no-bundle
                                                          passed, rebuilt release exe
desktop shortcut launch                                  passed
process tree                                             agent-openclaw.exe childProcesses only msedgewebview2.exe
hasConhostChild                                          false
launcher log                                             API already healthy; Launching desktop app; completed
```

当前本地状态：

```text
桌面快捷方式: C:\Users\Administrator\Desktop\Agent OpenClaw.lnk
release exe: apps/desktop-app/src-tauri/target/release/agent-openclaw.exe 已重建
预期用户体验: 双击快捷方式只出现 Agent OpenClaw 面板，不再出现黑色终端窗口；关闭面板才结束 app。
```

下一步顺序：

```text
1. 用户再次双击桌面 Agent OpenClaw.lnk，确认黑色窗口不再出现。
2. 如果只剩桌面面板，继续在 First Run 里检查“写入前先检查”清单和生成草稿。
3. 用户确认草稿方向后，再做“备份 + 写入真实 OpenClaw agent 框架”；此步骤前不覆盖真实 AGENTS.md。
4. 前两个体验问题都确认后，再继续 alpha polish。
```

## 2026-06-02 Desktop Launcher Silent Failure And First Run Review Gate Checkpoint

用户指出两个问题：

```text
1. 双击桌面 Agent OpenClaw.lnk 后“没有任何反应”。
2. “确认生成内容方向”这个说法太含糊；用户还没有看到草稿，也没有和 Codex 讨论过具体确认什么。
```

本次诊断结论：

```text
1. 快捷方式本身存在，目标仍是 wscript.exe + scripts/launch-desktop-app.vbs。
2. VBS 旧逻辑是隐藏启动 PowerShell 且不等待退出；launcher 失败时用户看不到任何错误，所以体感就是“没反应”。
3. logs/desktop-launcher.log 显示真实失败原因：本地已有 http://localhost:3000/health 正常的 node API 占用 3000，launcher 仍执行 docker compose up -d，dockerized orchestrator-api 抢 3000 失败。
4. 因此这次不是桌面 exe 缺失，也不是 Docker Desktop engine 坏掉，而是 launcher 没有识别“已有健康 API”，并且失败静默。
```

本次修复：

```text
1. scripts/launch-desktop-app.ps1 现在先检查 http://localhost:3000/health；若 API 已健康，直接跳过 Docker Compose 启动并打开桌面应用。
2. launcher 增加全局 mutex：连续多次点击快捷方式时不会并发跑多个 launcher 去抢 Docker/端口。
3. scripts/launch-desktop-app.vbs 改为等待 PowerShell 退出；如果启动失败，会弹出 Agent OpenClaw 提示框，并指向 logs/desktop-launcher.log。
4. docs/owner-tryout.md 展开“确认生成内容方向”的真实含义：这是看到 First Run 草稿后的 review gate，不是事前盲批。
5. apps/desktop-app/src/firstRun.tsx 在生成区新增 Review before writing / 写入前先检查 清单。
6. apps/desktop-app/src/styles.css 增加 reviewChecklist 样式。
```

“确认生成内容方向”以后要说具体，意思是用户看到 First Run 生成草稿后检查：

```text
1. 工作画像是否准确描述真实职业和日常工作。
2. 推荐 routing mode 是否符合期待的 agent 协作方式。
3. 每个 agent 的职责、边界、语气是否合适。
4. 提示词是否太空、太激进，或漏掉关键工具/工作流。
5. 当前 bundle 是否只作为草稿继续修改，还是准备进入“备份 + 写入真实 OpenClaw agent 框架”的后续显式步骤。
```

本次验证：

```text
PowerShell syntax check for launch-desktop-app.ps1       passed
npm run check                                            passed
npm run check:no-secrets                                 passed
npm --prefix apps/desktop-app run build                  passed
npm --prefix apps/desktop-app exec tauri build -- --no-bundle
                                                          passed, rebuilt release exe
desktop shortcut launch                                  passed, opened agent-openclaw.exe
launcher log                                             API already healthy; skipping Docker Compose startup
npm run smoke:desktop-ui-prod -- --skip-api-start        passed, JOB-20260602-75878D51 cancelled
API health                                               http://localhost:3000/health ok
```

当前本地状态：

```text
桌面快捷方式: C:\Users\Administrator\Desktop\Agent OpenClaw.lnk
快捷方式目标: wscript.exe -> scripts/launch-desktop-app.vbs
桌面进程: agent-openclaw.exe 可由快捷方式启动
API: http://localhost:3000/health ok
```

下一步顺序：

```text
1. 用户先双击桌面 Agent OpenClaw.lnk，确认现在能打开桌面应用。
2. 用户在 First Run 里看“写入前先检查”清单，判断生成的职业画像 / routing mode / agent prompts 哪些准确、哪些要改。
3. 只有用户确认草稿方向后，才进入“备份 + 写入真实 OpenClaw agent 框架”；在此之前不覆盖真实 AGENTS.md。
4. 上面两个问题确认后，再回到 alpha polish；图标、installer bundle、签名、release tag、公开 alpha 说明先等待。
```

## 2026-06-02 Docker Backend Port-Kill Fix And Real Four-Mode Pass Checkpoint

用户把最长等待要求从 10 分钟改成 5 分钟；同时确认桌面快捷方式不能再打开 PowerShell 终端窗口，应该打开真正的桌面应用面板。

本次定位到的根因：

```text
1. 旧桌面快捷方式目标是 powershell.exe + scripts/start-desktop-tryout.ps1，会把启动终端放在用户面前；这不是合格的桌面产品入口。
2. Docker Desktop 反复卡在 Starting Docker Engine 的更深层原因，是 scripts/start-dev.ps1 / scripts/stop-dev.ps1 看到 3000 端口被占用就 Stop-Process OwningProcess。
3. 当 docker-compose 的 orchestrator-api 暴露 3000 时，Windows 侧 owning process 往往是 com.docker.backend；旧脚本等于直接杀了 Docker backend。
4. Docker 日志中对应现象是 wsl-bootstrap 持续尝试关闭 previous bootstrap，最后 timeout waiting for previous bootstrap process / waiting for shutdown: context deadline exceeded。
5. 结论：这次不是 provider 或 OpenClaw job 卡住，而是本地脚本误杀 Docker backend 后，Docker Desktop/WSL engine 陷入半启动状态。
```

本次修复：

```text
1. scripts/create-desktop-shortcut.ps1 改为创建 wscript.exe 快捷方式，指向隐藏 VBS launcher：
   scripts/launch-desktop-app.vbs
2. 新增 scripts/launch-desktop-app.ps1：隐藏启动后端 compose stack，等待 http://localhost:3000/health，然后启动 release exe：
   apps/desktop-app/src-tauri/target/release/agent-openclaw.exe
3. launcher 日志写入：
   logs/desktop-launcher.log
4. start-dev / stop-dev / launcher 的 docker info、compose、inspect 调用改为带硬超时的 .NET ProcessStartInfo wrapper，避免 Docker CLI 无限挂住。
5. start-dev / stop-dev 增加 Stop-NonDockerPortListeners：端口清理永远跳过 Docker/WSL 进程，不再 Stop-Process com.docker.backend。
6. start-dev 会先用 compose stop/rm orchestrator-api dbos-worker 释放旧容器占用的 3000，再启动 Postgres 和本地 real-mode API。
7. stop-dev 对 docker compose down 失败只 warning，不再因此中断本地进程清理。
8. scripts/smoke-openclaw-real.ps1 默认 JobTimeoutSeconds 改为 300 秒；REST poll 加 5 秒请求 timeout；npm run dev:stop/dev:start 失败会立刻 throw，不再继续 POST job。
9. README.md / docs/owner-tryout.md 已说明桌面快捷方式为隐藏 launcher，不应再把 PowerShell 窗口放到产品前面。
```

本次验证：

```text
PowerShell syntax check for start-dev / stop-dev / launch-desktop-app / smoke-openclaw-real   passed
npm run dev:stop && npm run dev:start && GET http://localhost:3000/health                     passed
desktop shortcut target check                                                                  passed, target=wscript.exe
desktop launcher path check                                                                    passed, opened agent-openclaw.exe with title Agent OpenClaw
npm run check                                                                                  passed
npm run check:no-secrets                                                                       passed
```

OpenClaw real mode 四种 routing mode 端到端验证已逐个通过，均使用 300 秒 job timeout：

```text
OpenClaw version: OpenClaw 2026.5.7 (eeef486)

supervisor_pipeline        JOB-20260602-B3B04879  succeeded  realCompletionEvents=2  stageOutputArtifacts=1
pipeline                   JOB-20260602-21B6703E  succeeded  realCompletionEvents=2  stageOutputArtifacts=1
classic_master_slave       JOB-20260602-DFF28943  succeeded  realCompletionEvents=1  stageOutputArtifacts=1
master_slave_discussion    JOB-20260602-C6A6D84C  succeeded  realCompletionEvents=4  stageOutputArtifacts=2
```

当前本地状态：

```text
Docker Engine: docker info 可返回
API: http://localhost:3000/health ok
桌面快捷方式: C:\Users\Administrator\Desktop\Agent OpenClaw.lnk
```

下一步顺序：

```text
1. 用户先从桌面双击 Agent OpenClaw.lnk 体验真实桌面 First Run：熟悉界面、配置 key、完成工作访谈、检查生成的 agent prompts。
2. 用户确认 First Run 生成方向后，再做“备份 + 写入真实 OpenClaw agent 框架”的显式步骤；不要在用户未确认前覆盖真实 AGENTS.md。
3. 进入 alpha polish：图标质量、installer bundle、签名、release tag、首个公开 alpha 说明。
4. GitHub README/介绍页再参考 supermemory、skills 等高星项目的介绍逻辑；同时评估 supermemory 对本产品长期记忆/用户工作画像能力的可借鉴点。
```

## 2026-06-02 Desktop Shortcut And Real Smoke Blocker Checkpoint

用户指出桌面应用体验仍缺少“桌面图标/从哪里打开”的用户入口。已补齐：

```text
1. 已在 Windows 桌面创建快捷方式：
   C:\Users\Administrator\Desktop\Agent OpenClaw.lnk
2. 快捷方式目标：
   powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -File scripts/start-desktop-tryout.ps1
3. 新增 repo 脚本：
   scripts/create-desktop-shortcut.ps1
4. 新增 npm script：
   npm run tryout:shortcut
5. README 和 docs/owner-tryout.md 已写明：可先创建桌面图标，然后双击启动本地后端 + Tauri 桌面应用。
```

同时改进真实 OpenClaw smoke：

```text
1. scripts/smoke-openclaw-real.ps1 已从单一 classic_master_slave 改为默认验证四种 routing mode：
   supervisor_pipeline / pipeline / classic_master_slave / master_slave_discussion
2. 新增参数：
   -Modes <mode...>
   -JobTimeoutSeconds <seconds>
3. 每个 mode 会逐步输出：Starting / Created job / Completed job。
4. 每个 mode 检查：job succeeded、routingMode 正确、有 tool.openclaw_agent_completed 且 payload.mode=real、有 stage_output artifact。
```

本次验证与阻塞：

```text
npm run tryout:shortcut                                  passed, created desktop shortcut
PowerShell syntax check for create-desktop-shortcut.ps1   passed
PowerShell syntax check for smoke-openclaw-real.ps1       passed
npm run check                                            passed
npm run check:no-secrets                                 passed
npm run smoke:openclaw-real                              attempted, but timed out after 30 minutes
```

真实 smoke 未完成，不可记为通过。超时后发现：

```text
1. smoke-openclaw-real / start-dev 有残留进程，已停止。
2. stale .runtime/locks/dev-stack.lock 已删除。
3. WSL 中未发现一次性 openclaw agent 调用残留，只剩 OpenClaw gateway/node 常驻服务。
4. Docker Desktop daemon 状态异常：docker info 对 Linux engine API 持续 timeout/500。
5. Postgres 5432 未监听，db:migrate ECONNREFUSED。
6. 已尝试 Start-Service com.docker.service、重启 Docker Desktop 进程、wsl --shutdown 后重启 Docker，仍未恢复 docker info。
7. 当前阻塞是 Docker Desktop daemon/engine，没有可靠本地 Postgres/API，因此不能继续真实四模式验证。
```

恢复后下一步：

```text
1. 先让 Docker Desktop 恢复到 docker info 正常、docker compose ps 正常。
2. 运行 npm run tryout:desktop 或双击桌面 Agent OpenClaw.lnk，确认产品入口可打开。
3. 重新跑 OpenClaw real mode 验证。建议先逐个 mode 跑，定位更清楚：
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-openclaw-real.ps1 -Modes supervisor_pipeline
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-openclaw-real.ps1 -Modes pipeline
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-openclaw-real.ps1 -Modes classic_master_slave
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-openclaw-real.ps1 -Modes master_slave_discussion
4. 四个 mode 都通过后，再进入 alpha polish：图标质量、installer bundle、签名、release tag、公开 alpha 说明。
```

## 2026-06-02 Desktop First Run Checkpoint

用户纠正并确认：OpenClaw real mode 四种 routing mode 端到端验证是“之后顺序任务”，不是桌面首次引导流程的一部分。桌面应用打开后应先让用户熟悉界面，再配置 provider key，之后按预设工作问题提问，生成用户职业/日常工作的画像，并据此生成可写入 agent 框架的个性化提示词。

本次完成：

```text
1. apps/desktop-app 新增 First Run 视图，默认入口为首次启动，不再先进入纯控制台。
2. 顶部新增 First Run / Console 切换；语言切换继续支持 English / 中文。
3. First Run 包含四段：界面熟悉、provider key、工作访谈、生成 agent prompts。
4. provider 默认 DeepSeek / https://api.deepseek.com / deepseek-v4-pro。
5. API key 只留在当前页面内存；生成文件只记录 apiKeyConfigured=true，不写明文 key。
6. 生成安全 desktop setup bundle：first-run-profile.json、cluster.config.json、agents/<id>/AGENTS.md。
7. Tauri 后端新增 save_first_run_setup command，把 bundle 写到 app data 的 desktop-first-run 目录。
8. 根脚本新增 npm run tryout:desktop，优先打开 Tauri 桌面应用；npm run tryout:start 仅作为浏览器 dev fallback。
9. scripts/start-desktop-tryout.ps1 会清理旧 browser-dev Vite 进程，避免 5173 被占用导致 tauri dev 启动失败。
10. API 默认 CORS 增加 5174 本地生产预览 origin，保留 tauri://localhost。
11. smoke-desktop-ui 加固：禁用 Edge 扩展 background page 干扰，显式导航到目标 URL，并在默认 First Run 后切到 Console 执行原控制台 smoke。
12. README、apps/desktop-app/README.md、docs/owner-tryout.md 已改为桌面应用优先体验路径。
```

本次验证：

```text
npm run check                                            passed
npm run check:no-secrets                                 passed
npm --prefix apps/desktop-app run build                  passed
npm run smoke:desktop-ui -- --skip-api-start             passed, JOB-20260602-47932C28 cancelled
npm run smoke:tauri-shell                                passed
cargo check (apps/desktop-app/src-tauri)                 passed
npm run smoke:desktop-ui-prod -- --skip-api-start        passed, JOB-20260602-0D282EB4 cancelled
npm --prefix apps/desktop-app exec tauri build -- --no-bundle
                                                          passed, built target/release/agent-openclaw.exe
```

视觉验证截图：

```text
.runtime/desktop-ui-smoke/first-run-desktop.png
.runtime/desktop-ui-smoke/first-run-narrow.png
```

注意：

```text
完整 npm --prefix apps/desktop-app run tauri:build 超过 424 秒工具超时；
release exe 已生成，但 installer bundle 目录未生成产物。
因此当前已验证桌面应用 release 编译，不把 installer packaging 视为已完成。
```

当前本地栈状态：

```text
Docker Compose: postgres / orchestrator-api / dbos-worker healthy
API: http://localhost:3000/health ok
```

下一步顺序：

```text
1. 先让用户从 npm run tryout:desktop 体验桌面 First Run：配置 key、回答工作访谈、检查生成的画像和 agent prompts。
2. 用户确认生成内容方向后，再做“备份 + 写入真实 OpenClaw agent 框架”的显式步骤；不要在未确认前覆盖真实 AGENTS.md。
3. 继续之前的顺序任务：在明确真实 provider 调用费用授权下，跑 OpenClaw real mode 四种 routing mode 端到端验证。
4. 进入 alpha polish：图标、签名/installer bundle、release tag、首个公开 alpha 说明。
```

## 2026-06-02 GitHub README And Language Toggle Checkpoint

User gave two GitHub README references:

```text
https://github.com/supermemoryai/supermemory
https://github.com/mattpocock/skills
```

User instruction:

```text
Improve the GitHub introduction page by learning from high-star project README
logic, but do not blindly copy. Also evaluate whether supermemory has product
ideas Agent OpenClaw should absorb. Desktop UI should support two languages for
now: English and Chinese.
```

Codex judgment:

```text
Useful from supermemory: split the audience path clearly (end-user/product use
vs developer/API use) and treat memory/context as a core product layer, not a
miscellaneous log.

Useful from mattpocock/skills: start from the problem and failure mode, then
explain the project's operating model.

Product correction: do not rush directly from "alpha gates complete" to GitHub
release. The maintainer must be able to experience the product locally first.
```

Implementation:

```text
README.md:
  - clarified repository name vs product name;
  - added "Why This Exists" problem framing;
  - added "Choose Your Path" with owner tryout, quickstart, M3 config, and
    future memory paths;
  - linked docs/experience-memory.md.

docs/experience-memory.md:
  - documented the long-term "experience memory" direction;
  - connected existing job timeline/artifacts/test reviews/final summaries and
    historical experience files to future memory retrieval;
  - kept it explicitly out of the v0.1.0-alpha blocker list.

apps/desktop-app/src/main.tsx:
  - added English / 中文 language switch in the top bar;
  - language choice persists to localStorage;
  - direct URLs support ?lang=en and ?lang=zh;
  - translated core visible UI labels, filters, status labels, source labels,
    empty states, and buttons;
  - routing mode identifiers remain unchanged to preserve API semantics.

apps/desktop-app/src/styles.css:
  - added stable segmented-control styling for the language switch.

scripts/smoke-desktop-ui.ts:
  - made the smoke choose English explicitly before running;
  - changed Start Job lookup to a stable data-testid selector so smoke does not
    depend on English text.

docs/owner-tryout.md:
  - documented supported languages and direct ?lang=en / ?lang=zh URLs.
```

Verification:

```text
npm run check -> passed
npm run check:no-secrets -> passed

$env:DESKTOP_UI_SMOKE_PORT='5173'
npm run smoke:desktop-ui -- --skip-api-start -> passed
  jobId=JOB-20260602-61436A5C
  terminalStatus=cancelled
  timelineCursorRequests=5
  timelineItems=76
  screenshotPath=.runtime/desktop-ui-smoke/desktop-ui-dev-smoke.png

Chinese screenshot check:
  http://127.0.0.1:5173/?lang=zh
  screenshot=.runtime/desktop-ui-smoke/desktop-ui-zh-url.png
  visual check passed: Chinese labels render and layout remains stable.
```

Operational note:

```text
The owner tryout stack is still intentionally running for the user at:
  http://127.0.0.1:5173

Chinese direct URL:
  http://127.0.0.1:5173/?lang=zh

Stop with:
  npm run tryout:stop
```

Current next ordered tasks:

```text
1. Commit and push README/product-memory/language-toggle work.
2. User manually tries English and Chinese desktop flows.
3. Fix owner-experience friction found during manual tryout.
4. Then prepare v0.1.0-alpha release notes/tag/assets.
5. Later with explicit authorization: OpenClaw real-mode validation across all
   four routing modes.
```

## 2026-06-02 Owner Tryout Path Checkpoint

User clarified an important product sequencing rule:

```text
The product should first be experienced by the maintainer locally. Do not treat
"alpha gates complete" as "immediately publish to GitHub."
```

Codex read Claude's latest progress review from:

```text
C:\Users\Administrator\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\20d984a4-bff5-4fee-8d1b-d7cb84f94ea0\9fcc6203-63e1-4bb6-98e5-063de7217ee7\local_f8d6cc4b-0943-4503-a752-3f2db911ddd6\outputs\2082B4~1.MD
```

Judgment:

```text
Useful: alpha gates are complete; release notes/tag are now reachable.
Rejected as next step: immediately cutting v0.1.0-alpha before the maintainer
can sit down and try the product loop.
New priority: owner local tryout before public release.
```

Implementation:

```text
Added scripts/start-owner-tryout.ps1
Added scripts/stop-owner-tryout.ps1
Added docs/owner-tryout.md
Added package scripts:
  npm run tryout:start
  npm run tryout:stop
Updated README.md with an Owner Tryout section.
Updated docs/release-checklist.md with a Public Release Readiness section that
requires local maintainer tryout before cutting v0.1.0-alpha.
```

Owner tryout behavior:

```text
npm run tryout:start
  starts Docker Compose HTTP-only mock stack:
    postgres
    orchestrator-api on http://localhost:3000
    dbos-worker
  starts desktop web console on http://127.0.0.1:5173 or next free port
  opens the desktop console unless -NoOpen is passed
  records state in .runtime/owner-tryout.json
  writes desktop log to logs/owner-tryout-desktop.log

npm run tryout:stop
  stops the desktop dev server
  runs docker compose down --remove-orphans
  keeps Docker volumes for later inspection
```

Verification:

```text
npm run tryout:start -- -NoOpen -> passed
  Desktop UI: http://127.0.0.1:5173
  API:        http://localhost:3000

$env:DESKTOP_UI_SMOKE_PORT='5173'
npm run smoke:desktop-ui -- --skip-api-start -> passed
  jobId=JOB-20260602-41970DBA
  terminalStatus=cancelled
  cancelAttempted=true
  filteredJobVisible=true
  timeFilterVisible=true
  customSinceVisible=true
  timelineCursorRequests=5
  timelineItems=53
  screenshotPath=.runtime/desktop-ui-smoke/desktop-ui-dev-smoke.png

npm run check -> passed
npm run check:no-secrets -> passed
```

Operational note:

```text
The owner tryout stack was intentionally left running so the user can open and
experience the UI immediately. Stop it with npm run tryout:stop.
```

Current next ordered tasks:

```text
1. Commit and push the owner tryout path.
2. User manually tries the running desktop console at http://127.0.0.1:5173.
3. Fix any owner-experience friction found during that tryout.
4. Then prepare v0.1.0-alpha release notes/tag/assets.
5. Later with explicit authorization: OpenClaw real-mode validation across all
   four routing modes.
```

## 2026-06-02 Workflow Rule Reconfirmation Checkpoint

User reconfirmed the standing workflow rule and made it more explicit:

```text
After every work session / final response, Codex must tell the user the next
tasks in execution order.

After every completed work item, Codex must update both context files in the
same checkpoint style used by the existing history:
  C:\Users\Administrator\Documents\Codex\2026-05-18\agent-openclaw\CONTEXT.md
  C:\Users\Administrator\Desktop\新产品研发\上下文记忆\20260526-103814-agent-openclaw-dbos-m2-routing-modes.md
```

The prior completed work from this session has already been recorded in both
files:

```text
2026-06-02 M3 Real Provider Smoke Checkpoint
  npm run smoke:m3-real-planner -> passed
  npm run smoke:m3-real-provider -> passed
  provider=DeepSeek via openai-compatible planner
  model=deepseek-v4-pro
  jobId=JOB-20260602-A219930D
  terminalStatus=succeeded
```

Current next ordered tasks:

```text
1. Commit and push this workflow-rule reconfirmation checkpoint.
2. Alpha release polish: repository/product naming note, app icon/signing
   decision, release notes, and v0.1.0-alpha tag preparation.
3. Optional CI hardening: pin Windows runner and/or add macOS/Linux Tauri probe
   smoke jobs.
4. Later with explicit authorization: OpenClaw real-mode validation across all
   four routing modes.
```

## 2026-06-02 M3 Real Provider Smoke Checkpoint

User asked where real-provider authorization happens. Codex clarified:

```text
.env holds local provider configuration only; it is not permission to spend
provider quota. Explicit operator authorization happens in the conversation.
```

User then explicitly authorized one M3 real-provider smoke. Local `.env` was
checked without printing secrets. It contained DeepSeek OpenAI-compatible
configuration and an API key. Codex updated only `M3_PLANNER_MODEL` from the
previous local value to the user's requested `deepseek-v4-pro`; the key was not
printed or committed.

Preflight:

```text
npm run smoke:m3-real-planner -> passed
  clusterId=real-planner-smoke-generated
  stageAgents=research-agent, writer-agent, video-agent
```

Authorized real-provider smoke:

```text
npm run smoke:m3-real-provider -> passed
  provider=DeepSeek via openai-compatible planner
  model=deepseek-v4-pro
  clusterId=content-studio-demo
  jobId=JOB-20260602-A219930D
  terminalStatus=succeeded
  stageAgents=research-agent, writer-agent, image-agent
  checked=real_planner_provider_call,
          generated_cluster_config_validation,
          load_cluster_config_in_dbos_step,
          run_demo_job_succeeded
```

Generated runtime artifacts stayed local under:

```text
.runtime/m3-real-provider-e2e/
```

Cleanup:

```text
npm run dev:stop -> completed; local API/worker/Postgres dev services stopped
```

Release checklist was updated: M3 real-provider smoke is now done with explicit
operator authorization, and Git remote + hosted CI is also marked done. This
means all listed alpha gates now have proof. Next ordered tasks:

```text
1. Commit this checkpoint and release-checklist update.
2. Alpha release polish: repository/product naming note, app icon/signing
   decision, release notes, and v0.1.0-alpha tag preparation.
3. Optional CI hardening: pin Windows runner and/or add macOS/Linux Tauri probe
   smoke jobs.
4. Later with explicit authorization: OpenClaw real-mode validation across all
   four routing modes.
```

## 2026-06-01 Desktop Full Handoff Checkpoint

User requested a detailed, standalone context handoff for opening a new Codex
conversation.

Saved file:

```text
C:\Users\Administrator\Desktop\Agent-OpenClaw-完整上下文交接-20260601.md
```

Contents:

```text
- restore prompt for a new Codex conversation;
- product goal and direction guardrails;
- user workflow preferences;
- key architecture concepts and routing-mode explanation;
- important local context paths;
- completed work across Feishu direction cleanup, Docker quickstart, README /
  QUICKSTART, demo jobs, desktop/Tauri, release checklist, GitHub remote, and
  hosted CI;
- current git state and latest commits;
- remaining ordered tasks;
- note that paid provider/OpenClaw real checks require explicit operator
  authorization;
- answer to the user's question about viewing other Codex conversations.
```

Codex thread-access note:

```text
In the current tool context, Codex does not have an exposed read_thread /
list_threads tool for arbitrary previous Codex conversations. Tool discovery
only exposed multi-agent child-agent management tools, not cross-thread
history readers. Therefore the reliable handoff path remains local context
files unless a future session exposes thread-reading tools.
```

Next ordered tasks:

```text
1. In a new Codex conversation, read the desktop handoff file first if
   continuing from scratch.
2. Remaining alpha gate A: operator explicitly authorizes real provider spend,
   configures M3 env, then run npm run smoke:m3-real-provider.
3. Later with explicit authorization: OpenClaw real-mode validation across all
   four routing modes.
4. Optional polish after gates: app icon/signing/release tag notes and first
   public alpha release preparation.
```

## 2026-06-01 Final Hosted CI Confirmation Checkpoint

Final observed state after the GitHub remote/CI work:

```text
Commit 71a49c4 Record hosted CI success:
  run URL: https://github.com/1528687824a-jpg/claw-Agent-Mesh/actions/runs/26766148326
  status: success

Jobs:
  Node and smoke checks: success
  Docker quickstart: success
    Desktop UI production smoke: success
```

Operational note:

```text
This checkpoint itself is intended to be committed with [skip ci], because it is
only recording the final CI confirmation. Without skipping CI, every final
context update would create another workflow run and an infinite bookkeeping
loop.
```

Next ordered tasks:

```text
1. Remaining alpha gate A: operator explicitly authorizes real provider spend,
   configures M3 env, then run npm run smoke:m3-real-provider.
2. Later with explicit authorization: OpenClaw real-mode validation across all
   four routing modes.
3. Optional polish after gates: app icon/signing/release tag notes and first
   public alpha release preparation.
4. v1.1/backlog: waiting_for_human resume API.
```

## 2026-06-01 GitHub CI Desktop Smoke Fix Checkpoint

Observed hosted CI state after pushing GitHub remote setup:

```text
Run #1, commit 5beef51 Merge GitHub repository bootstrap:
  success

Run #2, commit 21a3cbe Opt GitHub Actions into Node 24 runtime:
  failure

Run #3, commit 38d3f75 Record GitHub remote and CI status:
  failure

Run #4, commit 3b42422 Stabilize desktop UI smoke in CI:
  failure

Common failure location:
  Docker quickstart -> Desktop UI production smoke

Already-green in failed run #4:
  Start HTTP-only stack
  Smoke HTTP job
```

Fix:

```text
Updated scripts/smoke-desktop-ui.ts:
  - Linux / CI browser launch now includes --no-sandbox and
    --disable-dev-shm-usage.
  - Browser candidates now include google-chrome-stable.
  - CDP send() now accepts a per-command timeout.
  - Runtime.evaluate for the long browser UI flow now gets 125000ms instead of
    the default 20000ms.
  - The UI flow now waits until Start Job is enabled before clicking it.
  - The UI flow now treats both cancelled and succeeded as healthy terminal
    statuses. It still attempts cancellation when the button is enabled, but it
    no longer fails if the mock worker wins the race and finishes first.

Reason:
  The UI flow itself allows up to 120 seconds, but the Chrome DevTools Protocol
  wrapper previously timed out Runtime.evaluate after 20 seconds. On slower
  hosted runners this can fail even when the browser UI flow is still healthy.
  The CI/Linux browser flags also make the smoke more reliable on GitHub
  ubuntu-latest. The hosted Docker job then exposed a second race: the desktop
  smoke assumed the job would remain cancellable, but fast mock workers can
  reach succeeded before the Cancel click is observed.
```

Local validation:

```text
docker compose up -d --build -> passed
$env:DESKTOP_UI_SMOKE_PORT='5173';
  npm run smoke:desktop-ui-prod -- --skip-api-start -> first rerun exposed the
  20s CDP timeout; next rerun exposed the Start Job enabled-state race; final
  rerun after both fixes passed
    jobId=JOB-20260601-74DFB1AA
    terminalStatus=cancelled
    cancelAttempted=true
    filteredJobVisible=true
    timeFilterVisible=true
    customSinceVisible=true
    timelineCursorRequests=5
    timelineItems=54
npm run check -> passed
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
docker compose down -v -> completed
```

Hosted validation:

```text
Run #5, commit d04c892 Harden desktop UI smoke lifecycle races:
  status: success
  run URL: https://github.com/1528687824a-jpg/claw-Agent-Mesh/actions/runs/26765957390
  total duration: 1m 20s

Jobs:
  Node and smoke checks: 49s
  Docker quickstart: 1m 15s

Warnings / notices:
  - actions/checkout@v4 and actions/setup-node@v4 still target Node.js 20
    internally, but FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true forces Node 24.
  - windows-latest redirect notice says windows-latest requests are being
    redirected to windows-2025-vs2026 by 2026-06-15.
```

Next ordered tasks:

```text
1. Commit and push this CI-success context update.
2. Confirm the resulting context-only GitHub Actions run does not introduce a
   new failure.
3. Remaining alpha gate A is M3 real provider smoke, which
   still requires explicit operator authorization because it can spend quota.
4. Later with explicit authorization: OpenClaw real-mode validation across all
   four routing modes.
5. Optional polish after gates: app icon/signing/release tag notes.
```

## 2026-06-01 GitHub Remote And CI Checkpoint

GitHub remote setup:

```text
User provided remote:
  https://github.com/1528687824a-jpg/claw-Agent-Mesh.git

Local branch:
  main

Remote:
  origin -> https://github.com/1528687824a-jpg/claw-Agent-Mesh.git
```

Important merge detail:

```text
The GitHub repository was not empty. It already had initial commit e6ee159
with .gitattributes and a short README.md.

Codex did not force-push over the remote. Instead it merged the GitHub
bootstrap commit into local history with --allow-unrelated-histories, resolved
README.md by keeping the full local open-source README, accepted .gitattributes,
and pushed main normally.
```

Pushed commits:

```text
5beef51 Merge GitHub repository bootstrap
21a3cbe Opt GitHub Actions into Node 24 runtime
```

CI status observed:

```text
First hosted GitHub Actions run observed green:
  https://github.com/1528687824a-jpg/claw-Agent-Mesh/actions/runs/26763549144

Jobs observed green:
  Docker quickstart
  Node and smoke checks

GitHub Actions warned that checkout/setup-node were still running on Node 20
internally and that Node 24 becomes the default on 2026-06-16. Commit 21a3cbe
added FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true to .github/workflows/ci.yml and
was pushed.

Do not overclaim the latest CI state after 21a3cbe unless rechecked. The
Actions page / network was stale or intermittently unreachable during the
follow-up verification attempt.
```

Direction note:

```text
This completed the remote/hosted-CI alpha gate enough to prove the repository
is publishable and CI-capable. It does not change the product direction: the
main goal remains an open-source, downloadable multi-agent orchestration
platform for OpenClaw. tomorrow123.art / Feishu public ingress remains optional
self-hosting reference work, not the main milestone.
```

Next ordered tasks:

```text
1. Recheck the latest GitHub Actions run for the current main HEAD after this
   context-update commit is pushed.
2. Remaining alpha gate A: operator explicitly authorizes real provider spend,
   configures M3 env, then run npm run smoke:m3-real-provider.
3. Later with explicit authorization: run OpenClaw real-mode validation across
   all four routing modes.
4. Optional polish after gates: improve placeholder app icon, add signing /
   release tag notes, and prepare a first public alpha release.
5. v1.1/backlog: waiting_for_human resume API.
```

## 2026-06-01 Public Ingress Direction Cleanup Checkpoint

Direction decision:

```text
Claude's direction-drift audit was mostly right: the project should stop
spending alpha energy on deeper internal hardening and should pivot to the
external door / first-run experience.

Accepted:
  - m2 recovery nightly CI is cut from the alpha path for now.
  - waiting_for_human resume/accept/retry API is deferred to v1.1.
  - tomorrow123.art must not remain a default product fact in the repo.

Codex judgment:
  Do not delete every public-ingress helper. Keep generic Feishu public HTTPS
  ingress as an optional self-hosting reference because real users may deploy
  Feishu with their own domain/tunnel. Remove the author-specific domain/IP and
  default URL instead.
```

Changes:

```text
Deleted/replaced docs/feishu-public-ingress.md with:
  docs/reference-feishu-public-ingress.md

Renamed:
  config/public-ingress/nginx/tomorrow123.art.conf.example
  -> config/public-ingress/nginx/feishu-webhook.conf.example

Updated scripts:
  scripts/prepare-public-ingress-bundle.ps1 now requires FEISHU_PUBLIC_DOMAIN.
  scripts/smoke-public-feishu-webhook.ps1 now requires FEISHU_PUBLIC_WEBHOOK_URL.
  Neither script defaults to the author's domain.

Updated docs:
  README.md, SETUP.md, CONTRIBUTING.md now describe Feishu public ingress as an
  optional self-hosting reference path, not a quickstart or product gate.

Updated desktop app identifier:
  apps/desktop-app/src-tauri/tauri.conf.json now uses io.agentopenclaw.desktop.
  scripts/smoke-tauri-shell.ps1 was updated to match.
```

Validation:

```text
npm run check -> passed
npm run check:no-secrets -> passed
npm run smoke:tauri-shell -> passed
  rustToolchain=available
  buildRunnable=true
$env:FEISHU_PUBLIC_DOMAIN='example.com'; npm run prepare:public-ingress -> passed
  generated .runtime/public-ingress/vps/nginx/example.com.conf
rg tomorrow123 / 49.232.90.172 over README/SETUP/docs/config/scripts/apps -> no results
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. User-side alpha gate A: configure M3 real provider env and run
   npm run smoke:m3-real-provider.
2. User-side alpha gate B: configure git remote, push a branch, and watch
   GitHub Actions to green.
3. Current Codex-side product task: rewrite README for first-time users
   (what this is, docker compose + curl, four routing modes, UI screenshot).
4. Walk new-user onboarding from a clean environment and produce QUICKSTART.md.
5. Add examples/demo-jobs/ templates for each routing mode.
6. Move desktop UI timeline consumption to cursor and add since/until filters.
7. Later/v1.1: waiting_for_human resume API. Do not revive m2 nightly CI as an
   alpha blocker.
```

## 2026-06-01 README First-Run Rewrite Checkpoint

README was rewritten from an engineering-note shape into a first-time-user
entry page.

Changes:

```text
Updated README.md:
  - first screen now explains what Agent OpenClaw is, who it is for, and why it
    differs from brittle bot scripts or opaque hosted workflow tools;
  - Docker Compose quickstart is now the primary path;
  - added pasteable PowerShell job creation, polling, messages, and timeline
    commands;
  - added an equivalent one-line curl POST /jobs example;
  - added expected POST /jobs response shape;
  - added a routing-mode decision table for supervisor_pipeline, pipeline,
    classic_master_slave, and master_slave_discussion;
  - added current capability/status summary;
  - demoted optional/advanced smokes out of the main check list.

Added docs/assets/desktop-ui-mvp.png:
  - copied from the verified production desktop UI smoke screenshot.
```

Validation:

```text
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
npm run smoke:docker-compose -> passed
  jobId=JOB-20260601-0A0786E2
  terminalStatus=succeeded
  ingressOrigin=http
  messageCount=4
  persistenceCheck=passed
  checked=compose_up_build,http_create_job,poll_succeeded,get_messages,compose_restart_persistence
```

Next ordered tasks:

```text
1. User-side alpha gate A: configure M3 real provider env and run
   npm run smoke:m3-real-provider.
2. User-side alpha gate B: configure git remote, push a branch, and watch
   GitHub Actions to green.
3. Current Codex-side product task: walk the new-user onboarding path and
   produce QUICKSTART.md.
4. Add examples/demo-jobs/ templates for each routing mode.
5. Move desktop UI timeline consumption to cursor and add since/until filters.
6. Later/v1.1: waiting_for_human resume API. m2 nightly CI remains off the
   alpha path.
```

## 2026-06-01 Clean Onboarding QUICKSTART Checkpoint

The new-user onboarding path was walked from a clean archive copy and captured
as `QUICKSTART.md`.

Clean-copy method:

```text
Created .runtime/onboarding-clean from git archive HEAD.
No .env, no .runtime state, and no node_modules were present in the clean copy.
Ran docker compose with project name agent-openclaw-onboarding.
```

Changes:

```text
Added QUICKSTART.md:
  - prerequisites;
  - docker compose up --build;
  - PowerShell and bash/curl POST /jobs examples;
  - polling loop;
  - messages and timeline inspection;
  - stop/reset commands;
  - routing-mode summary;
  - optional desktop console path;
  - troubleshooting;
  - verified clean-copy result.

Updated README.md:
  - Read next now includes QUICKSTART.md.
```

Validation:

```text
Clean archive onboarding run -> passed
  jobId=JOB-20260601-820940DC
  createStatus=queued
  terminalStatus=succeeded
  ingressOrigin=http
  messageCount=4
  timelineItems=86
  checked=git_archive_clean_copy,docker_compose_up_build,health,post_jobs,poll_terminal,get_messages,get_timeline

npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. User-side alpha gate A: configure M3 real provider env and run
   npm run smoke:m3-real-provider.
2. User-side alpha gate B: configure git remote, push a branch, and watch
   GitHub Actions to green.
3. Current Codex-side product task: add examples/demo-jobs/ templates for each
   routing mode.
4. Move desktop UI timeline consumption to cursor and add since/until filters.
5. Later/v1.1: waiting_for_human resume API. m2 nightly CI remains off the
   alpha path.
```

## 2026-06-01 Demo Job Templates Checkpoint

Added ready-to-post demo job bodies for all four routing modes.

Changes:

```text
Added examples/demo-jobs/supervisor-pipeline.json
Added examples/demo-jobs/pipeline.json
Added examples/demo-jobs/classic-master-slave.json
Added examples/demo-jobs/master-slave-discussion.json
Added examples/demo-jobs/README.md with bash/curl and PowerShell usage.

Updated README.md and QUICKSTART.md to point first-time users at
examples/demo-jobs/.
```

Validation:

```text
Started local mock API with:
  FEISHU_ADAPTER_ENABLED=false
  FEISHU_DRY_RUN=true
  OPENCLAW_AGENT_MODE=mock

Posted each JSON file to POST /jobs, polled terminal status, then read messages
and timeline:
  supervisor-pipeline.json        JOB-20260601-B2364DD6 succeeded messages=6 timelineItems=126
  pipeline.json                   JOB-20260601-73B1C593 succeeded messages=4 timelineItems=85
  classic-master-slave.json       JOB-20260601-C85214DB succeeded messages=4 timelineItems=85
  master-slave-discussion.json    JOB-20260601-CB8BE334 succeeded messages=5 timelineItems=122

npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. User-side alpha gate A: configure M3 real provider env and run
   npm run smoke:m3-real-provider.
2. User-side alpha gate B: configure git remote, push a branch, and watch
   GitHub Actions to green.
3. Current Codex-side product task: move desktop UI timeline consumption to
   cursor and add since/until filters.
4. Later/v1.1: waiting_for_human resume API. m2 nightly CI remains off the
   alpha path.
```

## 2026-06-01 Desktop Timeline Cursor And Time Filters Checkpoint

Desktop UI now uses the backend timeline cursor path and exposes job-created
time-window filters.

Changes:

```text
Updated apps/desktop-app/src/main.tsx:
  - added job time filters: All Time, 24h, 7d, Custom;
  - Custom exposes since/until datetime-local inputs;
  - listJobs calls now pass since/until when a time window is active;
  - same-job timeline refreshes now pass summary.nextCursor;
  - returned cursor-page items are appended to existing timeline items.

Updated apps/desktop-app/src/styles.css:
  - added stable custom since/until filter layout.

Updated scripts/smoke-desktop-ui.ts:
  - verifies status + prompt + time-window filters;
  - patches browser fetch during smoke and asserts timeline requests include
    cursor=;
  - returns timelineCursorRequests in the smoke result.

Updated SETUP.md:
  - desktop Jobs pane now documents time-window filters;
  - desktop timeline refresh now documents nextCursor usage.

Updated docs/assets/desktop-ui-mvp.png with the new UI screenshot.
```

Validation:

```text
npm run check -> passed
npm --prefix apps/desktop-app run build -> passed
npm run smoke:desktop-ui -> passed
  jobId=JOB-20260601-75D1E7D9
  filteredJobVisible=true
  timeFilterVisible=true
  customSinceVisible=true
  timelineCursorRequests=6
  timelineItems=52
npm run smoke:desktop-ui-prod -> passed
  jobId=JOB-20260601-31B6CD9E
  filteredJobVisible=true
  timeFilterVisible=true
  customSinceVisible=true
  timelineCursorRequests=6
  timelineItems=54
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed

Note: an initial attempt ran dev/prod desktop smokes in parallel and failed due
to the shared dev-stack smoke lock / browser context churn. Sequential reruns
passed. Keep these smokes sequential.
```

Next ordered tasks:

```text
1. User-side alpha gate A: configure M3 real provider env and run
   npm run smoke:m3-real-provider.
2. User-side alpha gate B: configure git remote, push a branch, and watch
   GitHub Actions to green.
3. If continuing Codex-only before A/B are available: add a short M3 real
   provider operator checklist and expected failure triage to make A easier.
4. Later: Rust/Tauri installer proof and OpenClaw real-mode broader validation.
5. v1.1: waiting_for_human resume API. m2 nightly CI remains off the alpha path.
```

## 2026-06-01 M3 Real Provider Operator Guide Checkpoint

Added an operator guide to lower the remaining M3 real-provider alpha gate.

Direction decision:

```text
Claude's latest review was accepted in substance: the prior five direction
correction tasks are complete, and the next Codex-only task should make
user-side alpha gate A easier instead of starting more internal hardening.
```

Changes:

```text
Added docs/m3-real-provider-operator-guide.md:
  - explains what smoke:m3-real-provider proves;
  - lists required and optional M3 planner env vars;
  - includes provider templates for OpenAI, DeepSeek, and Volcengine Ark;
  - explains that generate-cluster-config appends /chat/completions when needed;
  - documents expected success output;
  - gives error-to-fix triage for missing env, placeholder base URL, auth,
    wrong route, model/endpoint not found, quota/rate limit, non-JSON planner
    response, empty stages, unsupported roles, job execution failure, and timeout;
  - documents the accepted planner JSON contract and safe/unsafe sharing rules.

Updated README.md:
  - links the operator guide near smoke:m3-real-provider.

Updated SETUP.md:
  - links the operator guide from the M3 real-provider section.

Updated docs/m3-real-planner-known-issues.md:
  - points operators to the new guide for setup and triage.
```

Validation:

```text
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
npm run smoke:m3-real-planner -> passed
  plannerRequests=1
  planner=openai-compatible
  model=planner-smoke-model
  stageAgents=research-agent,writer-agent,video-agent

Not run intentionally:
  npm run smoke:m3-real-provider
Reason:
  it may call a real paid provider if local .env has real M3 variables. Run it
  only after the operator explicitly confirms the provider config.
```

Next ordered tasks:

```text
1. User-side alpha gate A: configure M3 real provider env using
   docs/m3-real-provider-operator-guide.md, then run:
   npm run smoke:m3-real-provider
2. User-side alpha gate B: configure git remote, push a branch, and watch
   GitHub Actions to green.
3. Codex-side after A/B or if user asks to continue without them: run one real
   Tauri build proof now that smoke:tauri-shell reports rustToolchain=available.
4. Later: QUICKSTART recording/GIF and OpenClaw real-mode broader validation.
5. v1.1: waiting_for_human resume API. m2 nightly CI remains off the alpha path.
```

## 2026-06-01 Automated Provider Call Boundary Checkpoint

Claude's review suggested that the "do not auto-run paid providers" behavior is
a project trust signal. This is now documented in SECURITY.md.

Changes:

```text
Updated SECURITY.md:
  - added Automated Provider Calls section;
  - states automated checks and agent-driven maintenance must not call paid LLM
    providers without explicit operator authorization;
  - lists safe automatic checks:
      npm run smoke:m3-real-planner
      npm run smoke:m3-config
      npm run smoke:http-only
  - lists checks that require explicit operator choice:
      npm run smoke:m3-real-provider
      npm run smoke:openclaw-real
  - states that provider keys in .env are not permission to spend quota.
```

Validation:

```text
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. User-side alpha gate A: configure M3 real provider env using
   docs/m3-real-provider-operator-guide.md, then run:
   npm run smoke:m3-real-provider
2. User-side alpha gate B: configure git remote, push a branch, and watch
   GitHub Actions to green.
3. Current Codex-side task if continuing before A/B: run one real Tauri build
   proof and document installer artifacts/notes.
4. Later: QUICKSTART recording/GIF and OpenClaw real-mode broader validation.
5. v1.1: waiting_for_human resume API. m2 nightly CI remains off the alpha path.
```

## 2026-06-01 Desktop Installer Build Proof Attempt

Claude's suggestion to move Tauri packaging forward was directionally useful,
but the "one command, no excuse" framing was too optimistic for the current
Windows host. Codex ran the real build path and found a native-toolchain
blocker instead of assuming readiness from Rust alone.

Changes:

```text
Added docs/desktop-installer-notes.md:
  - records the 2026-06-01 packaging proof attempt;
  - lists available host pieces: cargo 1.96.0, rustc 1.96.0, WebView2
    148.0.3967.96, and stable-x86_64-pc-windows-msvc;
  - records blocker: MSVC + Windows SDK missing, where cl not found;
  - records attempted command:
      npm --prefix apps/desktop-app run tauri:build
    which timed out after 304 seconds and produced no src-tauri/target bundle;
  - documents required Visual Studio Build Tools components and expected bundle
    output directory after the host prerequisite is installed.

Updated scripts/smoke-tauri-shell.ps1:
  - still validates the desktop shell structure;
  - now reports nativePackagingToolchain and packagingRunnable;
  - buildRunnable now reflects true Tauri packaging readiness, not just Rust.

Updated README.md, SETUP.md, and apps/desktop-app/README.md:
  - clarify that Windows Tauri packaging requires Rust/Cargo plus Visual
    Studio Build Tools with MSVC and a Windows SDK;
  - link to docs/desktop-installer-notes.md.

Added apps/desktop-app/src-tauri/Cargo.lock:
  - generated by the packaging attempt;
  - should be committed for reproducible Tauri application builds.
```

Validation:

```text
npm --prefix apps/desktop-app run build -> passed
  Vite production bundle produced under apps/desktop-app/dist.

npm run smoke:tauri-shell -> passed
  rustToolchain=available
  nativePackagingToolchain=missing_msvc_or_windows_sdk
  buildRunnable=false
  packagingRunnable=false

Process cleanup:
  stale npm/Vite processes from the timed-out tauri:build attempt were stopped.

Not attempted automatically:
  Installing Visual Studio Build Tools. This is a large host-level dependency
  change and should be an explicit operator action.
```

Next ordered tasks:

```text
1. User/operator installs Visual Studio 2022 Build Tools with Desktop
   development with C++, MSVC v143, and a Windows SDK.
2. Rerun:
      npm --prefix apps/desktop-app run tauri:build
   then record MSI/NSIS artifact paths under
      apps/desktop-app/src-tauri/target/release/bundle/
3. User-side alpha gate A: configure M3 real provider env using
   docs/m3-real-provider-operator-guide.md, explicitly authorize the paid
   provider call, then run npm run smoke:m3-real-provider.
4. User-side alpha gate B: configure git remote, push a branch, and watch
   GitHub Actions to green.
5. If continuing Codex-only before those gates: create a QUICKSTART recording
   or GIF from the already verified clean-copy onboarding path.
6. Later with explicit authorization: broaden OpenClaw real-mode validation
   across all four routing modes.
```

## 2026-06-01 Desktop Installer Build Completed

User explicitly authorized Codex to install Visual Studio Build Tools on D:
because C: was getting tight. Claude's note remained useful as reference, but
Codex continued with independent product judgment: complete the D blocker first,
keep paid-provider smokes gated by explicit authorization, and avoid leaving
large rebuildable caches on C:.

Host changes:

```text
Downloaded installer:
  D:\Installers\vs_BuildTools.exe

Successful Build Tools install command:
  D:\Installers\vs_BuildTools.exe --quiet --wait --norestart
    --installPath D:\BuildTools\VS2022\BuildTools
    --add Microsoft.VisualStudio.Workload.VCTools
    --includeRecommended

Installed:
  Visual Studio Build Tools 2022 17.14.37314.3
  MSVC tools: D:\BuildTools\VS2022\BuildTools\VC\Tools\MSVC\14.44.35207
  Windows SDK: C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0

Note:
  Earlier attempts using --path install/cache/shared plus --log returned exit
  code 87 on this host. The minimal --installPath form succeeded.
```

Code/docs changes:

```text
Updated scripts/smoke-tauri-shell.ps1:
  - detects Windows native packaging through vswhere and Windows SDK files;
  - no longer requires cl.exe to be globally present on PATH;
  - now reports buildRunnable=true / packagingRunnable=true on this host.

Updated apps/desktop-app/src-tauri/tauri.conf.json:
  - added bundle.icon for MSI/NSIS;
  - added bundle.useLocalToolsDir=true so WiX/NSIS tools cache under
    src-tauri/target/.tauri during builds instead of user AppData.

Added apps/desktop-app/src-tauri/icons/icon.ico and icon.png:
  - minimal placeholder app icon for Windows resource and MSI bundling.

Updated .gitignore:
  - ignores src-tauri/gen and src-tauri/target generated outputs.

Updated docs/desktop-installer-notes.md, README.md, SETUP.md, and desktop README:
  - changed the desktop packaging status from blocked to verified.
```

Build proof:

```text
npm --prefix apps/desktop-app exec tauri -- info -> MSVC detected
npm run smoke:tauri-shell -> passed
  rustToolchain=available
  nativePackagingToolchain=available
  nativePackagingDetails.source=vswhere
  nativePackagingDetails.msvc=true
  nativePackagingDetails.windowsSdk=true
  buildRunnable=true
  packagingRunnable=true

npm --prefix apps/desktop-app run tauri:build -> passed
  produced MSI and NSIS installers
```

Installer artifacts:

```text
Generated during build under:
  apps/desktop-app/src-tauri/target/release/bundle/msi/Agent OpenClaw_0.1.0_x64_en-US.msi
  apps/desktop-app/src-tauri/target/release/bundle/nsis/Agent OpenClaw_0.1.0_x64-setup.exe

Copied to D: before C: cache cleanup:
  D:\AgentOpenClaw\installers\2026-06-01\Agent OpenClaw_0.1.0_x64_en-US.msi
    size: 2.68 MB
  D:\AgentOpenClaw\installers\2026-06-01\Agent OpenClaw_0.1.0_x64-setup.exe
    size: 1.78 MB

Cleaned up:
  apps/desktop-app/src-tauri/target was about 1.3 GB and was deleted after
  copying artifacts to D: because it is rebuildable and the user wanted to
  avoid filling C:.
```

Validation after docs/code updates:

```text
npm run check -> passed
npm run check:no-secrets -> passed
npm run smoke:tauri-shell -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Current Codex-safe task: create QUICKSTART recording/GIF or another compact
   first-run demo asset from the already verified clean-copy onboarding path.
2. Then update README/QUICKSTART to surface the demo asset in the first screen.
3. User-side alpha gate A remains: explicitly authorize real provider spend,
   configure M3 env, then run npm run smoke:m3-real-provider.
4. User-side alpha gate B remains: configure git remote, push, and watch GitHub
   Actions to green.
5. Later with explicit authorization: OpenClaw real-mode validation across all
   four routing modes.
6. v1.1/backlog: waiting_for_human resume API and broader cross-platform Tauri
   host probes.
```

## 2026-06-01 QUICKSTART Demo GIF Checkpoint

Completed the next safe Codex-side task after the Windows installer proof:
create a first-run demo asset for the open-source onboarding path. This does
not use real providers and does not spend model quota.

Validation source:

```text
npm run smoke:docker-compose -> passed
  jobId=JOB-20260601-EF874902
  terminalStatus=succeeded
  ingressOrigin=http
  messageCount=4
  persistenceCheck=passed
  checked=compose_up_build,http_create_job,poll_succeeded,get_messages,compose_restart_persistence
```

Changes:

```text
Added docs/assets/quickstart-demo.gif:
  - generated from lightweight PNG frames using ffmpeg;
  - shows the HTTP-only quickstart flow:
      docker compose up --build
      POST /jobs
      jobId returned
      poll to succeeded
      read messages/timeline
      persistence check passed
  - uses real smoke result JOB-20260601-EF874902 as the displayed proof.

Updated README.md:
  - displays the quickstart GIF near the first screen before the desktop UI
    screenshot.

Updated QUICKSTART.md:
  - displays the same GIF near the top;
  - records the smoke result that generated the demo.
```

Validation:

```text
Manual visual check of docs/assets/quickstart-demo.gif -> acceptable first frame
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Commit the QUICKSTART GIF/docs update.
2. User-side alpha gate A: explicitly authorize real provider spend, configure
   M3 env, then run npm run smoke:m3-real-provider.
3. User-side alpha gate B: configure git remote, push, and watch GitHub Actions
   to green.
4. Codex-safe follow-up if continuing without A/B: add macOS/Linux native
   packaging notes/probes or create a short release checklist.
5. Later with explicit authorization: OpenClaw real-mode validation across all
   four routing modes.
6. v1.1/backlog: waiting_for_human resume API.
```

## 2026-06-01 Release Checklist Checkpoint

Added an explicit alpha/release checklist so future work stays aligned with the
open-source platform goal instead of drifting back into private deployment or
internal-only polishing.

Changes:

```text
Added docs/release-checklist.md:
  - defines alpha readiness around HTTP-only Docker quickstart, first-run docs,
    desktop console, Windows installer build, one authorized M3 real-provider
    smoke, and hosted CI;
  - states non-gates for alpha:
      Feishu public ingress on author's domain
      waiting_for_human resume API
      M2 recovery nightly CI
      macOS/Linux installers
      real media providers
      OpenClaw real mode across all four routing modes
  - records current gate state:
      HTTP-only Docker quickstart done
      README/QUICKSTART demo done
      desktop console MVP done
      Windows installer proof done
      M3 real-provider smoke blocked on explicit authorization
      Git remote/hosted CI blocked on remote setup
  - lists safe pre-release commands and explicitly authorized real-provider /
    real-OpenClaw checks;
  - documents artifact policy and direction guardrails.

Updated README.md:
  - Read next includes docs/release-checklist.md.
```

Validation:

```text
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Commit the release checklist.
2. Remaining alpha gate A: operator explicitly authorizes provider spend,
   configures M3 env, then runs npm run smoke:m3-real-provider.
3. Remaining alpha gate B: configure git remote, push, and watch GitHub Actions
   to green.
4. Codex-safe optional follow-up if continuing without A/B: add CI workflow
   templates locally, but do not assume a remote exists.
5. Later with explicit authorization: OpenClaw real-mode validation across all
   four routing modes.
```

## 2026-06-01 Cross-Platform Tauri Probe Checkpoint

After reading Claude's latest review, Codex accepted the useful part of the
suggestion: the next safe Codex-side task was to make desktop packaging
readiness clearer across platforms. GIF optimization was skipped because the
generated GIF is only about 52 KB, and icon redesign remains non-gating polish.

Changes:

```text
Updated scripts/smoke-tauri-shell.ps1:
  - Windows probe remains vswhere + MSVC + Windows SDK rc.exe;
  - macOS probe now checks xcode-select -p;
  - Linux probe now checks pkg-config packages:
      webkit2gtk-4.1
      gtk+-3.0
      ayatana-appindicator3-0.1
      librsvg-2.0
      openssl
  - nativePackagingToolchain can now report:
      available
      missing_msvc_or_windows_sdk
      missing_xcode_command_line_tools
      missing_linux_native_packages
      unknown_host

Updated docs/desktop-installer-notes.md:
  - added the official Tauri prerequisites URL:
      https://v2.tauri.app/start/prerequisites/
  - added macOS xcode-select --install note;
  - added current Debian/Ubuntu Tauri prerequisite command;
  - documented what smoke:tauri-shell probes on Windows/macOS/Linux.

Updated SETUP.md:
  - states smoke:tauri-shell reports Windows/macOS/Linux native packaging
    readiness.

Updated docs/release-checklist.md:
  - records cross-platform installer probes as partial:
      smoke reports readiness on Windows/macOS/Linux, but only Windows has a
      verified installer artifact so far.
```

Validation:

```text
npm run smoke:tauri-shell -> passed on Windows
  rustToolchain=available
  nativePackagingToolchain=available
  nativePackagingDetails.source=vswhere
  buildRunnable=true
  packagingRunnable=true
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Commit cross-platform Tauri probe/docs.
2. Remaining alpha gate A: operator explicitly authorizes real provider spend,
   configures M3 env, then run npm run smoke:m3-real-provider.
3. Remaining alpha gate B: configure git remote, push, and watch GitHub Actions
   to green.
4. Codex-safe optional follow-up without A/B: improve placeholder app icon into
   a real multi-platform icon set, or prepare a release/tag checklist.
5. Later with explicit authorization: OpenClaw real-mode validation across all
   four routing modes.
```

## 2026-05-31 Timeline Cursor Hardening Checkpoint

Timeline pagination now has an opaque per-item cursor so clients can page
without dropping events that share the same timestamp.

Code changes:

```text
Updated packages/db/src/pipeline.ts:
  - added InvalidTimelineCursorError;
  - each public timeline item now includes cursor;
  - GET timeline accepts cursor=<opaque>;
  - cursor encodes { at, id };
  - cursor pagination finds the exact timeline item and returns items after it;
  - invalid/missing cursor targets produce timeline_cursor_not_found or
    invalid_timeline_cursor.

Updated apps/orchestrator-api/src/server.ts:
  - validates optional timeline cursor;
  - returns HTTP 400 for invalid timeline cursors.

Updated apps/desktop-app/src/api.ts:
  - TimelineItem includes cursor;
  - JobTimeline summary includes cursor and nextCursor;
  - getJobTimeline can pass an optional cursor.

Updated scripts/smoke-timeline-since.ps1:
  - preserves existing since assertions;
  - inserts two same-created_at job_events as a deterministic same-timestamp
    fixture;
  - verifies item cursor pagination returns the second same-timestamp event;
  - verifies invalid timeline cursor returns 400.

Updated SETUP.md with cursor pagination guidance:
  - since remains for compatibility;
  - new clients should prefer per-item cursor.
```

Validation:

```text
npm run check -> passed
npm run smoke:timeline-since -> passed
  job=JOB-20260601-FC40A5A8
  totalTimelineItems=88
  sinceMatchedItems=43
  limitedReturnedItems=2
  limitedHasMore=true
  sameTimestampCursorIndex=86
  cursorMatchedItems=1
  invalidCursorStatus=400
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Configure local M3 real provider variables and run npm run smoke:m3-real-provider.
2. Configure git remote, push a branch, and watch GitHub Actions to green.
3. Try a genuinely different Rust path later, then run Tauri build proof.
4. Current next local product task: m2 recovery nightly CI.
5. Later: design waiting_for_human resume/accept/retry API.
```

## 2026-05-31 Node Engines Docs Checkpoint

Aligned Node/npm engine constraints with the actual dependency floor and current
verification environments.

Decision:

```text
Do not use Claude's earlier suggested ">=20 <23" range. It conflicts with the
current local Node 24 toolchain and is stricter than the installed Vite 7 engine
floor. Use the installed Vite 7 requirement instead:
  node ^20.19.0 || >=22.12.0
  npm >=10
```

Code/docs changes:

```text
Updated package.json and package-lock.json:
  engines.node = ^20.19.0 || >=22.12.0
  engines.npm = >=10

Updated apps/desktop-app/package.json and package-lock.json:
  same engines block.

Updated README.md, INSTALL.md, SETUP.md:
  - documented the Node/npm runtime requirement;
  - recorded that CI uses Node 22;
  - recorded that local development has also been verified on Node 24.15.0 with
    npm 11.12.1.
```

Validation:

```text
Local dependency check:
  vite 7.3.3 engines.node = ^20.19.0 || >=22.12.0
  tsx 4.22.3 engines.node = >=18.0.0
  @tauri-apps/cli 2.11.2 engines.node = >=10

Local runtime:
  node v24.15.0
  npm 11.12.1

npm install --package-lock-only --ignore-scripts -> passed
npm install --package-lock-only --ignore-scripts --prefix apps/desktop-app -> passed
npm run check -> passed
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Configure local M3 real provider variables and run npm run smoke:m3-real-provider.
2. Configure git remote, push a branch, and watch GitHub Actions to green.
3. Try a genuinely different Rust path later, then run Tauri build proof.
4. Current next local product task: timeline cursor composite-key hardening.
5. Then m2 recovery nightly CI.
6. Later: design waiting_for_human resume/accept/retry API.
```

## 2026-05-31 Smoke Lock Orphan Cleanup Checkpoint

Dev-stack smoke locks now recover from stale/orphan lock files.

Code changes:

```text
Updated scripts/run-with-smoke-lock.ps1:
  - reads existing .runtime/locks/<name>.lock metadata;
  - extracts owner pid when possible;
  - removes the lock file when the pid is missing, invalid, or no longer alive;
  - keeps exclusive FileShare=None acquisition as the actual live-lock authority.

Updated scripts/smoke-desktop-ui.ts:
  - handles EEXIST from the TypeScript lock path;
  - reads lock metadata;
  - removes malformed/dead-pid lock files;
  - retries acquire after stale cleanup;
  - still refuses the lock when the recorded process is alive.

Updated SETUP.md:
  - documented .runtime/locks stale cleanup behavior.
```

Validation:

```text
npm run check -> passed
PowerShell stale lock test -> passed
  wrote .runtime/locks/dev-stack.lock with pid=999999
  run-with-smoke-lock removed stale lock
  smoke-tauri-shell ran successfully

TypeScript stale lock test -> passed
  wrote .runtime/locks/dev-stack.lock with pid=999999
  npm run smoke:desktop-ui removed stale lock and acquired dev-stack
  job=JOB-20260601-AA29DF53
  filteredStatuses=all cancelled
  timelineItems=54

npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Configure local M3 real provider variables and run npm run smoke:m3-real-provider.
2. Configure git remote, push a branch, and watch GitHub Actions to green.
3. Try a genuinely different Rust path later, then run Tauri build proof.
4. Current next local product task: Node engines/docs alignment.
5. Then timeline cursor composite-key hardening.
6. Then m2 recovery nightly CI.
7. Later: design waiting_for_human resume/accept/retry API.
```

## 2026-05-31 Prompt Search Boundary Checkpoint

Extended the job-list smoke coverage to lock down prompt search behavior for
case-insensitive English input and Chinese input.

Code changes:

```text
Updated scripts/smoke-list-jobs.ps1:
  - Create-SmokeJob now sends request bodies as explicit UTF-8 bytes with
    application/json; charset=utf-8;
  - added a MixedCasePrompt probe and searches using a lowercase query;
  - added a Chinese prompt probe built from Unicode code points, not a raw
    PowerShell source literal, to avoid Windows PowerShell file-encoding loss;
  - verifies the Chinese query returns the Chinese probe.

Updated SETUP.md:
  - list-jobs smoke expectations now include case-insensitive prompt search and
    Chinese prompt search.
```

Validation:

```text
npm run check -> passed
npm run smoke:list-jobs -> passed
  marker=list-3f132827
  jobIds:
    JOB-20260601-4AAF44B5
    JOB-20260601-777540F2
    JOB-20260601-A46B7780
    JOB-20260601-ECA5E39B
    JOB-20260601-090C3D56
    JOB-20260601-ADC8D35E
  caseInsensitiveProbe=JOB-20260601-090C3D56
  chineseProbe=JOB-20260601-ADC8D35E
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Implementation note:

```text
The first Chinese smoke attempt failed usefully: the prompt reached the database
as question marks. The cause was Windows PowerShell request-body encoding, not
Postgres ILIKE. The smoke now sends UTF-8 bytes explicitly, which also documents
the correct client behavior for non-ASCII prompts.
```

Next ordered tasks:

```text
1. Configure local M3 real provider variables and run npm run smoke:m3-real-provider.
2. Configure git remote, push a branch, and watch GitHub Actions to green.
3. Try a genuinely different Rust path later, then run Tauri build proof.
4. Current next local product task: smoke lock orphan cleanup.
5. Then Node engines/docs alignment.
6. Then timeline cursor composite-key hardening.
7. Then m2 recovery nightly CI.
8. Later: design waiting_for_human resume/accept/retry API.
```

## 2026-05-31 Historical Cancel Archive Repair Checkpoint

Added a one-off maintenance path for historical jobs that were cancelled before
the cancel archive behavior existed.

Code changes:

```text
Added scripts/repair-cancelled-archives.ts:
  - default mode is dry-run;
  - finds jobs where status=cancelled and archived_at is null;
  - supports --limit 1..500;
  - supports --job-id JOB-... for targeted repair/smoke;
  - with --apply, calls archiveJobSession({ reason: "job_cancelled" });
  - emits compact JSON for script/smoke consumption.

Added npm script:
  npm run maintenance:repair-cancelled-archives

Added scripts/smoke-repair-cancelled-archives.ps1:
  - starts the dev stack in HTTP/mock mode;
  - creates a budget-limited job;
  - cancels it normally;
  - mutates it into a legacy fixture by clearing archived_at/retention_until and
    removing job.archived events;
  - verifies dry-run finds the candidate but does not write;
  - verifies --apply repairs archive fields and appends exactly one job.archived.

Added npm script:
  npm run smoke:repair-cancelled-archives

Updated SETUP.md with repair commands and dry-run/apply semantics.
```

Validation:

```text
npm run check -> passed
npm run smoke:repair-cancelled-archives -> passed
  job=JOB-20260601-1C3B998F
  dryRunCandidateCount=1
  applyRepairedCount=1
  cleanupStatus=retained
  archivedAt=2026-06-01T00:14:12.419Z
  retentionUntil=2026-07-01T00:14:12.419Z
  timelineArchiveEvents=1
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Configure local M3 real provider variables and run npm run smoke:m3-real-provider.
2. Configure git remote, push a branch, and watch GitHub Actions to green.
3. Try a genuinely different Rust path later, then run Tauri build proof.
4. Current next local product task: add prompt-search boundary checks for case-insensitive and Chinese input.
5. Then smoke lock orphan cleanup.
6. Then Node engines/docs alignment.
7. Then timeline cursor composite-key hardening.
8. Then m2 recovery nightly CI.
9. Later: design waiting_for_human resume/accept/retry API.
```

## 2026-05-31 Job Cancellation Semantics Docs Checkpoint

Documented v1 cancellation semantics so open-source users can understand why a
cancelled job can still show prior artifacts and timeline events.

Code/docs changes:

```text
Added docs/job-cancellation-semantics.md:
  - POST /jobs/:jobId/cancel API contract;
  - idempotency behavior;
  - 409 behavior for succeeded/failed terminal jobs;
  - cooperative stop semantics;
  - already-persisted artifacts are preserved as append-only audit records;
  - cancel does not mark artifacts stale or roll them back;
  - cancelled jobs do not create a new final output;
  - cancelled jobs are archived with retentionPolicy.archiveReason=job_cancelled;
  - cleanup is retention-gated and separate from cancel.

Updated SETUP.md:
  - linked docs/job-cancellation-semantics.md from the Cancel Job Smoke section.

Updated README.md:
  - desktop MVP description now mentions filter/search;
  - added the cancellation semantics doc to the details list.
```

Validation:

```text
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Configure local M3 real provider variables and run npm run smoke:m3-real-provider.
2. Configure git remote, push a branch, and watch GitHub Actions to green.
3. Try a genuinely different Rust path later, then run Tauri build proof.
4. Current next local product task: one-off maintenance repair for historical cancelled jobs missing archives.
5. Then add prompt-search boundary checks for case-insensitive and Chinese input.
6. Then smoke lock orphan cleanup.
7. Then Node engines/docs alignment.
8. Then timeline cursor composite-key hardening.
9. Then m2 recovery nightly CI.
10. Later: design waiting_for_human resume/accept/retry API.
```

## 2026-05-31 Desktop Job List Filters Checkpoint

Independent direction check:

```text
Claude's suggestion to expose GET /jobs filters in the desktop UI was accepted,
not because it should drive the roadmap, but because it serves the actual product
goal: a downloadable multi-agent orchestration platform with a usable desktop
control console. This turns the previous backend list API work into visible user
value. Claude's other suggestions remain filtered through that lens; private
deployment work is still off the product critical path.
```

Code changes:

```text
Updated apps/desktop-app/src/main.tsx:
  - added Jobs pane segmented filters:
      All
      Running
      Waiting
      Cancelled
  - added prompt search input backed by GET /jobs?prompt=...
  - added Load More support using page.nextCursor;
  - refreshes the selected job after filter changes;
  - uses a request sequence guard so older list responses cannot overwrite a
    newer filter/search result.

Updated apps/desktop-app/src/styles.css:
  - added compact segmented filter styling;
  - added search/filter layout and load-more row.

Updated scripts/smoke-desktop-ui.ts:
  - after creating and cancelling a job, searches for "Desktop UI smoke";
  - switches to the Cancelled filter;
  - verifies the created job remains visible;
  - verifies every visible job row has status=cancelled.

Updated docs:
  - apps/desktop-app/README.md lists status filters and prompt search;
  - SETUP.md notes which list controls are exposed in the desktop UI.
```

Validation:

```text
npm run check -> passed
npm run smoke:desktop-ui -> passed
  job=JOB-20260601-AAB47B82
  filteredJobVisible=true
  filteredStatuses=all cancelled
  timelineItems=54
npm run smoke:desktop-ui-prod -> passed
  job=JOB-20260601-8AB9E19A
  filteredJobVisible=true
  filteredStatuses=all cancelled
  timelineItems=54
  screenshot=.runtime/desktop-ui-smoke/desktop-ui-prod-smoke.png
Visual screenshot inspection passed:
  Cancelled filter is active, search is applied, visible rows are cancelled,
  selected job detail and timeline render without overlap.
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Implementation note:

```text
The first prod screenshot revealed a real UI race: the Cancelled segment could be
active while a stale prompt-search response left waiting_for_human rows visible.
The request sequence guard fixed this; the smoke now asserts all visible rows are
cancelled after applying the search + status filter.
```

Next ordered tasks:

```text
1. Configure local M3 real provider variables and run npm run smoke:m3-real-provider.
2. Configure git remote, push a branch, and watch GitHub Actions to green.
3. Try a genuinely different Rust path later, then run Tauri build proof.
4. Current next local product task: document job cancellation artifact semantics.
5. Then add a one-off maintenance repair for historical cancelled jobs missing archives.
6. Then add prompt-search boundary checks for case-insensitive and Chinese input.
7. Then smoke lock orphan cleanup.
8. Then Node engines/docs alignment.
9. Then timeline cursor composite-key hardening.
10. Then m2 recovery nightly CI.
11. Later: design waiting_for_human resume/accept/retry API.
```

## 2026-05-31 Job List Pagination/Search Checkpoint

GET /jobs now supports product-grade filtering, sorting, and cursor pagination
while preserving the old response shape (`jobs`) for existing clients.

Claude review input absorbed for this checkpoint:

```text
User-side blockers remain:
  A. configure M3 real provider environment variables;
  B. configure git remote and push/watch GitHub Actions;
  C. repair/reset Rust toolchain and run a real Tauri build.

Codex-side next product task remained GET /jobs pagination/sort/search.
Claude also identified follow-up cancel-tail work:
  - document artifact behavior after cancel;
  - add a one-off repair path for historical cancelled-but-unarchived jobs;
  - keep smoke lock orphan cleanup next after those tails.
```

Code changes:

```text
Updated packages/db/src/jobs.ts:
  - listJobs returns { jobs, page };
  - supports limit, status, ingressOrigin, prompt, since, until, sort, order, cursor;
  - status/ingress filters are normalized;
  - prompt search is parameterized and escapes LIKE wildcards;
  - cursor is an opaque base64url JSON payload containing:
      sort, order, microsecond timestamp value, job id;
  - cursor comparison uses composite (sort timestamp, id), so equal timestamp
    rows do not duplicate or fall between pages;
  - malformed cursors throw InvalidJobListCursorError.

Updated apps/orchestrator-api/src/server.ts:
  - validates GET /jobs query params;
  - returns 400 for invalid list cursors;
  - returns the full { jobs, page } result.

Updated apps/desktop-app/src/api.ts:
  - typed ListJobsInput/ListJobsResponse;
  - listJobs(number) remains compatible with the existing desktop UI;
  - listJobs({ ...filters }) supports the new API.

Updated packages/db/src/migrate.ts:
  - added jobs_created_at_id_idx;
  - added jobs_updated_at_id_idx.

Added scripts/smoke-list-jobs.ps1 and npm run smoke:list-jobs.
Updated SETUP.md with list API parameters and smoke instructions.
```

Validation:

```text
npm run check -> passed
npm run smoke:list-jobs -> passed
  marker=list-90ada325
  jobIds:
    JOB-20260531-B44D3FFA
    JOB-20260531-1C671E02
    JOB-20260531-2CE5A11A
    JOB-20260531-25072D39
  allOrder=alpha,beta,gamma,cancel-probe
  page1=alpha,beta
  page2=gamma,cancel-probe
  desc=cancel-probe,gamma
  cancelledFilter=cancel-probe
  window=beta,gamma,cancel-probe
  invalid cursor -> 400
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Implementation note:

```text
The first smoke run revealed a real precision bug: Node Date.toISOString()
truncated Postgres timestamptz microseconds to milliseconds, which caused page 2
to repeat the prior page's final row. The cursor now stores a Postgres-formatted
microsecond timestamp from to_char(...US...), while public JobRecord timestamps
remain normal ISO strings.
```

Next ordered tasks:

```text
1. Configure local M3 real provider variables and run npm run smoke:m3-real-provider.
2. Configure git remote, push a branch, and watch GitHub Actions to green.
3. Try a genuinely different Rust path later, then run Tauri build proof.
4. Current next local product task: document job cancellation artifact semantics.
5. Then add a one-off maintenance repair for historical cancelled jobs missing archives.
6. Then smoke lock orphan cleanup.
7. Then Node engines/docs alignment.
8. Then timeline cursor composite-key hardening.
9. Then m2 recovery nightly CI.
10. Later: design waiting_for_human resume/accept/retry API.
```

## 2026-05-31 Timeline Since Pagination Checkpoint

Timeline polling now supports incremental since-timestamp pagination while
preserving the old latest-N behavior when no cursor is supplied.

Code changes:

```text
Updated GET /jobs/:jobId/timeline:
  - accepts optional since=<ISO timestamp> and limit=<n>;
  - without since, keeps the existing behavior: return the latest N timeline
    items in chronological order;
  - with since, returns items strictly after the cursor timestamp, taking the
    first N matching items in chronological order;
  - response summary now includes:
      matchedTimelineItems
      hasMore
      since
      nextSince

Updated apps/desktop-app/src/api.ts:
  - JobTimeline summary type includes the new fields;
  - getJobTimeline(jobId, limit, since?) can pass the optional cursor.

Added scripts/smoke-timeline-since.ps1 and npm run smoke:timeline-since:
  - creates a mock HTTP-origin job;
  - reads the full timeline;
  - uses a midpoint timeline timestamp as the since cursor;
  - verifies filtered order/count;
  - verifies limit=2 returns the first two matching events and reports hasMore.

Updated SETUP.md with the timeline since endpoint and smoke command.
```

Validation:

```text
npm run check -> passed
npm run smoke:timeline-since -> passed
  job=JOB-20260531-4C2BA25C
  terminalStatus=succeeded
  totalTimelineItems=86
  sinceCursor=2026-05-31T11:12:27.763Z
  sinceMatchedItems=42
  limitedReturnedItems=2
  limitedHasMore=true
  nextSince=2026-05-31T11:12:27.769Z
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Configure local M3 real provider variables and run npm run smoke:m3-real-provider.
2. Configure git remote, push a branch, and watch GitHub Actions to green.
3. Try a genuinely different Rust path later, then run Tauri build proof.
4. Current next local product task: GET /jobs pagination/sort/search backlog.
5. Then smoke lock orphan cleanup.
6. Then Node engines/docs alignment.
7. Then m2 recovery nightly CI.
```

## 2026-05-31 Cancel Archival Consistency Checkpoint

Cancelled jobs now enter the same session archival/retention ledger as
successfully finalized jobs.

Code changes:

```text
Updated packages/db/src/jobs.ts:
  - cancelJob now calls archiveJobSession({ reason: "job_cancelled" }) after
    writing the job.cancelled event;
  - repeated cancel remains idempotent;
  - already-cancelled jobs that predate this fix are repaired on a later cancel
    request if archivedAt is still missing;
  - concurrent cancel races that observe a just-cancelled but unarchived job also
    repair the archive state.

Updated scripts/smoke-cancel-job.ps1:
  - verifies cancelled jobs have completedAt, archivedAt, retentionUntil;
  - verifies cleanupStatus=retained;
  - verifies retentionPolicy.archiveReason=job_cancelled;
  - verifies exactly one job_event job.cancelled and one job_event job.archived;
  - verifies job.archived appears after job.cancelled in the public timeline;
  - verifies the second cancel stays idempotent and does not duplicate archive
    job events.
```

Validation:

```text
npm run check -> passed
npm run smoke:cancel-job -> passed
  job=JOB-20260531-431E4F26
  waitingStatus=waiting_for_human
  cancelStatus=cancelled
  cleanupStatus=retained
  archivedAt=2026-05-31T11:04:04.838Z
  retentionUntil=2026-06-30T11:04:04.838Z
  secondCancelReason=already_cancelled
  timelineCancelEvents=1
  timelineArchiveEvents=1
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Configure local M3 real provider variables and run npm run smoke:m3-real-provider.
2. Configure git remote, push a branch, and watch GitHub Actions to green.
3. Try a genuinely different Rust path later, then run Tauri build proof.
4. Current next local product task: timeline since pagination.
5. Then GET /jobs pagination/sort/search backlog.
6. Then smoke lock orphan cleanup.
7. Then Node engines/docs alignment.
8. Then m2 recovery nightly CI.
```

## 2026-05-31 Smoke Lock Checkpoint

Implemented a shared local smoke lock for dev-stack smokes.

Code changes:

```text
Added scripts/run-with-smoke-lock.ps1:
  - takes a lock name and a script path under scripts/;
  - writes lock metadata to .runtime/locks/<name>.lock;
  - opens the lock file with FileShare=None;
  - fails fast if another process already holds the same lock;
  - releases/removes the lock in finally;
  - refuses to run script paths outside the repo scripts directory.

Updated package.json dev-stack smoke scripts to use the shared lock:
  - smoke:feishu-webhook
  - smoke:docker-compose
  - smoke:http-only
  - smoke:m2-recovery
  - smoke:m3-config
  - smoke:m3-real-provider
  - smoke:cancel-job
  - smoke:openclaw-real

Updated scripts/smoke-desktop-ui.ts:
  - acquires the same dev-stack lock when it starts the API itself;
  - skips the lock when --skip-api-start is used for CI/docker-compose mode;
  - added phase logs;
  - added browser-flow timeout;
  - starts browser with ignored stdio and explicit process exit after cleanup,
    so successful smoke runs do not hang on leftover WebSocket/child handles.
```

Validation:

```text
PowerShell lock wrapper direct run -> passed
  Acquired smoke lock 'dev-stack'
  wrapped smoke script ran normally

Lock contention test -> passed
  first process held .runtime/locks/dev-stack.lock
  second run exited with code 1
  output included "already held"

npm run smoke:cancel-job -> passed through package.json lock wrapper
  job=JOB-20260531-F5C863D2
  waitingStatus=waiting_for_human
  cancelStatus=cancelled
  secondCancelReason=already_cancelled
  timelineCancelEvents=2

npm run smoke:desktop-ui -> passed through TypeScript lock path
  job=JOB-20260531-9A630532
  mode=dev
  statusVisible=true
  timelineItems=7

npm run smoke:desktop-ui-prod -- --skip-api-start -> passed
  job=JOB-20260531-003D004A
  mode=prod
  skipApiStart=true
  timelineItems=7

npm run check -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Configure local M3 real provider variables and run npm run smoke:m3-real-provider.
2. Configure git remote, push a branch, and watch GitHub Actions to green.
3. Try a genuinely different Rust path later, then run Tauri build proof.
4. Current next local product task: cancel archival consistency.
5. Then timeline since pagination.
6. Then GET /jobs pagination/sort/search backlog.
7. Then m2 recovery nightly CI.
```

## 2026-05-30 CI Desktop Smoke Wiring Checkpoint

Remote GitHub Actions verification could not be fully executed because this
local repository currently has no configured git remote.

```text
git remote -v -> no remotes configured
```

Completed locally:

```text
Updated scripts/smoke-desktop-ui.ts:
  - added --skip-api-start for environments where the API is already running;
  - added DESKTOP_UI_SMOKE_PORT override;
  - improved non-Windows browser detection through which/where probing;
  - added step logs so future hangs reveal the active phase.

Updated .github/workflows/ci.yml:
  - docker-quickstart job now runs npm ci;
  - installs desktop dependencies with npm ci --prefix apps/desktop-app;
  - after docker compose HTTP smoke, runs:
      DESKTOP_UI_SMOKE_PORT=5173
      npm run smoke:desktop-ui-prod -- --skip-api-start

Updated SETUP.md with the CI/docker-compose skip-api-start command.
```

Validation:

```text
npm run smoke:desktop-ui-prod -- --skip-api-start -> passed locally
  mode=prod
  skipApiStart=true
  url=http://127.0.0.1:5174
  job=JOB-20260530-3FD2CC65
  timelineItems=6

npm run check -> passed
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Open item:

```text
Actual remote Actions run/push verification still requires adding a GitHub
remote or moving this repo into a remote-backed checkout.
```

Next ordered tasks:

```text
1. Configure local M3 real provider variables and run npm run smoke:m3-real-provider.
2. Configure git remote, push a branch, and watch GitHub Actions to green.
3. Try a genuinely different Rust path later, then run Tauri build proof.
4. Current next local product task: smoke lock mechanism.
5. Then cancel archival consistency.
6. Then timeline since pagination.
7. Then GET /jobs pagination/sort/search backlog.
8. Then m2 recovery nightly CI.
```

## 2026-05-30 Desktop Prod Bundle Smoke Checkpoint

Production desktop bundle verification is now covered by the same real browser
UI flow as the Vite dev-server path.

Code changes:

```text
Extended scripts/smoke-desktop-ui.ts:
  - default mode still tests the Vite dev server at http://127.0.0.1:5173;
  - --prod mode runs npm run build in apps/desktop-app;
  - --prod mode serves apps/desktop-app/dist with a small Node static server on
    http://127.0.0.1:5174;
  - API startup now includes 127.0.0.1:5174 in ORCHESTRATOR_CORS_ORIGINS for
    the prod-bundle smoke;
  - screenshots are mode-specific:
      .runtime/desktop-ui-smoke/desktop-ui-dev-smoke.png
      .runtime/desktop-ui-smoke/desktop-ui-prod-smoke.png

Added npm script:
  npm run smoke:desktop-ui-prod

Updated README.md and SETUP.md.
```

Validation:

```text
npm run smoke:desktop-ui -> passed
  mode=dev
  job=JOB-20260530-E440A92B
  timelineItems=13
  screenshot=.runtime/desktop-ui-smoke/desktop-ui-dev-smoke.png

npm run smoke:desktop-ui-prod -> passed
  mode=prod
  job=JOB-20260530-0EB52A7C
  timelineItems=6
  screenshot=.runtime/desktop-ui-smoke/desktop-ui-prod-smoke.png

Visual prod screenshot inspection passed:
  shows created job, cancelled status, disabled Cancelled button, job list, and
  timeline rows.

npm run check -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Configure local M3 real provider variables and run npm run smoke:m3-real-provider.
2. Try a genuinely different Rust path later, then run Tauri build proof.
3. Current next product task: remote GitHub Actions run/push verification,
   ideally including smoke:desktop-ui and smoke:desktop-ui-prod if a browser is
   available on the runner.
4. Then smoke lock mechanism.
5. Then cancel archival consistency.
6. Then timeline since pagination.
7. Then GET /jobs pagination/sort/search backlog.
8. Then m2 recovery nightly CI.
```

## 2026-05-30 Desktop UI Integration Smoke Checkpoint

Implemented a real browser UI smoke for the desktop MVP.

Code changes:

```text
Added npm script:
  npm run smoke:desktop-ui

Added scripts/smoke-desktop-ui.ts:
  - starts the local mock-mode API through npm run dev:start;
  - starts or reuses the Vite desktop UI at http://127.0.0.1:5173;
  - launches a headless Edge/Chrome browser through the DevTools protocol;
  - records existing job IDs before submitting;
  - fills the New Job form in the UI;
  - clicks Start Job;
  - waits for a newly-created job to appear in the list;
  - selects that job;
  - clicks Cancel;
  - verifies cancelled state is visible;
  - verifies timeline rows render;
  - saves a desktop-size screenshot artifact.

Updated README.md and SETUP.md with the new smoke command.
```

Validation:

```text
npm run smoke:desktop-ui -> passed
  job=JOB-20260530-C1F9AE09
  statusVisible=true
  timelineItems=14
  screenshot=.runtime/desktop-ui-smoke/desktop-ui-smoke.png
  checked=desktop_ui_load, create_job_from_ui, job_list_selection,
          cancel_job_from_ui, timeline_rendered

Visual screenshot inspection passed:
  shows created job, cancelled status, disabled Cancelled button, job list, and
  timeline rows.

npm run check -> passed
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Known note:

```text
Node v24 on this Windows host cannot direct-spawn npm.cmd and returns EINVAL.
The smoke therefore runs npm child commands through the Windows shell. Node
prints a DEP0190 warning, but the commands are static and the smoke passes.
```

Next ordered tasks:

```text
1. Configure local M3 real provider variables and run npm run smoke:m3-real-provider.
2. Try a genuinely different Rust path later, then run Tauri build proof.
3. Current next product task: prod bundle verification for apps/desktop-app/dist.
4. Then remote GitHub Actions run/push verification, ideally including the UI
   smoke if the hosted browser path is available.
5. Then smoke lock mechanism.
6. Then cancel archival consistency.
7. Then timeline since pagination.
8. Then GET /jobs pagination/sort/search backlog.
9. Then m2 recovery nightly CI.
```

## 2026-05-30 Rust/Tauri Non-Winget Retry

Tauri real build proof is still blocked by host Rust toolchain state.

What happened:

```text
rustup is now present at:
  C:\Users\Administrator\.cargo\bin\rustup.exe

Initial state:
  rustup 1.29.0 present
  rustc/cargo proxies present
  no usable default toolchain
  stable-x86_64-pc-windows-msvc existed but had "Missing manifest"

Attempts:
  rustup default stable
    -> set default but still reported error reading rustc version

  rustup toolchain uninstall stable-x86_64-pc-windows-msvc;
  rustup toolchain install stable --profile minimal;
  rustup default stable
    -> hung until timeout; rustup processes remained and were killed

  manually removed the damaged stable toolchain directory after verifying the
  resolved path stayed under C:\Users\Administrator\.rustup\toolchains

  rustup toolchain install stable --profile minimal --no-self-update
    -> hung until timeout

  rustup toolchain install stable --profile minimal --no-self-update --force
  with RUSTUP_CONCURRENT_DOWNLOADS=1 and RUSTUP_DOWNLOAD_TIMEOUT=30
    -> still hung until timeout

Network checks:
  HEAD https://static.rust-lang.org/dist/channel-rust-stable.toml -> 200
  HEAD https://win.rustup.rs/x86_64 -> 200
```

Interpretation:

```text
This is still a host/toolchain blocker, not a repo-code blocker. Do not mark
Tauri real build proof complete. Avoid further rustup commands in unattended
runs unless using a different installation strategy, because even rustup show
can hang in the current state.
```

Next ordered tasks:

```text
1. Configure local M3 real provider variables and run:
   npm run smoke:m3-real-provider
2. Try a genuinely different Rust path later, such as Scoop/choco/MSI/manual
   repair, then run npm --prefix apps/desktop-app run tauri:build.
3. Current next product task: UI integration smoke for the browser desktop MVP.
4. Then prod bundle verification.
5. Then remote GitHub Actions run/push verification.
6. Then smoke lock mechanism.
7. Then cancel archival consistency.
8. Then timeline since pagination.
9. Then GET /jobs pagination/sort/search backlog.
10. Then m2 recovery nightly CI.
```

## 2026-05-30 M3 Real Provider E2E Harness Checkpoint

Claude's new review was read and compared with the existing roadmap.

Judgment:

```text
Claude is right that UI integration smoke and prod-bundle verification should be
added soon. Codex keeps M3 real provider E2E first because it is the highest
product-value gap: M3 must prove a real planner can generate a runnable cluster.

Current host limitation:
The local .env does not currently contain M3_PLANNER_BASE_URL,
M3_PLANNER_MODEL, or M3_PLANNER_API_KEY. Therefore a true real-provider E2E run
cannot honestly pass on this machine yet. Do not fake this with the local fake
provider.
```

Completed:

```text
Added npm script:
  npm run smoke:m3-real-provider

Added scripts/smoke-m3-real-provider.ps1:
  - imports only M3 planner keys from process env or local .env;
  - fails fast if M3_PLANNER_BASE_URL, M3_PLANNER_MODEL, or
    M3_PLANNER_API_KEY are missing;
  - never prints secret values;
  - calls the configured real OpenAI-compatible planner through m3:generate;
  - validates cluster.config.json source.planner=openai-compatible;
  - starts the orchestrator with AGENT_CLUSTER_CONFIG_PATH;
  - forces FEISHU_ADAPTER_ENABLED=false, FEISHU_DRY_RUN=true,
    OPENCLAW_AGENT_MODE=mock;
  - posts a demo job and verifies DBOS executed the real-planner-generated
    stage sequence.

Added docs/m3-real-planner-known-issues.md:
  - real planner JSON contract;
  - accepted roles;
  - common failure modes such as non_json_response, unsupported_role,
    empty_stage_list, invalid_routing_mode, over_planning, provider_timeout;
  - secret-safe triage rule.

Updated README.md and SETUP.md with the optional real-provider smoke.
```

Validation:

```text
npm run smoke:m3-real-provider -> expected safe fail on this host
  missing: M3_PLANNER_BASE_URL, M3_PLANNER_MODEL, M3_PLANNER_API_KEY
  secret values were not printed

npm run check -> passed
npm run smoke:m3-real-planner -> passed
  plannerRequests=1
  planner=openai-compatible
  stageAgents=research-agent, writer-agent, video-agent
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Configure local M3 real provider variables and run:
   npm run smoke:m3-real-provider
   This is the remaining proof for the current M3 real-provider task.
2. Rust/Tauri build via a non-winget path (manual rustup-init, Scoop, or another
   non-hanging installer).
3. UI integration smoke: create job through browser UI, inspect timeline, cancel,
   and assert UI state changes.
4. Prod bundle verification: serve apps/desktop-app/dist and rerun the UI smoke.
5. Remote GitHub Actions run/push verification.
6. Smoke lock mechanism so dev-stack smokes cannot trample each other.
7. Cancel archival consistency check/fix.
8. Timeline since pagination.
9. GET /jobs pagination/sort/search backlog.
10. m2 recovery nightly CI.
```

## 2026-05-30 Desktop UI MVP Checkpoint

Claude's latest review was re-read and combined with Codex's current judgment.

Judgment:

```text
Claude is right that the next product-visible work should move from backend-only
plumbing into the desktop control surface. The repo already had timeline and
cancel APIs, so wiring a usable Desktop UI MVP now creates more product value
than spending another turn on the private Feishu/VPS path.

Codex adjustment:
Rust/Tauri real packaging remains important, but on this host it is blocked by
the missing Rust toolchain / hanging winget installer path. Keep product work
moving through the browser/Vite desktop frontend, then retry Tauri packaging
through a non-winget Rust installer path.
```

Completed:

```text
Added GET /jobs list support:
  - packages/shared/src/types.ts exports JOB_STATUSES.
  - packages/db/src/jobs.ts adds listJobs({ limit, status, ingressOrigin }).
  - apps/orchestrator-api/src/server.ts exposes GET /jobs?limit=&status=&ingressOrigin=.

Added local desktop CORS:
  - default origins: http://localhost:5173, http://127.0.0.1:5173,
    tauri://localhost.
  - .env.example documents ORCHESTRATOR_CORS_ORIGINS.

Upgraded apps/desktop-app from a thin demo into a job-control MVP:
  - creates jobs with prompt, routing mode, and max model-call budget;
  - lists recent jobs;
  - selects a job and displays status, ingress, routing, budget, timestamps;
  - reads /jobs/:id/timeline and displays timeline events;
  - calls /jobs/:id/cancel for cancellable jobs;
  - has a dense dashboard layout suitable for repeated operator use.

Updated docs:
  - README.md notes the desktop shell now create/list/inspect/cancel jobs.
  - SETUP.md records the UI-consumed endpoints.
  - apps/desktop-app/README.md describes the current MVP surface.

Strengthened HTTP-only smoke:
  - validates local CORS preflight from http://localhost:5173;
  - validates the created job appears in GET /jobs.
```

Validation:

```text
npm run check -> passed
npm --prefix apps/desktop-app run build -> passed
npm run smoke:tauri-shell -> passed
  rustToolchain=missing
  buildRunnable=false
npm run check:no-secrets -> passed
npm run smoke:http-only -> passed
  job=JOB-20260530-DEEFC053
  terminalStatus=succeeded
  ingressOrigin=http
  messageCount=4
  finalMessageCount=2
  timelineItemCount=86
  checked includes local_cors_preflight, http_list_jobs, http_get_job_timeline
npm run smoke:cancel-job -> passed
  job=JOB-20260530-A272645E
  waitingStatus=waiting_for_human
  cancelStatus=cancelled
  secondCancelReason=already_cancelled
  timelineCancelEvents=2
git diff --check -> passed; only Windows CRLF warnings were printed

Vite desktop dev server is running:
  http://127.0.0.1:5173

Headless Edge visual verification passed. Screenshot artifact:
  .runtime/desktop-dev/desktop-mvp-ready.png
```

Next ordered tasks:

```text
1. Current completed: Desktop UI MVP create/list/inspect/cancel wiring.
2. Next: M3 real provider E2E with a real local provider env, without printing
   or saving secrets.
3. Then: Rust/Tauri build via a non-winget path (manual rustup-init, Scoop, or
   another non-hanging installer).
4. Then: remote GitHub Actions run/push verification.
5. Then: smoke lock mechanism so dev-stack smokes cannot trample each other.
6. Then: cancel archival consistency check/fix.
7. Then: timeline since pagination.
8. Then: m2 recovery nightly CI.
```

## 2026-05-30 Claude Review And Open-Source License Checkpoint

Claude's latest analysis was reviewed independently instead of adopted blindly.

Judgment:

```text
Claude was mostly right on the product risks:
1. M3 real planner is a real missing product-value layer and should move up.
2. Tauri shell smoke was too shallow if it only checked file presence.
3. Smoke-script concurrency risk should live in project docs/checks, not only
   in chat memory.
4. tomorrow123.art remains a private/reference deployment task, not product
   mainline.

Adjustment:
1. LICENSE is cheap and important for open-source readiness, so it was done
   immediately.
2. Rust/Tauri real build proof matters, but should not block M3 real planner
   on this host just because cargo/rustc is currently missing.
3. The next mainline should keep product value first: harden smokes/docs, then
   start M3 real planner vertical slice.
```

Completed in this checkpoint:

```text
Added LICENSE with Apache-2.0 terms.
Added "license": "Apache-2.0" to root package.json.
Added "license": "Apache-2.0" to apps/desktop-app/package.json.
Updated README.md with a License section.
Regenerated package-lock metadata through npm install --package-lock-only
--ignore-scripts.
```

Next ordered tasks:

```text
1. Current: harden smoke guidance and smoke:tauri-shell content assertions.
2. Next: M3 real planner vertical slice behind explicit env/provider config.
3. Then: CI for no-secret checks (check, http-only smoke, m3 smoke,
   tauri-shell smoke).
4. Then: INSTALL.md / SECURITY.md / CONTRIBUTING.md.
5. Then: Rust toolchain + real Tauri build proof when host/tooling is ready.
6. Later: job timeline/inspect endpoint and cancel job API.
```

## 2026-05-30 Smoke Guidance And Tauri Shell Checkpoint

Completed:

```text
Updated SETUP.md with Smoke Script Rules:
  - run local smoke scripts sequentially;
  - several scripts share npm run dev:start/dev:stop, Postgres, and port 3000;
  - smoke:docker-compose uses an isolated Compose project and should be treated
    as a separate quickstart proof;
  - smoke:feishu-public remains a private/reference deployment check.

Strengthened scripts/smoke-tauri-shell.ps1:
  - asserts Vite dev server host/port/strictPort;
  - asserts Tauri productName, identifier, devUrl, frontendDist;
  - asserts desktop tauri:dev and tauri:build scripts;
  - asserts Cargo package name and Tauri v2 dependency.
```

Validation:

```text
npm run smoke:tauri-shell -> passed
  rustToolchain=missing
  buildRunnable=false
  checked=react_shell_files, api_client, vite_dev_server_config,
          tauri_config, desktop_package_scripts, cargo_manifest,
          rust_toolchain_probe

npm run check -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Current: M3 real planner vertical slice behind explicit env/provider config.
2. Then: CI for no-secret checks (check, http-only smoke, m3 smoke,
   tauri-shell smoke).
3. Then: INSTALL.md / SECURITY.md / CONTRIBUTING.md.
4. Then: Rust toolchain + real Tauri build proof when host/tooling is ready.
5. Later: job timeline/inspect endpoint and cancel job API.
```

## 2026-05-30 M3 Real Planner Checkpoint

M3 now has a real-planner vertical slice while preserving the mock default.

Code changes:

```text
Updated scripts/generate-cluster-config.ts:
  - added --planner mock|openai-compatible;
  - added optional --model and --base-url CLI overrides;
  - added M3_PLANNER_MODE, M3_PLANNER_BASE_URL, M3_PLANNER_MODEL,
    M3_PLANNER_API_KEY, M3_PLANNER_TEMPERATURE, and
    M3_PLANNER_TIMEOUT_SECONDS env support;
  - default remains mock and requires no secret/network call;
  - openai-compatible planner calls /chat/completions, asks for JSON, validates
    roles against the local role catalog, and converts planner-selected stages
    into AgentClusterConfig.

Updated AgentClusterConfig source metadata:
  - source.planner is now "mock" | "openai-compatible";
  - source.model can record the planner model without storing secrets.

Added scripts/smoke-m3-real-planner.ts and npm run smoke:m3-real-planner:
  - starts a local fake OpenAI-compatible chat-completions provider;
  - runs m3:generate through the openai-compatible planner path;
  - verifies auth/model request shape, JSON response parsing, source metadata,
    and planner-selected stage order.

Updated .env.example / README.md / SETUP.md with the optional planner env and
the new smoke.
```

Validation:

```text
npm run smoke:m3-real-planner -> passed
  planner=openai-compatible
  model=planner-smoke-model
  stageAgents=research-agent, writer-agent, video-agent

npm run check -> passed
git diff --check -> passed; only Windows CRLF warnings were printed

npm run smoke:m3-config -> passed
  job=JOB-20260530-9ECC11C2
  terminalStatus=succeeded
  stageAgents=research-agent, writer-agent, image-agent
```

Notes:

```text
Do not commit real M3 planner API keys. Real provider use is opt-in through
environment variables. The fake-provider smoke is the normal CI-safe proof.

During smoke:m3-config, Docker Desktop printed a transient npipe connection
warning but the local dev stack started and the smoke passed.
```

Next ordered tasks:

```text
1. Current: CI for no-secret checks (check, http-only smoke, m3 smoke,
   m3-real-planner smoke, tauri-shell smoke).
2. Then: INSTALL.md / SECURITY.md / CONTRIBUTING.md.
3. Then: Rust toolchain + real Tauri build proof when host/tooling is ready.
4. Later: job timeline/inspect endpoint and cancel job API.
```

## 2026-05-30 CI Checkpoint

CI scaffolding is added for the open-source product path.

Code changes:

```text
Added .github/workflows/ci.yml with two jobs:
  node-smokes on windows-latest:
    npm ci
    npm run check
    npm run check:no-secrets
    npm run smoke:m3-real-planner
    npm run smoke:tauri-shell

  docker-quickstart on ubuntu-latest:
    docker compose up -d --build
    POST /jobs
    poll job to succeeded
    verify ingressOrigin=http
    GET /jobs/:id/messages
    docker compose down -v

Added scripts/check-no-secrets.ts and npm run check:no-secrets.
The check scans tracked files for high-confidence secret-looking tokens and
non-placeholder values for sensitive env names, while allowing documented local
smoke placeholders and GitHub secrets references.

Updated README.md and SETUP.md with the new check and CI-safe subset.
```

Local validation:

```text
npm run check -> passed
npm run check:no-secrets -> passed
npm run smoke:m3-real-planner -> passed
npm run smoke:tauri-shell -> passed
docker compose config -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Notes:

```text
The full GitHub Actions workflow has not run remotely from this local session.
The Ubuntu docker-quickstart job is designed to test the HTTP-only product path
without relying on Windows PowerShell scripts.
```

Next ordered tasks:

```text
1. Current: INSTALL.md / SECURITY.md / CONTRIBUTING.md.
2. Then: Rust toolchain + real Tauri build proof when host/tooling is ready.
3. Then: job timeline/inspect endpoint.
4. Then: cancel job API.
```

## 2026-05-30 Open-Source Docs Checkpoint

Completed:

```text
Added INSTALL.md:
  - Docker quickstart;
  - local development;
  - M3 mock and real planner usage;
  - optional Feishu/OpenClaw integration notes.

Added SECURITY.md:
  - early-stage support status;
  - secret handling rules;
  - public ingress exposure boundary;
  - admin endpoint caution;
  - OpenClaw adapter boundary;
  - reporting note.

Added CONTRIBUTING.md:
  - product direction;
  - OpenClaw/ClawPanel boundary;
  - development checks;
  - sequential smoke rule;
  - PR expectations.

Updated README.md to link INSTALL.md, SECURITY.md, and CONTRIBUTING.md.
```

Validation:

```text
npm run check:no-secrets -> passed
npm run check -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Current: Rust toolchain + real Tauri build proof when host/tooling is ready.
2. Then: job timeline/inspect endpoint.
3. Then: cancel job API.
```

## 2026-05-30 Tauri Build Toolchain Attempt

Local Tauri real-build proof is still blocked by host toolchain installation.

What happened:

```text
Initial probe:
  cargo -> missing
  rustc -> missing
  rustup -> missing

Attempted:
  winget install --id Rustlang.Rustup -e --silent
    --accept-package-agreements --accept-source-agreements

Result:
  the command timed out after 10 minutes;
  winget.exe and rustup-init.exe continued running but sat idle;
  both processes were stopped to avoid leaving a hung installer.
```

Interpretation:

```text
This is a host/tooling blocker, not a repo-code blocker. Do not mark Tauri real
build proof complete yet. The current verified Tauri status remains:
  npm run smoke:tauri-shell -> passed
  rustToolchain=missing
  buildRunnable=false
```

Next ordered tasks:

```text
1. Current: job timeline/inspect endpoint.
2. Then: cancel job API.
3. Later: retry Rust/Tauri real build after Rustup can be installed manually or
   through a non-hanging installer path.
```

## 2026-05-30 Job Timeline Inspect Checkpoint

Implemented a UI-friendly job inspection endpoint.

Code changes:

```text
Added GET /jobs/:jobId/timeline?limit=200.

packages/db/src/pipeline.ts:
  - added getJobTimeline(jobId, { limit });
  - aggregates job_events, agent_events, group_messages, stage_attempts,
    test_reviews, and artifacts into sorted timeline items;
  - returns a compact job summary and counts for desktop/UI inspection;
  - caps limit to 1..1000 and returns the latest items when truncated.

apps/orchestrator-api/src/server.ts:
  - added query validation with zod;
  - returns 404 job_not_found for missing jobs.

scripts/smoke-http-only-end-to-end.ps1:
  - now calls /jobs/:jobId/timeline;
  - asserts job/status/ingressOrigin;
  - asserts timeline includes all expected sources.

README.md and SETUP.md now show the timeline endpoint in quickstart/use docs.
```

Validation:

```text
npm run check -> passed
git diff --check -> passed; only Windows CRLF warnings were printed

npm run smoke:http-only -> passed
  job=JOB-20260530-CA185005
  terminalStatus=succeeded
  ingressOrigin=http
  messageCount=4
  finalMessageCount=2
  timelineItemCount=86
  timelineSources=job_event, agent_event, artifact, group_message,
                  stage_attempt, test_review
```

Next ordered tasks:

```text
1. Current: cancel job API.
2. Later: retry Rust/Tauri real build after Rustup can be installed manually or
   through a non-hanging installer path.
```

## 2026-05-30 Cancel Job API Checkpoint

Implemented cooperative job cancellation.

Code changes:

```text
Added POST /jobs/:jobId/cancel.
Request body:
  reason?: string
  requesterId?: string

API behavior:
  - 404 for missing job;
  - 409 for succeeded/failed jobs;
  - idempotent success for already-cancelled jobs;
  - non-terminal jobs become cancelled and emit job.cancelled.

packages/db/src/jobs.ts:
  - added cancelJob;
  - setJobStatus no longer overwrites cancelled jobs with later non-cancel
    statuses;
  - setJobFinalOutput does not mark cancelled jobs succeeded.

apps/dbos-worker:
  - added isJobCancelled DBOS step;
  - workflow checks cancellation at major step boundaries and routing loops;
  - finalizeJob skips final message/archive if the final status update is
    blocked by cancellation.

Added scripts/smoke-cancel-job.ps1 and npm run smoke:cancel-job.
README.md and SETUP.md now include the cancel smoke.
```

Validation:

```text
npm run smoke:cancel-job -> passed
  job=JOB-20260530-F0E4DC1E
  waitingStatus=waiting_for_human
  cancelStatus=cancelled
  secondCancelReason=already_cancelled
  timelineCancelEvents=2

npm run smoke:http-only -> passed after cancellation changes
  job=JOB-20260530-5C02CBA4
  terminalStatus=succeeded
  timelineItemCount=86

npm run check -> passed
npm run check:no-secrets -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
```

Next ordered tasks:

```text
1. Retry Rust/Tauri real build after Rustup can be installed manually or through
   a non-hanging installer path.
2. Continue product work: desktop UI wiring can now read /jobs/:id/timeline and
   call /jobs/:id/cancel.
```

## 2026-05-28 Stage 1.1 Adapter Abstraction Checkpoint

Stage 1.1 is implemented: HTTP is now the core ingress/egress path and Feishu
is an optional adapter/plugin.

Code changes:

```text
1. packages/shared/src/types.ts
   - added INGRESS_ORIGINS, IngressOrigin, IngressAdapter, EgressAdapter,
     OutboundMessage, DeliveryResult.
2. packages/db/src/migrate.ts
   - added agent.jobs.ingress_origin text not null default 'http'.
3. packages/db/src/jobs.ts
   - createJob persists ingressOrigin; JobRecord exposes ingressOrigin.
4. apps/orchestrator-api/src/adapters/
   - added HTTP ingress adapter for POST /jobs.
   - added Feishu ingress adapter for POST /webhooks/feishu/events.
   - Feishu adapter is disabled when FEISHU_ADAPTER_ENABLED=false and otherwise
     enabled when Feishu-related env is present.
5. apps/orchestrator-api/src/server.ts
   - mounts enabled ingress adapters.
   - added GET /jobs/:jobId/messages for HTTP egress consumption.
6. apps/dbos-worker/src/egress/
   - added EgressDispatcher, HttpEgressAdapter, FeishuEgressAdapter.
   - worker group-message delivery now routes by job.ingressOrigin.
7. scripts/smoke-http-only-end-to-end.ps1
   - added HTTP-only smoke with FEISHU_ADAPTER_ENABLED=false.
8. scripts/smoke-feishu-webhook.ps1
   - now asserts Feishu-created jobs have ingressOrigin=feishu.
9. README.md / SETUP.md
   - updated product smoke order and documented HTTP-only core path.
```

Validation:

```text
npm run check -> passed
npm run smoke:http-only -> passed
  job=JOB-20260528-7153FEB0
  terminalStatus=succeeded
  ingressOrigin=http
  messageCount=4
  finalMessageCount=2
  Feishu adapter disabled and no Feishu message id attached.

npm run smoke:feishu-webhook -> passed
  job=JOB-20260528-6187CD70
  terminalStatus=succeeded
  ingressOrigin=feishu assertion passed

npm run smoke:m2-recovery -> passed before final doc/smoke assertion edits
  pipeline job=JOB-20260528-0484B8DE succeeded
  master_slave_discussion job=JOB-20260528-85E3E240 succeeded

git diff --check -> passed; only Windows CRLF warnings were printed.
```

Notes:

```text
Do not run multiple smoke scripts that call npm run dev:start in parallel.
They share the same Postgres/dev stack and can race during migration. Sequential
runs are clean.

npm run smoke:feishu-public is not a Stage 1.1 product gate. It remains a
private/reference deployment check for tomorrow123.art and is still expected to
fail until VPS Nginx/frp routing is configured.
```

Next ordered tasks:

```text
1. Completed: Stage 1.1 committed as c30f4d6 Add adapter-based ingress and egress.
2. Stage 1.2: Docker Compose one-command quickstart, default HTTP-only.
3. Add smoke:docker-compose on a clean runner path.
4. After Docker quickstart, start M3 config generation vertical slice.
5. Later: OpenClaw real-mode E2E proof and Tauri shell.
```

## 2026-05-28 Stage 1.2 Docker Compose Quickstart Checkpoint

Task 2 is implemented: Docker Compose now describes the default open-source
quickstart stack.

Code changes:

```text
Added .dockerignore.
Added Dockerfile.api.
Added Dockerfile.worker.
Added packages/db/src/wait-for-postgres.ts.
Updated docker-compose.yml:
  postgres: postgres:17-alpine with persistent postgres-data volume.
  orchestrator-api: HTTP API on port 3000, runs wait -> migrate -> server.
  dbos-worker: optional recovery worker, starts after API is healthy.
  job-data volume persists generated job files.
  default env is HTTP-only + mock:
    FEISHU_ADAPTER_ENABLED=false
    FEISHU_DRY_RUN=true
    OPENCLAW_AGENT_MODE=mock
Updated scripts/start-dev.ps1 to start only the postgres service so local dev
does not collide with the Docker quickstart API container.
Updated README.md and SETUP.md so docker compose up --build is the public
quickstart path.
```

Validation:

```text
npm run build -> passed
npm run check -> passed
docker compose config -> passed
```

Next ordered tasks:

```text
1. Completed: Stage 1.1 committed as c30f4d6.
2. Completed: Stage 1.2 Docker Compose quickstart files/config.
3. Current: add and run smoke:docker-compose from up -> POST /jobs -> poll -> messages -> down.
4. Next: M3 config generation vertical slice.
5. Later: OpenClaw real-mode E2E proof and Tauri shell.
```

## 2026-05-28 Docker Compose Smoke Checkpoint

Task 3 is implemented and verified.

Code changes:

```text
Added scripts/smoke-docker-compose.ps1.
Added npm script: npm run smoke:docker-compose.
Updated README.md and SETUP.md to include the repeatable Docker smoke.
```

Smoke behavior:

```text
1. stops local dev stack;
2. uses isolated compose project agent-openclaw-smoke;
3. docker compose up -d --build;
4. waits for /health;
5. POST /jobs through HTTP core ingress;
6. polls job to succeeded;
7. reads GET /jobs/:jobId/messages;
8. docker compose down, then up again without deleting the smoke volume;
9. verifies the job is still present;
10. final cleanup removes only the smoke project volumes.
```

Validation:

```text
npm run smoke:docker-compose -> passed
  job=JOB-20260528-A047A8AC
  terminalStatus=succeeded
  ingressOrigin=http
  messageCount=4
  persistenceCheck=passed

Note:
  The first attempt exposed a local Postgres 16 volume vs Postgres 17 image
  incompatibility. The smoke now uses an isolated compose project so it does
  not touch or delete the user's existing default development volume.
```

Next ordered tasks:

```text
1. Completed: Stage 1.1 committed as c30f4d6.
2. Completed: Stage 1.2 Docker Compose quickstart, committed as c5fee50.
3. Completed: smoke:docker-compose verified, committed as c5fee50.
4. Current: M3 config generation vertical slice.
5. Later: OpenClaw real-mode E2E proof and Tauri shell.
```

## 2026-05-28 M3 Config Generation Vertical Slice Checkpoint

Task 4 is implemented and verified. M3 now exists as a backend/CLI vertical
slice before any Tauri UI work.

Code changes:

```text
Added examples/m3/interview.answers.example.json.
Added scripts/generate-cluster-config.ts.
Added scripts/smoke-m3-config.ps1.
Added npm scripts:
  npm run m3:generate
  npm run smoke:m3-config
Added packages/shared AgentClusterConfig types.
Added apps/dbos-worker/src/config/cluster.ts.
Updated createPipelinePlan so AGENT_CLUSTER_CONFIG_PATH is read inside the
checkpointed DBOS planning step. If not set, the old prompt-inference behavior
remains unchanged.
Updated README.md and SETUP.md with M3 CLI/smoke usage.
```

Generated cluster flow:

```text
structured interview answers JSON
  -> mock planner
  -> preview gate
  -> cluster.config.json
  -> agents/<agent-id>/AGENTS.md
  -> AGENT_CLUSTER_CONFIG_PATH
  -> DBOS createPipelinePlan uses generated stages
```

Validation:

```text
npm run m3:generate -- --answers examples/m3/interview.answers.example.json --out .runtime/m3-preview-test
  preview passed without writing files

npm run smoke:m3-config -> passed
  generated cluster=content-studio-demo
  config=.runtime/m3-config-smoke/cluster.config.json
  job=JOB-20260528-FA47F791
  terminalStatus=succeeded
  stageAgents=research-agent, writer-agent, image-agent
```

Notes:

```text
The first smoke attempt exposed the default Postgres 16 volume vs Postgres 17
image incompatibility. docker-compose.yml now uses a new postgres17-data volume
name, preserving the old PG16 volume without deleting user data.
```

Next ordered tasks:

```text
1. Completed: Stage 1.1 committed as c30f4d6.
2. Completed: Stage 1.2 / smoke:docker-compose committed as c5fee50.
3. Completed: M3 config generation vertical slice, committed as 4838a1f.
4. Current: OpenClaw real-mode E2E proof.
5. Then: Tauri shell initial proof.
```

## 2026-05-28 OpenClaw Real Mode And Tauri Shell Checkpoint

Task 5 is implemented to the current environment boundary.

OpenClaw real-mode changes:

```text
Added scripts/smoke-openclaw-real.ps1.
Added npm script: npm run smoke:openclaw-real.
Updated apps/dbos-worker/src/adapters/openclaw.ts:
  - OpenClaw external session ids are sanitized because OpenClaw rejects colons.
  - OpenClaw JSON extraction now reads payloads[0].text and finalAssistant* fields.
Updated packages/db/src/model-calls.ts and activities error handling:
  - model-call error text strips NUL bytes before PostgreSQL writes.
Updated tool.openclaw_agent_completed event payload to include mode.
```

Real-mode validation:

```text
Direct OpenClaw CLI probe:
  OpenClaw 2026.5.7 (eeef486)
  writer-agent direct call returned JSON.

First orchestrator real-mode attempt:
  job=JOB-20260528-2B3CB19D
  exposed two real bugs:
    1. OpenClaw rejects colon-containing session ids.
    2. WSL/OpenClaw error text can include NUL bytes that PostgreSQL rejects.
  Both bugs were fixed.

npm run smoke:openclaw-real -> passed
  job=JOB-20260528-C809526F
  terminalStatus=succeeded
  routingMode=classic_master_slave
  realCompletionEvents=1
  stageOutputArtifacts=1
```

Tauri shell changes:

```text
Added apps/desktop-app:
  package.json
  index.html
  tsconfig.json
  vite.config.ts
  src/api.ts
  src/main.tsx
  src/styles.css
  src-tauri/Cargo.toml
  src-tauri/build.rs
  src-tauri/src/main.rs
  src-tauri/tauri.conf.json
  README.md
Added scripts/smoke-tauri-shell.ps1.
Added npm script: npm run smoke:tauri-shell.
Updated README.md and SETUP.md with real-mode and Tauri shell instructions.
```

Tauri validation:

```text
npm run smoke:tauri-shell -> passed
  shell files present
  API client present
  Tauri config present
  Cargo manifest present
  rustToolchain=missing
  buildRunnable=false

Interpretation:
  Tauri shell scaffold is present and structurally valid. Full Tauri build was
  not run because this Windows host currently has no cargo/rustc installed.
```

Next ordered tasks after Task 5:

```text
1. Completed: Task 5 committed as 1c1b194 Prove real mode and scaffold desktop shell.
2. Add CI: npm run check + smoke:http-only + smoke:m3-config + smoke:tauri-shell.
3. Add INSTALL.md / SECURITY.md / LICENSE.
4. Add job timeline/inspect endpoint or CLI.
5. Add cancel job API.
6. Install Rust toolchain and run a real Tauri build.
```

## 2026-05-28 Product Direction Correction

The product goal is an open-source, downloadable multi-agent orchestration
platform built on top of OpenClaw. Users should be able to download it, start an
agent cluster, switch among four routing modes, generate configuration through
an interview-style flow, and eventually manage it through a Tauri desktop
console.

Important correction:

```text
tomorrow123.art / Feishu public webhook is not the product goal. It is the
author's private/reference deployment path for demos and self-use.

The code/doc work already added for public Feishu ingress is still useful as a
reference deployment example and smoke-test harness. However, manually
configuring VPS Nginx + frp for tomorrow123.art should not be treated as the
main product milestone.
```

Current product-level estimate:

```text
Orchestration kernel: ~80-90% skeleton complete.
Overall open-source downloadable product: ~25-30% complete.

Major gaps:
1. M3 configuration generation pipeline: interview -> role plan -> prompt
   generation -> preview gate -> injection.
2. Input adapter abstraction: Feishu should become one adapter, not the entry
   model.
3. OpenClaw real-mode end-to-end verification.
4. Docker Compose / one-command local install path.
5. Open-source readiness: LICENSE, CI, INSTALL, demo.
6. Tauri desktop console scaffold and later full UI.
```

Revised mainline direction:

```text
Primary product path:
1. Input-adapter abstraction + keep Feishu as first concrete adapter.
2. Docker Compose one-command local quickstart for Postgres + API + worker.
3. M3 configuration generation pipeline, initially as a backend/CLI vertical
   slice before the Tauri UI.
4. OpenClaw real-mode E2E proof.
5. Tauri desktop app scaffold and control surface.

Demoted/off-critical-path:
  tomorrow123.art VPS Nginx + frp + Feishu verify. Keep as private demo/reference
  deployment task only, useful when preparing a demo video or blog post.
```

Stage 0 product boundary decision recommendation after reviewing the Claude
discussion file:

```text
UI delivery:
  Choose option C: one React/TypeScript Web UI that can run in browser and can
  also be packaged inside a Tauri desktop shell. Tauri is the default end-user
  download experience, but the Web UI remains available for developers/server
  deployments.

Tauri backend startup:
  Choose option 3: phased approach. v1 Tauri is a thin client that connects to a
  local backend started by Docker Compose / one-click scripts; v2 can revisit an
  embedded sidecar. Do not switch away from Postgres/pglite/sqlite prematurely,
  because DBOS checkpointing and the current agent ledger are already built on
  PostgreSQL.

Confirmed platform boundary:
  docker compose default is HTTP-only; Feishu is an optional plugin/adapter.
  POST /jobs or an equivalent HTTP ingress remains the core always-on path.
```

Stage 0 closed by user on 2026-05-28:

```text
Decisions confirmed:
1. UI delivery uses option C: one React/TypeScript Web UI, also packaged by
   Tauri for default end-user desktop delivery.
2. Tauri backend startup uses option 3: v1 thin client + Docker Compose /
   one-click scripts; v2 may revisit embedded sidecar.
3. v1 keeps PostgreSQL. Do not switch to pglite/sqlite because DBOS checkpoint
   tables and the agent ledger depend on PostgreSQL behavior.
4. docker compose default is HTTP-only; Feishu is optional plugin/adapter.

Current implementation sequence:
1. Stage 1.1: IngressAdapter/EgressAdapter abstraction.
2. Stage 1.1 acceptance: HTTP-only smoke plus existing Feishu/M2 smokes pass.
3. Stage 1.2: Docker Compose quickstart after Feishu is decoupled.
```

## 2026-05-28 Public Feishu Ingress Status Checkpoint

Historical/private deployment note:

```text
This section records useful public Feishu ingress prep work, but it is no
longer the product mainline. Product mainline is the Stage 0 decision closure,
then InputAdapter abstraction, Docker Compose quickstart, and M3 config
generation. tomorrow123.art work is private demo/reference deployment.
```

ICP 备案已通过，公网 webhook 工作从“等待备案/DNS”切换到“配置
VPS Nginx + SSL + frp + 飞书后台 URL”的阶段。

Current status check:

```text
git status:
  ## master
   M CONTEXT.md

DNS:
  tomorrow123.art -> 49.232.90.172

HTTP/HTTPS:
  http://tomorrow123.art/health -> 308 Permanent Redirect
  https://tomorrow123.art/health -> 200 {"status":"ok"}
  https://tomorrow123.art/webhooks/feishu/events -> 404
```

Interpretation:

```text
1. DNS is correct and still points to the VPS.
2. HTTPS is alive on the VPS.
3. The current /health response is not the local orchestrator-api response
   (`orchestrator-api` returns {"ok":true}), so it is likely a VPS/Nginx
   health endpoint.
4. The Feishu webhook path is not yet proxied to local orchestrator-api/frp.
5. Do not configure Feishu backend as final until POST challenge on
   /webhooks/feishu/events reaches orchestrator-api and returns challenge.
```

Historical immediate work for private/reference deployment:

```text
1. Add public ingress docs and templates for VPS Nginx, frps/frpc, Feishu
   backend configuration, and mock-mode E2E checklist.
2. Add a public webhook smoke script that can verify challenge, invalid token,
   and optional fake message creation through the public URL.
3. Keep first private/reference deployment pass in OPENCLAW_AGENT_MODE=mock.
4. This no longer blocks product mainline work.
```

Work completed in this pass:

```text
Added docs/feishu-public-ingress.md.
Added config/public-ingress/nginx/tomorrow123.art.conf.example.
Added config/public-ingress/frp/frps.toml.example.
Added config/public-ingress/frp/frpc.toml.example.
Added config/public-ingress/systemd/frps-agent-openclaw.service.example.
Added config/public-ingress/systemd/frpc-agent-openclaw.service.example.
Added scripts/smoke-public-feishu-webhook.ps1.
Added npm script: npm run smoke:feishu-public.
Updated README.md and SETUP.md to point to the public ingress guide/templates.
```

Verification:

```text
npm run smoke:feishu-public
  result: failed at challenge check
  observed: challenge status expected 200, got 404

This is the expected current failure while
https://tomorrow123.art/webhooks/feishu/events is not yet proxied to the local
orchestrator-api through Nginx/frp.

npm run check
  passed

git diff --check
  passed; only Windows CRLF warnings were printed
```

Deployment attempt status:

```text
SSH network check:
  tomorrow123.art:22 reachable

SSH auth check:
  root@tomorrow123.art -> Permission denied (publickey,password)
  ubuntu@tomorrow123.art -> Permission denied (publickey,password)

Interpretation:
  The current Windows machine can reach the VPS SSH port, but has no configured
  non-interactive SSH key/login for the VPS. Codex cannot directly install frps
  or edit Nginx on the VPS from this environment until SSH access is provided
  or commands are run manually on the VPS.
```

Local/public-ingress preparation status:

```text
npm run smoke:feishu-webhook
  passed
  job=JOB-20260528-F9A66E71
  terminalStatus=succeeded

npm run prepare:public-ingress
  passed
  generated untracked deployment bundle under .runtime/public-ingress/
  generated frp token under .runtime/public-ingress/frp-token.txt
  generated VPS frps config, VPS Nginx config, local frpc config, and command
  helper files

npm run dev:stop
  passed

Restarted local dev stack for public E2E:
  OPENCLAW_AGENT_MODE=mock
  FEISHU_DRY_RUN=false
  npm run dev:start -> API http://localhost:3000

Local readiness:
  http://localhost:3000/health -> {"ok":true}
  POST http://localhost:3000/webhooks/feishu/events with .env
  FEISHU_VERIFICATION_TOKEN challenge -> passed
```

Current blocker:

```text
VPS work still needs to be performed manually or through valid SSH access:
1. install/start frps with .runtime/public-ingress/vps/etc/frp/agent-openclaw-frps.toml
2. start local frpc with .runtime/public-ingress/local/frpc/agent-openclaw-frpc.toml
3. update Nginx with .runtime/public-ingress/vps/nginx/tomorrow123.art.conf
4. nginx -t && reload
5. rerun npm run smoke:feishu-public; expected result after proxy is fixed:
   challenge 200, wrong token 401, optional synthetic message succeeded
```

Final sanity check after local preparation:

```text
npm run check -> passed
git diff --check -> passed; only Windows CRLF warnings were printed
http://localhost:3000/health -> {"ok":true}
https://tomorrow123.art/webhooks/feishu/events -> 404 Not Found

Interpretation:
  Local orchestrator-api is ready in mock-mode public-E2E settings.
  The remaining gap is still VPS frps + Nginx routing to the local frpc tunnel.
```

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

## 2026-05-28 Tech Stack Confirmation and M3 Desktop Framework Decision

Tech stack confirmed:

```text
Backend  : Node.js + TypeScript（monorepo，npm workspaces）
Apps     : apps/orchestrator-api（HTTP API）, apps/dbos-worker（DBOS workflow engine）
Database : PostgreSQL — dbos.* checkpoint 表 + agent.* 业务账本
Frontend : v1 无 web 前端。飞书是人机界面层。
M3 app   : Tauri + React + TypeScript（桌面控制台 — 尚未开始）
```

M3 桌面框架决策：选 Tauri，不选 Electron。

```text
- Tauri 使用操作系统原生 WebView，打包体积约 5-15 MB；
  Electron 自带 Chromium，打包体积约 150-300 MB。
- 前端仍然是 React + TypeScript，团队无需学新技术。
- M3 桌面 app 只是配置 UI + 状态面板，业务逻辑在 orchestrator-api，
  桌面 app 通过 localhost HTTP 调用 API；Tauri Rust 主进程极简。
- Tauri 2.0 2026 年已稳定，新项目首选。
- Electron 的 Node.js 主进程优势在本项目不适用（后端独立运行，不内嵌）。
```

M3 monorepo 结构（尚未开始）：

```text
apps/desktop-app/     Tauri shell
  src/main/           Rust 主进程（极简）
  src/renderer/       React + TypeScript UI
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

> ⚠️ 以下为历史记录（DBOS 迁移前，Temporal 时代）。**当前技术栈以顶部各里程碑 Checkpoint 为准**：Node.js + TypeScript 后端，PostgreSQL，DBOS 取代 Temporal，无 web 前端，M3 桌面 app 选 Tauri + React + TypeScript。

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

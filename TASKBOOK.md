你是执行者，这份文档是你唯一的任务来源；中途没人可问，拿不准的写进 BLOCKED.md，跳过继续做别的，最后随交付提交。断线换新会话先读 PROGRESS.md 接着做，别重做；每做完一项立刻更新。这活为什么干：给 Claude Code 建一个能把简单调研任务甩给你（agy）自己干的插件，省 Opus 的调用额度；书里没写到的情况自己按这个目的裁。打架时让步顺序：先保证 status 字段判断正确 > 四种坑都有测试覆盖 > 代码好看。"只允许"/"不许"违反算失败；"建议"有更好的路就走，在 PROGRESS.md 记一句为什么。

## 我替领导拍的板
- 测试框架 → 默认 Node 内置 `node --test`，不装 vitest/jest（猜的，为了满足下面"不装新依赖"）｜猜错代价小。
- package.json 包名 → 默认 `quota-router-agy`（猜的）｜代价小。
- marketplace.json owner → 默认 `{"name":"quota-router"}`（猜的）｜无实质影响。

## 界限
- 白名单（只能改/建）：`plugins/agy/**`、`.claude-plugin/marketplace.json`、`tests/**`、`package.json`、`PROGRESS.md`、`BLOCKED.md`。其余只读。
- 不许碰 `GOAL.md`、`TASKBOOK.md`（这份文档本身）：基线 commit `2dd317a`，交付时 `git diff 2dd317a -- GOAL.md TASKBOOK.md` 必须为空。
- 不许碰 `../codex-plugin-cc/` 任何文件——只读参照，可以看它的 `plugins/codex/.claude-plugin/plugin.json`、`plugins/codex/commands/status.md` 当格式模板，一个字节都不许改。
- 顺手活当场拦下写 BLOCKED.md、跳过：给 cursor/codebuddy 建目录、建 `lib/` 共享层、建 job 状态机/重试循环、给 CLI 装可用性探测框架——都是 GOAL.md 3.5 节已经禁过的，这里再禁一次。

## 现状与任务0（2026-08-23 实测）
- `which agy` → `/data/home/bluejqhuang/.local/bin/agy`；`agy --version` → `1.1.19`。
- 真实跑过 `agy -p "In one sentence, what is a git rebase?" --output-format json --print-timeout 30s`，返回单行 JSON，字段与 GOAL.md 3.3 节一致（conversation_id/status/response/duration_seconds/num_turns/usage）。
- 故意传 `--model does-not-exist-model`：exit=1，`status:"ERROR"`，`error` 带出可用模型列表——和 GOAL.md 3.4 节第2坑吻合。
- `node --test` 本机可用（Node v24.14.1）。

任务0：自己重跑一遍上面几条命令核对（认证状态可能变了），对不上就停，证据写进 BLOCKED.md 最上面，只做不受影响的部分；核对无误后把"理解的目标/顺序/最大风险"（≤10行）写进 PROGRESS.md 再动工。

## 任务1：搭骨架
建 `plugins/agy/.claude-plugin/plugin.json`、根目录 `.claude-plugin/marketplace.json`（注册这一个插件）、`plugins/agy/commands/research.md`（`/agy:research <topic>`，frontmatter+`!`调用脚本，照抄 `../codex-plugin-cc/plugins/codex/commands/status.md` 的写法，换成调用 `agy-cli.mjs`）。
验收：`node -e "JSON.parse(require('fs').readFileSync('plugins/agy/.claude-plugin/plugin.json'))"`，marketplace.json 同法验证，都不报错。

## 任务2：核心脚本（GOAL.md 3.3/3.4 节是唯一真理，逐条对照）
建 `plugins/agy/scripts/agy-cli.mjs`（单文件，不拆 lib）：spawn `agy -p "<prompt>" --output-format json --print-timeout <超时>`，stdin 设为 `'ignore'`；等 `close` 事件后**整体** `JSON.parse(stdout)`，不许边收边解析；按返回的 `status` 字段判断成功/失败，不许只看退出码；stderr 出现 `denied`/`not allowed` 关键字时必须把这条提示带进给用户看的输出，不许吞掉；命令不存在（ENOENT）时给清楚报错，不做探测框架；不自己实现超时 kill，只靠 `--print-timeout`。
验收：`node plugins/agy/scripts/agy-cli.mjs research "一句话解释什么是git rebase"` 能输出一段可读文字。

## 任务3：测试（fake agy 二进制，别真调外部服务）
建 `tests/fixtures/fake-agy-bin.mjs`（按参数/环境变量输出四种预设场景的可执行 JS）和 `tests/agy-cli.test.mjs`，覆盖：①正常 SUCCESS；②ERROR（exit 1）；③soft-deny（exit 0 但 stderr 含 denied 关键字，断言这条警告确实传到了用户可见输出里）；④agy 不存在（ENOENT）。
不许用 `.skip`/`.todo`，不许 mock 被测的 `agy-cli.mjs` 本身（把它内部 spawn 的目标换成 fake 二进制是允许的，这不是 mock 被测代码），不许删测试或把断言写成恒真。
验收：`node --test tests/*.test.mjs` 输出 pass ≥ 4，fail=0，skip=0。

## 反向验证
把 `agy-cli.mjs` 里判断 `status` 的逻辑故意改反，跑一次 `node --test`，贴出变红的输出；改回来再跑一次，贴出全绿的输出。这一步不做，测试等于没验证过。

## 规矩
- 不装任何新 npm 三方包（`package.json` 不许出现 `dependencies` 字段），必须装的写 BLOCKED.md。
- 同一条验收连败3次换下一项；结果比开工（空目录）差就回滚，如实报告。

## 完成条件
- 硬指标1：`node --test tests/*.test.mjs` 显示至少4个测试全部通过、0个skip、0个fail。
- 硬指标2：`git diff 2dd317a -- GOAL.md` 输出为空，且 `../codex-plugin-cc/` 目录零改动。
- 每条都要在回复里贴真实命令输出（含反向验证红→绿两份），只说"做完了"不算数。
- `BLOCKED.md` 随交付提交，没内容也写"无"。
- 止损：跑满 8 轮仍未达标就停，如实汇报卡在哪、还差什么。

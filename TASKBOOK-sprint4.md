你是执行者，这份文档是你唯一的任务来源；中途没人可问，拿不准的写进 BLOCKED.md，跳过继续做别的，最后随交付提交。断线换新会话先读 PROGRESS.md 接着做，别重做；每做完一项立刻更新。这活为什么干：接入 codebuddy CLI，做只读调研命令 `/codebuddy:research`，和 `/agy:research`、`/cursor:research` 平级。**codebuddy 是 Claude Code 的 fork，flag 名字跟另两个几乎一样，但 JSON 形状和退出码语义全不同——照抄 cursor-cli.mjs 会把失败误判成成功。**打架时让步顺序：失败判断准确 > 超时能真杀进程 > 代码好看。"不许"违反算失败；"建议"有更好的路就走，在 PROGRESS.md 记一句为什么。

## 我替领导拍的板
- 只做同步只读调研，不做后台模式（它自带 `--bg`，但那套契约还没实测过）｜代价：以后补一个 Sprint。
- 不抽 `lib/subprocess.mjs`（GOAL.md 说三个写完就该 diff 抽象，但抽象要同时改三份已绿文件，风险类型和"新增适配器"不同，混一起出事分不清谁弄坏的）｜代价：留 Sprint 5。
- 默认超时 → 180000ms，对齐前两个 Sprint（猜的）｜代价小。

## 界限
- 白名单（只能改/建）：`plugins/codebuddy/**`、`.claude-plugin/marketplace.json`（只许往 `plugins` 追加一条，不许动 agy/cursor 那两条）、`tests/**`、`PROGRESS.md`、`BLOCKED.md`。
- 不许碰 `plugins/agy/**`、`plugins/cursor/**`、`package.json`、`../codex-plugin-cc/`。**不许 import `agy-cli.mjs` 或 `cursor-cli.mjs`**，不许建 `lib/`。
- 不许碰 `GOAL.md`：基线 `f807db1`，交付时 `git diff f807db1 -- GOAL.md` 必须为空。不许碰本文件。
- **不许传 `-y` / `--dangerously-skip-permissions`**（官方 headless 文档把它写成"必需参数"，那是针对要写文件的场景；只读调研传了等于自拆防线）。

## 必读契约（先读 GOAL.md 第 8 节，本机实测 `codebuddy 2.137.1`）
四条会让你写错代码的：
1. **stdout 是 JSON 数组不是对象**（三个 CLI 里唯一）。`JSON.parse(stdout).result` 是 `undefined`。必须 parse 后 `Array.isArray()` 校验，再 `find(x => x.type === 'result')`——**不许写死 `j[j.length-1]`**，长度随轮数变（实测 4~12）。
2. **退出码不可信**：模型名不存在时 **exit 0 + stdout 0 字节 + stderr 纯文本**（连测两次都是 0）；flag 拼错才 exit 1。**cursor 那套"exit 0 且 stdout 非空"在这里不够**，唯一可靠依据是"数组里找得到 `type:"result"`"。
3. **`is_error` 和 `permission_denials` 都是空壳**：实测真发生拒绝时前者仍 `false`、后者仍 `[]`、`subtype` 仍 `success`。拒绝原因只在 `result` 自然语言里。
4. **拒绝关键词是中文**：实测原文"被拒绝"/"禁止"/"无法完成"，英文 `blocked|rejected|denied` 一个没出现。**照抄 cursor 的正则等于没防线**。
另：`usage` 下划线命名（同 agy，不同 cursor 驼峰）；文本字段 `result`、会话 id `session_id`；**无任何 `--timeout` 参数**。

## 任务0
基线 `node --test tests/*.test.mjs` 应为 **19 pass 0 fail 0 skip**（commit `f807db1`）；对不上就停并写 BLOCKED.md。核对后把"理解的目标／顺序／最大风险"（≤10 行）写进 PROGRESS.md 再动工。

## 任务1：骨架
仿 `plugins/cursor/`：建 `plugins/codebuddy/.claude-plugin/plugin.json`、`plugins/codebuddy/commands/research.md`（`/codebuddy:research <topic>`，格式照 cursor 那份）；往根 `.claude-plugin/marketplace.json` 的 `plugins` 追加一条。
验收：两个 json 能 `JSON.parse`；`plugins` 长度 = 3；`git diff f807db1 -- .claude-plugin/marketplace.json` 里 agy/cursor 两条无改动。

## 任务2：核心脚本
建 `plugins/codebuddy/scripts/codebuddy-cli.mjs`（单文件）：
- `spawn('codebuddy', ['-p', prompt, '--permission-mode', 'dontAsk', '--tools', 'Read,Glob,Grep', '--output-format', 'json'], {stdio:['ignore','pipe','pipe']})`。两层只读边界都要上：`dontAsk` 管模式层，`--tools` 白名单管工具层（不给写工具，不靠模式语义）。**不许用 `--permission-mode plan`**：它的只读性是从"进入前的模式"继承来的，且自己会往 `~/.codebuddy/plans/` 写文件。
- 自己包 180000ms 超时，`SIGTERM` → 2 秒 → `SIGKILL`。
- `close` 后按契约2判成败：**先 parse、再校验数组、再 `find(type==='result')`，三步任一失败即判失败**，stderr 原样带出（截断）。不许拿 exit code 当唯一依据、不许看 `is_error`。
- 取 `result`/`session_id`/`usage`；对 `result` 做中英文关键词扫描，命中带 warning 不吞掉。ENOENT 报"codebuddy 没装/不在 PATH"。
验收：`node plugins/codebuddy/scripts/codebuddy-cli.mjs research "一句话解释什么是 git rebase"` 输出一段可读文字。

## 任务3：测试（假二进制）
建 `tests/fixtures/fake-codebuddy-bin.mjs`（**记得 `chmod +x`**，Sprint 3 在这踩过 EACCES）和 `tests/codebuddy-cli.test.mjs`，覆盖：
1. 正常成功：吐一个**数组**，且 result 元素**不在末尾**也能取到（证明不是靠 `length-1`）。
2. **exit 0 + stdout 空**（真实 API 失败的样子）→ 必须判失败。**本 Sprint 最重要的一条**，照抄 cursor 逻辑会在这里绿灯放行。
3. 合法 JSON 但是**对象不是数组**（或数组里没 `type:"result"`）→ 判失败，不许崩在 `undefined`。
4. `result` 含中文"被拒绝"→ 能提取出 warning。
5. 假二进制 sleep 远超超时（超时压到 500ms）→ 验证 `setTimeout+kill` 真能按时终止。
不许 `.skip`、不许 mock 被测的 `codebuddy-cli.mjs` 本身、不许删或改已有 19 个测试。
验收：`node --test tests/*.test.mjs` pass ≥ 24、fail 0、skip 0。

## 反向验证（两条都要，各贴输出）
1. 注释掉超时里的 `kill`，跑测试5，应看到进程没死、明显挂起（外层 `timeout 8` 取证）；恢复后跑全绿。
2. 把成败判断临时改成 cursor 那套"exit 0 且 stdout 非空"，跑测试2，应看到它**误判成功**（测试变红）；改回契约2的判法跑全绿。这条证明契约2不是抄来的教条。

## 完成条件
- 硬指标1：`node --test tests/*.test.mjs` ≥ 24 全过、0 fail、0 skip。
- 硬指标2：`git diff f807db1 -- GOAL.md` 为空；`plugins/agy/**`、`plugins/cursor/**`、`package.json`、`../codex-plugin-cc/` 零改动。
- 每条贴真实命令输出（含两条反向验证证据），只说"做完了"不算。`BLOCKED.md` 随交付提交，没内容也写"无"。
- 不装新 npm 依赖。同一条验收连败 3 次换下一项；结果比基线差就回滚如实报告。跑满 10 轮未达标就停，如实汇报卡在哪。

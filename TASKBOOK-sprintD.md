你是执行者，这份文档是你唯一的任务来源；中途没人可问，拿不准的写进 BLOCKED.md，跳过继续做别的，最后随交付提交。断线换新会话先读 PROGRESS.md 接着做，别重做；每做完一项立刻更新。这活为什么干：给 agy 插件加 `/agy:implement`——与 `/cursor:implement` 平级的执行命令。agy headless **写不了用户文件**（GOAL.md 第 11 节实测），所以走 apply 模式：agy 只读生成修改内容，插件尽力提取，**落盘在 Claude 主会话侧、经用户确认**——最安全的执行路径，天然免疫部分成功陷阱。打架时让步顺序：CANCELED 报错可操作 > 提取不吞内容 > 代码好看。"不许"违反算失败；"建议"有更好的路就走，在 PROGRESS.md 记一句为什么。

## 我替领导拍的板
- 命令名 `/agy:implement`（与 cursor 同语义平级）——实现差异留给 README 路由表讲，不进命令名。
- 提取尽力而为：分隔符在就提取，不在就 response 原样返回 + warning，不押注 agy 输出格式。
- job 清理不做（等真疼，GOAL.md 已记）。

## 界限
- 白名单（只能改/建）：`plugins/agy/**`、`tests/**`、`PROGRESS.md`、`BLOCKED.md`。
- 不许碰 `plugins/cursor|codebuddy|router/**`、`.claude-plugin/marketplace.json`（agy 已注册）、`package.json`、`GOAL.md`（基线 `95bed31`，交付时 `git diff 95bed31 -- GOAL.md` 必须为空）、本文件、`../codex-plugin-cc/`。
- **不许传 `--dangerously-skip-permissions`**（11 节实测：写不了用户文件还开全权限，纯亏）。**不许让插件脚本写任何用户文件**（落盘权在 Claude 侧，这是设计的灵魂）。
- 测试约束：不删除、不弱化、不 skip 现有 40 个断言；扩展 fake-agy-bin 允许；必要修改保持原覆盖意图。

## 必读契约（GOAL.md 11/11.1 节，隔离 fixture 实测）
| status | 判定 |
| --- | --- |
| `SUCCESS` + response 非空 | **成功**（探针 E 实测可达：trusted workspace + 默认权限） |
| `ERROR` + response 非空 | **防御性成功**：内容照常返回 + warning「agy 报内部错误但产物可能在 response，请人工核对」 |
| `CANCELED`（stderr 含 auto-denied） | **失败**，错误含可操作指引：①交互模式跑一次 agy 把目录加入 trustedWorkspaces；②在 `~/.gemini/antigravity-cli/settings.json` 的 permissions.allow 加规则 |
| 其他 status | 失败，stderr 原样带出（截断 2000） |

agy 无 `--allowed-tools` flag（探针 D，别试）。usage 下划线命名。超时沿用原生 `--print-timeout 3m`。

## 任务0
基线：你的沙箱跑不了本仓库测试（fake bin 与沙箱不兼容，历史三次实测），测试验证由验收方在沙箱外做。你的任务0 = 静态数现有 `it(` 总数为 40 并记进 PROGRESS。自检手段全程限于：`node --check`、直接调用 fixture（`FAKE_AGY_SCENARIO=... node tests/fixtures/fake-agy-bin.mjs`，不走 spawn）。

## 任务1：核心脚本
`plugins/agy/scripts/agy-cli.mjs` 新增 `runAgyImplement(prompt, options)`（同文件，不改 research/后台逻辑）：
- prompt 模板：instruction 前置——「不要修改任何文件、不要调用写文件工具。阅读相关文件后，在回复末尾对每个要修改的文件输出：`===FILE: <相对路径>===` 一行，随后是完整修改后文件内容，`===END===` 结束。块外可有说明文字。」
- args 同 research（`-p` 换模板化 prompt、`--output-format json`、`--print-timeout 3m`），**不加任何权限 flag**。
- 判成败按四分支表。返回 `{status, response, files: [{path, content}] | null, warnings, session_id, usage, raw}`。
- **提取规则**：`/===FILE:\s*(.+?)===\r?\n([\s\S]*?)===END===/g` 全局匹配；有命中 → `files` 数组（path 修剪空白）；零命中 → `files: null` + warning「未找到 FILE 块，response 原样返回」。**提取失败不判失败**。
- CANCELED 错误 message 写全两条指引。中英文关键词扫描（新增：权限不足/无法访问/被拒绝/auto-denied，保留 denied/not allowed）。
- CLI `implement` 子命令：files 非空先打清单（每个 `path (N 行)`）再打完整 response，warnings 到 stderr，成功 exit 0。
验收：`node --check` 过。真机由验收方跑。

## 任务2：命令文档
`plugins/agy/commands/implement.md`：`/agy:implement <instruction>`，frontmatter 照 research.md（含 `disable-model-invocation: true`、`allowed-tools: Bash(node:*)`）。正文必须写清：
1. 这是 apply 模式：agy 只读生成修改内容，不直接写文件——最安全的执行路径。
2. Claude 侧行为：拿到结果后**原样展示**（files 清单 + 内容），用户确认后用 Edit 工具落盘；**落盘前必须先读目标文件现状**，内容对不上（文件已被改过）就停下问用户。
3. 遇到 CANCELED 报错时向用户转述两条指引。
4. 输出里 agy 自称"已修改/已完成"不可信——它写不了文件，一切以展示内容为准。

## 任务3：测试
扩展 `tests/fixtures/fake-agy-bin.mjs`（加场景，不动已有场景）+ 建 `tests/agy-implement.test.mjs`：
1. SUCCESS + 含两个 FILE 块 → `files` 长度 2、path/content 正确、无 warning。
2. SUCCESS + 无 FILE 块（纯文字 response）→ `files: null`、warning 命中「未找到」、response 原样在。
3. ERROR + response 有内容（含 FILE 块）→ 防御分支：files 提取正常 + warning 命中「内部错误」。
4. CANCELED + stderr auto-denied → reject，错误信息含「trustedWorkspaces」和「permissions.allow」两个关键词。
5. **prompt 模板断言**：fake bin 记录收到的 `-p` 参数，断言含「不要修改任何文件」和「===FILE:」。
6. ENOENT + 超时各一条（沿用现有模式）。
验收：`node --test tests/*.test.mjs` pass ≥ 46、fail 0、skip 0（最终数字由验收方跑出，你静态数 `it(` 报个数）。

## 反向验证（你能做的部分）
把提取正则临时改成永远不匹配，静态推演测试 1/3 会红（files 变 null、断言长度失败）——把这个推演写进 PROGRESS；真跑由验收方做。

## 完成条件
- 硬指标1（验收方跑）：全量 ≥ 46 pass、0 fail、0 skip。
- 硬指标2：`git diff 95bed31 -- GOAL.md plugins/cursor plugins/codebuddy plugins/router .claude-plugin/marketplace.json package.json` 为空。
- 硬指标3（验收方跑）：真机在 trusted workspace fixture 里跑 `implement "把 math.js 的 add 改成支持第三个可选参数"`，response 含 FILE 块或原样返回，文件未被修改。
- 你交付：代码 + 测试 + 文档 + PROGRESS/BLOCKED + 每项自检证据（--check 输出、静态 it 计数）。不 git commit。
- 不装新依赖。同一条自检连败 3 次换下一项；跑满 10 轮未达标就停，如实汇报。

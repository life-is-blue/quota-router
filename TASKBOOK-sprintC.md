你是执行者，这份文档是你唯一的任务来源；中途没人可问，拿不准的写进 BLOCKED.md，跳过继续做别的，最后随交付提交。断线换新会话先读 PROGRESS.md 接着做，别重做；每做完一项立刻更新。这活为什么干：agy 和 cursor 两个适配器的错误信息里嵌的是**完整未截断的 stderr**，codebuddy 已有 2000 字符截断（`MAX_STDERR_TRUNCATE`）。CLI 失败时吐几百 KB stderr 会把错误信息原样灌进主会话上下文（GOAL.md 7.2-C 条）。这是收尾小活，**不许借它建 lib/、不许顺手改别的**。打架时让步顺序：截断真的生效 > 不破坏现有 31 个测试 > 代码好看。"不许"违反算失败；"建议"有更好的路就走，在 PROGRESS.md 记一句为什么。

## 我替领导拍的板
- 上限统一 2000 字符，对齐 codebuddy 已有常量｜代价小。
- 截断只作用于**嵌进错误信息/warning 的文本**，不影响任何判断逻辑｜无实质影响。
- 顺带把 `JSON.parse` 失败路径嵌的完整 `Raw output` 也截到 2000（三个适配器这条都没截，codebuddy 的整条 transcript 数组能到几十 KB）——同一类风险一起关掉。

## 界限
- 白名单（只能改/建）：`plugins/agy/**`、`plugins/cursor/**`、`plugins/codebuddy/scripts/codebuddy-cli.mjs`、`tests/**`、`PROGRESS.md`、`BLOCKED.md`。
- 不许碰 `GOAL.md`（基线 `e0db8c4`，交付时 `git diff e0db8c4 -- GOAL.md` 必须为空）、`marketplace.json`、`package.json`、任何 TASKBOOK 文件、`../codex-plugin-cc/`。
- **不许建 `lib/`、不许把三个适配器改成共享实现**（GOAL.md 7.1 实测结论：不抽象）。各文件各加各的常量。
- **不许改任何判断逻辑**：soft-deny/部分成功关键词扫描、判成败 gate、超时 kill，一个字不动。截断只发生在"把文本嵌进 Error message / warning"的出口处。**关键词扫描仍在完整 stderr 上跑（先扫后截）**。

## 任务0
基线 `node --test tests/*.test.mjs` 应为 **31 pass 0 fail 0 skip**（commit `e0db8c4`）；对不上就停并写 BLOCKED.md。核对后把理解（≤10 行）写进 PROGRESS.md。

## 任务1：截断
- `plugins/agy/scripts/agy-cli.mjs`：加 `MAX_STDERR_TRUNCATE = 2000`；所有把 `trimmedStderr` 嵌进 Error 的位置、soft-deny warning 里嵌的 stderr、parse 失败嵌的 `Raw output`，全部截到 2000。截断保头不保尾（`slice(0, N)`，与 codebuddy 现有写法一致）。
- `plugins/cursor/scripts/cursor-cli.mjs`：`runCursorResearch` 和 `runCursorImplement` 两个函数的全部嵌出点，同样处理。
- `plugins/codebuddy/scripts/codebuddy-cli.mjs`：stderr 已截，只补 `Raw output` 截断。
- 建议（不强制）：截断处加 `…(truncated)` 标记。
验收：agy/cursor 两文件各能 grep 到截断常量；把"哪些行改了"的自查清单写进 PROGRESS.md。

## 任务2：测试（每个适配器各 1 条，fake bin 加场景）
1. agy：fake 吐 ≥5000 字符 stderr 后失败 → Error.message 长度 < 3000。
2. cursor：fake exit 1 + 空 stdout + ≥5000 字符 stderr（research 路径）→ Error.message < 3000。
3. codebuddy：fake exit 0 + ≥5000 字节坏 JSON → parse 失败 Error.message < 3000。
不许 `.skip`、不许 mock 被测函数、不许删/改已有 31 个测试。新建 fixture 记得 chmod +x。
验收：`node --test tests/*.test.mjs` pass ≥ 34、fail 0、skip 0。

## 反向验证
把任一文件的截断临时去掉（slice 删掉或上限改 Infinity），跑对应测试应变红；恢复后全绿。贴两段输出。

## 完成条件
- 硬指标1：`node --test tests/*.test.mjs` ≥ 34 全过、0 fail、0 skip。
- 硬指标2：`git diff e0db8c4 -- GOAL.md marketplace.json package.json` 为空；`../codex-plugin-cc/` 零改动。
- 每条贴真实命令输出。`BLOCKED.md` 随交付提交，没内容也写"无"。
- 不装新 npm 依赖。同一条验收连败 3 次换下一项；结果比基线差就回滚如实报告。

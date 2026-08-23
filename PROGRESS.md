# PROGRESS.md

- **目标**：为 agy 适配器增加后台执行模式与 `/agy:status` 状态查询，实现耗时调研任务后台异步执行及可靠的 job 状态和进程存活管理。
- **执行过程与完成项**：
  1. **任务0（基线核对）**：重跑基线测试，确认 4 pass / 0 fail / 0 skip，并完成初始目标与风险防范梳理。
  2. **任务1（job 存取层）**：在 `plugins/agy/scripts/job-store.mjs` 中实现 `resolveJobsDir`、`writeJob`、`readJob`、`listJobs`。严格限制状态值（`running`、`done`、`error`），并在 `writeJob` 写入后立即通过 `readJob` 进行深度 JSON 一致性核对，不匹配立即抛错。读取不存在的 job id 安全返回 `null`。
  3. **任务2（`--background` 模式）**：在 `agy-cli.mjs` 中支持 `research --background <topic>`，生成 UUID job id，写入初始 `running` 记录，以 `spawn(process.execPath, [__filename, '--worker', jobId, prompt], {detached: true, stdio: 'ignore'})` 启动后台 worker 并 `unref()`，回写 PID 后立刻退出（耗时 <0.1s）。Worker 内部调用 `runAgyResearch`，完成后可靠落盘 `done` / `error` 终态。
  4. **任务3（`/agy:status` 命令）**：新建 `plugins/agy/commands/status.md`，实现 `agy-cli.mjs status [job-id]`。支持单任务详情与最近任务列表查询。针对 `running` 状态使用 `process.kill(pid, 0)` 进行进程存活检测，若进程已死（`ESRCH`）明确标注 `running (进程已消失，状态未知)` 且不擅自篡改文件内容。
  5. **任务4（自动化测试与反向验证）**：
     - 测试覆盖：基线4个 + 新增11个 = 15个测试全部通过（15 pass, 0 fail, 0 skip）。
     - 反向验证：故意注释 `writeJob` 读回校验逻辑并模拟文件写入异常，测试立即变红（1 fail, 14 pass）；恢复校验后全部恢复全绿（15 pass）。
- **最大风险防范**：严格核对写入状态防静默截断；`process.kill(pid, 0)` 准确定位假死进程；零新增 npm 依赖，遵循白名单约束。

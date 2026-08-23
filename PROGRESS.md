# PROGRESS.md

- **目标**：构建独立 Claude Code 插件 `quota-router-agy`，将只读调研任务分流给本地 agy headless 模式以节省 Opus 配额。
- **执行顺序**：
  1. 任务0环境验证：agy、Node、`node --test` 实测与契约确认完毕。
  2. 任务1骨架搭建：创建 `plugin.json`、`marketplace.json`、`research.md`。
  3. 任务2核心脚本：实现 `plugins/agy/scripts/agy-cli.mjs`，包含 status 判断、soft-deny 警告透传、整体 JSON.parse 与 ENOENT 处理。实测运行正常。
  4. 任务3测试与假二进制：实现 `fake-agy-bin.mjs` 与 `agy-cli.test.mjs`，覆盖全部 4 个关键场景（SUCCESS, ERROR, SOFT_DENY, ENOENT）。全部通过（4 pass, 0 fail, 0 skip）。
  5. 反向验证：反转 status 检查逻辑测试变红（3 fail, 1 pass），还原后恢复全绿（4 pass, 0 fail）。
- **最大风险防范**：已严格基于 status 字段判断（非仅 exit code）、stdin 设置为 ignore、无 npm 依赖（无 dependencies）、严格恪守白名单。

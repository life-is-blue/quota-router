# 发布就绪规划（谋定而后动版）

对比 `codex-plugin-cc` 的差距盘点 + 分批实施方案。原则：**每批独立可交付、独立可验收；机械活不启动自建执行者**（浪费），**有契约风险的活才走任务书流程**。

## 盘点结论（全部实测核实过，非推测）

### 已确认的差距（要补）

| # | 差距 | 官方做法 | 我们的现状 | 实测核实 |
|---|---|---|---|---|
| G1 | `/setup` 就绪检查 | `/codex:setup` 查 CLI + AskUserQuestion 提议安装 | 无。用户首次调用才报错 | setup.md 逐行读过 |
| G2 | CI 门禁 | pull-request-ci.yml（10min 超时，node 22） | 无。测试本地手跑 | 他们的 yml 全文读过 |
| G3 | 版本纪律 | 1.0.6 + CHANGELOG.md + bump-version 脚本同步 4 处版本号 | 三个插件全 0.1.0，无 changelog | bump-version.mjs 读过 |
| G4 | 输出 schema | review-output.schema.json 约束结构化输出 | result 是自然语言字符串 | schema 文件读过 |
| G5 | 开源合规 | LICENSE/NOTICE 每插件一份、package.json 带 license 字段 | 全无 | ✅ 已核实 |

### 刻意不学的（立场，写进文档防翻案）

- **Stop Hook 自动审查门**：隐式 spawn 外部 CLI 烧用户额度，违反「用户点头才跑」原则（官方也是 opt-in，我们连 opt-in 都不做）。
- **常驻 Broker**：无状态 spawn 换零守护进程零端口；冷启动是上游 CLI 的事（codebuddy 自有 `--prewarm`）。
- **Engine 抽象层**：GOAL.md 7.1 实测结论，不重开。

## 关键可行性前提（已实测）

**CI 零 CLI 依赖**：`env -i` 干净环境下（PATH 只有 node）`node --test tests/*.test.mjs` → 34 pass / 0 fail。fake bin 机制完备，GitHub Actions 无需安装任何 CLI。**G2 是纯机械活。**

## 分批方案

### 批次 1：GitHub 发布包（机械活，我直接写，不走自建）

范围：G2 + G3 + G5。

1. `.github/workflows/ci.yml`：PR 触发、node 24（本机实测版本）、`npm test`、10 分钟超时。照抄官方结构但**去掉** `npm ci`（我们零依赖，无 lockfile 生成负担）和 build 步骤（无 tsc）。
2. `LICENSE`（Apache-2.0，全文）+ 各插件 NOTICE（版权人写"quota-router contributors"）。
3. `package.json` 补 `license`、`engines: {node: ">=18"}`（官方同款下限）。
4. 版本走 **1.0.0**：三个 plugin.json + marketplace.json metadata + package.json 五处统一。理由：主体功能完工、34 测试全绿、六轮独立验收，配得上 1.0.0；停在 0.x 反而暗示不可用。
5. `CHANGELOG.md`：从 git log 提炼六个里程碑（Sprint 1–4 / A / C），每条一句话 + commit 引用。
6. bump-version 小脚本（可选）：官方那个要同步 package-lock，我们没有 lockfile，**先手改五处 + CI 校验一致性**即可，不预建工具。

验收：`git status` 干净；CI 配置语法 `node -e` 能 parse（或首推后看 Actions 跑绿）；五处版本号一致；README 安装段占位符替换决策留给用户。

**风险**：无实质风险。唯一注意点：CI 里 `node --test tests/*.test.mjs` 的 glob 由 shell 展开，actions 默认 bash 没问题。

### 批次 2：`/quota:setup`（体验活，走任务书自建）

范围：G1。新插件 `plugins/router/`（当前空缺）挂一个 `/quota:setup` 命令：

- 逐个检查四引擎：二进制在 PATH（`which`）、`--version` 可执行、认证状态探测（agy `agy --version` 隐式已登录即可；codebuddy `status`；agent `status`）。
- 输出一张就绪表（引擎 × 安装/登录/可用），**不做自动安装**（官方会 AskUserQuestion 提议 `npm install -g`，但我们的三个 CLI 都不是 npm 一行能装的——agy/cursor-agent/codebuddy 各有安装渠道，自动安装是坑，不做；给安装指引链接即可）。
- 失败模式：某引擎未装 → 表格如实标 ❌，命令仍 exit 0（setup 是诊断不是闸门）。

**契约注意点**（写任务书前需小调研，半小时级）：各 CLI 的「已登录」探测命令是否可靠、是否有无副作用的探测方式（`status` 类命令会不会拉网络）。这条比照 GOAL.md 的规矩：契约未实测不写任务书。

### 批次 3（挂起，等使用反馈）：schema 化调研输出 + contract 速查 skill

G4 + Skills。**刻意后置**：schema 的字段设计需要真实使用数据（用户到底要消费什么字段），现在拍脑袋设计就是重蹈「过早抽象」。等有真实使用再定。

## 依赖关系

```
批次1（发布包） ──► 推 GitHub ──► 批次2（setup）──► 批次3（schema，等反馈）
```

批次 1 完成即可推 GitHub；批次 2 不依赖发布，但发布后做更符合「先让用户装得上」。批次 2 的任务书**等批次 1 提交后**再写（基线 commit 会变）。

## 明确不做（本规划周期内）

- 自动安装 CLI（坑）、Stop Hook、Broker、Engine 抽象、bump-version 工具化、package-lock（零依赖不装）。

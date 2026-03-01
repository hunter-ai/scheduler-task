# scheduler-task

基于 Cron 的任务调度器，通过 Claude CLI 定时执行 Prompt 工作流，支持指数级回退策略。

[English](./README.md)

---

## 特性

- **零依赖**：仅使用 Node.js 内置模块
- **灵活调度**：支持固定间隔（毫秒）和 Cron 表达式两种调度方式
- **驱动架构**：可扩展的 Driver 接口，内置 Claude CLI Driver
- **防并发**：同一任务上一次未完成时自动跳过本次触发
- **指数级回退**：工作流输出无数据信号时自动延长扫描间隔，数据恢复后自动重置
- **结构化日志**：每个任务独立 JSON 日志文件，记录完整执行事件
- **优雅退出**：捕获 SIGTERM / SIGINT，等待运行中任务完成后再退出

---

## 快速开始

### 前置条件

- Node.js >= 18
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) 已安装并完成认证

### 安装

```bash
git clone <repo-url>
cd scheduler-task
```

无需安装任何 npm 依赖。

### 运行

```bash
node index.js
# 或
npm start
```

---

## 项目结构

```
scheduler-task/
├── index.js              # 主调度器
├── cron.js               # Cron 表达式解析器（纯 JS，无依赖）
├── tasks.config.json     # 任务配置文件
├── drivers/
│   ├── base.js           # Driver 抽象基类
│   └── claude.js         # Claude CLI Driver
├── prompts/              # Prompt 文件目录
│   ├── say-hello.md
│   └── data-processor.md
└── logs/                 # 运行日志（自动创建）
    └── <task-name>.log
```

---

## 任务配置

所有任务在 `tasks.config.json` 中定义：

```json
{
  "tasks": [
    {
      "name": "my-task",
      "promptFile": "prompts/my-task.md",
      "interval": 60000,
      "enabled": true,
      "driver": "claude",
      "driverConfig": {},
      "backoff": {
        "signal": "NO_DATA",
        "intervals": [30000, 60000, 120000, 300000]
      }
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 任务唯一标识，同时作为日志文件名 |
| `promptFile` | string | ✅ | Prompt 文件路径（相对于项目根目录） |
| `interval` | number | 二选一 | 执行间隔，单位毫秒 |
| `schedule` | string | 二选一 | Cron 表达式（见下方说明） |
| `enabled` | boolean | ✅ | 是否启用该任务 |
| `driver` | string | | Driver 名称，默认 `"claude"` |
| `driverConfig` | object | | 传递给 Driver 的配置项 |
| `backoff` | object | | 指数级回退配置（见下方说明） |

### Cron 表达式

格式：`分 时 日 月 周`

```
┌──────────── 分钟 (0-59)
│ ┌────────── 小时 (0-23)
│ │ ┌──────── 日期 (1-31)
│ │ │ ┌────── 月份 (1-12)
│ │ │ │ ┌──── 星期 (0-6，0=周日)
│ │ │ │ │
* * * * *
```

支持 `*`、数值、范围（`1-5`）、步长（`*/15`、`9-17/2`）、列表（`0,6,12,18`）。

**示例：**

| 表达式 | 含义 |
|--------|------|
| `*/30 * * * *` | 每 30 分钟 |
| `0 9 * * 1-5` | 工作日每天上午 9 点 |
| `0 0 1 * *` | 每月 1 日零点 |

### Claude Driver 配置

通过 `driverConfig` 传入：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `timeout` | number | `1800000`（30分钟）| 单次执行超时，单位毫秒 |
| `claudeBin` | string | `"claude"` | Claude CLI 可执行文件路径 |

---

## 指数级回退

当工作流处理完所有数据后，若数据源暂时为空，频繁轮询意义不大。开启回退后，调度器会在检测到"无数据"信号时自动拉长等待间隔，数据恢复时自动重置。

### 工作原理

工作流（Prompt）在没有数据时，在输出中包含指定信号字符串（默认 `NO_DATA`）：

```markdown
如果当前队列为空，请仅输出 `NO_DATA`，不做其他操作。
```

调度器扫描每次执行的输出：
- **检测到信号** → `backoffLevel` 递增，按回退策略计算下次等待时间
- **未检测到信号（已在回退中）** → `backoffLevel` 重置为 0，恢复正常间隔

### 回退配置

```json
"backoff": {
  "signal": "NO_DATA",
  "intervals": [30000, 60000, 120000, 300000],
  "maxInterval": 1800000
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `signal` | string | `"NO_DATA"` | 输出中需匹配的信号字符串 |
| `intervals` | number[] | — | 自定义回退阶梯（毫秒）。第 N 次无数据使用 `intervals[N-1]`，超出末尾后保持最后一级 |
| `maxInterval` | number | `3600000`（1小时）| 自动指数回退的上限（不配置 `intervals` 时生效） |

### 回退策略对比

**自定义阶梯**（配置 `intervals`）：

| 无数据次数 | 等待时间 |
|-----------|---------|
| 1 | `intervals[0]`，如 30s |
| 2 | `intervals[1]`，如 60s |
| 3 | `intervals[2]`，如 120s |
| 4+ | `intervals` 最后一项，如 300s |

**自动指数**（不配置 `intervals`）：

等待时间 = `min(interval × 2ⁿ, maxInterval)`

| 无数据次数（n） | 等待时间（interval=15s） |
|---------------|------------------------|
| 1 | 30s |
| 2 | 60s |
| 3 | 120s |
| 4 | 240s |
| … | …（上限 maxInterval） |

---

## 日志

每个任务在 `logs/<task-name>.log` 中记录结构化 JSON 日志：

```jsonl
{"event":"run_start","task":"data-processor","ts":"2024-03-01T09:00:00.000Z"}
{"event":"run_end","task":"data-processor","session_id":"abc123","outputLength":42,"ts":"2024-03-01T09:00:05.123Z"}
{"event":"backoff","task":"data-processor","level":1,"ts":"2024-03-01T09:00:05.124Z"}
{"event":"backoff_reset","task":"data-processor","ts":"2024-03-01T09:01:05.200Z"}
```

### 事件类型

| 事件 | 说明 |
|------|------|
| `run_start` | 任务开始执行 |
| `run_end` | 任务执行完成，含 `session_id` 和 `outputLength` |
| `run_error` | 任务执行出错，含 `error` 信息 |
| `skip` | 跳过本次触发（上次仍在运行），含 `reason` |
| `backoff` | 检测到无数据信号，含当前 `level` |
| `backoff_reset` | 数据恢复，回退重置 |
| `session_start` | Claude 会话初始化，含 `session_id` |
| `session_end` | Claude 会话结束，含 `result` 子类型 |
| `stderr` | Claude 进程标准错误输出，含 `text` |

---

## 扩展 Driver

继承 `drivers/base.js` 实现自定义执行引擎：

```js
const BaseDriver = require('./drivers/base');

class MyDriver extends BaseDriver {
  async run({ prompt, logFile, taskName }) {
    // 执行逻辑...
    return { sessionId: 'xxx', output: 'result text' };
  }
}

module.exports = MyDriver;
```

在任务配置中指定 `"driver": "my-driver"`，调度器会自动从 `drivers/` 目录加载。

---

## 优雅退出

发送 `SIGTERM` 或 `Ctrl+C`（`SIGINT`）后：

1. 停止所有待执行定时器
2. 等待当前运行中的任务完成（最多 30 秒）
3. 退出进程

---

## License

[MIT](./LICENSE) © [ihunterdev](https://github.com/ihunterdev)

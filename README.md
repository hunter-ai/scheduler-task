# scheduler-task

A cron-based task scheduler that runs Prompt workflows via the Claude CLI, with built-in exponential backoff support.

[中文](./README.zh.md)

---

## Features

- **Zero dependencies** — uses only Node.js built-in modules
- **Flexible scheduling** — supports both fixed intervals (milliseconds) and cron expressions
- **Driver architecture** — extensible Driver interface with a built-in Claude CLI Driver
- **Concurrency guard** — automatically skips a trigger if the previous run is still in progress
- **Exponential backoff** — automatically lengthens the polling interval when a workflow signals no data; resets when data returns
- **Structured logging** — per-task JSON log files recording every execution event
- **Graceful shutdown** — handles SIGTERM / SIGINT, waits for in-flight tasks before exiting

---

## Quick Start

### Prerequisites

- Node.js >= 18
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

### Install

```bash
git clone <repo-url>
cd scheduler-task
```

No npm dependencies to install.

### Run

```bash
node index.js
# or
npm start
```

---

## Project Structure

```
scheduler-task/
├── index.js              # Main scheduler
├── cron.js               # Cron expression parser (pure JS, no deps)
├── tasks.config.json     # Task configuration
├── drivers/
│   ├── base.js           # Abstract driver base class
│   └── claude.js         # Claude CLI driver
├── prompts/              # Prompt files
│   ├── say-hello.md
│   └── data-processor.md
└── logs/                 # Runtime logs (auto-created)
    └── <task-name>.log
```

---

## Task Configuration

All tasks are defined in `tasks.config.json`:

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

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Unique task identifier, also used as the log file name |
| `promptFile` | string | ✅ | Path to the prompt file (relative to project root) |
| `interval` | number | One of | Execution interval in milliseconds |
| `schedule` | string | One of | Cron expression (see below) |
| `enabled` | boolean | ✅ | Whether the task is active |
| `driver` | string | | Driver name, defaults to `"claude"` |
| `driverConfig` | object | | Configuration passed to the driver constructor |
| `backoff` | object | | Exponential backoff configuration (see below) |

### Cron Expressions

Format: `minute hour day month weekday`

```
┌──────────── minute (0-59)
│ ┌────────── hour (0-23)
│ │ ┌──────── day of month (1-31)
│ │ │ ┌────── month (1-12)
│ │ │ │ ┌──── day of week (0-6, 0=Sunday)
│ │ │ │ │
* * * * *
```

Supports `*`, values, ranges (`1-5`), steps (`*/15`, `9-17/2`), and lists (`0,6,12,18`).

**Examples:**

| Expression | Meaning |
|------------|---------|
| `*/30 * * * *` | Every 30 minutes |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `0 0 1 * *` | First day of each month at midnight |

### Claude Driver Config

Pass via `driverConfig`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timeout` | number | `1800000` (30 min) | Per-run timeout in milliseconds |
| `claudeBin` | string | `"claude"` | Path to the Claude CLI binary |

---

## Exponential Backoff

When a workflow finishes processing all available data and the source goes quiet, polling at a fixed interval wastes resources. With backoff enabled, the scheduler automatically widens the gap between runs when it detects a "no data" signal, and resets as soon as data comes back.

### How It Works

The workflow (prompt) outputs a designated signal string (default: `NO_DATA`) when there is nothing to process:

```markdown
If the queue is currently empty, output only `NO_DATA` and do nothing else.
```

After each run, the scheduler scans the output:
- **Signal detected** → increment `backoffLevel`, compute the next delay from the backoff strategy
- **No signal (while backing off)** → reset `backoffLevel` to 0, resume normal interval

### Backoff Configuration

```json
"backoff": {
  "signal": "NO_DATA",
  "intervals": [30000, 60000, 120000, 300000],
  "maxInterval": 1800000
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `signal` | string | `"NO_DATA"` | String to match in the run output |
| `intervals` | number[] | — | Custom backoff ladder (ms). The Nth consecutive no-data uses `intervals[N-1]`; the last entry is reused once the array is exhausted |
| `maxInterval` | number | `3600000` (1 hr) | Upper cap for auto-exponential backoff (used when `intervals` is not set) |

### Strategy Comparison

**Custom ladder** (with `intervals`):

| Consecutive no-data runs | Wait time |
|--------------------------|-----------|
| 1 | `intervals[0]`, e.g. 30s |
| 2 | `intervals[1]`, e.g. 60s |
| 3 | `intervals[2]`, e.g. 120s |
| 4+ | Last entry, e.g. 300s |

**Auto exponential** (without `intervals`):

Delay = `min(interval × 2ⁿ, maxInterval)`

| Consecutive no-data (n) | Delay (interval = 15s) |
|-------------------------|------------------------|
| 1 | 30s |
| 2 | 60s |
| 3 | 120s |
| 4 | 240s |
| … | … (capped at maxInterval) |

---

## Logging

Each task writes structured JSON logs to `logs/<task-name>.log`:

```jsonl
{"event":"run_start","task":"data-processor","ts":"2024-03-01T09:00:00.000Z"}
{"event":"run_end","task":"data-processor","session_id":"abc123","outputLength":42,"ts":"2024-03-01T09:00:05.123Z"}
{"event":"backoff","task":"data-processor","level":1,"ts":"2024-03-01T09:00:05.124Z"}
{"event":"backoff_reset","task":"data-processor","ts":"2024-03-01T09:01:05.200Z"}
```

### Event Types

| Event | Description |
|-------|-------------|
| `run_start` | Task execution started |
| `run_end` | Task completed; includes `session_id` and `outputLength` |
| `run_error` | Task failed; includes `error` message |
| `skip` | Trigger skipped (previous run still in progress); includes `reason` |
| `backoff` | No-data signal detected; includes current `level` |
| `backoff_reset` | Data returned, backoff level reset to 0 |
| `session_start` | Claude session initialised; includes `session_id` |
| `session_end` | Claude session ended; includes `result` subtype |
| `stderr` | Stderr output from the Claude process; includes `text` |

---

## Custom Drivers

Extend `drivers/base.js` to implement your own execution engine:

```js
const BaseDriver = require('./drivers/base');

class MyDriver extends BaseDriver {
  async run({ prompt, logFile, taskName }) {
    // your execution logic...
    return { sessionId: 'xxx', output: 'result text' };
  }
}

module.exports = MyDriver;
```

Set `"driver": "my-driver"` in the task config. The scheduler loads drivers by name from the `drivers/` directory.

---

## Graceful Shutdown

On `SIGTERM` or `Ctrl+C` (`SIGINT`):

1. All pending timers are cancelled
2. In-flight tasks are given up to 30 seconds to finish
3. The process exits cleanly

---

## License

[MIT](./LICENSE) © [ihunterdev](https://github.com/ihunterdev)

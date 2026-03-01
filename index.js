'use strict';

const fs = require('fs');
const path = require('path');
const { nextTick } = require('./cron');

const SCHEDULER_DIR = __dirname;
const LOGS_DIR = path.join(SCHEDULER_DIR, 'logs');
const CONFIG_PATH = path.join(SCHEDULER_DIR, 'tasks.config.json');
const GRACEFUL_SHUTDOWN_MS = 30_000;

// ── Bootstrap ────────────────────────────────────────────────────────────────

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

function logLine(logFile, entry) {
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() });
  fs.appendFileSync(logFile, line + '\n');
}

// ── Task state ────────────────────────────────────────────────────────────────

/** @type {Map<string, { timer: NodeJS.Timeout, isRunning: boolean, promise: Promise|null }>} */
const taskState = new Map();

let shuttingDown = false;

// ── Scheduler ─────────────────────────────────────────────────────────────────

function loadDriver(task) {
  const driverName = task.driver || 'claude';
  let DriverClass;
  try {
    DriverClass = require(`./drivers/${driverName}`);
  } catch {
    throw new Error(`Unknown driver "${driverName}" for task "${task.name}"`);
  }
  return new DriverClass(task.driverConfig || {});
}

function scheduleTask(task) {
  if (shuttingDown) return;

  const { name, promptFile, schedule, interval, enabled } = task;
  if (!enabled) return;

  const driver = loadDriver(task);
  const logFile = path.join(LOGS_DIR, `${name}.log`);
  const promptAbsPath = path.join(SCHEDULER_DIR, promptFile);

  if (!taskState.has(name)) {
    taskState.set(name, { timer: null, isRunning: false, promise: null, backoffLevel: 0 });
  }
  const state = taskState.get(name);

  function computeDelay() {
    if (task.backoff && state.backoffLevel > 0) {
      const { intervals, maxInterval = 3_600_000 } = task.backoff;
      if (intervals && intervals.length > 0) {
        return intervals[Math.min(state.backoffLevel - 1, intervals.length - 1)];
      }
      const baseMs = interval ?? 60_000;
      return Math.min(baseMs * Math.pow(2, state.backoffLevel), maxInterval);
    }
    if (interval != null) {
      return interval;
    }
    const next = nextTick(schedule);
    return next.getTime() - Date.now();
  }

  function run() {
    if (shuttingDown) return;

    if (state.isRunning) {
      logLine(logFile, { event: 'skip', task: name, reason: 'previous run still in progress' });
      scheduleNext();
      return;
    }

    state.isRunning = true;
    logLine(logFile, { event: 'run_start', task: name });

    const prompt = fs.readFileSync(promptAbsPath, 'utf8');
    state.promise = driver.run({ prompt, logFile, taskName: name })
      .then(({ sessionId, output }) => {
        logLine(logFile, { event: 'run_end', task: name, session_id: sessionId, outputLength: output.length });
        console.log(`[${name}] done — session ${sessionId}`);

        if (task.backoff) {
          const signal = task.backoff.signal ?? 'NO_DATA';
          if (output.includes(signal)) {
            state.backoffLevel++;
            logLine(logFile, { event: 'backoff', task: name, level: state.backoffLevel });
            console.log(`[${name}] no-data signal detected — backoff level ${state.backoffLevel}`);
          } else if (state.backoffLevel > 0) {
            state.backoffLevel = 0;
            logLine(logFile, { event: 'backoff_reset', task: name });
            console.log(`[${name}] data resumed — backoff reset`);
          }
        }
      })
      .catch((err) => {
        logLine(logFile, { event: 'run_error', task: name, error: err.message });
        console.error(`[${name}] error: ${err.message}`);
      })
      .finally(() => {
        state.isRunning = false;
        state.promise = null;
        scheduleNext();
      });
  }

  function scheduleNext() {
    if (shuttingDown) return;
    const delay = computeDelay();
    const nextDate = new Date(Date.now() + delay);
    console.log(`[${name}] next run at ${nextDate.toISOString()} (in ${Math.round(delay / 1000)}s)`);
    state.timer = setTimeout(run, delay);
  }

  // Kick off the first schedule
  scheduleNext();
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nReceived ${signal}. Shutting down gracefully…`);

  // Cancel all pending timers
  for (const [name, state] of taskState) {
    if (state.timer) {
      clearTimeout(state.timer);
      console.log(`[${name}] timer cancelled`);
    }
  }

  // Wait for running tasks (up to GRACEFUL_SHUTDOWN_MS)
  const running = [...taskState.values()].filter(s => s.isRunning && s.promise);
  if (running.length > 0) {
    console.log(`Waiting for ${running.length} running task(s) to finish (max ${GRACEFUL_SHUTDOWN_MS / 1000}s)…`);
    const timeout = new Promise(resolve => setTimeout(resolve, GRACEFUL_SHUTDOWN_MS));
    await Promise.race([
      Promise.allSettled(running.map(s => s.promise)),
      timeout,
    ]);
  }

  console.log('Scheduler stopped.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`Failed to load ${CONFIG_PATH}: ${err.message}`);
    process.exit(1);
  }

  const tasks = config.tasks ?? [];
  const enabled = tasks.filter(t => t.enabled);

  if (enabled.length === 0) {
    console.log('No enabled tasks found in tasks.config.json. Exiting.');
    process.exit(0);
  }

  console.log(`Scheduler starting — ${enabled.length} task(s) loaded`);
  for (const task of enabled) {
    scheduleTask(task);
  }
}

main();

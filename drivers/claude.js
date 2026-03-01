'use strict';

const { spawn } = require('child_process');
const BaseDriver = require('./base');

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

class ClaudeDriver extends BaseDriver {
  constructor(driverConfig = {}) {
    super(driverConfig);
    this.timeoutMs = driverConfig.timeout ?? DEFAULT_TIMEOUT_MS;
    this.claudeBin = driverConfig.claudeBin ?? 'claude';
  }

  run({ prompt, logFile, taskName }) {
    return new Promise((resolve, reject) => {
      const args = [
        '--print',
        '--output-format', 'stream-json',
        '--verbose',
        '--dangerously-skip-permissions',
      ];

      const env = { ...process.env };
      delete env.CLAUDECODE;
      delete env.CLAUDE_CODE_ENTRYPOINT;

      const child = spawn(this.claudeBin, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        detached: true,
      });
      child.unref();

      child.stdin.write(prompt);
      child.stdin.end();

      let sessionId = null;
      const outputChunks = [];
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill('SIGKILL');
          reject(new Error(`Task "${taskName}" timed out after ${this.timeoutMs / 1000}s`));
        }
      }, this.timeoutMs);

      this.lineBuffer(child.stdout, (line) => {
        if (!line.trim()) return;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          return; // non-JSON verbose line — skip
        }

        const type = msg.type;

        if (type === 'system' && msg.subtype === 'init') {
          sessionId = msg.session_id;
          this.appendLog(logFile, { event: 'session_start', task: taskName, session_id: sessionId });
        }

        if (type === 'assistant') {
          const content = msg.message?.content ?? [];
          for (const block of content) {
            if (block.type === 'text') {
              outputChunks.push(block.text);
              process.stdout.write(`[${taskName}] ${block.text}\n`);
            }
          }
        }

        if (type === 'result') {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            const output = outputChunks.join('');
            this.appendLog(logFile, { event: 'session_end', task: taskName, session_id: sessionId, result: msg.subtype });
            resolve({ sessionId, output });
          }
        }
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text) this.appendLog(logFile, { event: 'stderr', task: taskName, text });
      });

      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });

      child.on('close', (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Claude process exited with code ${code} before sending result`));
        }
      });
    });
  }
}

module.exports = ClaudeDriver;

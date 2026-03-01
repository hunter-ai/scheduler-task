'use strict';

const fs = require('fs');

class BaseDriver {
  constructor(driverConfig = {}) {
    this.driverConfig = driverConfig;
  }

  /**
   * Run a task session.
   * @param {object} opts
   * @param {string} opts.prompt     — prompt text content (already read)
   * @param {string} opts.logFile    — absolute path to the log file
   * @param {string} opts.taskName   — task name (for log entries)
   * @returns {Promise<{ sessionId: string|null, output: string }>}
   */
  async run({ prompt, logFile, taskName }) {
    throw new Error('Not implemented');
  }

  appendLog(logFile, entry) {
    const line = JSON.stringify({ ...entry, ts: new Date().toISOString() });
    fs.appendFileSync(logFile, line + '\n');
  }

  lineBuffer(stream, onLine) {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete last line
      for (const line of lines) {
        onLine(line);
      }
    });
  }
}

module.exports = BaseDriver;

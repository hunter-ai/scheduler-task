'use strict';

/**
 * Pure JS cron parser — no external dependencies.
 *
 * Supported field syntax:
 *   *        — every value
 *   n        — exact value
 *   a-b      — inclusive range
 *   * /n     — step (every n values across full range)
 *   a-b/n    — step within range
 *   x,y,...  — comma-separated list of any of the above
 *
 * Expression format (5 fields): minute hour day-of-month month day-of-week
 *   minute:       0-59
 *   hour:         0-23
 *   day-of-month: 1-31
 *   month:        1-12
 *   day-of-week:  0-6 (0=Sunday)
 */

const FIELD_RANGES = [
  { min: 0, max: 59 },  // minute
  { min: 0, max: 23 },  // hour
  { min: 1, max: 31 },  // day-of-month
  { min: 1, max: 12 },  // month
  { min: 0, max: 6  },  // day-of-week
];

/**
 * Parse a single cron field string into a Set of matching numbers.
 * @param {string} field
 * @param {{ min: number, max: number }} range
 * @returns {Set<number>}
 */
function parseField(field, { min, max }) {
  const result = new Set();

  for (const part of field.split(',')) {
    const trimmed = part.trim();

    // Step syntax: "*/n" or "a-b/n"
    const stepMatch = trimmed.match(/^([^/]+)\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[2], 10);
      if (step < 1) throw new Error(`Invalid step value: ${step}`);
      const [rangeMin, rangeMax] = parseRange(stepMatch[1], min, max);
      for (let v = rangeMin; v <= rangeMax; v += step) {
        result.add(v);
      }
      continue;
    }

    // Wildcard: "*"
    if (trimmed === '*') {
      for (let v = min; v <= max; v++) result.add(v);
      continue;
    }

    // Range: "a-b"
    if (trimmed.includes('-')) {
      const [rangeMin, rangeMax] = parseRange(trimmed, min, max);
      for (let v = rangeMin; v <= rangeMax; v++) result.add(v);
      continue;
    }

    // Single number
    const n = parseInt(trimmed, 10);
    if (isNaN(n) || n < min || n > max) {
      throw new Error(`Value ${trimmed} out of range [${min}, ${max}]`);
    }
    result.add(n);
  }

  return result;
}

/**
 * Parse a range expression like "a-b" or "*" into [min, max].
 * @param {string} expr
 * @param {number} defaultMin
 * @param {number} defaultMax
 * @returns {[number, number]}
 */
function parseRange(expr, defaultMin, defaultMax) {
  if (expr === '*') return [defaultMin, defaultMax];
  const parts = expr.split('-');
  if (parts.length !== 2) throw new Error(`Invalid range: ${expr}`);
  const a = parseInt(parts[0], 10);
  const b = parseInt(parts[1], 10);
  if (isNaN(a) || isNaN(b) || a > b) throw new Error(`Invalid range: ${expr}`);
  return [a, b];
}

/**
 * Parse a 5-field cron expression.
 * @param {string} expr
 * @returns {{ minute: Set<number>, hour: Set<number>, dom: Set<number>, month: Set<number>, dow: Set<number> }}
 */
function parseCron(expr) {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have 5 fields, got ${fields.length}: "${expr}"`);
  }
  const [minuteF, hourF, domF, monthF, dowF] = fields;
  return {
    minute: parseField(minuteF, FIELD_RANGES[0]),
    hour:   parseField(hourF,   FIELD_RANGES[1]),
    dom:    parseField(domF,    FIELD_RANGES[2]),
    month:  parseField(monthF,  FIELD_RANGES[3]),
    dow:    parseField(dowF,    FIELD_RANGES[4]),
  };
}

/**
 * Calculate the next trigger Date for a cron expression.
 * Searches from the start of the next minute (or `from + 1 minute`).
 *
 * @param {string} expr — cron expression
 * @param {Date} [from=new Date()] — reference time
 * @returns {Date}
 */
function nextTick(expr, from) {
  const parsed = parseCron(expr);
  const base = from ? new Date(from) : new Date();

  // Start at the next whole minute
  const candidate = new Date(base);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Search up to 4 years (366*4*24*60 minutes) to avoid infinite loops
  const MAX_ITERATIONS = 366 * 4 * 24 * 60;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const month = candidate.getMonth() + 1; // JS months are 0-indexed
    const dom   = candidate.getDate();
    const dow   = candidate.getDay();
    const hour  = candidate.getHours();
    const min   = candidate.getMinutes();

    if (
      parsed.month.has(month) &&
      parsed.dom.has(dom) &&
      parsed.dow.has(dow) &&
      parsed.hour.has(hour) &&
      parsed.minute.has(min)
    ) {
      return new Date(candidate);
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error(`No next tick found for cron expression: "${expr}"`);
}

module.exports = { parseCron, nextTick };

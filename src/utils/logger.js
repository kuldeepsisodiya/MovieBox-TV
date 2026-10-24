/**
 * MovieBox TV Leveled Logging Utility
 * Supports TV diagnostics screen inspection with URL sanitization.
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const LOG_BUFFER_MAX = 200;
const logBuffer = [];

let currentLogLevel = LOG_LEVELS.INFO;

export function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    if (parsed.search) {
      // Redact sensitive query parameters
      const params = new URLSearchParams(parsed.search);
      for (const key of ['token', 'key', 'secret', 'auth', 'sig', 'signature', 'pass', 'password']) {
        if (params.has(key)) {
          params.set(key, '[REDACTED]');
        }
      }
      parsed.search = params.toString();
    }
    return parsed.toString();
  } catch {
    return url.replace(/([?&](?:token|key|secret|auth|sig|signature)=)[^&#]*/gi, '$1[REDACTED]');
  }
}

function formatLogEntry(level, tag, message, data) {
  const timestamp = new Date().toISOString().substring(11, 23);
  const sanitizedMessage = typeof message === 'string' ? sanitizeUrl(message) : message;
  return {
    timestamp,
    level,
    tag,
    message: sanitizedMessage,
    data: data ? JSON.parse(JSON.stringify(data, (k, v) => (typeof v === 'string' ? sanitizeUrl(v) : v))) : null,
  };
}

function pushLog(entry) {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_MAX) {
    logBuffer.shift();
  }
}

export const logger = {
  setLogLevel(level) {
    if (typeof level === 'string' && LOG_LEVELS[level.toUpperCase()] !== undefined) {
      currentLogLevel = LOG_LEVELS[level.toUpperCase()];
    } else if (typeof level === 'number') {
      currentLogLevel = level;
    }
  },

  getRecentLogs() {
    return [...logBuffer];
  },

  clearLogs() {
    logBuffer.length = 0;
  },

  debug(tag, message, data) {
    if (currentLogLevel <= LOG_LEVELS.DEBUG) {
      const entry = formatLogEntry('DEBUG', tag, message, data);
      pushLog(entry);
      console.debug(`[${entry.timestamp}] [DEBUG] [${tag}]`, entry.message, data || '');
    }
  },

  info(tag, message, data) {
    if (currentLogLevel <= LOG_LEVELS.INFO) {
      const entry = formatLogEntry('INFO', tag, message, data);
      pushLog(entry);
      console.info(`[${entry.timestamp}] [INFO] [${tag}]`, entry.message, data || '');
    }
  },

  warn(tag, message, data) {
    if (currentLogLevel <= LOG_LEVELS.WARN) {
      const entry = formatLogEntry('WARN', tag, message, data);
      pushLog(entry);
      console.warn(`[${entry.timestamp}] [WARN] [${tag}]`, entry.message, data || '');
    }
  },

  error(tag, message, error) {
    if (currentLogLevel <= LOG_LEVELS.ERROR) {
      const errData = error instanceof Error ? { message: error.message, stack: error.stack } : error;
      const entry = formatLogEntry('ERROR', tag, message, errData);
      pushLog(entry);
      console.error(`[${entry.timestamp}] [ERROR] [${tag}]`, entry.message, errData || '');
    }
  },
};

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function format(level: LogLevel, scope: string, msg: string): string {
  return `[${new Date().toISOString()}] [${level.toUpperCase()}] [${scope}] ${msg}`;
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, ...args: unknown[]) => {
      if (shouldLog('debug')) console.debug(format('debug', scope, msg), ...args);
    },
    info: (msg: string, ...args: unknown[]) => {
      if (shouldLog('info')) console.info(format('info', scope, msg), ...args);
    },
    warn: (msg: string, ...args: unknown[]) => {
      if (shouldLog('warn')) console.warn(format('warn', scope, msg), ...args);
    },
    error: (msg: string, ...args: unknown[]) => {
      if (shouldLog('error')) console.error(format('error', scope, msg), ...args);
    },
  };
}

/**
 * 极简结构化日志（m01 建，全程复用）。
 * ponytail: 自带 ~20 行的 JSON line logger，够一个终端 CLI 用；真要 pino 的
 * transport/采样/重定向时再换——接口（debug/info/warn/error）保持不变即可平替。
 *
 * 设计：日志走 stderr，不污染 stdout 的流式回复（stdout 留给 agent 说话）。
 * level 由 LOG_LEVEL 控制（debug|info|warn|error），默认 info。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(level: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info'): Logger {
  const min = ORDER[level] ?? ORDER.info;
  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < min) return;
    const line = { t: new Date().toISOString(), level: lvl, msg, ...fields };
    process.stderr.write(JSON.stringify(line) + '\n');
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

/** 测试/静默场景用：什么都不打印。 */
export const silentLogger: Logger = {
  debug() {}, info() {}, warn() {}, error() {},
};

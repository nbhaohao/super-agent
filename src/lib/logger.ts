// 将 DEBUG=true 写入 .env 文件即可开启所有日志
const DEBUG = process.env.DEBUG === 'true';

export function log(label: string, data?: unknown): void {
    if (!DEBUG) return;
    const msg = data !== undefined
        ? `[debug] ${label}: ${typeof data === 'string' ? data : JSON.stringify(data)}`
        : `[debug] ${label}`;
    console.log(msg);
}

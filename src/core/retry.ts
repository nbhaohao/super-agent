/**
 * API 容错（s3 核心 · 后端核心，重点 review）—— 第二层防护「过载保护」。
 *
 * 核心是分类：哪些错值得重试、哪些直接抛。429/超时/网络/5xx 值得重试；4xx（参数错）重试一万次也没用。
 * 退避用指数 + 抖动：翻倍等待避免轰炸服务端；±25% 随机抖动打散「惊群效应」（所有客户端同时重试形成洪峰）。
 */

/** 错误是否值得重试。 */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message || "";

  const statusMatch = message.match(/\b(\d{3})\b/);
  if (statusMatch) {
    const status = parseInt(statusMatch[1], 10);
    if ([408, 429, 529].includes(status)) return true;
    if (status >= 500 && status < 600) return true;
    if (status >= 400 && status < 500) return false;
  }

  if (/ECONNRESET|EPIPE|ETIMEDOUT|timeout|fetch failed|network/i.test(message))
    return true;
  // AI SDK 把流式中断包装成 NoOutputGeneratedError
  if (message.includes("No output generated")) return true;

  return false;
}

/** 第 attempt 次重试该等多久：指数退避 + ±25% 抖动，封顶 maxMs。 */
export function calculateDelay(
  attempt: number,
  baseMs = 500,
  maxMs = 30000,
): number {
  const exponential = baseMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, maxMs);
  const jittered = capped + (Math.random() * 2 - 1) * capped * 0.25;
  return Math.max(0, Math.round(jittered));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

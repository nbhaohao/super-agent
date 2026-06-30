/**
 * 搜索工具（s7 加餐）—— web_search 双引擎 + web_fetch（gen，pickSearchTool 为写核心）。
 *
 * 两个引擎注册的工具名都叫 web_search，对模型透明；切换后端只改环境变量：
 *   Tavily（自动挡）：搜索 + AI 提取正文/摘要，省心但贵慢。
 *   Serper（手动挡）：Google 代理，只回 snippet，便宜但要配 web_fetch 抓全文。
 */
import type { ToolDefinition } from './registry.js';

// ── Tavily（自动挡）──────────────────────────────────────────────
export const tavilySearchTool: ToolDefinition = {
  name: 'web_search',
  description: '搜索互联网获取最新信息。返回相关网页的标题、链接和内容摘要',
  parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' }, max_results: { type: 'number', description: '返回结果数量，默认 5' } }, required: ['query'], additionalProperties: false },
  isConcurrencySafe: true,
  isReadOnly: true,
  maxResultChars: 3000,
  execute: async ({ query, max_results = 5 }: { query: string; max_results?: number }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return '[web_search] 未配置 TAVILY_API_KEY，请在 .env 中设置';
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query, max_results, include_answer: true }),
    });
    if (!res.ok) return `[web_search] 请求失败: HTTP ${res.status}`;
    const data = (await res.json()) as any;
    const lines: string[] = [];
    if (data.answer) lines.push(`## AI 摘要\n${data.answer}\n`);
    for (const r of data.results ?? []) {
      lines.push(`### ${r.title}`, r.url, r.content || r.snippet || '', '');
    }
    return lines.join('\n') || '没有找到相关结果';
  },
};

// ── Serper（手动挡）──────────────────────────────────────────────
export const serperSearchTool: ToolDefinition = {
  name: 'web_search',
  description: '搜索互联网获取最新信息。返回 Google 搜索结果的标题、链接和摘要',
  parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' }, max_results: { type: 'number', description: '返回结果数量，默认 5' } }, required: ['query'], additionalProperties: false },
  isConcurrencySafe: true,
  isReadOnly: true,
  maxResultChars: 3000,
  execute: async ({ query, max_results = 5 }: { query: string; max_results?: number }) => {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) return '[web_search] 未配置 SERPER_API_KEY，请在 .env 中设置';
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: max_results }),
    });
    if (!res.ok) return `[web_search] 请求失败: HTTP ${res.status}`;
    const data = (await res.json()) as any;
    const lines: string[] = [];
    if (data.knowledgeGraph) {
      lines.push(`## ${data.knowledgeGraph.title}`);
      if (data.knowledgeGraph.description) lines.push(data.knowledgeGraph.description);
      lines.push('');
    }
    for (const r of (data.organic || []).slice(0, max_results)) {
      lines.push(`### ${r.title}`, r.link, r.snippet || '', '');
    }
    return lines.join('\n') || '没有找到相关结果';
  },
};

// ── web_fetch（手动挡配套：抓全文转 Markdown）──────────────────────
export const webFetchTool: ToolDefinition = {
  name: 'web_fetch',
  description: '抓取指定 URL 的网页内容，转换为 Markdown 格式',
  parameters: { type: 'object', properties: { url: { type: 'string', description: '完整 URL' } }, required: ['url'], additionalProperties: false },
  isConcurrencySafe: true,
  isReadOnly: true,
  maxResultChars: 3000,
  execute: async ({ url }: { url: string }) => {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SuperAgent/1.0)' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) return `抓取失败: HTTP ${res.status}`;
      return htmlToMarkdown(await res.text());
    } catch (err: any) {
      return `抓取失败: ${err.message}`;
    }
  },
};

/**
 * ponytail: 极简 HTML→Markdown，够 demo 用。生产换 Turndown（30KB，正确处理嵌套/表格/实体）。
 * 先剥噪音标签（script/style/nav/footer），再把标题/链接/代码转成 Markdown，最后压空白。
 */
function htmlToMarkdown(html: string): string {
  return html
    .replace(/<(script|style|nav|footer)[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n, t) => `\n${'#'.repeat(Number(n))} ${strip(t)}\n`)
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, t) => `[${strip(t)}](${href})`)
    .replace(/<(code|pre)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, c) => `\`${strip(c)}\``)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t) => `- ${strip(t)}\n`)
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function strip(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * s7（写）：启动时按环境变量自动挑搜索后端 —— 配了 Tavily 用 Tavily，配了 Serper 用 Serper，
 * 都没配返回默认（会提示配 key）。加 Brave 只需再写一个 tool + 在这里加一个 if。
 */
export function pickSearchTool(): ToolDefinition {
  // TODO: stage 4(s7) —— 按环境变量挑后端
  // 1. process.env.TAVILY_API_KEY 存在 → 返回 tavilySearchTool（自动挡）
  // 2. 否则 process.env.SERPER_API_KEY 存在 → 返回 serperSearchTool（手动挡）
  // 3. 都没有 → 返回 tavilySearchTool 作默认（其 execute 会提示去配 key）
  throw new Error('TODO: stage 4(s7) pickSearchTool');
}

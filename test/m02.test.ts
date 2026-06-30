import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ToolRegistry, truncateResult } from '../src/tools/registry.js';
import { editFileTool, fetchUrlTool, simulatedDeferredTools } from '../src/tools/builtin.js';
import { pickSearchTool, tavilySearchTool, serperSearchTool } from '../src/tools/search.js';
import { MockMCPClient } from '../src/tools/mcp.js';

// ── stage 1 · s4：工具注册 + 结果截断 + 读写锁 ──────────────────────
describe('stage 1 · s4 ToolRegistry：结果截断 + 读写锁', () => {
  it('truncateResult：超长文本 Head/Tail 60/40 截断 + 标注省略', () => {
    const text = 'A'.repeat(100) + 'B'.repeat(100); // 200 字符
    const out = truncateResult(text, 50); // head=30 tail=20 dropped=150
    expect(out).toContain('... [省略 150 字符] ...');
    expect(out.startsWith('A')).toBe(true); // 保留头部
    expect(out.endsWith('B')).toBe(true); // 保留尾部
    expect(out.length).toBeLessThan(text.length);
  });
  it('truncateResult：未超限原样返回', () => {
    expect(truncateResult('hello', 50)).toBe('hello');
  });
  it('读写锁：独占锁必须等所有共享锁释放后才获得', async () => {
    const reg = new ToolRegistry();
    const order: string[] = [];
    await reg.acquireConcurrent(); // 读者持共享锁
    const writer = (async () => {
      await reg.acquireExclusive();
      order.push('w');
      reg.releaseExclusive();
    })();
    order.push('r-holding');
    await new Promise((r) => setTimeout(r, 10)); // 给 writer 机会（它不该插队）
    expect(order).toEqual(['r-holding']); // writer 仍在等
    reg.releaseConcurrent();
    await writer;
    expect(order).toEqual(['r-holding', 'w']);
  });
});

// ── stage 2 · s5：edit_file 精确替换 ────────────────────────────────
describe('stage 2 · s5 edit_file 精确替换的三种结果', () => {
  const tmp = join(tmpdir(), `m02-edit-${process.pid}.txt`);
  afterEach(() => {
    try {
      unlinkSync(tmp);
    } catch {}
  });
  it('唯一匹配 → 替换成功', async () => {
    writeFileSync(tmp, 'hello world', 'utf-8');
    const r = await editFileTool.execute({ path: tmp, old_string: 'world', new_string: 'agent' });
    expect(r).toContain('已替换');
    expect(readFileSync(tmp, 'utf-8')).toBe('hello agent');
  });
  it('0 匹配 → 提示未找到（给模型自我修正）', async () => {
    writeFileSync(tmp, 'hello', 'utf-8');
    expect(await editFileTool.execute({ path: tmp, old_string: 'xyz', new_string: 'q' })).toContain('未找到');
  });
  it('多处匹配 → 要求更多上下文', async () => {
    writeFileSync(tmp, 'a a a', 'utf-8');
    expect(await editFileTool.execute({ path: tmp, old_string: 'a', new_string: 'b' })).toContain('找到 3 处');
  });
});

// ── stage 3 · s6：fetch_url 抓网页转纯文本 ──────────────────────────
describe('stage 3 · s6 fetch_url 剥离 HTML 标签', () => {
  it('剥掉标签只留正文（MOCK_PAGES 离线兜底）', async () => {
    const r = (await fetchUrlTool.execute({ url: 'https://example.com' })) as string;
    expect(r).not.toContain('<'); // 标签全剥
    expect(r).toContain('Example Domain'); // 正文保留
  });
});

// ── stage 4 · s7：web_search 双引擎按 env 选择 ──────────────────────
describe('stage 4 · s7 pickSearchTool 按环境变量选后端', () => {
  afterEach(() => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.SERPER_API_KEY;
  });
  it('两个引擎对模型同名 web_search（后端透明）', () => {
    expect(tavilySearchTool.name).toBe('web_search');
    expect(serperSearchTool.name).toBe('web_search');
  });
  it('配了 TAVILY_API_KEY → Tavily（自动挡）', () => {
    process.env.TAVILY_API_KEY = 'x';
    expect(pickSearchTool()).toBe(tavilySearchTool);
  });
  it('只配 SERPER_API_KEY → Serper（手动挡）', () => {
    process.env.SERPER_API_KEY = 'x';
    expect(pickSearchTool()).toBe(serperSearchTool);
  });
});

// ── stage 5 · s8：MCP 注册 + 命名空间隔离 ──────────────────────────
describe('stage 5 · s8 registerMCPServer 命名空间隔离', () => {
  it('注册 MockMCP → 工具带 mcp__github__ 前缀，execute 转发到 callTool', async () => {
    const reg = new ToolRegistry();
    const names = await reg.registerMCPServer('github', new MockMCPClient());
    expect(names).toContain('mcp__github__list_issues');
    const tool = reg.get('mcp__github__list_issues')!;
    const out = (await tool.execute({ owner: 'vercel', repo: 'ai' })) as string;
    expect(out).toContain('支持 MCP 协议接入'); // 来自 MockMCP.callTool
  });
  it('同名工具二次注册被跳过（不覆盖）', async () => {
    const reg = new ToolRegistry();
    await reg.registerMCPServer('github', new MockMCPClient());
    const before = reg.getAll().length;
    await reg.registerMCPServer('github', new MockMCPClient());
    expect(reg.getAll().length).toBe(before);
  });
});

// ── stage 6 · s9：延迟加载 ToolSearch ──────────────────────────────
describe('stage 6 · s9 延迟加载：藏起来按需发现', () => {
  function setup() {
    const reg = new ToolRegistry();
    reg.register(...simulatedDeferredTools());
    return reg;
  }
  it('延迟工具默认不进 active，被 searchTools 发现后才进', () => {
    const reg = setup();
    const before = reg.getActiveTools().length; // 0：全是延迟工具
    const found = reg.searchTools('mcp__notion__search_pages');
    expect(found.map((t) => t.name)).toContain('mcp__notion__search_pages');
    expect(reg.getActiveTools().length).toBe(before + 1);
  });
  it('getDeferredToolSummary 列出未发现的延迟工具 + 提示去 tool_search', () => {
    const summary = setup().getDeferredToolSummary();
    expect(summary).toContain('mcp__supabase__query');
    expect(summary).toContain('tool_search');
  });
  it('countTokenEstimate：延迟工具的 token 不计入 active', () => {
    const est = setup().countTokenEstimate();
    expect(est.deferred).toBeGreaterThan(0);
    expect(est.active).toBe(0);
  });
});

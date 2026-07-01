import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelMessage } from 'ai';

import { SkillLoader } from '../src/skills/loader.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { PluginManager } from '../src/plugins/manager.js';
import type { PluginDefinition, PluginApi } from '../src/plugins/types.js';
import { ChannelGateway } from '../src/channels/gateway.js';
import { MockChannel } from '../src/channels/mock.js';

// ── stage 1 · s17：SkillLoader 渐进式加载 ─────────────────────────────
describe('stage 1 · s17 SkillLoader.buildPromptSection', () => {
  const base = join(tmpdir(), `sa-m05-skill-${process.pid}`);
  afterEach(() => {
    try { rmSync(base, { recursive: true, force: true }); } catch {}
  });

  function seedSkill() {
    const dir = join(base, '.skills', 'code-review');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      '---\nname: code-review\ndescription: "以高级工程师视角审查代码"\nwhen_to_use: "当用户要求审查代码时"\n---\n\n# Code Review\n\n## 审查流程\n先确定范围，再逐文件审查 SOLID。',
    );
  }

  it('未激活：只列 name + description，不注入正文', () => {
    seedSkill();
    const loader = new SkillLoader(base);
    loader.load();
    const section = loader.buildPromptSection(new Set());
    expect(section).toContain('/code-review');
    expect(section).toContain('以高级工程师视角审查代码');
    expect(section).not.toContain('审查流程'); // 正文不进 prompt
  });

  it('已激活：注入完整 SOP 正文', () => {
    seedSkill();
    const loader = new SkillLoader(base);
    loader.load();
    const section = loader.buildPromptSection(new Set(['code-review']));
    expect(section).toContain('[激活的 Skill: code-review]');
    expect(section).toContain('审查流程'); // 激活后正文注入
  });

  it('没有任何 skill → 返回 null（不往 prompt 塞空段）', () => {
    const loader = new SkillLoader(base); // base 下没有 .skills
    loader.load();
    expect(loader.buildPromptSection(new Set())).toBeNull();
  });
});

// ── stage 2 · s18：PluginManager 加载 ─────────────────────────────────
describe('stage 2 · s18 PluginManager.load', () => {
  function makePlugin(over: Partial<PluginDefinition> = {}): PluginDefinition {
    return {
      name: 'db',
      version: '1.0.0',
      description: 'test',
      activate(api: PluginApi) {
        api.registerTools([
          { name: 'query', description: 'q', parameters: { type: 'object', properties: {}, required: [] }, execute: async () => 'ok' },
        ]);
      },
      ...over,
    };
  }

  it('工具名加 `plugin__tool` 前缀防冲突', async () => {
    const registry = new ToolRegistry();
    const manager = new PluginManager(registry);
    const names = await manager.load(makePlugin());
    expect(names).toEqual(['db__query']);
    expect(registry.get('db__query')).toBeDefined();
    expect(registry.get('query')).toBeUndefined(); // 裸名不注册
  });

  it('config 里的 ${ENV} 占位符解析成真实环境变量值', async () => {
    process.env.SA_M05_DB_URL = 'http://db.local';
    const registry = new ToolRegistry();
    const manager = new PluginManager(registry);
    let seen = '';
    await manager.load(
      makePlugin({
        config: { url: '${SA_M05_DB_URL}' },
        activate(api: PluginApi) {
          seen = String(api.getConfig().url);
          api.registerTools([]);
        },
      }),
    );
    expect(seen).toBe('http://db.local');
    delete process.env.SA_M05_DB_URL;
  });

  it('同名插件重复加载 → 抛错', async () => {
    const registry = new ToolRegistry();
    const manager = new PluginManager(registry);
    await manager.load(makePlugin());
    await expect(manager.load(makePlugin())).rejects.toThrow(/已加载/);
  });
});

// ── stage 3 · s19：ChannelGateway 路由 ────────────────────────────────
describe('stage 3 · s19 ChannelGateway.handleIncoming', () => {
  // 注入的 agent 替身：把最后一条 user 内容回声成 assistant 回复
  function echoAgent(historyLens: number[]) {
    return async (messages: ModelMessage[]) => {
      historyLens.push(messages.length);
      const last = messages[messages.length - 1];
      messages.push({ role: 'assistant', content: 'echo:' + String(last.content) });
    };
  }

  it('回复经同一 Channel 原路发回，收件人正确', async () => {
    const lens: number[] = [];
    const gateway = new ChannelGateway({ buildSystem: () => 'sys', runAgent: echoAgent(lens) });
    const mock = new MockChannel('mock');
    gateway.register(mock);

    mock.emit({ channelId: 'c1', senderId: 'u1', senderName: 'Alice', text: 'hello' });
    await new Promise((r) => setTimeout(r, 0)); // 等 async handleIncoming 跑完

    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0]).toMatchObject({ channelId: 'c1', recipientId: 'u1', text: 'echo:hello' });
  });

  it('每个发送者一条独立会话：同人累积历史，不同人各自新开', async () => {
    const lens: number[] = [];
    const gateway = new ChannelGateway({ buildSystem: () => 'sys', runAgent: echoAgent(lens) });
    const mock = new MockChannel('mock');
    gateway.register(mock);

    mock.emit({ channelId: 'c1', senderId: 'u1', senderName: 'A', text: 'a1' });
    await new Promise((r) => setTimeout(r, 0));
    mock.emit({ channelId: 'c1', senderId: 'u1', senderName: 'A', text: 'a2' });
    await new Promise((r) => setTimeout(r, 0));
    mock.emit({ channelId: 'c1', senderId: 'u2', senderName: 'B', text: 'b1' });
    await new Promise((r) => setTimeout(r, 0));

    // u1 第一轮跑 agent 时历史=1（仅 user），第二轮=3（user+assistant+user）；u2 新会话=1
    expect(lens).toEqual([1, 3, 1]);
  });
});

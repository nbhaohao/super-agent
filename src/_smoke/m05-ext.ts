// m05 Skills + Plugins + Channel —— 分阶段 smoke demo（纯本地，无需 key）
// 用法：pnpm v:s17 / v:s18 / v:s19（先实现对应核心函数，再跑体感）
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelMessage } from 'ai';

import { SkillLoader } from '../skills/loader.js';
import { ToolRegistry } from '../tools/registry.js';
import { PluginManager } from '../plugins/manager.js';
import { dbPlugin } from '../plugins/db-plugin.js';
import { ChannelGateway } from '../channels/gateway.js';
import { MockChannel } from '../channels/mock.js';

const stage = process.argv[2] ?? '17';

if (stage === '17') {
  console.log('\n=== s17: Skills 渐进式加载 ===\n');
  const base = mkdtempSync(join(tmpdir(), 'sa-m05-'));
  const dir = join(base, '.skills', 'code-review');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    '---\nname: code-review\ndescription: 以高级工程师视角审查代码变更\nwhen_to_use: 当用户要求审查代码时\n---\n\n# Code Review\n\n## 审查流程\n1) 确定范围 2) 逐文件查 SOLID 3) 安全扫描 4) 按 P0/P1/P2 分级输出',
  );
  const loader = new SkillLoader(base);
  loader.load();
  console.log('【未激活】只注入 name + description（省 token）：');
  console.log(loader.buildPromptSection(new Set()));
  console.log('\n【已激活 code-review】完整 SOP 注入 system prompt：');
  console.log(loader.buildPromptSection(new Set(['code-review'])));
  rmSync(base, { recursive: true, force: true });
}

if (stage === '18') {
  console.log('\n=== s18: Plugin 动态加载 ===\n');
  const registry = new ToolRegistry();
  const manager = new PluginManager(registry);
  const tools = await manager.load(dbPlugin);
  console.log(`加载插件 db，注册工具：${tools.join(', ')}`);
  console.log('调 db__list_tables →', await registry.get('db__list_tables')!.execute({}));
  await manager.unload('db');
  console.log('卸载 db 后 registry.get("db__query") →', registry.get('db__query'));
}

if (stage === '19') {
  console.log('\n=== s19: Channel 路由 ===\n');
  // 注入一个回声 agent 替身（生产里换成真 agentLoop）
  const runAgent = async (messages: ModelMessage[]) => {
    const last = messages[messages.length - 1];
    messages.push({ role: 'assistant', content: '收到：' + String(last.content) });
  };
  const gateway = new ChannelGateway({ buildSystem: () => 'you are super agent', runAgent });
  const mock = new MockChannel('mock');
  gateway.register(mock);

  mock.emit({ channelId: 'group-1', senderId: 'u1', senderName: '小明', text: '你好' });
  await new Promise((r) => setTimeout(r, 0));
  console.log('  → 回复：', mock.sent[mock.sent.length - 1]);
}

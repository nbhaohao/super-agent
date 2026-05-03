import 'dotenv/config';
import { createMockProvider, createRealProvider } from './providers/provider.js';
import { ToolRegistry } from './tools/registry.js';
import { allTools } from './tools/index.js';
import { ChatAgent } from './agent/chat-agent.js';
import { runWebServer } from './server/http.js';

const mockModel = createMockProvider();
const realModel = createRealProvider();

const registry = new ToolRegistry();
registry.register(...allTools);

console.log(`已注册 ${registry.getAll().length} 个工具：`);
for (const tool of registry.getAll()) {
    const flags = [
        tool.isConcurrencySafe ? '可并发' : '串行',
        tool.isReadOnly ? '只读' : '读写',
    ].join(', ');
    console.log(`  - ${tool.name}（${flags}）`);
}

const agent = new ChatAgent(realModel ?? mockModel, registry);
runWebServer(agent, { mockModel, realModel }, registry);

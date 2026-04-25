import 'dotenv/config';
import { createLLMProvider } from './infrastructure/llm/provider.js';
import { tools } from './infrastructure/tools/index.js';
import { ChatAgent } from './application/chat-agent.js';
import { runCLI } from './infrastructure/cli/readline-cli.js';

// 组合根（Composition Root）：组装依赖，不含任何业务逻辑
const model = createLLMProvider();
const agent = new ChatAgent(model, tools);
runCLI(agent);

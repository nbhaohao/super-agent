import 'dotenv/config';
import { createLLMProvider } from './providers/provider.js';
import { tools } from './tools/index.js';
import { ChatAgent } from './agent/chat-agent.js';
import { runWebServer } from './server/http.js';

const model = createLLMProvider();
const agent = new ChatAgent(model, tools);
runWebServer(agent);

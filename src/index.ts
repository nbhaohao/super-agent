import 'dotenv/config';
import { createMockProvider, createRealProvider } from './providers/provider.js';
import { tools } from './tools/index.js';
import { ChatAgent } from './agent/chat-agent.js';
import { runWebServer } from './server/http.js';

const mockModel = createMockProvider();
const realModel = createRealProvider();

const agent = new ChatAgent(realModel ?? mockModel, tools);
runWebServer(agent, { mockModel, realModel });

/**
 * ToolRegistry —— 工具系统的中枢（m02 后端核心，重点 review）。
 *
 * 一个比 AI SDK 的 tool() 更「厚」的抽象：除了模型关心的 description/parameters/execute，
 * 还打包了运行时控制信息——并发安全(isConcurrencySafe)、只读(isReadOnly)、结果上限(maxResultChars)。
 * 注册一次，同时服务两个消费者：模型（怎么调）和 Agent Loop（怎么管）。
 *
 * 这一个类跨三关长大（每关只动自己那几处，不推倒重来）：
 *   s4  截断 truncateResult + 读写锁（acquire/release/drain）—— 执行管线
 *   s8  registerMCPServer / closeAllMCP —— 把外部 MCP 工具注册进同一套管线
 *   s9  searchTools / getDeferredToolSummary / countTokenEstimate —— 延迟加载
 * gen 的部分（register/get/getAll/getActiveTools/toAISDKFormat）是脚手架，已就位。
 */
import { jsonSchema, type ToolSet } from "ai";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute: (input: any) => Promise<unknown>;
  // ── 元数据：给 Agent Loop 做决策用，模型看不到 ──
  isConcurrencySafe?: boolean; // 能否和别的工具并行
  isReadOnly?: boolean; // 是否只读（无副作用）
  maxResultChars?: number; // 结果最大长度，超了截断
  shouldDefer?: boolean; // s9：是否延迟加载（不常驻 prompt）
  searchHint?: string; // s9：给 tool_search 的匹配线索（模型看不到）
}

const DEFAULT_MAX_RESULT_CHARS = 3000;

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  // s4：三个状态变量构成一把读写锁
  private exclusiveLock = false; // 当前是否有独占锁持有者
  private concurrentCount = 0; // 当前共享锁持有数
  private waitQueue: Array<() => void> = []; // 阻塞等待中的 resolve 函数

  // s8 / s9 的状态
  private mcpClients: Array<{ close(): Promise<void> }> = [];
  private discoveredTools = new Set<string>(); // s9：被 tool_search 发现过的延迟工具

  // ── gen：注册与查找（已就位）──
  register(...tools: ToolDefinition[]): void {
    for (const tool of tools) this.tools.set(tool.name, tool);
  }
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** gen：进入 prompt 的工具 = 全部工具 - 未被发现的延迟工具（s9 的过滤口径）。 */
  getActiveTools(): ToolDefinition[] {
    return this.getAll().filter((tool) => {
      if (tool.shouldDefer && !this.discoveredTools.has(tool.name))
        return false;
      return true;
    });
  }

  /**
   * gen：转成 AI SDK 的 ToolSet —— 在 execute 外包一层「读写锁 + 截断」。
   * 注册一次，AI SDK 拿到的就是已经带并发控制和截断保护的版本，Agent Loop 不用感知细节。
   */
  toAISDKFormat(): ToolSet {
    const result: ToolSet = {};
    for (const tool of this.getActiveTools()) {
      const maxChars = tool.maxResultChars;
      const executeFn = tool.execute;
      const isSafe = tool.isConcurrencySafe === true;
      result[tool.name] = {
        description: tool.description,
        inputSchema: jsonSchema(tool.parameters as any),
        execute: async (input: any) => {
          // 真正执行前先按 isConcurrencySafe 拿锁（打印锁类型，trace 里能看到并发/串行）
          if (isSafe) {
            await this.acquireConcurrent();
            console.log(`  [并发] ${tool.name} 获取共享锁`);
          } else {
            await this.acquireExclusive();
            console.log(`  [串行] ${tool.name} 获取独占锁，等待其他工具完成`);
          }
          try {
            const raw = await executeFn(input);
            const text =
              typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
            return truncateResult(text, maxChars);
          } finally {
            // 不管成功还是抛异常，锁都要还回去，否则整个 Registry 锁死
            if (isSafe) this.releaseConcurrent();
            else this.releaseExclusive();
          }
        },
      } as ToolSet[string];
    }
    return result;
  }

  // ── s4：读写锁（你写）──────────────────────────────────────────────
  /** 获取共享锁：只要没人独占就能拿，多个只读工具可以同时持有。 */
  async acquireConcurrent(): Promise<void> {
    //while(有人持独占 exclusiveLock) 就把自己的 resolve 推进 waitQueue 挂起；
    while (this.exclusiveLock) {
      await new Promise((resolve) =>
        this.waitQueue.push(resolve as () => void),
      );
    }
    this.concurrentCount++;
  }
  releaseConcurrent(): void {
    // concurrentCount--；当它归零（最后一个读者走了）时 drainQueue() 唤醒等待者。
    this.concurrentCount--;
    if (this.concurrentCount === 0) this.drainQueue();
  }
  /** 获取独占锁：必须等所有共享锁释放、且没人持独占。 */
  async acquireExclusive(): Promise<void> {
    // while(exclusiveLock || concurrentCount>0) 挂起等待；
    // 条件都清零后 exclusiveLock=true（独占成功）。
    while (this.exclusiveLock || this.concurrentCount > 0) {
      await new Promise((resolve) =>
        this.waitQueue.push(resolve as () => void),
      );
    }
    this.exclusiveLock = true;
  }
  releaseExclusive(): void {
    this.exclusiveLock = false;
    this.drainQueue();
  }
  /** 锁释放时把等待队列全唤醒，让它们重新去抢锁（不是轮询自旋）。 */
  private drainQueue(): void {
    // 把 waitQueue 一次性 splice(0) 取出，逐个 resolve()（让挂起者醒来重抢锁）。
    const queue = this.waitQueue.splice(0);
    for (const resolve of queue) resolve();
  }

  // ── s8：MCP 注册（写）──────────────────────────────────────────────
  /**
   * 连接一个 MCP Server，发现它的工具，加命名空间前缀 mcp__<server>__<tool> 注册进来。
   * 同名冲突跳过；每个工具的 execute 是个闭包，调用时通过 JSON-RPC 转发给 client.callTool。
   */
  async registerMCPServer(
    serverName: string,
    client: {
      connect(): Promise<void>;
      listTools(): Promise<
        Array<{
          name: string;
          description: string;
          inputSchema: Record<string, unknown>;
        }>
      >;
      callTool(name: string, args: Record<string, unknown>): Promise<string>;
      close(): Promise<void>;
    },
  ): Promise<string[]> {
    // stage 5(s8) —— 连接 + 发现 + 命名空间注册
    await client.connect();
    this.mcpClients.push(client);

    const tools = await client.listTools();
    const prefixedNames: string[] = [];
    for (const tool of tools) {
      const prefixedName = `mcp__${serverName}__${tool.name}`;
      if (this.tools.has(prefixedName)) continue;
      this.register({
        name: prefixedName,
        description: `${tool.description}[MCP:${serverName}]`,
        parameters: tool.inputSchema,
        isConcurrencySafe: true,
        isReadOnly: true,
        maxResultChars: 3000,
        execute: async (input: Record<string, unknown>) => {
          return await client.callTool(tool.name, input);
        },
      });
      prefixedNames.push(prefixedName);
    }
    return prefixedNames;
  }
  async closeAllMCP(): Promise<void> {
    // stage 5(s8) —— 逐个 await client.close()，然后清空 this.mcpClients
    await Promise.all(this.mcpClients.map((client) => client.close()));
    this.mcpClients = [];
  }

  // ── s9：延迟加载（写）──────────────────────────────────────────────
  /** 按精确工具名查找延迟工具（System prompt 已列出名字，无需模糊匹配），匹配到的加入 discovered。 */
  searchTools(query: string): ToolDefinition[] {
    // TODO: stage 6(s9) —— 按精确工具名查找（System prompt 已列出名字，无需模糊匹配）
    // 1. query 含逗号则 split 成多个名字（trim + 去空），否则就是单个名字
    // 2. 逐个 this.tools.get(name)：命中且不是 tool_search 本身 → 收集，并 this.discoveredTools.add(name)
    // 3. 返回命中的 ToolDefinition[]（被发现的工具下一轮就会出现在 active 里）
    throw new Error("TODO: stage 6(s9) searchTools");
  }
  /** 生成延迟工具的名字清单，附到 System prompt：模型据此知道有哪些能力、需要时去 search。 */
  getDeferredToolSummary(): string {
    // TODO: stage 6(s9) —— 取「shouldDefer 且未被发现」的工具，拼成提示文本
    //   每行 `  - 工具名 — searchHint`；开头点明「需要先通过 tool_search 搜索获取完整定义」；
    //   没有延迟工具就返回 ''。
    throw new Error("TODO: stage 6(s9) getDeferredToolSummary");
  }
  /** 粗略估算工具 Schema 的 token 占用（序列化字符数 / 4）：active 进 prompt，deferred 省下来。 */
  countTokenEstimate(): { active: number; deferred: number; total: number } {
    // TODO: stage 6(s9) —— 遍历所有工具，schemaSize = JSON.stringify({name,description,parameters}).length，
    //   tokens = ceil(schemaSize/4)；shouldDefer 且未发现 → 计入 deferred，否则 active；返回 {active,deferred,total}。
    throw new Error("TODO: stage 6(s9) countTokenEstimate");
  }
}

/**
 * s4（写）：结果截断 —— 上下文保卫战的第一道防线。
 * Head/Tail 60/40 分割：保留前 60% + 后 40%，中间用「... [省略 N 字符] ...」标记。
 * 为什么不只截头部？文件尾部往往更有价值（日志最新条目、代码函数实现、配置最后一节）。
 */
export function truncateResult(
  text: string,
  maxChars: number = DEFAULT_MAX_RESULT_CHARS,
): string {
  // Head/Tail 60/40 截断

  // 1. text.length <= maxChars → 原样返回
  // 2. headSize = floor(maxChars*0.6)，tailSize = maxChars - headSize
  // 3. head = 前 headSize 个字符，tail = 后 tailSize 个字符（slice(-tailSize)）
  // 4. dropped = text.length - headSize - tailSize
  // 5. 返回 `${head}\n\n... [省略 ${dropped} 字符] ...\n\n${tail}`
  if (text.length <= maxChars) return text;
  const headSize = Math.floor(maxChars * 0.6);
  const tailSize = maxChars - headSize;
  const head = text.slice(0, headSize);
  const tail = text.slice(-tailSize);
  const dropped = text.length - headSize - tailSize;
  return `${head}\n\n... [省略 ${dropped} 字符] ...\n\n${tail}`;
}

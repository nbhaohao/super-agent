import { jsonSchema } from 'ai';

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    isConcurrencySafe?: boolean;
    isReadOnly?: boolean;
    maxResultChars?: number;
    execute: (input: any) => Promise<unknown>;
}

export type LockEvent =
    | { type: 'wait';    toolName: string }
    | { type: 'acquire'; toolName: string }
    | { type: 'release'; toolName: string };

const DEFAULT_MAX_RESULT_CHARS = 3000;

export class ToolRegistry {
    private tools = new Map<string, ToolDefinition>();
    private exclusiveLock = false;
    private concurrentCount = 0;
    private waitQueue: Array<() => void> = [];
    private lockEventHandler?: (event: LockEvent) => void;

    register(...tools: ToolDefinition[]): void {
        for (const tool of tools) {
            this.tools.set(tool.name, tool);
        }
    }

    get(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    getAll(): ToolDefinition[] {
        return Array.from(this.tools.values());
    }

    setLockEventHandler(handler: (event: LockEvent) => void): void {
        this.lockEventHandler = handler;
    }

    private async acquireConcurrent(toolName: string): Promise<void> {
        if (this.exclusiveLock) {
            this.lockEventHandler?.({ type: 'wait', toolName });
            while (this.exclusiveLock) {
                await new Promise<void>(r => this.waitQueue.push(r));
            }
        }
        this.concurrentCount++;
        this.lockEventHandler?.({ type: 'acquire', toolName });
    }

    private releaseConcurrent(toolName: string): void {
        this.concurrentCount--;
        this.lockEventHandler?.({ type: 'release', toolName });
        if (this.concurrentCount === 0) this.drainQueue();
    }

    private async acquireExclusive(toolName: string): Promise<void> {
        if (this.exclusiveLock || this.concurrentCount > 0) {
            this.lockEventHandler?.({ type: 'wait', toolName });
            while (this.exclusiveLock || this.concurrentCount > 0) {
                await new Promise<void>(r => this.waitQueue.push(r));
            }
        }
        this.exclusiveLock = true;
        this.lockEventHandler?.({ type: 'acquire', toolName });
    }

    private releaseExclusive(toolName: string): void {
        this.exclusiveLock = false;
        this.lockEventHandler?.({ type: 'release', toolName });
        this.drainQueue();
    }

    private drainQueue(): void {
        const waiting = this.waitQueue.splice(0);
        for (const resolve of waiting) resolve();
    }

    toAISDKFormat(): Record<string, any> {
        const result: Record<string, any> = {};
        const registry = this;
        for (const [name, tool] of this.tools) {
            const maxChars = tool.maxResultChars;
            const executeFn = tool.execute;
            const isSafe = tool.isConcurrencySafe ?? false;
            result[name] = {
                description: tool.description,
                inputSchema: jsonSchema(tool.parameters as any),
                execute: async (input: any) => {
                    if (isSafe) {
                        await registry.acquireConcurrent(name);
                    } else {
                        await registry.acquireExclusive(name);
                    }
                    try {
                        const raw = await executeFn(input);
                        const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
                        return truncateResult(text, maxChars);
                    } finally {
                        if (isSafe) {
                            registry.releaseConcurrent(name);
                        } else {
                            registry.releaseExclusive(name);
                        }
                    }
                },
            };
        }
        return result;
    }
}

export function truncateResult(text: string, maxChars: number = DEFAULT_MAX_RESULT_CHARS): string {
    if (text.length <= maxChars) return text;
    const headSize = Math.floor(maxChars * 0.6);
    const tailSize = maxChars - headSize;
    const head = text.slice(0, headSize);
    const tail = text.slice(-tailSize);
    const dropped = text.length - headSize - tailSize;
    return `${head}\n\n... [省略 ${dropped} 字符] ...\n\n${tail}`;
}

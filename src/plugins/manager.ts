/**
 * PluginManager —— 插件的加载/卸载中枢（m05 s18，后端核心，重点 review）。
 *
 * 职责：给每个 Plugin 构造隔离的 PluginApi、工具名加命名空间前缀防冲突、activate 失败不拖垮其他
 * Plugin、卸载时 destroy 清理并摘掉工具。这套「控制反转」不只 agent 能用——开放平台、CLI 框架同理。
 *
 * gen 已就位：unload / unloadAll / get / list / resolveEnvVars（环境变量占位符解析）。
 * ✍️ 你写（s18 核心）：load —— 构造受控 api、activate、登记；工具名 `${plugin}__${tool}` 前缀隔离。
 */
import type { ToolRegistry, ToolDefinition } from "../tools/registry.js";
import type { PluginDefinition, PluginConfig, PluginApi } from "./types.js";

interface LoadedPlugin {
  definition: PluginDefinition;
  tools: string[];
}

export class PluginManager {
  private plugins = new Map<string, LoadedPlugin>();
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  /**
   * ✍️ 你写（s18 核心）：加载一个 Plugin —— 构造受控 api → activate → 登记，返回注册的工具名清单。
   *
   * 步骤：
   *   1. 已加载同名（this.plugins.has(definition.name)）→ throw Error（`插件 "xxx" 已加载`）。
   *   2. resolvedConfig = this.resolveEnvVars({ ...definition.config, ...config })（外部 config 覆盖默认）。
   *   3. 建一个 registeredTools: string[] 收集本次注册的名字。
   *   4. 构造隔离的 api: PluginApi = {
   *        registerTools(tools): 每个 tool 名字前缀成 `${definition.name}__${tool.name}`、description 前缀
   *          `[Plugin:${definition.name}] `，registry.register(prefixed)，把前缀名 push 进 registeredTools；
   *        getConfig: () => resolvedConfig；
   *        log: (m) => console.log(`  [plugin:${definition.name}] ${m}`) }。
   *   5. try { await definition.activate(api) } catch(err) { 打错误日志后 throw err }（错误隔离：不污染已加载的）。
   *   6. this.plugins.set(definition.name, { definition, tools: registeredTools })；return registeredTools。
   */
  async load(
    definition: PluginDefinition,
    config?: PluginConfig,
  ): Promise<string[]> {
    // NOTE: stage 2 (s18) —— 受控 api + 命名空间前缀 + 错误隔离
    if (this.plugins.has(definition.name)) {
      throw new Error(`插件 "${definition.name}" 已加载`);
    }

    const resolvedConfig = this.resolveEnvVars({
      ...definition.config,
      ...config,
    });
    const registeredTools: string[] = [];
    const api: PluginApi = {
      registerTools: (tools) => {
        for (const tool of tools) {
          const prefixed: ToolDefinition = {
            ...tool,
            name: `${definition.name}__${tool.name}`,
            description: `[Plugin:${definition.name}] ${tool.description}`,
          };
          this.registry.register(prefixed);
          registeredTools.push(prefixed.name);
        }
      },
      getConfig: () => resolvedConfig,
      log: (m) => console.log(`  [plugin:${definition.name}] ${m}`),
    };
    try {
      await definition.activate(api);
    } catch (err) {
      console.error(
        `  [plugin:${definition.name}] activate 出错: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
    this.plugins.set(definition.name, {
      definition,
      tools: registeredTools,
    });
    return registeredTools;
  }

  // ── gen：卸载（destroy → 摘工具 → 删记录），已就位 ──
  async unload(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    if (plugin.definition.destroy) {
      try {
        await plugin.definition.destroy();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  [plugin:${name}] destroy 出错: ${msg}`);
      }
    }
    for (const toolName of plugin.tools) this.registry.unregister(toolName);
    this.plugins.delete(name);
    return true;
  }

  async unloadAll(): Promise<void> {
    for (const name of Array.from(this.plugins.keys())) await this.unload(name);
  }

  get(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }

  list(): Array<{
    name: string;
    version: string;
    description: string;
    tools: string[];
  }> {
    return Array.from(this.plugins.values()).map((p) => ({
      name: p.definition.name,
      version: p.definition.version,
      description: p.definition.description,
      tools: p.tools,
    }));
  }

  /** gen：config 里 `${ENV_VAR}` 占位符 → 替换成实际环境变量值（声明需求、部署环境供值）。 */
  private resolveEnvVars(config: PluginConfig): PluginConfig {
    const resolved: PluginConfig = {};
    for (const [key, value] of Object.entries(config)) {
      if (
        typeof value === "string" &&
        value.startsWith("${") &&
        value.endsWith("}")
      ) {
        resolved[key] = process.env[value.slice(2, -1)] || "";
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }
}

/**
 * Plugin 接口契约（m05 s18，gen 已就位，扫一眼）。
 *
 * 一个 Plugin 回答三件事：你是谁（name/version/description）、你要注册什么（activate 里注册工具）、
 * 你什么时候退出（destroy 清理资源）。核心与能力彻底分离——核心只管推理循环，能力靠 Plugin 动态加载。
 *
 * 关键设计 = PluginApi：Plugin 不直接碰 ToolRegistry，只能通过这个受控 API 交互。
 * 能做什么、不能做什么全由这一层决定（防 Plugin 删别人工具/搞崩系统）。未来给 Plugin 更多能力
 * （注册 Channel、订阅事件）往 PluginApi 上加方法即可，不改 Plugin 接入方式。
 */
import type { ToolDefinition } from "../tools/registry.js";

export interface PluginConfig {
  [key: string]: string | number | boolean;
}

// Plugin 只能通过这个受控 API 与 agent 交互（能力边界）
export interface PluginApi {
  registerTools(tools: ToolDefinition[]): void;
  getConfig(): PluginConfig;
  log(message: string): void;
}

export interface PluginDefinition {
  name: string;
  version: string;
  description: string;
  config?: PluginConfig;

  // 最小生命周期：加载时初始化、卸载时清理（DB 连接/长连接/定时器都要在 destroy 释放）
  activate(api: PluginApi): Promise<void> | void;
  destroy?(): Promise<void> | void;
}

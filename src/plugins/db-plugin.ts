/**
 * 示例 Plugin：一个数据库插件（m05 s18，gen 已就位，扫一眼）。
 *
 * 演示 Plugin 的完整形态：声明 config（用 ${ENV} 占位符）、activate 里 registerTools。
 * 没配 DB_URL 时走 Mock 模式返回假数据——这样无需真数据库也能跑通 Plugin 加载/调用链路。
 * 源课用的是 Supabase，这里简化成一个自包含的 mock db，重点是感受「加能力=加插件，核心零改动」。
 */
import type { PluginDefinition, PluginApi } from "./types.js";

export const dbPlugin: PluginDefinition = {
  name: "db",
  version: "1.0.0",
  description: "数据库操作能力（list_tables / query），未配 DB_URL 时走 Mock 模式",
  config: {
    url: "${DB_URL}",
  },

  activate(api: PluginApi) {
    const url = String(api.getConfig().url || "");
    if (!url) api.log("未配置 DB_URL，使用 Mock 模式");

    api.registerTools([
      {
        name: "list_tables",
        description: "列出数据库中所有表",
        parameters: { type: "object", properties: {}, required: [] },
        isConcurrencySafe: true,
        isReadOnly: true,
        execute: async () =>
          JSON.stringify({
            tables: ["users", "posts", "comments"],
            note: url ? `from ${url}` : "Mock 模式 — 配置 DB_URL 连真库",
          }),
      },
      {
        name: "query",
        description: "查询指定表的数据",
        parameters: {
          type: "object",
          properties: {
            table: { type: "string", description: "表名" },
            limit: { type: "number", description: "返回条数，默认 10" },
          },
          required: ["table"],
        },
        isConcurrencySafe: true,
        isReadOnly: true,
        execute: async (input: { table: string; limit?: number }) =>
          JSON.stringify({
            table: input.table,
            rows: [{ id: 1, name: "alice" }].slice(0, input.limit ?? 10),
            note: url ? `from ${url}` : "Mock 数据",
          }),
      },
    ]);
  },
};

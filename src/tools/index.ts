import { weatherTool } from './weather.js';
import { calculatorTool } from './calculator.js';
import { checkStatusTool } from './check-status.js';
import { readFileTool } from './read-file.js';
import { writeFileTool } from './write-file.js';
import { listDirectoryTool } from './list-directory.js';
import { editFileTool } from './edit-file.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { bashTool } from './bash.js';

export type { ToolDefinition } from './registry.js';
export { ToolRegistry } from './registry.js';

// 主流程工具
export const allTools = [
    weatherTool, calculatorTool, readFileTool, writeFileTool, listDirectoryTool,
    editFileTool, globTool, grepTool, bashTool,
];

// 循环检测 demo 专用
export const demoToolDefs = [
    weatherTool, checkStatusTool,
];

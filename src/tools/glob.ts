import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ToolDefinition } from './registry.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache']);
const MAX_RESULTS = 100;

function matchGlob(pattern: string, filePath: string): boolean {
    // Convert glob pattern to regex
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\x00')   // placeholder for **
        .replace(/\*/g, '[^/]*')    // * matches within segment
        .replace(/\x00/g, '.*');    // ** matches across segments
    return new RegExp(`^${escaped}$`).test(filePath);
}

function walk(dir: string, baseDir: string, pattern: string, results: string[]): void {
    if (results.length >= MAX_RESULTS) return;

    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }

    for (const entry of entries) {
        if (results.length >= MAX_RESULTS) return;
        if (SKIP_DIRS.has(entry)) continue;

        const fullPath = join(dir, entry);
        const relPath = fullPath.slice(baseDir.length + 1);

        let stat;
        try {
            stat = statSync(fullPath);
        } catch {
            continue;
        }

        if (stat.isDirectory()) {
            walk(fullPath, baseDir, pattern, results);
        } else if (matchGlob(pattern, relPath)) {
            results.push(relPath);
        }
    }
}

export const globTool: ToolDefinition = {
    name: 'glob',
    description: '按模式搜索文件。支持 * 和 ** 通配符，如 "src/**/*.ts" 匹配 src 下所有 TypeScript 文件',
    parameters: {
        type: 'object',
        properties: {
            pattern: { type: 'string', description: '搜索模式，如 "**/*.ts"、"src/*.json"' },
            path: { type: 'string', description: '搜索起始目录，默认当前目录' },
        },
        required: ['pattern'],
        additionalProperties: false,
    },
    isConcurrencySafe: true,
    isReadOnly: true,
    execute: async ({ pattern, path = '.' }: { pattern: string; path?: string }) => {
        const baseDir = resolve(path);
        const results: string[] = [];
        walk(baseDir, baseDir, pattern, results);

        if (results.length === 0) return `未找到匹配 "${pattern}" 的文件`;
        const suffix = results.length >= MAX_RESULTS ? `\n（已达上限 ${MAX_RESULTS} 条，结果可能不完整）` : '';
        return results.join('\n') + suffix;
    },
};

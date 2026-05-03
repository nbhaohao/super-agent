import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ToolDefinition } from './registry.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache']);
const MAX_MATCHES = 50;

function isBinary(buffer: Buffer): boolean {
    for (let i = 0; i < Math.min(buffer.length, 512); i++) {
        const byte = buffer[i];
        if (byte === 0) return true;
    }
    return false;
}

function grepFile(filePath: string, relPath: string, regex: RegExp, results: string[]): void {
    let buffer: Buffer;
    try {
        buffer = readFileSync(filePath);
    } catch {
        return;
    }
    if (isBinary(buffer)) return;

    const lines = buffer.toString('utf-8').split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (results.length >= MAX_MATCHES) return;
        if (regex.test(lines[i])) {
            results.push(`${relPath}:${i + 1}: ${lines[i]}`);
        }
    }
}

function walk(dir: string, baseDir: string, regex: RegExp, results: string[]): void {
    if (results.length >= MAX_MATCHES) return;

    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }

    for (const entry of entries) {
        if (results.length >= MAX_MATCHES) return;
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
            walk(fullPath, baseDir, regex, results);
        } else {
            grepFile(fullPath, relPath, regex, results);
        }
    }
}

export const grepTool: ToolDefinition = {
    name: 'grep',
    description: '在文件中搜索匹配指定模式的内容。返回匹配的行号和内容',
    parameters: {
        type: 'object',
        properties: {
            pattern: { type: 'string', description: '搜索模式（正则表达式）' },
            path: { type: 'string', description: '搜索路径（文件或目录），默认当前目录' },
        },
        required: ['pattern'],
        additionalProperties: false,
    },
    isConcurrencySafe: true,
    isReadOnly: true,
    maxResultChars: 3000,
    execute: async ({ pattern, path = '.' }: { pattern: string; path?: string }) => {
        let regex: RegExp;
        try {
            regex = new RegExp(pattern);
        } catch {
            return `无效的正则表达式: ${pattern}`;
        }

        const resolved = resolve(path);
        const results: string[] = [];

        let stat;
        try {
            stat = statSync(resolved);
        } catch {
            return `路径不存在: ${path}`;
        }

        if (stat.isFile()) {
            grepFile(resolved, path, regex, results);
        } else {
            walk(resolved, resolved, regex, results);
        }

        if (results.length === 0) return `未找到匹配 "${pattern}" 的内容`;
        const suffix = results.length >= MAX_MATCHES ? `\n（已达上限 ${MAX_MATCHES} 条）` : '';
        return results.join('\n') + suffix;
    },
};

import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import type { ToolDefinition } from './registry.js';

let previewServer: Server | null = null;

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.tsx': 'application/javascript; charset=utf-8',
    '.ts': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
};

export const startPreviewTool: ToolDefinition = {
    name: 'start_preview',
    description: '启动 app/ 目录的预览服务器。生成应用文件后必须立即调用此工具',
    parameters: {
        type: 'object',
        properties: {
            port: { type: 'number', description: '监听端口，默认 8080' },
        },
        required: [],
        additionalProperties: false,
    },
    isConcurrencySafe: false,
    isReadOnly: false,
    execute: async ({ port = 8080 }: { port?: number } = {}) => {
        if (previewServer) return `预览服务器已在运行 → http://localhost:${port}`;
        const root = resolve('app');
        if (!existsSync(root)) return '错误：app/ 目录不存在';

        previewServer = createServer((req, res) => {
            const urlPath = (req.url?.split('?')[0] || '/').replace(/\/$/, '/index.html');
            const filePath = join(root, urlPath === '/' ? '/index.html' : urlPath);
            try {
                if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
                res.writeHead(200, {
                    'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
                    'Cache-Control': 'no-cache',
                });
                res.end(readFileSync(filePath));
            } catch { res.writeHead(404); res.end('Not Found'); }
        });

        return new Promise<string>((resolvePromise) => {
            previewServer!.listen(port, () => {
                resolvePromise(`✓ 预览服务器已启动 → http://localhost:${port}`);
            });
        });
    },
};

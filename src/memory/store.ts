/**
 * MemoryStore —— 跨会话长期记忆（m04 s14 后端核心，重点 review）。
 *
 * 给 Agent 装一块「硬盘」：会话历史（JSONL）关掉就丢，记忆要跨会话留存。
 * 设计 = MEMORY.md 索引 + 每条记忆一个独立 .md 文件（YAML frontmatter）。
 *   - 索引（MEMORY.md）每轮注入 system prompt，给模型「我都记过什么」的目录；
 *   - 正文按需 read，不全量塞上下文（信噪比 + token 预算）。
 * 两条硬约束（照搬 Claude Code）：索引最多 200 行、单文件最多 4000 字符 —— 逼着只留真正重要的。
 *
 * 你写的：save() —— 写文件 + 维护索引（含同名覆盖 + 200 行上限淘汰最旧）。这是「该记什么、留多久」的决策落点。
 * 已就位（gen）：init / list / search / buildPromptSection / slugify —— fs 样板与关键词检索。
 */
import fs from "node:fs";
import path from "node:path";

export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryEntry {
  name: string;
  description: string;
  type: MemoryType;
  content: string;
  filePath: string;
  // s16 体检用：读/写时间戳（loadFile 时刷新 lastReadAt）。
  lastReadAt?: number;
  lastWriteAt?: number;
}

const MEMORY_DIR = ".memory";
const INDEX_FILE = "MEMORY.md";
const MAX_INDEX_LINES = 200; // 索引上限：逼着低价值记忆被淘汰（Claude Code 同款数字）
const MAX_FILE_CHARS = 4000; // 单文件上限：防一条记忆吃光上下文预算

export class MemoryStore {
  constructor(private readonly baseDir: string = ".") {}

  private get memoryDir(): string {
    return path.join(this.baseDir, MEMORY_DIR);
  }
  private get indexPath(): string {
    return path.join(this.memoryDir, INDEX_FILE);
  }

  // ── gen：目录/索引初始化（已就位）──
  init(): void {
    if (!fs.existsSync(this.memoryDir))
      fs.mkdirSync(this.memoryDir, { recursive: true });
    if (!fs.existsSync(this.indexPath))
      fs.writeFileSync(this.indexPath, "# Memory Index\n", "utf-8");
  }

  /** gen：name → 文件名 slug（中英文保留，其余转 -）。 */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9一-鿿]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  // ── 你写（s14 核心）：保存一条记忆 ────────────────────────────────────
  /**
   * 写一条记忆：落一个 {type}_{slug}.md 文件（YAML frontmatter + 正文），并把它登记进 MEMORY.md 索引。
   * 返回文件名（如 user_用户偏好.md）。
   *
   * 实现步骤：
   *   1. this.init()，确保目录/索引存在。
   *   2. const slug = this.slugify(entry.name)；const filename = `${entry.type}_${slug}.md`。
   *   3. 拼 frontmatter 正文：['---', `name: ${entry.name}`, `description: ${entry.description}`,
   *      `type: ${entry.type}`, '---', '', entry.content].join('\n')。
   *   4. fs.writeFileSync(path.join(this.memoryDir, filename), 内容, 'utf-8')。
   *   5. 维护索引（读 MEMORY.md → 按行）：
   *      - 索引行格式：`- [${name}](${filename}) — ${description}`。
   *      - 已存在同名条目（行里含 `(${filename})`）→ 替换那一行（覆盖语义，不重复追加）。
   *      - 否则追加新行。
   *      - 若数据行数（不含首行标题）超过 MAX_INDEX_LINES → 从最旧（最前）的数据行删起，删到不超限。
   *      - 写回 MEMORY.md。
   *   6. return filename。
   */
  save(entry: Omit<MemoryEntry, "filePath">): string {
    this.init();
    const slug = this.slugify(entry.name);
    const filename = `${entry.type}_${slug}.md`;
    const content = [
      "---",
      `name: ${entry.name}`,
      `description: ${entry.description}`,
      `type: ${entry.type}`,
      "---",
      "",
      entry.content,
    ].join("\n");
    fs.writeFileSync(path.join(this.memoryDir, filename), content, "utf-8");

    // 5. 维护索引
    const indexRaw = fs.readFileSync(this.indexPath, "utf-8");
    const lines = indexRaw.split("\n");
    const title = lines[0]; // "# Memory Index"
    const dataLines = lines.slice(1).filter(Boolean);

    const newLine = `- [${entry.name}](${filename}) \u2014 ${entry.description}`;
    const existingIdx = dataLines.findIndex((l) => l.includes(`(${filename})`));

    let updated: string[];
    if (existingIdx !== -1) {
      // 同名覆盖：替换该行
      updated = [...dataLines];
      updated[existingIdx] = newLine;
    } else {
      // 新条目：追加
      updated = [...dataLines, newLine];
    }

    // 数据行超 MAX_INDEX_LINES → 从最旧（最前）删起
    while (updated.length > MAX_INDEX_LINES) {
      updated.shift();
    }

    fs.writeFileSync(
      this.indexPath,
      [title, ...updated, ""].join("\n"),
      "utf-8",
    );

    return filename;
  }

  // ── gen：列举 / 检索（已就位）──
  /** 读出全部记忆（解析每个 .md 的 frontmatter），并刷新 lastReadAt。 */
  list(): MemoryEntry[] {
    this.init();
    const files = fs
      .readdirSync(this.memoryDir)
      .filter((f) => f.endsWith(".md") && f !== INDEX_FILE);
    const now = Date.now();
    const entries: MemoryEntry[] = [];
    for (const filename of files) {
      const filePath = path.join(this.memoryDir, filename);
      const raw = fs.readFileSync(filePath, "utf-8").slice(0, MAX_FILE_CHARS);
      const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!m) continue;
      const front = Object.fromEntries(
        m[1].split("\n").map((l) => {
          const i = l.indexOf(":");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
      );
      const stat = fs.statSync(filePath);
      entries.push({
        name: front.name ?? filename,
        description: front.description ?? "",
        type: (front.type as MemoryType) ?? "reference",
        content: m[2].trim(),
        filePath: filename,
        lastReadAt: now,
        lastWriteAt: stat.mtimeMs,
      });
    }
    return entries;
  }

  /** 关键词检索：name+description+content 命中任一查询词即返回（s15 会升级成 BM25 + 向量混合）。 */
  search(query: string): MemoryEntry[] {
    const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.list().filter((entry) => {
      const text =
        `${entry.name} ${entry.description} ${entry.content}`.toLowerCase();
      return keywords.some((kw) => text.includes(kw));
    });
  }

  /** 注入 system prompt 的记忆段：索引 + 使用原则（记忆是线索不是事实，用前先验证）。 */
  buildPromptSection(): string {
    const entries = this.list();
    if (entries.length === 0) return "";
    const lines = [
      `[记忆系统] 共 ${entries.length} 条记忆`,
      "",
      "记忆索引：",
      ...entries.map((e) => `- [${e.name}](${e.filePath}) — ${e.description}`),
      "",
      "记忆使用原则：",
      "- 记忆是线索，不是事实——使用前先用工具验证（read_file、grep 确认）",
      "- 不存代码能推导的、git 能查的、文档已经写了的",
      "- 只存对话中出现的、其他地方推导不出来的信息",
    ];
    return lines.join("\n");
  }
}

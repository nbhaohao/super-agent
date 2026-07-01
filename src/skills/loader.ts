/**
 * SkillLoader —— 给 agent 注入领域知识（m05 s17，后端核心，重点 review）。
 *
 * Skill ≠ Tool：Tool 是一个可执行函数（read_file/grep），Skill 是一份 Markdown SOP
 * （做代码审查该先看什么、按什么优先级、输出什么格式）。Skill 不进 tools 列表，而是
 * 注入 system prompt——等于给通才 agent 一份「专家操作手册」。
 *
 * 存储：.skills/<name>/SKILL.md（YAML frontmatter 记 name/description/when_to_use，正文是 SOP）。
 * 关键设计在 buildPromptSection：渐进式加载（Level 1 只注入 name+desc，Level 2 激活才注入全文），
 * 100 个 skill 初始也就 ~10K token，不撑爆上下文。
 *
 * gen 已就位：load / list / get / parseFrontmatter（扫描 + frontmatter 解析，非重点）。
 * ✍️ 你写（s17 核心）：buildPromptSection —— prompt 注入点，整个 skill 系统最关键的一环。
 */
import fs from "node:fs";
import path from "node:path";

export interface SkillDefinition {
  name: string;
  description: string;
  whenToUse?: string;
  content: string;
  dirPath: string;
}

const SKILLS_DIR = ".skills";
const SKILL_FILE = "SKILL.md";

export class SkillLoader {
  private readonly baseDir: string;
  private skills = new Map<string, SkillDefinition>();

  constructor(baseDir = ".") {
    this.baseDir = baseDir;
  }

  // ── gen：扫描 .skills/*/SKILL.md，解析 frontmatter（已就位）──
  load(): SkillDefinition[] {
    this.skills.clear();
    const skillsDir = path.join(this.baseDir, SKILLS_DIR);
    if (!fs.existsSync(skillsDir)) return [];

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(skillsDir, entry.name, SKILL_FILE);
      if (!fs.existsSync(skillFile)) continue;

      const raw = fs.readFileSync(skillFile, "utf-8");
      const parsed = this.parseFrontmatter(raw);
      if (!parsed) continue;

      this.skills.set(entry.name, {
        name: entry.name,
        description: parsed.description,
        whenToUse: parsed.whenToUse,
        content: parsed.content,
        dirPath: path.join(skillsDir, entry.name),
      });
    }
    return this.list();
  }

  list(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /**
   * ✍️ 你写（s17 核心）：渐进式加载的 prompt 注入点。
   *   已激活的 skill → 注入完整 SOP；未激活的 → 只列 name + description（省 token）。
   *
   * 步骤：
   *   1. this.skills.size === 0 → return null（没 skill 就别往 prompt 里塞空段）。
   *   2. 遍历 activeSkills：get(name) 拿到 skill；跳过找不到的；
   *      往 lines 依次推 `[激活的 Skill: ${name}]`、skill.content、''（空行分隔）。
   *   3. 列未激活 skill：list() 里 filter 掉已激活的，map 成一行
   *      `  /${name} — ${description}`（若有 whenToUse，再拼 `（适用场景: ...）`）。
   *      非空则先推一行 '可用的 Skills（输入 /skill load <name> 激活）：' 再推这些行。
   *   4. lines.length > 0 ? lines.join('\n') : null。
   */
  buildPromptSection(activeSkills: Set<string>): string | null {
    // NOTE: stage 1 (s17) —— 渐进式加载：激活注入全文、未激活只列 name+desc
    throw new Error("TODO: stage 1 (s17) — buildPromptSection 未实现");
  }

  // ── gen：极简 frontmatter 解析（生产可换 gray-matter，非重点）──
  private parseFrontmatter(
    raw: string,
  ): { description: string; whenToUse?: string; content: string } | null {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return { description: "", content: raw };
    const meta: Record<string, string> = {};
    for (const line of match[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if (value.startsWith('"') && value.endsWith('"'))
          value = value.slice(1, -1);
        meta[key] = value;
      }
    }
    return {
      description: meta.description || "",
      whenToUse: meta.when_to_use || undefined,
      content: match[2].trim(),
    };
  }
}

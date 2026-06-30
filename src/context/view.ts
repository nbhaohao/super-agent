// 已就位（AI 生成）——上下文矩阵可视化（16×16, /context 命令）
const A = {
  sys: '\x1b[34m', tools: '\x1b[33m', msgs: '\x1b[36m',
  free: '\x1b[90m', buf: '\x1b[37m', rst: '\x1b[0m',
};

export interface ContextSnapshot {
  systemChars: number;
  toolChars: number;
  messageChars: number;
  contextWindow: number; // tokens
  modelName: string;
  bufferRatio?: number;  // default 0.05 (5%)
}

export function renderContextMatrix(snap: ContextSnapshot): string {
  const { systemChars, toolChars, messageChars, contextWindow, modelName, bufferRatio = 0.05 } = snap;
  const T = (c: number) => Math.ceil(c / 4); // rough chars→tokens

  const sysT  = T(systemChars);
  const toolT = T(toolChars);
  const msgT  = T(messageChars);
  const total = sysT + toolT + msgT;
  const pct   = total / contextWindow;

  const CELLS = 256; // 16×16
  const tokPerCell = contextWindow / CELLS;
  const bufCells  = Math.floor(contextWindow * bufferRatio / tokPerCell);
  const sysCells  = Math.min(Math.ceil(sysT  / tokPerCell), CELLS);
  const toolCells = Math.min(Math.ceil(toolT / tokPerCell), CELLS - sysCells);
  const msgCells  = Math.min(Math.ceil(msgT  / tokPerCell), CELLS - sysCells - toolCells);
  const usedCells = sysCells + toolCells + msgCells;
  const freeCells = Math.max(0, CELLS - bufCells - usedCells);

  const cells: string[] = [];
  for (let i = 0; i < sysCells;  i++) cells.push(A.sys   + '●' + A.rst);
  for (let i = 0; i < toolCells; i++) cells.push(A.tools + '●' + A.rst);
  for (let i = 0; i < msgCells;  i++) cells.push(A.msgs  + '●' + A.rst);
  for (let i = 0; i < freeCells; i++) cells.push(A.free  + '○' + A.rst);
  while (cells.length < CELLS)        cells.push(A.buf   + '▢' + A.rst);

  const rows: string[] = [];
  for (let r = 0; r < 16; r++) {
    const row = cells.slice(r * 16, r * 16 + 16).join(' ');
    let sfx = '';
    if (r === 0) sfx = `    ${modelName}`;
    if (r === 1) sfx = `    ${total.toLocaleString()}/${Math.round(contextWindow / 1000)}k tokens (${(pct * 100).toFixed(1)}%)`;
    if (r === 3) sfx = `    ${A.sys}●${A.rst} System:   ${sysT.toLocaleString()} (${(sysT / contextWindow * 100).toFixed(1)}%)`;
    if (r === 4) sfx = `    ${A.tools}●${A.rst} Tools:    ${toolT.toLocaleString()} (${(toolT / contextWindow * 100).toFixed(1)}%)`;
    if (r === 5) sfx = `    ${A.msgs}●${A.rst} Messages: ${msgT.toLocaleString()} (${(msgT / contextWindow * 100).toFixed(1)}%)`;
    if (r === 6) sfx = `    ${A.free}○${A.rst} Free:     ${(contextWindow - total).toLocaleString()} (${((1 - pct) * 100).toFixed(1)}%)`;
    if (r === 7) sfx = `    ${A.buf}▢${A.rst} Buffer:   ${Math.floor(contextWindow * bufferRatio).toLocaleString()}`;
    rows.push('  ' + row + sfx);
  }
  return rows.join('\n');
}

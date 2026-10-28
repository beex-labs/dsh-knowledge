// Native instruction files are small pointers; every agent shares the root .dsh/.
const instruction = (path, format) => ({ path, ...(format ? { format } : {}) })

export const AGENTS = {
  dsh: { name: 'DeepSeek Harness', instructions: [instruction('AGENTS.md')] },
  'claude-code': { name: 'Claude Code', instructions: [instruction('CLAUDE.md')], hook: 'claude', skillPath: '.claude/skills/knowledge/SKILL.md' },
  codex: { name: 'Codex', instructions: [instruction('AGENTS.md')], skillPath: '.agents/skills/knowledge/SKILL.md' },
  copilot: { name: 'GitHub Copilot', instructions: [instruction('.github/copilot-instructions.md')], skillPath: '.github/skills/knowledge/SKILL.md' },
  minimaxcode: { name: 'MiniMax Code', instructions: [instruction('AGENTS.md')] },
  opencode: { name: 'OpenCode', instructions: [instruction('AGENTS.md')] },
  gemini: { name: 'Gemini CLI', instructions: [instruction('GEMINI.md')], skillPath: '.gemini/skills/knowledge/SKILL.md' },
  cursor: { name: 'Cursor', instructions: [instruction('.cursor/rules/dsh-knowledge.mdc', 'cursor')] },
  windsurf: { name: 'Windsurf', instructions: [instruction('.windsurf/rules/dsh-knowledge.md', 'windsurf')] },
  devin: { name: 'Devin', instructions: [instruction('AGENTS.md')], skillPath: '.agents/skills/knowledge/SKILL.md' },
  cline: { name: 'Cline', instructions: [instruction('.clinerules/dsh-knowledge.md')] },
  roo: { name: 'Roo Code', instructions: [instruction('.roo/rules/dsh-knowledge.md')] },
  kilo: { name: 'Kilo Code', instructions: [instruction('AGENTS.md')] },
  trae: { name: 'Trae', instructions: [instruction('.trae/rules/dsh-knowledge.md', 'trae')] },
  qoder: { name: 'Qoder', instructions: [instruction('AGENTS.md')] },
  'qoder-cli': { name: 'Qoder CLI', instructions: [instruction('AGENTS.md')] },
  codebuddy: { name: 'CodeBuddy', instructions: [instruction('CODEBUDDY.md'), instruction('.codebuddy/rules/dsh-knowledge/RULE.mdc', 'codebuddy')] },
  kimi: { name: 'Kimi CLI', instructions: [instruction('AGENTS.md')] },
  qwen: { name: 'Qwen Code', instructions: [instruction('QWEN.md')] },
  amp: { name: 'Amp', instructions: [instruction('AGENTS.md')] },
  auggie: { name: 'Augment', instructions: [instruction('.augment/rules/dsh-knowledge.md', 'augment')] },
  continue: { name: 'Continue', instructions: [instruction('.continue/rules/dsh-knowledge.md', 'continue')] },
  aider: { name: 'Aider', instructions: [instruction('AGENTS.md')] },
  generic: { name: 'AGENTS.md / any agent with project file access', instructions: [instruction('AGENTS.md')] },
}

export const ALIASES = { claude: 'claude-code', claudecode: 'claude-code', 'gemini-cli': 'gemini', minimax: 'minimaxcode', 'minimax-code': 'minimaxcode', 'roo-code': 'roo', 'kilo-code': 'kilo', 'kimi-cli': 'kimi', 'qwen-code': 'qwen', augment: 'auggie', 'github-copilot': 'copilot' }

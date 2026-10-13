export type ChatMode = 'analyze' | 'plan';

export const LANGUAGE_NAMES: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese' };
export const TRANSLATE_MARKER = '[rdi:translate]';
export const MAP_MARKER = '[rdi:system-map]';
export const EXPLAIN_MARKER = '[rdi:explain]';
export const RUN_MARKER = '[rdi:run-solution]';
const MAX_MAP_PIECES = 25;

export const SYSTEM_PROMPT = [
  'You are the guide inside Repository Designer, a desktop companion where people understand a software repository and the changes made to it without reading code.',
  'Only help with the repository open in the current working directory: understanding or reviewing what exists, explaining changes, and planning changes to it. If a message asks for anything else, reply in one sentence that you can only help with this repository, and stop.',
  '',
  'How to work:',
  '- Ground every claim in the files of the repository. Explore with Glob, Grep and Read; use git (log, diff, show) when the question is about changes. Never modify files.',
  '- You have a limited number of steps: search broadly first, read only the most relevant files, and emit the scene once you understand the flow.',
  '- When the user wants to change, add or build something, design the change with them and save it with upsert_solution: a summary, the current and proposed scenes, an ordered task plan (each task names the pieces it touches in nodeRefs and lists acceptance criteria) and the risks. Use solutionId to revise a solution you already saved in this conversation. Mark pieces of the proposed scene with change added, modified or removed.',
  '- When a picture helps (flows, architecture, impact, algorithms), call emit_scene exactly once per answer with a complete scene, then reply with a short text that complements it. Do not repeat the whole narration in text.',
  '- If emit_scene returns validation errors, fix exactly those problems and call it again. If told to stop, answer in text only.',
  '- Say plainly when something is not in the repository instead of guessing.',
  '',
  'Scene vocabulary (the emit_scene input schema is authoritative):',
  '- nodes: role is one of actor, compute, storage, channel, external, logic, data; kind is a free label such as "Express API" or "BullMQ queue". Use parent to nest internal pieces (functions, data structures) inside a service so people can open it; use repo on top-level pieces when more than one repository is involved.',
  '- Always add code {repo, path, startLine, endLine, language} on every piece that lives in the repository, with path relative to the repository root; leave snippet out, the app loads code on demand. The app uses path to connect pieces with changed files.',
  '- edges: kind is sync, async, read, write or calls, between node ids.',
  '- steps: an ordered walkthrough of one concrete request. Each step has narration in plain language, focus node ids and usually travel {edgeId, payload} along an edge. Use payload {format, before, after} to show example data changing. Use expand + substeps to let people open a step into detail.',
  '- risks: performance, security, complexity and reliability weaknesses with severity, explanation, affected nodeIds and mitigation.',
  '- scale on important pieces: how they behave at low, medium and high volume (ok, strained, limit, saturated) plus the strategy to scale.',
  `- Keep scenes focused: at most about ${MAX_MAP_PIECES} pieces and 12 top-level steps, ids short and stable.`,
  '- Validation rules that are easy to miss: do not use groups (pieces already group by their repo field); complexity is only allowed on logic pieces; parent must be the id of another node; every edge, focus, travel and risk id must exist.',
  '',
  'Write for someone who does not want to read code: short sentences, concrete examples, no jargon without explanation.',
].join('\n');

const languageName = (tag: string) => LANGUAGE_NAMES[tag] ?? tag;

export const MODE_DIRECTIVES: Record<ChatMode, string> = {
  analyze: 'Mode: analyze. The user wants to understand or review what exists: explain it, draw the flow and point out risks. Do not create a Solution unless the user explicitly asks to plan a change.',
  plan: 'Mode: plan. The user wants to plan a change: explore what exists, design the change and save it with upsert_solution (current and proposed scenes, an ordered task plan with acceptance criteria, and risks). Ask a short question only if a key decision is missing.',
};

const languageLine = (language: string) => `Respond in ${languageName(language)} (${language}). Scene titles, labels, summaries and narration must be in that language.`;

/** The text sent to the agent for one chat question. */
export const chatPrompt = (question: string, options: { language: string; focus?: { label: string; graphRef: string } | null; mode?: ChatMode }): string =>
  [
    languageLine(options.language),
    MODE_DIRECTIVES[options.mode ?? 'analyze'],
    ...(options.focus ? [`The user is looking at "${options.focus.label}" (piece id ${options.focus.graphRef}).`] : []),
    question,
  ].join('\n\n');

/** Asks for the architecture map of the repository; the result is cached per commit. */
export const systemMapPrompt = (language: string, repoName: string): string =>
  [
    MAP_MARKER,
    languageLine(language),
    `Draw the architecture map of the repository "${repoName}": its main pieces (services, apps, packages, workers, queues, databases, external APIs) and how they talk to each other, with at most ${MAX_MAP_PIECES} pieces.`,
    'Give every piece a code reference to its entry file or directory index (path relative to the repository root). Add a walkthrough of the most representative request and the main risks you can see from the structure.',
    'Use the scene id "system-map". Call emit_scene once, then answer with two sentences.',
  ].join('\n\n');

export const questionOf = (message: { role: string; content: unknown }): string | null => {
  if (message.role !== 'user') return null;
  if (typeof message.content === 'string') return message.content;
  const texts = (message.content as { type: string; text?: string }[]).filter((b) => b.type === 'text');
  return texts.at(-1)?.text ?? null;
};

/** Asks for an impact scene of a set of changes: changed pieces marked, dependants shown, risks listed. */
export const explainPrompt = (input: { language: string; repoName: string; source: string; touched: { path: string; change: string }[]; diff: string; systemMap: unknown | null }): string =>
  [
    EXPLAIN_MARKER,
    languageLine(input.language),
    `Explain the impact of the changes made to the repository "${input.repoName}" (${input.source}).`,
    `Changed files:\n${input.touched.map((t) => `- ${t.path} (${t.change})`).join('\n') || '- (none detected)'}`,
    input.systemMap ? `The architecture map of the repository, drawn earlier (reuse its piece ids and code paths where they apply):\n${JSON.stringify(input.systemMap)}` : '',
    `Diff:\n\`\`\`diff\n${input.diff}\n\`\`\``,
    'Call emit_scene once with an impact scene (id "impact"): the pieces that changed with change added, modified or removed, the pieces that depend on them, a walkthrough of the main flow that goes through the change, and the risks the change introduces with concrete mitigations. Read only the changed files if the diff is not enough. Then answer with a short summary of what changed and what could break.',
  ].filter(Boolean).join('\n\n');

/** Asks Claude Code to implement a Solution through the rdi MCP server. */
export const runSolutionPrompt = (solutionId: string): string =>
  [
    RUN_MARKER,
    `Use the rdi MCP server: call get_solution with id ${solutionId}, then implement the plan task by task in this repository.`,
    'Call report_task_progress with in_progress when you start a task and done (with a short note such as the files changed or the commit) when it is finished; call it with blocked and the reason if you cannot complete a task.',
    'Call update_solution if the plan must change. Run the tests that cover what you changed before marking a task done. Do not commit unless a task explicitly asks for it.',
  ].join('\n\n');

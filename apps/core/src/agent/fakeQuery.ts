import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { EXPLAIN_MARKER, MAP_MARKER, RUN_MARKER, TRANSLATE_MARKER } from './prompt';
import type { QueryFn, QueryLike } from './sdkRunner';

export const FAKE_MODEL = 'fake-scripted';
export const FAKE_SESSION_PREFIX = 'fake-session-';
const LANGUAGE_DIRECTIVE = /\(([a-z]{2,3}(?:-[A-Za-z0-9]+)*)\)\./;
const MODE_PLAN = /^Mode: plan\./m;
const FAKE_USAGE = { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

let counter = 0;
const nextId = (prefix: string) => `${prefix}_fake_${++counter}`;

const languageOf = (prompt: string) => LANGUAGE_DIRECTIVE.exec(prompt)?.[1] ?? 'en';
const questionOf = (prompt: string) => prompt.trim().split('\n').at(-1) ?? '';

/** A small scene whose pieces carry code paths, so the change overlay has something to match. */
export const fakeScene = (language: string, title: string, id = nextId('scene')) => ({
  id,
  title,
  language,
  summary: 'A scripted scene used in development and tests.',
  nodes: [
    { id: 'api', label: 'API', role: 'compute', kind: 'Fastify API', summary: 'Receives requests.', code: { repo: 'local', path: 'apps/core/src/app.ts', startLine: 1, endLine: 20, language: 'ts' } },
    { id: 'store', label: 'Store', role: 'storage', kind: 'JSON files', summary: 'Keeps scenes on disk.', code: { repo: 'local', path: 'apps/core/src/store/json.ts', startLine: 1, endLine: 20, language: 'ts' } },
    { id: 'web', label: 'Web', role: 'actor', kind: 'React app', summary: 'Renders the canvas.', code: { repo: 'local', path: 'apps/web/src/main.tsx', startLine: 1, endLine: 20, language: 'ts' } },
  ],
  edges: [
    { id: 'e1', from: 'web', to: 'api', kind: 'sync' },
    { id: 'e2', from: 'api', to: 'store', kind: 'write' },
  ],
  steps: [
    { id: 's1', narration: 'The web app asks the API.', focus: ['api'], travel: { edgeId: 'e1' } },
    { id: 's2', narration: 'The API writes the result.', focus: ['store'], travel: { edgeId: 'e2' } },
  ],
  risks: [{ id: 'r1', title: 'Unbounded files', category: 'performance', severity: 'low', explanation: 'Scenes accumulate on disk.', nodeIds: ['store'], mitigation: 'Prune old scenes.' }],
});

const basename = (path: string) => path.split('/').filter(Boolean).pop() ?? path;

/** One task per readable root, so cross-repository plans look like the real thing. */
const fakeDraft = (language: string, roots: string[]) => {
  const names = roots.map(basename);
  const current = fakeScene(language, 'Current', 'current');
  const proposed = { ...fakeScene(language, 'Proposed', 'proposed'), nodes: fakeScene(language, 'Proposed', 'proposed').nodes.map((n, i) => ({ ...n, ...(n.id === 'store' ? { change: 'modified' } : {}), ...(names.length > 1 ? { repo: names[i % names.length] } : {}) })) };
  const plan = names.length > 1
    ? names.map((name, i) => ({ id: `t${i + 1}`, title: `Change ${name}`, repo: name, nodeRefs: ['store'], acceptance: [`${name} updated`], ...(i > 0 ? { dependsOn: [`t${i}`] } : {}) }))
    : [{ id: 't1', title: 'Change the store', nodeRefs: ['store'], acceptance: ['Scenes are pruned'] }];
  return { summary: 'Scripted solution.', sceneCurrent: current, sceneProposed: proposed, plan, risks: [] };
};

const session = () => `${FAKE_SESSION_PREFIX}${nextId('s')}`;
const assistant = (sessionId: string, content: unknown[]): SDKMessage =>
  ({ type: 'assistant', uuid: nextId('u'), session_id: sessionId, parent_tool_use_id: null, message: { id: nextId('msg'), type: 'message', role: 'assistant', model: FAKE_MODEL, content, stop_reason: null, stop_sequence: null, usage: FAKE_USAGE } }) as unknown as SDKMessage;
const user = (sessionId: string, content: unknown[]): SDKMessage => ({ type: 'user', uuid: nextId('u'), session_id: sessionId, parent_tool_use_id: null, message: { role: 'user', content } }) as unknown as SDKMessage;
const result = (sessionId: string, text: string): SDKMessage =>
  ({ type: 'result', subtype: 'success', uuid: nextId('u'), session_id: sessionId, is_error: false, duration_ms: 1, duration_api_ms: 1, num_turns: 1, result: text, stop_reason: 'end_turn', total_cost_usd: 0.001, usage: FAKE_USAGE, modelUsage: {}, permission_denials: [] }) as unknown as SDKMessage;

/** Scripted stand-in for the Agent SDK: answers with text, draws a scene through the real in-process tools and, in plan mode, saves a solution. */
export const createFakeQuery = (): QueryFn => (params, local) => {
  const sessionId = (params.options.resume as string | undefined) ?? session();
  const language = languageOf(params.prompt);
  const useTool = async function* (name: string, input: unknown) {
    const id = nextId('toolu');
    yield assistant(sessionId, [{ type: 'tool_use', id, name: `mcp__rdi__${name}`, input }]);
    const outcome = await local.call(name, input);
    yield user(sessionId, [{ type: 'tool_result', tool_use_id: id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) }]);
  };
  const generator = async function* (): AsyncGenerator<SDKMessage> {
    if (params.prompt.startsWith(TRANSLATE_MARKER)) {
      const [header, ...rest] = params.prompt.split('\n');
      const target = header!.slice(TRANSLATE_MARKER.length).trim();
      const scene = JSON.parse(rest.at(-1)!.trim()) as Record<string, unknown>;
      yield* useTool('emit_scene', { ...scene, language: target });
      yield result(sessionId, 'Translated.');
      return;
    }
    if (params.prompt.startsWith(RUN_MARKER)) {
      yield assistant(sessionId, [{ type: 'text', text: 'Reading the solution. ' }]);
      const id = nextId('toolu');
      const input = { command: 'npm test', description: 'Run the tests' };
      yield assistant(sessionId, [{ type: 'tool_use', id, name: 'Bash', input }]);
      const decision = params.options.canUseTool
        ? await params.options.canUseTool('Bash', input, { signal: params.options.abortController?.signal ?? new AbortController().signal, toolUseID: id, requestId: nextId('req') })
        : { behavior: 'allow' as const };
      const denied = decision?.behavior === 'deny';
      yield user(sessionId, [{ type: 'tool_result', tool_use_id: id, content: denied ? decision.message : 'ok', ...(denied ? { is_error: true } : {}) }]);
      yield assistant(sessionId, [{ type: 'text', text: denied ? 'Stopping: the command was denied.' : 'Task t1 done.' }]);
      yield result(sessionId, denied ? 'Denied.' : 'Done.');
      return;
    }
    if (params.prompt.startsWith(EXPLAIN_MARKER)) {
      const scene = fakeScene(language, 'Impact', 'impact');
      yield* useTool('emit_scene', { ...scene, nodes: scene.nodes.map((n) => (n.id === 'store' ? { ...n, change: 'modified' } : n)) });
      yield assistant(sessionId, [{ type: 'text', text: 'The store changed; the API depends on it.' }]);
      yield result(sessionId, 'Explained.');
      return;
    }
    if (params.prompt.startsWith(MAP_MARKER)) {
      yield* useTool('emit_scene', fakeScene(language, 'System map', 'system-map'));
      yield result(sessionId, 'Here is the map.');
      return;
    }
    const question = questionOf(params.prompt);
    yield assistant(sessionId, [{ type: 'text', text: `Looking at "${question}". ` }]);
    yield* useTool('emit_scene', fakeScene(language, `About ${question}`));
    const roots = [params.options.cwd ?? '', ...(params.options.additionalDirectories ?? [])].filter(Boolean);
    if (MODE_PLAN.test(params.prompt)) yield* useTool('upsert_solution', { title: `Solution for ${question}`, ...fakeDraft(language, roots) });
    yield assistant(sessionId, [{ type: 'text', text: 'Scripted answer.' }]);
    yield result(sessionId, 'Scripted answer.');
  };
  const stream = generator() as unknown as QueryLike;
  stream.interrupt = async () => undefined;
  stream.close = () => undefined;
  return stream;
};

# repository-designer-ide → "RDI Desktop": renderizador local de Claude Code

## Context

Hoy `repository-designer-ide` es un SaaS multi-tenant (Postgres + Neo4j + Redis + worker + GitHub App + auth/orgs) que indexa repos con tree-sitter, guarda el grafo en Neo4j y usa la API de Anthropic directa para que un agente emita "escenas" (mapa de componentes, walkthrough, riesgos, escala). El usuario quiere reposicionarlo como **herramienta desktop local, single-user, de solo renderizado**, para "ver el mapa y la relación entre componentes y posibles riesgos del cambio sin evaluar el código", con dos flujos:

1. **Observar** las sesiones de Claude Code que corre en la terminal (transcripciones `~/.claude/projects/*.jsonl` + git del repo).
2. **Lanzar** sesiones / pedir explicaciones desde la app vía el **Claude Agent SDK** local (`@anthropic-ai/claude-agent-sdk` 0.3.296, usa el binario `claude` 2.1.296 y la suscripción local → todo el consumo de tokens queda centralizado ahí).

Decisiones ya tomadas con el usuario:
- Conservar todas las vistas: impacto en el grafo, exploración System→Detail + walkthrough, Solutions + MCP + simulador "A escala". Agregar **Timeline de sesión**.
- Simplificar: **sin Neo4j, sin Postgres, sin Redis/BullMQ, sin worker, sin GitHub App, sin auth**. "Usar directamente el output de Claude": las escenas (mapa del sistema, impacto) las produce Claude vía SDK y se cachean como JSON.
- Shell: **Electron** sobre un core Node local (Fastify en 127.0.0.1) cargado por URL, así la SPA no cambia (fetch relativo `/api`, SSE, `createBrowserRouter`). El core también corre standalone con `npm run dev`.
- Storage: **JSON dentro de cada repo, en `<repo>/.rdi/`** (más un índice global mínimo de carpetas abiertas en `~/.rdi/repos.json`, porque sin DB hay que recordar qué repos se abrieron).

Hallazgos que habilitan esto (verificados en código):
- El núcleo de render es puro y recibe todo por props: `apps/web/src/workspace/Workspace.tsx:41` (`chat`, `panels`, `loadCode`, `extraScenes`, `theme`…). `packages/scene` (schema, `hierarchy`, `walkthrough`, `simulate`, `diff`, `solution`) no depende de nada.
- Los nodos de escena ya tienen `code.path`, `change: added|modified|removed` y `graphRef` (`packages/scene/src/schema.ts:56-67`) → el overlay "archivos tocados → componentes" no necesita grafo.
- `apps/api/src/agent/runAgent.ts` emite `AgentEvent` (`text|tool|scene|solution|error`) y `apps/web/src/shell/chat/chatApi.ts` parsea esos mismos eventos por SSE → si el nuevo runner sobre el SDK emite el mismo `AgentEvent`, `ChatPanel` no cambia.
- `emit_scene` y `upsert_solution` en `apps/api/src/agent/tools.ts` ya validan con `validateScene` / `validateSolutionDraft` y `repairScene.ts` → se reexponen tal cual como MCP tools in-process del SDK. Los tools `search_code/read_code/search_graph/get_neighbors/find_path/get_pr_diff` desaparecen: Claude Code trae `Read/Grep/Glob/Bash` propios.
- Agent SDK confirmado (`sdk.d.ts` del tarball): `query({ prompt, options })` devuelve `AsyncGenerator<SDKMessage>` con `interrupt()`, `close()`; `Options` incluye `cwd, model, permissionMode ('default'|'acceptEdits'|'bypassPermissions'|'plan'|'dontAsk'|'auto'), allowedTools, disallowedTools, mcpServers: Record<string, McpServerConfig>, maxTurns, maxBudgetUsd, systemPrompt, resume, sessionId, abortController, includePartialMessages`; `createSdkMcpServer({ name, tools: [tool(name, desc, zodShape, handler)] })`; `SDKAssistantMessage.message` es un `BetaMessage` (bloques text/tool_use); `SDKResultMessage` trae `session_id, usage, total_cost_usd, num_turns, is_error`.
- Transcripciones: `~/.claude/projects/<cwd con todo lo no alfanumérico reemplazado por "-">/<sessionId>.jsonl`. Líneas `user` / `assistant` (content: text, tool_use con `name` + `input`; `Edit` = `{file_path, old_string, new_string, replace_all}`, `Write` = `{file_path, content}`, `Bash` = `{command, description}`, `Read`, `Agent`…), `tool_result` en líneas `user` con `tool_use_id`, más `file-history-snapshot`, `mode`, `permission-mode`, etc. Cada línea trae `sessionId`, `uuid`, `parentUuid`, `timestamp`, `cwd`.

## Arquitectura objetivo

```
Electron main (apps/desktop)
  └─ fork → apps/core  (Fastify 127.0.0.1:<puerto libre>, sin auth)
        ├─ sirve apps/web/dist (prod) | proxy Vite 5177 (dev)
        ├─ /api/repos          ← índice ~/.rdi/repos.json + <repo>/.rdi/
        ├─ /api/repos/:id/scenes|conversations|solutions  ← JSON files
        ├─ /api/repos/:id/chat (SSE)        ← runner sobre Agent SDK query()
        ├─ /api/repos/:id/sessions (SSE)    ← observer de ~/.claude/projects/*.jsonl + git
        ├─ /api/repos/:id/impact            ← overlay determinístico (0 tokens) + "explicar" (SDK)
        └─ /mcp (streamable HTTP, solo localhost) ← Solutions para `claude mcp add`
  └─ BrowserWindow.loadURL(http://127.0.0.1:<puerto>)
```

Storage:
```
~/.rdi/repos.json                       [{ id, path, name, addedAt }]
<repo>/.rdi/
  system-map.<HEAD-sha>.json            escena "mapa del sistema" (cache por commit)
  scenes/<sceneId>.json                 escenas emitidas por chat / impacto
  conversations/<id>.json               mensajes + ids de escenas + sdkSessionId
  solutions/<id>.json                   versiones append-only (mismo shape que hoy)
  prefs.json                            tema, idioma, nivel inicial
```
`.rdi/` se agrega al `.gitignore` del repo al abrirlo (con confirmación en UI); el usuario puede decidir versionarlo.

## Qué se borra / se queda / es nuevo

**Borrar (runtime SaaS):** `apps/worker/`, `packages/graph/`, `packages/providers/` (GitHub App, manifest, signatures; `materialize` ya no hace falta), `packages/indexer/` (tree-sitter; `pullImpact.ts` no sobrevive porque su input `OrgGraph` desaparece — ver "Impacto"), `infra/docker-compose.yml`, en `apps/api`: `db/` (pg, migrate, ensureDatabase, queries/*), `auth/*`, `routes/{auth,orgs,invitations,github,repos,pulls,tokens,usage}.ts`, `queue/`, `github/`, `mail/`, `solutions/events.ts` (Redis), `agent/{anthropicLlm,llm,scopeGuard,fakeLlm,history}.ts`, tests `*.integration.test.ts` (26) y `test/setup/env`. En `apps/web`: `shell/auth/*`, `settings/{members,repositories,usage,security,tokens}`, `shell/pulls/PullsPanel.tsx` (reemplazado por Timeline/Impacto), `session.ts` (CSRF), onboarding.

**Queda intacto:** `packages/scene/` completo; `apps/web/src/workspace/**` (canvas, engine, panels, themes, i18n); `apps/web/src/shell/chat/*` (ChatPanel + chatApi: mismos eventos SSE); `apps/web/src/shell/solutions/*` menos el diálogo de handoff; `apps/api/src/agent/{prompt,tools(emit_scene+upsert_solution),repairScene,translate}.ts`; `apps/api/src/solutions/service.ts` (cambia su `Deps` de pg a store JSON); `apps/api/src/mcp/server.ts` (cambia `McpContext`).

**Nuevo:** `apps/core` (renombre de `apps/api`), `apps/core/src/store/*` (JSON), `apps/core/src/agent/sdkRunner.ts`, `apps/core/src/observer/*`, `apps/core/src/impact/*`, `apps/web/src/shell/{repos,sessions,impact}/*`, `apps/desktop/`.

## Fases

### Fase A — Core local + storage JSON + Agent SDK (reemplaza API directa)

1. **Renombrar `apps/api` → `apps/core`**, quitar deps `pg, neo4j-driver, bullmq, ioredis, argon2, @fastify/cookie`; agregar `@anthropic-ai/claude-agent-sdk`, `@fastify/static`. `config.ts`: solo `port` (0 = libre), `host=127.0.0.1`, `rdiHome` (`~/.rdi`), `fakeAgent` (ex `RDI_FAKE_LLM`), `webDist`. Borrar `checks.ts` de infra.
2. **Store JSON** `apps/core/src/store/{repos,scenes,conversations,solutions,prefs}.ts`: lectura/escritura atómica (`write tmp + rename`), ids con `randomUUID`, mismas firmas que hoy consumen `solutions/service.ts` y `routes/agent.ts` (`insertMessage`, `listMessages`, `saveScene`, `getSolution`, `appendVersion`…) para minimizar cambios aguas arriba. `repoId = sha1(path)` corto.
3. **Rutas**: `routes/repos.ts` (`GET/POST/DELETE /api/repos`, `GET /api/repos/:id` con `head` sha vía `git rev-parse`, `GET /api/repos/:id/code?path&start&end` leyendo disco — reemplaza `readSource`), `routes/scenes.ts`, `routes/solutions.ts` (sin cambios de contrato salvo `orgId→repoId`), `routes/agent.ts` (chat SSE, translate) sobre el nuevo runner. Quitar `preHandler` de auth; CORS solo `127.0.0.1`.
4. **`agent/sdkRunner.ts`** reemplaza `runAgent.ts` + `anthropicLlm.ts`: `runAgent({ repoPath, mode, messages, language, sdkSessionId?, signal }) → AsyncIterable<AgentEvent>`. Llama `query({ prompt, options: { cwd: repoPath, model, permissionMode: 'plan'` para `analyze` / `'default'`+`disallowedTools:[Edit,Write,MultiEdit,NotebookEdit]` para `plan`,` allowedTools: ['Read','Grep','Glob','Bash(git *)', 'mcp__rdi__emit_scene','mcp__rdi__upsert_solution'], mcpServers: { rdi: createSdkMcpServer({ name:'rdi', tools:[emit_scene, upsert_solution] }) }, systemPrompt: { type:'preset', preset:'claude_code', append: SYSTEM_PROMPT + MODE_DIRECTIVE }, maxTurns: 16, maxBudgetUsd?, resume: sdkSessionId, abortController } })`. Mapea `SDKMessage` → `AgentEvent`: bloque `text` → `text`; `tool_use` → `tool running`; `tool_result` → `tool done/error`; cuando el handler de `emit_scene` valida OK → `scene`; `upsert_solution` → `solution`; `result` → cierra (guarda `session_id` en la conversación para `resume`, usage en `prefs`/conversación). El `SYSTEM_PROMPT` en `prompt.ts` se reescribe: ya no habla de "System Graph indexado" sino de "explorá el repo con Read/Grep/Glob; emití la escena una vez".
5. **Scope guard**: eliminar (era una llamada Haiku aparte; con `systemPrompt` alcanza). `translate.ts`: misma idea con `query` + `maxTurns: 2` + `disallowedTools` todo salvo `emit_scene`.
6. **Mapa del sistema**: `POST /api/repos/:id/system-map` → si existe `system-map.<HEAD>.json` lo devuelve; si no, corre el runner con prompt fijo "mapa de arquitectura del repo (≤25 piezas, con `code.path` en cada pieza)" y lo cachea. `ExplorePage` lo carga en vez de `/system-map` Neo4j.
7. **Fake SDK** `agent/fakeQuery.ts`: generador que yield-ea `SDKMessage` scripteados (text, tool_use emit_scene con una sample scene, result) → mismo rol que `fakeLlm.ts`; se inyecta por `deps.queryFn` para tests y `RDI_FAKE_AGENT=true`.
8. **Web shell**: router → `/` (lista de repos locales + botón "Abrir carpeta": en browser pide path por input; en Electron usa IPC → `dialog.showOpenDialog`), `/repos/:repoId/explore`, `/repos/:repoId/solutions/:id`, `/repos/:repoId/settings/preferences` (único settings). Borrar páginas auth/onboarding/members/tokens/usage/security/repositories. `api.ts`: quitar CSRF y cookies. `HomeRedirect` → `/`.
9. **Tests**: sobreviven `packages/scene/**`, `apps/web/test/**`, `apps/core/test/agent/{tools,repairScene,prompt}`; nuevos unitarios: store JSON (tmp dir), `sdkRunner` con `fakeQuery` (mapeo de eventos, resume, abort), rutas con `app.inject` sobre tmp `.rdi/`. Borrar `*.integration.test.ts`. `turbo.json`: quitar `infra:*`.

### Fase B — Observer de sesiones + Timeline + Impacto

1. **`observer/transcripts.ts`**: `projectDirFor(repoPath)` (regla: todo char no `[A-Za-z0-9]` → `-`), `listSessions(repoPath)` (jsonl por mtime, primer `user` como título), `tailSession(file, fromOffset)` (lee por líneas con `fs.watch` + offset; sin releer el archivo entero). Parser puro `observer/parse.ts`: línea → `TimelineEvent`:
   `{ id, ts, kind: 'prompt'|'text'|'edit'|'write'|'bash'|'read'|'subagent'|'commit', file?, oldText?, newText?, command?, summary }`, uniendo `tool_use` con su `tool_result` por `tool_use_id` (status ok/error). Ignora `attachment`, `file-history-snapshot`, `mode`, etc.
2. **Rutas**: `GET /api/repos/:id/sessions`, `GET /api/repos/:id/sessions/:sid` (eventos acumulados), `GET /api/repos/:id/sessions/:sid/events` (SSE en vivo, `EventSource` como ya hace `solutionsApi.ts`), `GET /api/repos/:id/git/status|diff?path` (working tree vía `git`).
3. **Impacto determinístico (0 tokens)** `impact/overlay.ts`: `overlayChanges(systemMap: Scene, touched: {path, change}[]) → Scene` marca `change` en nodos cuyo `code.path` coincide (exacto, luego prefijo de directorio más largo, luego nombre de módulo); nodos vecinos por `edges` se anotan en `risks` como "depende de pieza modificada" (severity low). Entrada: archivos tocados por la sesión (eventos `edit/write`) o por `git status`. Mismo output = una `Scene` → va al `Workspace` por `extraScenes`, como hacía `PullsPanel`.
4. **"Explicar este cambio" (tokens)** `POST /api/repos/:id/impact/explain { sessionId? | diff: 'worktree' | 'range' }`: runner con prompt "revisá este diff, emití escena de impacto con `change` y riesgos", adjuntando `git diff` (recortado a N KB) y el mapa cacheado como contexto; `permissionMode:'plan'`, `maxTurns: 8`. Resultado se guarda en `scenes/` y se asocia a la sesión.
5. **UI `shell/sessions/`**: `SessionsPage` (lista) y `TimelinePage` (columna izquierda: eventos agrupados por prompt, con badge de archivo y estado; centro: `Workspace` con el overlay de la sesión hasta el evento seleccionado; panel derecho: diff del paso usando `PayloadDiff.tsx` y `react-diff`/`diff` ya instalado). Botón "Explicar este cambio". `RisksPanel` ya renderiza los riesgos.
6. **Tests**: `parse.test.ts` con fixtures reales recortadas de un jsonl (anonimizadas), `overlay.test.ts` (matching de paths, nodos sin `code`), `tail` con archivo tmp que crece.

### Fase C — MCP localhost + "Run in Claude Code" real

1. `mcp/route.ts`: sin Bearer; solo acepta conexiones de loopback. `McpContext = { repoId, store, events: EventEmitter }`. Tools iguales (`list_solutions, get_solution, query_graph→ renombrar a get_system_map` devolviendo el mapa cacheado, `update_solution, report_task_progress`).
2. `solutions/events.ts` → `EventEmitter` in-process; `GET /solutions/:id/events` SSE lo consume.
3. **`HandoffDialog`** pasa a dos acciones: "Copiar comando `claude mcp add --transport http rdi http://127.0.0.1:<port>/mcp`" (terminal) y **"Ejecutar acá"**: `POST /api/repos/:id/solutions/:sid/run` → runner con `permissionMode: 'acceptEdits'`, `mcpServers: { rdi: <sdk server in-process con las tools de solutions> }`, prompt "implementá la solution tarea por tarea y reportá con report_task_progress". La sesión aparece en el Timeline (el SDK también escribe su jsonl, así que el observer la ve; además se guarda `sdkSessionId` para `resume`/`interrupt`). Botón "Detener" → `AbortController`.
4. Permisos: `canUseTool` del SDK conectado a un diálogo en la UI (SSE `permission` event + `POST .../permissions/:id`) para `permissionMode:'default'`; `acceptEdits` por defecto con toggle.

### Fase D — Electron + empaquetado

1. `apps/desktop/` (electron + electron-builder, TS): `main.ts` hace `fork(core)` con `RDI_PORT=0`, espera `GET /api/health` → `{port}` por IPC del child, `BrowserWindow.loadURL`. `preload.ts` expone `rdi.pickFolder()` (dialog) y `rdi.openExternal`. Dev: `RDI_WEB_URL=http://localhost:5177`; prod: core sirve `apps/web/dist` con `@fastify/static`.
2. Web detecta `window.rdi` para usar el picker nativo; si no, input de path.
3. Scripts: `npm run desktop:dev` (turbo: core + web + electron), `npm run desktop:build` (vite build → electron-builder, `extraResources` con el core compilado con `tsup`/`esbuild`). El SDK necesita el binario `claude` en PATH del usuario (no se empaqueta); `Options.pathToClaudeCodeExecutable` configurable en preferencias.

## Guardarraíles de tokens
- Caché por `HEAD` sha del mapa del sistema; "regenerar" explícito.
- `maxTurns` por tipo de pedido (mapa 16, explicar cambio 8, traducir 2) y `maxBudgetUsd` opcional en prefs.
- El overlay de impacto y el Timeline no gastan tokens; solo "Explicar" y el chat.
- Mostrar `usage`/`total_cost_usd` del `SDKResultMessage` por conversación (reemplaza la página Usage).

## Riesgos / abiertos
- El SDK espera el `claude` CLI logueado; si no, `query` falla → mostrar error claro con el comando `claude login`.
- Sesiones de terminal lanzadas desde un worktree u otro `cwd` caen en otro project dir: el observer busca por `cwd` exacto; agregar en prefs "cwd alternativos" por repo.
- `systemPrompt` tipo preset+append está en `Options` (`type:'preset', preset, append`), confirmado en d.ts; el nombre exacto de las tools MCP in-process es `mcp__<server>__<tool>` (verificar en el primer run con `includePartialMessages` para ver el `tool_use.name`).
- `.rdi/` dentro de repos ajenos: confirmar con el usuario al abrir (gitignore automático).

## Verificación end-to-end
1. `RDI_FAKE_AGENT=true npm run dev` → abrir `http://localhost:5177`, agregar la carpeta de `sessionboard-web-api`, ver mapa (escena fake), chat emite escena, solution se guarda en `<repo>/.rdi/solutions/`.
2. Sin fake: pedir mapa real de `repository-designer-ide` (≤25 piezas, `code.path` presentes) y confirmar `system-map.<sha>.json`; segunda carga no llama al SDK.
3. Observer: abrir una sesión `claude` en terminal sobre ese repo, hacer un Edit → en la app aparece el evento en <2 s, el nodo correspondiente queda `modified` en el canvas, el diff se ve en el panel.
4. "Explicar este cambio" produce escena con `change` + riesgos; "Ejecutar acá" sobre una solution de 1 tarea reporta progreso en vivo y se puede detener.
5. `npm test` en `packages/scene`, `apps/core`, `apps/web` verde sin Docker. `npm run desktop:build` genera `.app` que abre y carga el core.

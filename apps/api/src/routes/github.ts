import { randomBytes } from 'node:crypto';
import { buildAppManifest, exchangeManifestCode, exchangeUserCode, listUserInstallations, manifestPostUrl, signState, verifyState, verifyWebhookSignature } from '@rdi/providers';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { can } from '../domain/roles';
import { bindInstallation, findReposForInstallationAndName } from '../db/queries/github';
import { saveGithubApp } from '../db/queries/githubApp';
import { findMembership } from '../db/queries/orgs';
import { manifestAvailable, resolveGithubApp } from '../github/app';
import { fail, requireAction, requireAuth, requireMember } from '../http/auth';
import { nowOf, type AppDeps } from '../http/deps';

const STATE_TTL_MS = 15 * 60_000;
const STATE_KEY_PREFIX = 'rdi:gh-state:';
const MANIFEST_KEY_PREFIX = 'rdi:gh-manifest:';
const CONNECT_KEY_PREFIX = 'rdi:gh-connect:';
const VERIFY_KEY_PREFIX = 'rdi:gh-verify:';
const CONNECT_TTL_SECONDS = 60 * 60;
const VERIFY_TTL_SECONDS = 10 * 60;
const OAUTH_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const MANIFEST_TTL_SECONDS = 60 * 60;
const STATE_BYTES = 24;
const SECRET_BYTES = 32;
const SUBJECT_SEPARATOR = ':';
const MAX_APP_NAME = 34;

const setupQuery = z.object({
  installation_id: z.coerce.number().int().positive().optional(),
  setup_action: z.string().max(40).optional(),
  code: z.string().min(1).max(200).optional(),
  state: z.string().min(1).max(500).optional(),
});
const manifestQuery = z.object({
  owner: z.enum(['user', 'org']).default('user'),
  org: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/).optional(),
  name: z.string().trim().min(1).max(MAX_APP_NAME),
});
const callbackQuery = z.object({ code: z.string().min(1).max(200), state: z.string().min(1).max(200) });
const pushPayload = z.object({ ref: z.string(), repository: z.object({ full_name: z.string(), default_branch: z.string() }), installation: z.object({ id: z.number() }) });

export const githubRoutes = (api: FastifyInstance, deps: AppDeps) => {
  const manage = [requireAuth, requireMember(deps), requireAction('repos.manage')];
  const installState = (stateSecret: string, orgId: string, userId: string) => signState(stateSecret, `${orgId}${SUBJECT_SEPARATOR}${userId}`, nowOf(deps));
  const setupUrl = `${deps.config.appUrl}/api/github/setup`;
  const repositoriesPage = (orgId: string | null, params: string) =>
    orgId ? `${deps.config.appUrl}/orgs/${orgId}/settings/repositories?${params}` : `${deps.config.appUrl}/?${params}`;
  /** Remembers which product org the user is connecting, so GitHub redirects without our state still land in the right place. */
  const rememberConnect = (userId: string, orgId: string) => deps.redis.set(`${CONNECT_KEY_PREFIX}${userId}`, orgId, 'EX', CONNECT_TTL_SECONDS);
  const canManage = async (orgId: string, userId: string) => {
    const membership = await findMembership(deps.pool, orgId, userId);
    return Boolean(membership && can(membership.role, 'repos.manage'));
  };

  api.get('/orgs/:orgId/github/manifest', { preHandler: manage }, async (req, reply) => {
    if (await resolveGithubApp(deps)) return fail(reply, 409, 'github_already_configured');
    if (!(await manifestAvailable(deps))) return fail(reply, 404, 'not_found');
    const query = manifestQuery.parse(req.query);
    if (query.owner === 'org' && !query.org) return fail(reply, 400, 'validation');
    const state = randomBytes(STATE_BYTES).toString('base64url');
    await deps.redis.set(`${MANIFEST_KEY_PREFIX}${state}`, JSON.stringify({ orgId: req.member!.org.id, userId: req.auth!.user.id }), 'EX', MANIFEST_TTL_SECONDS);
    const owner = query.owner === 'org' && query.org ? { type: 'org' as const, login: query.org } : { type: 'user' as const };
    return {
      action: manifestPostUrl(owner, state),
      manifest: JSON.stringify(buildAppManifest({ name: query.name, appUrl: deps.config.appUrl, publicApiUrl: deps.config.publicApiUrl })),
    };
  });

  api.get('/github/manifest/callback', { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.auth!.user.id;
    const query = callbackQuery.safeParse(req.query);
    const raw = query.success ? await deps.redis.getdel(`${MANIFEST_KEY_PREFIX}${query.data.state}`) : null;
    const pending = raw ? (JSON.parse(raw) as { orgId: string; userId: string }) : null;
    if (!query.success || !pending || pending.userId !== userId) return reply.redirect(repositoriesPage(null, 'github_error=invalid_state'), 302);
    if (!(await canManage(pending.orgId, userId))) return reply.redirect(repositoriesPage(null, 'github_error=invalid_state'), 302);
    if (!(await manifestAvailable(deps))) return reply.redirect(repositoriesPage(pending.orgId, 'github_error=github_already_configured'), 302);
    try {
      const app = await exchangeManifestCode(query.data.code, deps.fetch ?? fetch);
      await saveGithubApp(deps.pool, { ...app, stateSecret: randomBytes(SECRET_BYTES).toString('base64url') });
    } catch {
      return reply.redirect(repositoriesPage(pending.orgId, 'github_error=manifest_failed'), 302);
    }
    const active = await resolveGithubApp(deps);
    if (!active) return reply.redirect(repositoriesPage(pending.orgId, 'github_error=manifest_failed'), 302);
    await rememberConnect(userId, pending.orgId);
    return reply.redirect(active.client.installUrl(installState(active.config.stateSecret, pending.orgId, userId)), 302);
  });

  api.get('/orgs/:orgId/github/install-url', { preHandler: manage }, async (req, reply) => {
    const active = await resolveGithubApp(deps);
    if (!active) return fail(reply, 409, 'github_not_configured');
    await rememberConnect(req.auth!.user.id, req.member!.org.id);
    return { url: active.client.installUrl(installState(active.config.stateSecret, req.member!.org.id, req.auth!.user.id)) };
  });

  api.get('/github/setup', { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.auth!.user.id;
    const back = (orgId: string | null, params: string) => reply.redirect(repositoriesPage(orgId, params), 302);
    const parsed = setupQuery.safeParse(req.query);
    if (!parsed.success) return back(null, 'github_error=invalid_request');
    const query = parsed.data;
    const active = await resolveGithubApp(deps);
    let orgId: string | null = null;
    let signedState = false;
    let installationId = query.installation_id ?? null;
    if (query.state && active) {
      const [stateOrg, stateUser] = (verifyState(active.config.stateSecret, query.state, nowOf(deps)) ?? '').split(SUBJECT_SEPARATOR);
      if (stateOrg && stateUser === userId) {
        orgId = stateOrg;
        signedState = true;
      }
    }
    if (!orgId && query.state) {
      const raw = await deps.redis.getdel(`${VERIFY_KEY_PREFIX}${query.state}`);
      const pending = raw ? (JSON.parse(raw) as { orgId: string; userId: string; installationId: number }) : null;
      if (pending && pending.userId === userId) {
        orgId = pending.orgId;
        installationId = pending.installationId;
      }
    }
    orgId ??= await deps.redis.get(`${CONNECT_KEY_PREFIX}${userId}`);
    if (!orgId) return back(null, 'github_error=invalid_state');
    if (!active) return back(orgId, 'github_error=github_not_configured');
    if (!(await canManage(orgId, userId))) return back(null, 'github_error=invalid_state');
    if (query.setup_action === 'request') return back(orgId, 'github=pending');
    if (!installationId) return back(orgId, 'github_error=missing_installation');
    try {
      let accountLogin: string;
      if (active.oauth) {
        if (!query.code) {
          const nonce = randomBytes(STATE_BYTES).toString('base64url');
          await deps.redis.set(`${VERIFY_KEY_PREFIX}${nonce}`, JSON.stringify({ orgId, userId, installationId }), 'EX', VERIFY_TTL_SECONDS);
          return reply.redirect(`${OAUTH_AUTHORIZE_URL}?${new URLSearchParams({ client_id: active.oauth.clientId, redirect_uri: setupUrl, state: nonce }).toString()}`, 302);
        }
        const token = await exchangeUserCode({ ...active.oauth, code: query.code, redirectUri: setupUrl }, deps.fetch ?? fetch);
        const owned = (await listUserInstallations(token, deps.fetch ?? fetch)).find((i) => i.id === installationId);
        if (!owned) return back(orgId, 'github_error=installation_not_yours');
        accountLogin = owned.accountLogin;
      } else {
        // Env Apps without OAuth credentials keep the signed, single-use state as their only proof.
        if (!signedState || !query.state) return back(orgId, 'github_error=invalid_state');
        const firstUse = await deps.redis.set(`${STATE_KEY_PREFIX}${query.state}`, '1', 'PX', STATE_TTL_MS, 'NX');
        if (firstUse !== 'OK') return back(orgId, 'github_error=invalid_state');
        accountLogin = (await active.client.getInstallation(installationId)).accountLogin;
      }
      const bound = await bindInstallation(deps.pool, { orgId, installationId, accountLogin });
      if (!bound) return back(orgId, 'github_error=installation_taken');
      return back(orgId, 'connected=github');
    } catch {
      return back(orgId, 'github_error=github_failed');
    }
  });

  api.register(async (hooks) => {
    hooks.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    hooks.post('/github/webhook', async (req, reply) => {
      const secret = (await resolveGithubApp(deps))?.config.webhookSecret;
      const raw = typeof req.body === 'string' ? req.body : '';
      const signature = req.headers['x-hub-signature-256'];
      if (!secret || !verifyWebhookSignature(secret, raw, typeof signature === 'string' ? signature : undefined)) return fail(reply, 401, 'invalid_signature');
      if (req.headers['x-github-event'] !== 'push') return reply.code(202).send({ ok: true });
      const parsed = pushPayload.safeParse(JSON.parse(raw));
      if (!parsed.success) return reply.code(202).send({ ok: true });
      const { ref, repository, installation } = parsed.data;
      if (ref !== `refs/heads/${repository.default_branch}`) return reply.code(202).send({ ok: true });
      for (const repo of await findReposForInstallationAndName(deps.pool, installation.id, repository.full_name)) {
        await deps.indexQueue?.enqueue({ repoId: repo.id, orgId: repo.org_id, reason: 'push' });
      }
      return reply.code(202).send({ ok: true });
    });
  });
};

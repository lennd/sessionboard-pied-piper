import { randomBytes } from 'node:crypto';
import { buildAppManifest, exchangeManifestCode, manifestPostUrl, signState, verifyState, verifyWebhookSignature } from '@rdi/providers';
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
const MANIFEST_TTL_SECONDS = 60 * 60;
const STATE_BYTES = 24;
const SECRET_BYTES = 32;
const SUBJECT_SEPARATOR = ':';
const MAX_APP_NAME = 34;

const setupQuery = z.object({ installation_id: z.coerce.number().int().positive(), state: z.string().min(1).max(500) });
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
    const query = callbackQuery.parse(req.query);
    const raw = await deps.redis.getdel(`${MANIFEST_KEY_PREFIX}${query.state}`);
    const pending = raw ? (JSON.parse(raw) as { orgId: string; userId: string }) : null;
    if (!pending || pending.userId !== req.auth!.user.id) return fail(reply, 400, 'invalid_state');
    const membership = await findMembership(deps.pool, pending.orgId, req.auth!.user.id);
    if (!membership || !can(membership.role, 'repos.manage')) return fail(reply, 404, 'not_found');
    if (!(await manifestAvailable(deps))) return fail(reply, 409, 'github_already_configured');
    const app = await exchangeManifestCode(query.code, deps.fetch ?? fetch);
    await saveGithubApp(deps.pool, { ...app, stateSecret: randomBytes(SECRET_BYTES).toString('base64url') });
    const active = await resolveGithubApp(deps);
    if (!active) return fail(reply, 500, 'internal');
    return reply.redirect(active.client.installUrl(installState(active.config.stateSecret, pending.orgId, req.auth!.user.id)), 302);
  });

  api.get('/orgs/:orgId/github/install-url', { preHandler: manage }, async (req, reply) => {
    const active = await resolveGithubApp(deps);
    if (!active) return fail(reply, 409, 'github_not_configured');
    return { url: active.client.installUrl(installState(active.config.stateSecret, req.member!.org.id, req.auth!.user.id)) };
  });

  api.get('/github/setup', { preHandler: requireAuth }, async (req, reply) => {
    const active = await resolveGithubApp(deps);
    if (!active) return fail(reply, 409, 'github_not_configured');
    const query = setupQuery.parse(req.query);
    const [orgId, userId] = (verifyState(active.config.stateSecret, query.state, nowOf(deps)) ?? '').split(SUBJECT_SEPARATOR);
    if (!orgId || userId !== req.auth!.user.id) return fail(reply, 400, 'invalid_state');
    const firstUse = await deps.redis.set(`${STATE_KEY_PREFIX}${query.state}`, '1', 'PX', STATE_TTL_MS, 'NX');
    if (firstUse !== 'OK') return fail(reply, 400, 'invalid_state');
    const membership = await findMembership(deps.pool, orgId, req.auth!.user.id);
    if (!membership || !can(membership.role, 'repos.manage')) return fail(reply, 404, 'not_found');
    const installation = await active.client.getInstallation(query.installation_id);
    const bound = await bindInstallation(deps.pool, { orgId, installationId: query.installation_id, accountLogin: installation.accountLogin });
    if (!bound) return fail(reply, 409, 'installation_taken');
    return reply.redirect(`${deps.config.appUrl}/orgs/${orgId}/settings/repositories?connected=github`, 302);
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

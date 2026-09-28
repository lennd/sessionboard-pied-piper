import { signState, verifyState, verifyWebhookSignature } from '@rdi/providers';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { can } from '../domain/roles';
import { bindInstallation, findReposForInstallationAndName } from '../db/queries/github';
import { findMembership } from '../db/queries/orgs';
import { fail, requireAction, requireAuth, requireMember } from '../http/auth';
import { nowOf, type AppDeps } from '../http/deps';

const STATE_TTL_MS = 15 * 60_000;
const STATE_KEY_PREFIX = 'rdi:gh-state:';
const SUBJECT_SEPARATOR = ':';

const setupQuery = z.object({ installation_id: z.coerce.number().int().positive(), state: z.string().min(1).max(500) });
const pushPayload = z.object({ ref: z.string(), repository: z.object({ full_name: z.string(), default_branch: z.string() }), installation: z.object({ id: z.number() }) });

export const githubRoutes = (api: FastifyInstance, deps: AppDeps) => {
  api.get('/orgs/:orgId/github/install-url', { preHandler: [requireAuth, requireMember(deps), requireAction('repos.manage')] }, async (req, reply) => {
    if (!deps.config.github || !deps.github) return fail(reply, 409, 'github_not_configured');
    return { url: deps.github.installUrl(signState(deps.config.github.stateSecret, `${req.member!.org.id}${SUBJECT_SEPARATOR}${req.auth!.user.id}`, nowOf(deps))) };
  });

  api.get('/github/setup', { preHandler: requireAuth }, async (req, reply) => {
    if (!deps.config.github || !deps.github) return fail(reply, 409, 'github_not_configured');
    const query = setupQuery.parse(req.query);
    const [orgId, userId] = (verifyState(deps.config.github.stateSecret, query.state, nowOf(deps)) ?? '').split(SUBJECT_SEPARATOR);
    if (!orgId || userId !== req.auth!.user.id) return fail(reply, 400, 'invalid_state');
    const firstUse = await deps.redis.set(`${STATE_KEY_PREFIX}${query.state}`, '1', 'PX', STATE_TTL_MS, 'NX');
    if (firstUse !== 'OK') return fail(reply, 400, 'invalid_state');
    const membership = await findMembership(deps.pool, orgId, req.auth!.user.id);
    if (!membership || !can(membership.role, 'repos.manage')) return fail(reply, 404, 'not_found');
    const installation = await deps.github.getInstallation(query.installation_id);
    const bound = await bindInstallation(deps.pool, { orgId, installationId: query.installation_id, accountLogin: installation.accountLogin });
    if (!bound) return fail(reply, 409, 'installation_taken');
    return reply.redirect(`${deps.config.appUrl}/orgs/${orgId}/settings/repositories?connected=github`, 302);
  });

  api.register(async (hooks) => {
    hooks.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    hooks.post('/github/webhook', async (req, reply) => {
      const secret = deps.config.github?.webhookSecret;
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

import { describe, expect, it, vi } from 'vitest';
import { buildAppManifest, exchangeManifestCode, isLocalUrl, manifestPostUrl } from '../src/index';

describe('buildAppManifest', () => {
  it('creates a public read-only app whose URLs go through the web origin', () => {
    const manifest = buildAppManifest({ name: 'Repository Designer abcd', appUrl: 'http://localhost:5177', publicApiUrl: 'http://localhost:4040' });
    expect(manifest).toEqual({
      name: 'Repository Designer abcd',
      url: 'http://localhost:5177',
      hook_attributes: { url: 'http://localhost:4040/api/github/webhook', active: false },
      redirect_url: 'http://localhost:5177/api/github/manifest/callback',
      setup_url: 'http://localhost:5177/api/github/setup',
      setup_on_update: true,
      public: true,
      default_permissions: { contents: 'read', metadata: 'read', pull_requests: 'read' },
      default_events: ['push'],
    });
    expect((buildAppManifest({ name: 'x', appUrl: 'https://app.example.com', publicApiUrl: 'https://api.example.com' }).hook_attributes as { active: boolean }).active).toBe(true);
  });

  it('posts to the user or organization settings page with the state', () => {
    expect(manifestPostUrl({ type: 'user' }, 's 1')).toBe('https://github.com/settings/apps/new?state=s%201');
    expect(manifestPostUrl({ type: 'org', login: 'lennd' }, 's')).toBe('https://github.com/organizations/lennd/settings/apps/new?state=s');
  });

  it('recognizes local URLs', () => {
    expect(isLocalUrl('http://localhost:4040')).toBe(true);
    expect(isLocalUrl('http://127.0.0.1:4040')).toBe(true);
    expect(isLocalUrl('https://api.example.com')).toBe(false);
  });
});

describe('exchangeManifestCode', () => {
  it('converts the temporary code into app credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 123, slug: 'repository-designer-abcd', name: 'Repository Designer abcd', html_url: 'https://github.com/apps/repository-designer-abcd',
      owner: { login: 'hugo' }, pem: '-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----\n', webhook_secret: 'whs', client_id: 'Iv1', client_secret: 'cs',
    }), { status: 201 }));
    const app = await exchangeManifestCode('code123', fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/app-manifests/code123/conversions', expect.objectContaining({ method: 'POST' }));
    expect(app).toEqual({ appId: '123', slug: 'repository-designer-abcd', name: 'Repository Designer abcd', htmlUrl: 'https://github.com/apps/repository-designer-abcd', ownerLogin: 'hugo', privateKey: expect.stringContaining('BEGIN RSA'), webhookSecret: 'whs', clientId: 'Iv1', clientSecret: 'cs' });
  });

  it('fails clearly when GitHub rejects the code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }));
    await expect(exchangeManifestCode('bad', fetchMock as unknown as typeof fetch)).rejects.toThrow('GitHub API 404: Not Found');
  });
});

// @vitest-environment node
import { brandBySlug, brandsFor } from '../../src/workspace/canvas/brands';

describe('brandsFor', () => {
  it('finds known products in a label and kind, in rule order and without duplicates', () => {
    expect(brandsFor('PostgreSQL RDS cluster (master + replicas)').map((b) => b.slug)).toEqual(['postgresql']);
    expect(brandsFor('Service providers SendGrid, OpenAI/Anthropic/ElevenLabs, HubSpot, Slack').map((b) => b.slug)).toEqual(['hubspot', 'slack', 'sendgrid']);
    expect(brandsFor('Jobs queue AWS SQS (api-jobs)').map((b) => b.slug)).toEqual(['sqs', 'aws']);
  });

  it('caps the number of logos and ignores unknown text', () => {
    expect(brandsFor('Express API server Node.js / Express (port 3001) with Redis and Socket.IO', 2)).toHaveLength(2);
    expect(brandsFor('Business logic updateSession')).toEqual([]);
  });

  it('resolves a slug back to its path for both library and custom marks', () => {
    expect(brandBySlug('redis')?.title).toBe('Redis');
    expect(brandBySlug('s3')?.title).toBe('Amazon S3');
    expect(brandBySlug('nope')).toBeNull();
  });
});

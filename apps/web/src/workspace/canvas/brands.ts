import * as si from 'simple-icons';

export type Brand = { slug: string; title: string; path: string };

/** Products whose mark is not in simple-icons (or that we draw generically): a filled 24×24 path. */
const CUSTOM: Record<string, Brand> = {
  aws: { slug: 'aws', title: 'AWS', path: 'M6.8 10.2c0 .4 0 .7.1 1 .1.2.2.5.3.8v.3c0 .1-.1.2-.2.3l-.6.4h-.3c-.1 0-.2-.1-.3-.2l-.4-.5-.3-.6c-.9 1-2 1.5-3.3 1.5-1 0-1.7-.3-2.3-.8S-1 11.1-1 10.2c0-1 .3-1.7 1-2.3.7-.6 1.6-.9 2.8-.9.4 0 .8 0 1.2.1l1.3.3V6.6c0-.8-.2-1.4-.5-1.7-.3-.3-.9-.5-1.7-.5-.4 0-.8 0-1.2.1l-1.2.4h-.4c-.2 0-.3-.1-.3-.4v-.5c0-.2 0-.3.1-.4l.4-.3c.4-.2.8-.4 1.4-.5.5-.1 1.1-.2 1.7-.2 1.3 0 2.2.3 2.8.9.6.6.9 1.5.9 2.6v3.6zM19 12.9c-.2 0-.3 0-.4-.1-.1-.1-.2-.2-.3-.4L15.8 4c-.1-.2-.1-.4-.1-.5 0-.2.1-.3.3-.3h1.1c.2 0 .3 0 .4.1.1.1.2.2.2.4l1.8 7 1.6-7c0-.2.1-.3.2-.4.1-.1.3-.1.4-.1h.9c.2 0 .3 0 .4.1.1.1.2.2.2.4l1.7 7.1 1.8-7.1c.1-.2.1-.3.2-.4.1-.1.3-.1.4-.1h1c.2 0 .3.1.3.3v.3l-.1.3-2.6 8.4c-.1.2-.1.3-.3.4-.1.1-.3.1-.4.1h-1c-.2 0-.3 0-.4-.1-.1-.1-.2-.2-.2-.4L21.7 6l-1.6 6.5c0 .2-.1.3-.2.4-.1.1-.3.1-.4.1H19z' },
  s3: { slug: 's3', title: 'Amazon S3', path: 'M12 2C7.6 2 4 3.3 4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5c0-1.7-3.6-3-8-3zm0 2c3.9 0 6 1 6 1s-2.1 1-6 1-6-1-6-1 2.1-1 6-1zm-6 3.4C7.6 8.4 9.7 9 12 9s4.4-.6 6-1.6V12c0 .6-2.5 1.5-6 1.5S6 12.6 6 12V7.4zm0 7C7.6 15.4 9.7 16 12 16s4.4-.6 6-1.6V19c0 .6-2.5 1.5-6 1.5S6 19.6 6 19v-4.6z' },
  sqs: { slug: 'sqs', title: 'Amazon SQS', path: 'M3 6h12v4H3zm0 8h12v4H3zm14-6 4 4-4 4v-3h-2v-2h2z' },
  sns: { slug: 'sns', title: 'Amazon SNS', path: 'M12 3a9 9 0 0 0-9 9 9 9 0 0 0 9 9 9 9 0 0 0 9-9 9 9 0 0 0-9-9zm0 2a7 7 0 0 1 7 7 7 7 0 0 1-7 7 7 7 0 0 1-7-7 7 7 0 0 1 7-7zm0 3a4 4 0 0 0-4 4 4 4 0 0 0 4 4 4 4 0 0 0 4-4 4 4 0 0 0-4-4zm0 2a2 2 0 0 1 2 2 2 2 0 0 1-2 2 2 2 0 0 1-2-2 2 2 0 0 1 2-2z' },
  lambda: { slug: 'lambda', title: 'AWS Lambda', path: 'M5 3h5l9 18h-5zM9.5 12 4 21h5l3-5z' },
  openai: { slug: 'openai', title: 'OpenAI', path: 'M12 2 14.2 8.1 20.5 8.3 15.6 12.3 17.3 18.4 12 14.9 6.7 18.4 8.4 12.3 3.5 8.3 9.8 8.1z' },
  slack: { slug: 'slack', title: 'Slack', path: 'M9 3h2v8H9zM13 3h2v8h-2zM9 13h2v8H9zM13 13h2v8h-2zM3 9h8v2H3zM13 9h8v2h-8zM3 13h8v2H3zM13 13h8v2h-8z' },
  sendgrid: { slug: 'sendgrid', title: 'SendGrid', path: 'M3 5h18v14H3zm2 2v.4l7 4.6 7-4.6V7zm0 2.8V17h14V9.8l-7 4.6z' },
  twilio: { slug: 'twilio', title: 'Twilio', path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-3 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm-6 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z' },
  salesforce: { slug: 'salesforce', title: 'Salesforce', path: 'M9 6a4 4 0 0 1 3.5 2 3.5 3.5 0 0 1 5.3 2.8A3.6 3.6 0 0 1 17 18H7a4 4 0 0 1-1-7.9A4 4 0 0 1 9 6z' },
  docusign: { slug: 'docusign', title: 'DocuSign', path: 'M5 3h10l4 4v14H5zm9 1.5V8h3.5zM7 11h10v2H7zm0 4h7v2H7z' },
  cron: { slug: 'cron', title: 'Scheduler', path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm-1 3h2v5.6l3.5 2-1 1.7L11 13z' },
  email: { slug: 'email', title: 'Email', path: 'M3 5h18v14H3zm2 2v.4l7 4.6 7-4.6V7zm0 2.8V17h14V9.8l-7 4.6z' },
  websocket: { slug: 'websocket', title: 'WebSocket', path: 'M3 12 7 8v3h10V8l4 4-4 4v-3H7v3z' },
};

type Rule = { test: RegExp; brand: Brand | null; icon?: keyof typeof si };
const fromSi = (key: string): Brand | null => {
  const icon = (si as unknown as Record<string, { title: string; slug: string; path: string } | undefined>)[key];
  return icon ? { slug: icon.slug, title: icon.title, path: icon.path } : null;
};

/** Order matters: the first matching rule wins for a given product, and several products can be found in one text. */
const RULES: { test: RegExp; brand: () => Brand | null }[] = [
  { test: /\bpostgres(ql)?\b|\bpg\b|\brds\b/i, brand: () => fromSi('siPostgresql') },
  { test: /\bredis\b|\bioredis\b/i, brand: () => fromSi('siRedis') },
  { test: /\belastic ?search\b|\bopensearch\b/i, brand: () => fromSi('siElasticsearch') },
  { test: /\bmongo(db)?\b/i, brand: () => fromSi('siMongodb') },
  { test: /\bmysql\b|\bmariadb\b/i, brand: () => fromSi('siMysql') },
  { test: /\bsqlite\b/i, brand: () => fromSi('siSqlite') },
  { test: /\bdynamo(db)?\b/i, brand: () => CUSTOM.aws! },
  { test: /\bs3\b/i, brand: () => CUSTOM.s3! },
  { test: /\bsqs\b/i, brand: () => CUSTOM.sqs! },
  { test: /\bsns\b/i, brand: () => CUSTOM.sns! },
  { test: /\blambda\b/i, brand: () => CUSTOM.lambda! },
  { test: /\bkafka\b/i, brand: () => fromSi('siApachekafka') },
  { test: /\brabbit ?mq\b/i, brand: () => fromSi('siRabbitmq') },
  { test: /\bsocket\.?io\b/i, brand: () => fromSi('siSocketdotio') },
  { test: /\bwebsockets?\b/i, brand: () => CUSTOM.websocket! },
  { test: /\bexpress\b/i, brand: () => fromSi('siExpress') },
  { test: /\bfastify\b/i, brand: () => fromSi('siFastify') },
  { test: /\bnest(js)?\b/i, brand: () => fromSi('siNestjs') },
  { test: /\bnode(\.js)?\b/i, brand: () => fromSi('siNodedotjs') },
  { test: /\bsequelize\b/i, brand: () => fromSi('siSequelize') },
  { test: /\bprisma\b/i, brand: () => fromSi('siPrisma') },
  { test: /\breact\b/i, brand: () => fromSi('siReact') },
  { test: /\bnext(\.js)?\b/i, brand: () => fromSi('siNextdotjs') },
  { test: /\bvue(\.js)?\b/i, brand: () => fromSi('siVuedotjs') },
  { test: /\bangular\b/i, brand: () => fromSi('siAngular') },
  { test: /\bsvelte\b/i, brand: () => fromSi('siSvelte') },
  { test: /\belectron\b/i, brand: () => fromSi('siElectron') },
  { test: /\bgraphql\b/i, brand: () => fromSi('siGraphql') },
  { test: /\bpython\b|\bdjango\b|\bflask\b|\bfastapi\b/i, brand: () => fromSi('siPython') },
  { test: /\bgo(lang)?\b/, brand: () => fromSi('siGo') },
  { test: /\brust\b/i, brand: () => fromSi('siRust') },
  { test: /\brails\b/i, brand: () => fromSi('siRubyonrails') },
  { test: /\bspring\b/i, brand: () => fromSi('siSpring') },
  { test: /\bdocker\b/i, brand: () => fromSi('siDocker') },
  { test: /\bkubernetes\b|\bk8s\b|\beks\b/i, brand: () => fromSi('siKubernetes') },
  { test: /\bterraform\b/i, brand: () => fromSi('siTerraform') },
  { test: /\baws\b|\bamazon\b|\becs\b|\bfargate\b|\bcloudfront\b|\bcognito\b|\bstep functions?\b/i, brand: () => CUSTOM.aws! },
  { test: /\bgoogle cloud\b|\bgcp\b|\bbigquery\b/i, brand: () => fromSi('siGooglecloud') },
  { test: /\bfirebase\b/i, brand: () => fromSi('siFirebase') },
  { test: /\bsupabase\b/i, brand: () => fromSi('siSupabase') },
  { test: /\bvercel\b/i, brand: () => fromSi('siVercel') },
  { test: /\bcloudflare\b/i, brand: () => fromSi('siCloudflare') },
  { test: /\bnginx\b/i, brand: () => fromSi('siNginx') },
  { test: /\bsnowflake\b/i, brand: () => fromSi('siSnowflake') },
  { test: /\bairflow\b/i, brand: () => fromSi('siApacheairflow') },
  { test: /\bduckdb\b/i, brand: () => fromSi('siDuckdb') },
  { test: /\bneo4j\b/i, brand: () => fromSi('siNeo4j') },
  { test: /\bgrafana\b/i, brand: () => fromSi('siGrafana') },
  { test: /\bprometheus\b/i, brand: () => fromSi('siPrometheus') },
  { test: /\bdatadog\b/i, brand: () => fromSi('siDatadog') },
  { test: /\bsentry\b/i, brand: () => fromSi('siSentry') },
  { test: /\bopentelemetry\b|\botel\b/i, brand: () => fromSi('siOpentelemetry') },
  { test: /\bauth0\b/i, brand: () => fromSi('siAuth0') },
  { test: /\bokta\b/i, brand: () => fromSi('siOkta') },
  { test: /\bkeycloak\b/i, brand: () => fromSi('siKeycloak') },
  { test: /\bsalesforce\b/i, brand: () => CUSTOM.salesforce! },
  { test: /\bhubspot\b/i, brand: () => fromSi('siHubspot') },
  { test: /\bstripe\b/i, brand: () => fromSi('siStripe') },
  { test: /\bpaypal\b/i, brand: () => fromSi('siPaypal') },
  { test: /\bgithub\b/i, brand: () => fromSi('siGithub') },
  { test: /\bslack\b/i, brand: () => CUSTOM.slack! },
  { test: /\bsendgrid\b/i, brand: () => CUSTOM.sendgrid! },
  { test: /\btwilio\b/i, brand: () => CUSTOM.twilio! },
  { test: /\bdocusign\b/i, brand: () => CUSTOM.docusign! },
  { test: /\bopenai\b|\bgpt\b/i, brand: () => CUSTOM.openai! },
  { test: /\banthropic\b|\bclaude\b/i, brand: () => fromSi('siAnthropic') },
  { test: /\belevenlabs\b/i, brand: () => fromSi('siElevenlabs') },
  { test: /\bmailchimp\b/i, brand: () => fromSi('siMailchimp') },
  { test: /\bintercom\b/i, brand: () => fromSi('siIntercom') },
  { test: /\bzendesk\b/i, brand: () => fromSi('siZendesk') },
  { test: /\bzoom\b/i, brand: () => fromSi('siZoom') },
  { test: /\bjira\b/i, brand: () => fromSi('siJira') },
  { test: /\bcron\b|\bscheduler\b/i, brand: () => CUSTOM.cron! },
  { test: /\be-?mails?\b|\bsmtp\b/i, brand: () => CUSTOM.email! },
];

export const MAX_BRANDS = 3;

/** Known products mentioned in a piece's label and kind, in the order they appear in the rules; at most `MAX_BRANDS`. */
export const brandsFor = (text: string, max = MAX_BRANDS): Brand[] => {
  const found: Brand[] = [];
  for (const rule of RULES) {
    if (found.length >= max) break;
    if (!rule.test.test(text)) continue;
    const brand = rule.brand();
    if (brand && !found.some((b) => b.slug === brand.slug)) found.push(brand);
  }
  return found;
};

export const brandBySlug = (slug: string): Brand | null => {
  const custom = Object.values(CUSTOM).find((b) => b.slug === slug);
  if (custom) return custom;
  const key = Object.keys(si).find((k) => (si as unknown as Record<string, { slug?: string }>)[k]?.slug === slug);
  return key ? fromSi(key) : null;
};

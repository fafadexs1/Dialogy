require('dotenv').config({ quiet: true });

async function main() {
  const settings = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
  }).then((response) => response.json());

  console.log(JSON.stringify({
    emailProvider: settings.external?.email,
    emailAutoconfirm: settings.mailer_autoconfirm,
    signupDisabled: settings.disable_signup,
  }, null, 2));

  const Stripe = require('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const ids = [
    'price_1TPAo6Chm5ywuupPPqWfvKzb',
    'price_1TPAo7Chm5ywuupPEMyFpktS',
    'price_1TPAo7Chm5ywuupPrZSNUfWk',
  ];
  const prices = [];

  for (const id of ids) {
    try {
      const price = await stripe.prices.retrieve(id);
      prices.push({
        id: price.id,
        active: price.active,
        currency: price.currency,
        unitAmount: price.unit_amount,
        interval: price.recurring?.interval,
        type: price.type,
      });
    } catch (error) {
      prices.push({ id, error: error.code || error.message });
    }
  }

  const endpoints = await stripe.webhookEndpoints.list({ limit: 20 });
  console.log(JSON.stringify({
    stripeMode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test',
    prices,
    webhooks: endpoints.data.map((endpoint) => ({
      status: endpoint.status,
      urlHost: new URL(endpoint.url).host,
      events: endpoint.enabled_events.filter((event) => (
        event.includes('subscription') ||
        event.includes('invoice') ||
        event === 'checkout.session.completed'
      )),
    })),
  }, null, 2));

  const { Pool } = require('pg');
  const { createHash } = require('crypto');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const subscriptions = await stripe.subscriptions.list({ status: 'all', limit: 100 });
    const [billing, roleMismatches, permissionCoverage, stripeSettings] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(status, 'missing') AS status,
          COUNT(*)::int AS workspaces,
          COUNT(*) FILTER (WHERE stripe_customer_id IS NULL)::int AS missing_customer,
          COUNT(*) FILTER (WHERE stripe_subscription_id IS NULL)::int AS missing_subscription
        FROM billing_info
        GROUP BY COALESCE(status, 'missing')
        ORDER BY status
      `),
      pool.query(`
        SELECT COUNT(*)::int AS mismatches
        FROM team_members tm
        JOIN teams t ON t.id = tm.team_id
        JOIN user_workspace_roles uwr
          ON uwr.user_id = tm.user_id
         AND uwr.workspace_id = t.workspace_id
        WHERE uwr.role_id <> t.role_id
      `),
      pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM permissions) AS permissions,
          (SELECT COUNT(*)::int FROM roles) AS roles,
          (SELECT COUNT(*)::int FROM role_permissions) AS grants
      `),
      pool.query(`
        SELECT key, value
        FROM system_settings
        WHERE key = ANY($1)
      `, [['stripe_secret_key', 'stripe_webhook_secret']]),
    ]);

    const settingMap = Object.fromEntries(stripeSettings.rows.map((row) => [row.key, row.value]));
    const fingerprint = (value) => value
      ? createHash('sha256').update(value).digest('hex')
      : null;

    console.log(JSON.stringify({
      billingRows: billing.rows,
      stripeSubscriptions: {
        total: subscriptions.data.length,
        byStatus: subscriptions.data.reduce((result, subscription) => {
          result[subscription.status] = (result[subscription.status] || 0) + 1;
          return result;
        }, {}),
        withWorkspaceMetadata: subscriptions.data.filter((subscription) => subscription.metadata?.workspaceId).length,
      },
      teamRoleMismatches: roleMismatches.rows[0]?.mismatches || 0,
      permissionCoverage: permissionCoverage.rows[0],
      stripeSettings: {
        databaseSecretPresent: Boolean(settingMap.stripe_secret_key),
        databaseSecretMatchesEnv:
          !settingMap.stripe_secret_key ||
          fingerprint(settingMap.stripe_secret_key) === fingerprint(process.env.STRIPE_SECRET_KEY),
        databaseWebhookSecretPresent: Boolean(settingMap.stripe_webhook_secret),
        databaseWebhookSecretMatchesEnv:
          !settingMap.stripe_webhook_secret ||
          fingerprint(settingMap.stripe_webhook_secret) === fingerprint(process.env.STRIPE_WEBHOOK_SECRET),
      },
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

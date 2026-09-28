// Script à exécuter UNE FOIS pour créer le produit et les 3 offres
// d'abonnement dans votre compte PayPal (sandbox ou live selon PAYPAL_ENV).
// Usage : npm run setup-paypal-plans
require('dotenv').config();
const fetch = require('node-fetch');

const PAYPAL_BASE = process.env.PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

async function getToken() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  return data.access_token;
}

async function createProduct(token) {
  const res = await fetch(`${PAYPAL_BASE}/v1/catalogs/products`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Clipflip', type: 'SERVICE', category: 'SOFTWARE' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.id;
}

async function createPlan(token, productId, name, price) {
  const res = await fetch(`${PAYPAL_BASE}/v1/billing/plans`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product_id: productId,
      name,
      billing_cycles: [{
        frequency: { interval_unit: 'MONTH', interval_count: 1 },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0, // 0 = renouvellement indéfini
        pricing_scheme: { fixed_price: { value: price, currency_code: 'EUR' } },
      }],
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 2,
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.id;
}

(async () => {
  const token = await getToken();
  const productId = await createProduct(token);
  const starter = await createPlan(token, productId, 'Clipflip Starter', '4.99');
  const creator = await createPlan(token, productId, 'Clipflip Creator', '14.99');
  const studio = await createPlan(token, productId, 'Clipflip Studio', '39.99');

  console.log('\nOffres créées avec succès. Copiez ces valeurs dans votre .env :\n');
  console.log(`PAYPAL_PLAN_STARTER=${starter}`);
  console.log(`PAYPAL_PLAN_CREATOR=${creator}`);
  console.log(`PAYPAL_PLAN_STUDIO=${studio}`);
})();

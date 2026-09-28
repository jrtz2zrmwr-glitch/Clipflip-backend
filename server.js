require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '15mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Très simple stockage fichier pour la démo — remplacez par une vraie base
// de données (Postgres, MongoDB...) avant d'aller en production.
const DB_PATH = path.join(__dirname, 'db.json');
function readDb() {
  if (!fs.existsSync(DB_PATH)) return { subscriptions: {}, jobs: {} };
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// =====================================================================
// GÉNÉRATION VIDÉO — Replicate
// =====================================================================

async function createReplicatePrediction(imageBase64) {
  const res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: process.env.REPLICATE_MODEL_VERSION.split(':')[1] || process.env.REPLICATE_MODEL_VERSION,
      input: { input_image: imageBase64 },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Erreur Replicate');
  return data; // contient { id, status, urls: { get } , ... }
}

async function getReplicatePrediction(id) {
  const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
    headers: { 'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}` },
  });
  return res.json();
}

// Démarre une génération. Le front envoie l'image en multipart.
app.post('/api/generate', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Photo manquante' });
    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const prediction = await createReplicatePrediction(base64);
    const db = readDb();
    db.jobs[prediction.id] = { status: prediction.status, createdAt: Date.now() };
    writeDb(db);
    res.json({ jobId: prediction.id, status: prediction.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Le front interroge cette route toutes les 2-3s jusqu'à "succeeded".
app.get('/api/generate/:id', async (req, res) => {
  try {
    const prediction = await getReplicatePrediction(req.params.id);
    res.json({
      status: prediction.status, // starting | processing | succeeded | failed
      output: prediction.output || null, // URL de la vidéo générée si succeeded
      error: prediction.error || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================================
// PAYPAL — abonnements réels
// =====================================================================

const PAYPAL_BASE = process.env.PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

async function getPayPalAccessToken() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Impossible d\'obtenir un token PayPal');
  return data.access_token;
}

// Donne au front-end le Client ID (public, sans risque) et les plan IDs
// pour afficher les vrais boutons d'abonnement PayPal.
app.get('/api/paypal/config', (req, res) => {
  res.json({
    clientId: process.env.PAYPAL_CLIENT_ID,
    plans: {
      starter: process.env.PAYPAL_PLAN_STARTER,
      creator: process.env.PAYPAL_PLAN_CREATOR,
      studio: process.env.PAYPAL_PLAN_STUDIO,
    },
  });
});

// Vérifie la signature du webhook PayPal (obligatoire en production pour
// être sûr que l'appel vient bien de PayPal et pas d'un tiers).
async function verifyWebhookSignature(headers, body) {
  const token = await getPayPalAccessToken();
  const res = await fetch(`${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: process.env.PAYPAL_WEBHOOK_ID,
      webhook_event: body,
    }),
  });
  const data = await res.json();
  return data.verification_status === 'SUCCESS';
}

// PayPal appelle cette route à chaque événement (activation, paiement,
// annulation...). Configurez cette URL dans votre dashboard PayPal :
// Apps & Credentials > votre app > Add Webhook > https://votre-domaine/api/paypal/webhook
app.post('/api/paypal/webhook', express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }), async (req, res) => {
  try {
    const valid = await verifyWebhookSignature(req.headers, req.body);
    if (!valid) return res.status(400).send('Signature invalide');

    const event = req.body;
    const db = readDb();

    switch (event.event_type) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        const subId = event.resource.id;
        db.subscriptions[subId] = { status: 'active', planId: event.resource.plan_id, updatedAt: Date.now() };
        break;
      }
      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.SUSPENDED': {
        const subId = event.resource.id;
        if (db.subscriptions[subId]) db.subscriptions[subId].status = 'inactive';
        break;
      }
      case 'PAYMENT.SALE.COMPLETED': {
        // paiement récurrent encaissé avec succès — utile pour vos logs/compta
        console.log('Paiement reçu :', event.resource.amount);
        break;
      }
      default:
        console.log('Événement PayPal non traité :', event.event_type);
    }

    writeDb(db);
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// Le front appelle ceci juste après qu'un visiteur ait approuvé l'abonnement
// côté PayPal, pour enregistrer côté serveur quel utilisateur a quel abonnement.
app.post('/api/paypal/confirm', async (req, res) => {
  const { subscriptionId, userId } = req.body;
  if (!subscriptionId || !userId) return res.status(400).json({ error: 'Champs manquants' });
  const db = readDb();
  db.subscriptions[subscriptionId] = { ...(db.subscriptions[subscriptionId] || {}), userId };
  writeDb(db);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur Clipflip lancé sur le port ${PORT}`));

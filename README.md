# Clipflip — backend + front-end de production

Ce dossier contient une application **réelle** (pas une démo) : génération vidéo
par IA via [Replicate](https://replicate.com) et abonnements payants réels via
PayPal. Contrairement à la version publiée sur claude.ai (qui ne peut pas
appeler d'API externes pour des raisons de sécurité de la plateforme), ceci
doit être déployé sur votre propre hébergement pour fonctionner.

## 1. Prérequis

- Node.js 18 ou plus
- Un compte [Replicate](https://replicate.com) (carte bancaire requise, facturé à l'usage)
- Un compte [PayPal Developer](https://developer.paypal.com) (business)

## 2. Installation locale

```bash
cd backend
npm install
cp .env.example .env
```

Ouvrez `.env` et remplissez :
- `REPLICATE_API_TOKEN` — depuis https://replicate.com/account/api-tokens
- `REPLICATE_MODEL_VERSION` — choisissez un modèle "image to video" à jour sur
  https://replicate.com/explore (les modèles évoluent souvent, vérifiez que
  celui par défaut dans `.env.example` existe encore)
- `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` — depuis
  https://developer.paypal.com/dashboard/applications (commencez en `sandbox`)

## 3. Créer les offres d'abonnement PayPal

```bash
npm run setup-paypal-plans
```

Copiez les 3 identifiants affichés dans votre `.env`
(`PAYPAL_PLAN_STARTER`, `PAYPAL_PLAN_CREATOR`, `PAYPAL_PLAN_STUDIO`).

## 4. Lancer en local

```bash
npm start
```

Ouvrez http://localhost:3000 — l'app tourne avec de vraies générations IA
(facturées sur votre compte Replicate) et de vrais boutons PayPal (en mode
sandbox tant que `PAYPAL_ENV=sandbox`).

## 5. Déployer en ligne

Le plus simple pour démarrer : [Render](https://render.com) ou
[Railway](https://railway.app) (gratuit pour commencer, cartes bancaires
prises en charge nativement).

1. Poussez ce dossier sur un dépôt GitHub.
2. Sur Render : "New Web Service" → connectez le dépôt → build command
   `npm install`, start command `npm start`.
3. Ajoutez toutes les variables de `.env` dans les "Environment Variables" de
   Render (jamais dans le code ni sur GitHub).
4. Une fois déployé, notez l'URL publique (ex. `https://clipflip.onrender.com`).

## 6. Activer les webhooks PayPal (obligatoire)

Sans ça, les abonnements ne seront jamais marqués comme actifs/annulés côté
serveur.

1. Dashboard PayPal → votre app → "Add Webhook".
2. URL : `https://votre-domaine/api/paypal/webhook`
3. Cochez au minimum : `BILLING.SUBSCRIPTION.ACTIVATED`,
   `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`,
   `PAYMENT.SALE.COMPLETED`.
4. Copiez le "Webhook ID" affiché dans `PAYPAL_WEBHOOK_ID` de votre `.env`.

## 7. Passer en production réelle

- Changez `PAYPAL_ENV=live` et remplacez les identifiants sandbox par vos
  identifiants "Live" PayPal.
- Recréez les plans en live (`npm run setup-paypal-plans`).
- Remplacez le stockage `db.json` par une vraie base de données
  (Postgres/MongoDB) — un fichier JSON ne tient pas la charge en production
  et n'est pas fiable en cas de redémarrage du serveur.
- Ajoutez une vraie authentification utilisateur (actuellement, l'app utilise
  un identifiant anonyme stocké dans le navigateur — suffisant pour tester,
  pas pour gérer de vrais comptes clients).
- Vérifiez la conformité RGPD : les photos envoyées par vos utilisateurs sont
  des données personnelles ; ajoutez une politique de confidentialité et un
  mécanisme de suppression des données.

## Limites connues à surveiller

- Le coût Replicate est facturé par génération : à 30 000 € de ventes en 24h,
  surveillez votre budget d'usage pour éviter une facture surprise si le
  volume de générations explose.
- Le modèle IA par défaut dans `.env.example` peut avoir changé de version
  d'ici que vous lisiez ceci — vérifiez toujours sur Replicate avant de
  déployer.

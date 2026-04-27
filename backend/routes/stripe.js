const express = require('express');
const router = express.Router();
const db = require('../db');

function getStripe() {
  const key = db.prepare('SELECT value FROM dev_config WHERE key=?').get('stripe_secret_key');
  if (!key || !key.value) throw new Error('Clé Stripe non configurée. Rendez-vous dans le panel dev.');
  const Stripe = require('stripe');
  return Stripe(key.value);
}

// POST /stripe/checkout — créer session paiement
router.post('/checkout', async (req, res) => {
  try {
    const stripe = getStripe();
    const {
      items, customer_email, customer_name,
      delivery_type, delivery_address,
      customer_phone, notes, user_id
    } = req.body;

    const config = {};
    db.prepare('SELECT key, value FROM site_config').all().forEach(r => { config[r.key] = r.value; });

    const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const shippingCost = parseFloat(config.shipping_price) || 9.90;
    const freeThreshold = parseFloat(config.shipping_free_threshold) || 200;
    const finalShipping = (delivery_type === 'livraison' && subtotal < freeThreshold) ? shippingCost : 0;

    const lineItems = items.map(item => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: item.name,
          description: item.size ? `Taille : ${item.size}` : undefined,
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.quantity,
    }));

    if (finalShipping > 0) {
      lineItems.push({
        price_data: {
          currency: 'eur',
          product_data: { name: 'Frais de livraison' },
          unit_amount: Math.round(finalShipping * 100),
        },
        quantity: 1,
      });
    }

    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      customer_email,
      success_url: `${FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/?cancelled=1`,
      metadata: {
        customer_name,
        customer_phone: customer_phone || '',
        delivery_type,
        delivery_address: delivery_address || '',
        notes: notes || '',
        user_id: user_id ? String(user_id) : '',
        subtotal: subtotal.toString(),
        shipping: finalShipping.toString(),
        items: JSON.stringify(items),
      },
    });

    res.json({ url: session.url, session_id: session.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /stripe/session/:id — page succès
router.get('/session/:id', async (req, res) => {
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(req.params.id);
    res.json({ status: session.payment_status, email: session.customer_email });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/stripe/webhook — appelé par Stripe après paiement
// ⚠️ Ce handler reçoit le body RAW (configuré dans server.js AVANT express.json)
async function webhook(req, res) {
  try {
    const stripe = getStripe();
    const webhookSecret = db.prepare('SELECT value FROM dev_config WHERE key=?').get('stripe_webhook_secret');

    let event;
    if (webhookSecret?.value) {
      const sig = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret.value);
    } else {
      // Mode test sans vérification de signature
      event = JSON.parse(req.body.toString());
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const meta = session.metadata;

      // Appel interne à la route orders
      const ordersRouter = require('./orders');

      // Simuler req/res pour appel interne
      const fakeReq = {
        body: {
          customer_email: session.customer_email,
          customer_name: meta.customer_name,
          customer_phone: meta.customer_phone,
          delivery_type: meta.delivery_type,
          delivery_address: meta.delivery_address,
          items: JSON.parse(meta.items),
          subtotal: parseFloat(meta.subtotal),
          shipping: parseFloat(meta.shipping),
          total: session.amount_total / 100,
          notes: meta.notes,
          user_id: meta.user_id || null,
          stripe_session_id: session.id,
        }
      };

      // Utiliser directement la logique de création de commande
      const QRCode = require('qrcode');
      const { sendOrderConfirmation } = require('./mail');

      const { body } = fakeReq;
      const orderNumber = `MSN-${new Date().getFullYear().toString().slice(-2)}${String(new Date().getMonth()+1).padStart(2,'0')}${String(new Date().getDate()).padStart(2,'0')}-${Math.random().toString(36).substring(2,6).toUpperCase()}`;

      // Éviter doublon
      const existing = db.prepare('SELECT id FROM orders WHERE stripe_session_id=?').get(body.stripe_session_id);
      if (!existing) {
        const qrData = JSON.stringify({ order_number: orderNumber, type: 'maison_pickup' });
        const qr_code = await QRCode.toDataURL(qrData, { width: 300, margin: 2, color: { dark: '#0a0a0a', light: '#ffffff' } });

        const result = db.prepare(`
          INSERT INTO orders (
            order_number, user_id, customer_email, customer_name, customer_phone,
            delivery_type, delivery_address, items, subtotal, shipping, total,
            status, stripe_session_id, notes, qr_code, paid_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(
          orderNumber, body.user_id || null, body.customer_email, body.customer_name, body.customer_phone || '',
          body.delivery_type, body.delivery_address || '',
          JSON.stringify(body.items), body.subtotal, body.shipping, body.total,
          body.stripe_session_id, body.notes || '', qr_code
        );

        const order = db.prepare('SELECT * FROM orders WHERE id=?').get(result.lastInsertRowid);
        try {
          await sendOrderConfirmation({ ...order, items: body.items });
        } catch (mailErr) {
          console.error('Mail error:', mailErr.message);
        }
      }
    }

    res.json({ received: true });
  } catch (e) {
    console.error('Webhook error:', e.message);
    res.status(400).json({ error: e.message });
  }
}

module.exports = { router, webhook };

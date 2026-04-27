const express = require('express');
const router = express.Router();
const db = require('../db');
const { auth, requireRole } = require('./auth');
const QRCode = require('qrcode');
const { sendOrderConfirmation } = require('./mail');

// Générer un numéro de commande unique
function generateOrderNumber() {
  const date = new Date();
  const yy = date.getFullYear().toString().slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `MSN-${yy}${mm}${dd}-${rand}`;
}

// POST /orders — créer une commande (appelé par le webhook Stripe)
router.post('/', async (req, res) => {
  try {
    const {
      customer_email, customer_name, customer_phone,
      delivery_type, delivery_address,
      items, subtotal, shipping, total, notes,
      user_id, stripe_session_id,
    } = req.body;

    // Vérifier si la commande existe déjà (idempotence webhook)
    if (stripe_session_id) {
      const existing = db.prepare('SELECT id FROM orders WHERE stripe_session_id=?').get(stripe_session_id);
      if (existing) return res.json({ id: existing.id, already_exists: true });
    }

    const order_number = generateOrderNumber();

    // Générer QR code (contient l'order_number pour scan)
    const qrData = JSON.stringify({ order_number, type: 'maison_pickup' });
    const qr_code = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 2,
      color: { dark: '#0a0a0a', light: '#ffffff' },
    });

    const stmt = db.prepare(`
      INSERT INTO orders (
        order_number, user_id, customer_email, customer_name, customer_phone,
        delivery_type, delivery_address, items, subtotal, shipping, total,
        status, stripe_session_id, notes, qr_code, paid_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const result = stmt.run(
      order_number, user_id || null, customer_email, customer_name, customer_phone || '',
      delivery_type, delivery_address || '',
      JSON.stringify(items), subtotal, shipping, total,
      stripe_session_id || null, notes || '', qr_code
    );

    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(result.lastInsertRowid);

    // Envoyer mail de confirmation
    try {
      await sendOrderConfirmation({ ...order, items });
    } catch (mailErr) {
      console.error('Mail error (non bloquant):', mailErr.message);
    }

    res.json({ id: result.lastInsertRowid, order_number });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /orders — toutes les commandes (vendeur+)
router.get('/', auth, requireRole('vendeur'), (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  res.json(orders);
});

// GET /orders/pickups/history — historique des retraits (vendeur+)
router.get('/pickups/history', auth, requireRole('vendeur'), (req, res) => {
  const pickups = db.prepare(`
    SELECT p.*, o.items, o.total, o.customer_email
    FROM pickups p
    JOIN orders o ON o.id = p.order_id
    ORDER BY p.completed_at DESC
  `).all();
  res.json(pickups);
});

// GET /orders/scan/:order_number — scan QR code (vendeur+)
router.get('/scan/:order_number', auth, requireRole('vendeur'), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_number=?').get(req.params.order_number);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });

  // Vérifier si déjà retirée
  const pickup = db.prepare('SELECT * FROM pickups WHERE order_id=?').get(order.id);

  res.json({
    ...order,
    items: typeof order.items === 'string' ? JSON.parse(order.items) : order.items,
    already_picked_up: !!pickup,
    pickup_info: pickup || null,
  });
});

// GET /orders/by-session/:session_id — page succès Stripe
router.get('/by-session/:session_id', (req, res) => {
  const order = db.prepare('SELECT order_number, customer_name, total, delivery_type FROM orders WHERE stripe_session_id=?').get(req.params.session_id);
  if (!order) return res.status(404).json({ error: 'Commande non trouvée' });
  res.json(order);
});

// GET /orders/:id — détail commande (vendeur+)
router.get('/:id', auth, requireRole('vendeur'), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  res.json({ ...order, items: JSON.parse(order.items) });
});

// PUT /orders/:id/status — changer le statut (vendeur+)
router.put('/:id/status', auth, requireRole('vendeur'), (req, res) => {
  const { status } = req.body;
  const allowed = ['pending', 'paid', 'ready', 'completed', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ success: true });
});

// POST /orders/:id/pickup — confirmer remise colis + signature (vendeur+)
router.post('/:id/pickup', auth, requireRole('vendeur'), (req, res) => {
  const { signature } = req.body;
  if (!signature) return res.status(400).json({ error: 'Signature requise' });

  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  if (order.delivery_type !== 'retrait') return res.status(400).json({ error: 'Cette commande est en livraison, pas en retrait' });

  // Vérifier si pas déjà retiré
  const existing = db.prepare('SELECT id FROM pickups WHERE order_id=?').get(order.id);
  if (existing) return res.status(409).json({ error: 'Cette commande a déjà été remise' });

  const vendeur_name = `${req.user.name || req.user.email}`;

  // Enregistrer le retrait
  db.prepare(`
    INSERT INTO pickups (order_id, order_number, vendeur_id, vendeur_name, customer_name, signature)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(order.id, order.order_number, req.user.id, vendeur_name, order.customer_name, signature);

  // Mettre à jour statut commande
  db.prepare("UPDATE orders SET status='completed' WHERE id=?").run(order.id);

  res.json({ success: true, message: 'Remise enregistrée avec succès' });
});

module.exports = router;

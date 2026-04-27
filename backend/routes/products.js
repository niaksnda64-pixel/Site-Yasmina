const express = require('express');
const router = express.Router();
const db = require('../db');
const { auth, requireRole } = require('./auth');

// ─── PRODUITS ───────────────────────────────────────────────

// GET /products — liste publique (actifs)
router.get('/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE active=1 ORDER BY created_at DESC').all();
  res.json(products.map(p => ({
    ...p,
    sizes: typeof p.sizes === 'string' ? JSON.parse(p.sizes) : p.sizes,
    is_new: !!p.is_new,
    is_promo: !!p.is_promo,
    in_collection: !!p.in_collection,
  })));
});

// GET /products/all — tous les produits (admin)
router.get('/products/all', auth, requireRole('admin'), (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  res.json(products.map(p => ({
    ...p,
    sizes: typeof p.sizes === 'string' ? JSON.parse(p.sizes) : p.sizes,
  })));
});

// POST /products — créer produit (admin+)
router.post('/products', auth, requireRole('admin'), (req, res) => {
  try {
    const { name, category, price, old_price, description, materials, sizes, image, is_new, is_promo, in_collection } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'Nom et prix requis' });

    const result = db.prepare(`
      INSERT INTO products (name, category, price, old_price, description, materials, sizes, image, is_new, is_promo, in_collection)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, category || '', price, old_price || null, description || '', materials || '',
      JSON.stringify(sizes || []), image || '',
      is_new ? 1 : 0, is_promo ? 1 : 0, in_collection !== false ? 1 : 0
    );

    const product = db.prepare('SELECT * FROM products WHERE id=?').get(result.lastInsertRowid);
    res.json({ ...product, sizes: JSON.parse(product.sizes) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /products/:id — modifier produit (admin+)
router.put('/products/:id', auth, requireRole('admin'), (req, res) => {
  try {
    const { name, category, price, old_price, description, materials, sizes, image, is_new, is_promo, in_collection, active } = req.body;
    db.prepare(`
      UPDATE products SET
        name=?, category=?, price=?, old_price=?, description=?, materials=?,
        sizes=?, image=?, is_new=?, is_promo=?, in_collection=?, active=?
      WHERE id=?
    `).run(
      name, category || '', price, old_price || null, description || '', materials || '',
      JSON.stringify(sizes || []), image || '',
      is_new ? 1 : 0, is_promo ? 1 : 0, in_collection !== false ? 1 : 0,
      active !== false ? 1 : 0,
      req.params.id
    );
    const product = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
    res.json({ ...product, sizes: JSON.parse(product.sizes) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /products/:id — supprimer (désactiver) produit (admin+)
router.delete('/products/:id', auth, requireRole('admin'), (req, res) => {
  db.prepare('UPDATE products SET active=0 WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ─── CONFIG SITE ────────────────────────────────────────────

// GET /config — config publique
router.get('/config', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM site_config').all();
  const config = {};
  rows.forEach(r => { config[r.key] = r.value; });
  res.json(config);
});

// PUT /config — modifier config site (admin+)
router.put('/config', auth, requireRole('admin'), (req, res) => {
  try {
    const update = db.prepare('INSERT OR REPLACE INTO site_config (key, value) VALUES (?, ?)');
    const updateMany = db.transaction((data) => {
      for (const [key, value] of Object.entries(data)) {
        update.run(key, String(value));
      }
    });
    updateMany(req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CONFIG DEV ─────────────────────────────────────────────

// GET /config/dev — config dev (super_admin)
router.get('/config/dev', auth, requireRole('super_admin'), (req, res) => {
  const rows = db.prepare('SELECT key, value FROM dev_config').all();
  const config = {};
  rows.forEach(r => {
    // Masquer partiellement les clés sensibles
    if (r.key.includes('key') || r.key.includes('password') || r.key.includes('secret')) {
      config[r.key] = r.value ? r.value.slice(0, 8) + '••••••••' : '';
      config[r.key + '_set'] = !!r.value;
    } else {
      config[r.key] = r.value;
    }
  });
  res.json(config);
});

// PUT /config/dev — modifier config dev (super_admin)
router.put('/config/dev', auth, requireRole('super_admin'), (req, res) => {
  try {
    const update = db.prepare('INSERT OR REPLACE INTO dev_config (key, value) VALUES (?, ?)');
    const updateMany = db.transaction((data) => {
      for (const [key, value] of Object.entries(data)) {
        if (value && !String(value).includes('••••')) { // Ne pas écraser si masqué
          update.run(key, String(value));
        }
      }
    });
    updateMany(req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

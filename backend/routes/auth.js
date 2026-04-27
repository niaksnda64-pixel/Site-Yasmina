const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'maison_dev_secret_change_me';
const ROLES_LEVEL = { client: 1, vendeur: 2, admin: 3, super_admin: 4 };

// ─── MIDDLEWARES ────────────────────────────────────────────

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Token manquant' });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    const userLevel = ROLES_LEVEL[req.user.role] || 0;
    const required = ROLES_LEVEL[minRole] || 0;
    if (userLevel < required) return res.status(403).json({ error: 'Accès refusé — rôle insuffisant' });
    next();
  };
}

function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: `${user.first_name} ${user.last_name}`.trim() },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// ─── ROUTES ────────────────────────────────────────────────

// POST /auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, first_name = '', last_name = '' } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    if (password.length < 8) return res.status(400).json({ error: 'Mot de passe trop court (8 caractères minimum)' });

    const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Un compte existe déjà avec cet email' });

    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare(
      'INSERT INTO users (email, password, first_name, last_name) VALUES (?, ?, ?, ?)'
    ).run(email.toLowerCase(), hash, first_name, last_name);

    const user = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
    res.json({ token: makeToken(user), user: safeUser(user) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    res.json({ token: makeToken(user), user: safeUser(user) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /auth/me
router.get('/me', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json(safeUser(user));
});

// PUT /auth/me — modifier profil
router.put('/me', auth, async (req, res) => {
  try {
    const { first_name, last_name, phone, password } = req.body;
    const updates = [];
    const vals = [];

    if (first_name !== undefined) { updates.push('first_name=?'); vals.push(first_name); }
    if (last_name !== undefined) { updates.push('last_name=?'); vals.push(last_name); }
    if (phone !== undefined) { updates.push('phone=?'); vals.push(phone); }
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'Mot de passe trop court' });
      updates.push('password=?'); vals.push(await bcrypt.hash(password, 12));
    }

    if (!updates.length) return res.status(400).json({ error: 'Rien à mettre à jour' });
    vals.push(req.user.id);
    db.prepare(`UPDATE users SET ${updates.join(',')} WHERE id=?`).run(...vals);

    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    res.json(safeUser(user));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /auth/users — liste staff (admin+)
router.get('/users', auth, requireRole('admin'), (req, res) => {
  const users = db.prepare("SELECT id, email, first_name, last_name, phone, role, created_at FROM users ORDER BY created_at DESC").all();
  res.json(users);
});

// PUT /auth/users/:id/role — changer rôle (super_admin)
router.put('/users/:id/role', auth, requireRole('super_admin'), (req, res) => {
  const { role } = req.body;
  if (!ROLES_LEVEL[role]) return res.status(400).json({ error: 'Rôle invalide' });
  if (req.params.id == req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas changer votre propre rôle' });
  db.prepare('UPDATE users SET role=? WHERE id=?').run(role, req.params.id);
  res.json({ success: true });
});

function safeUser(u) {
  const { password, ...safe } = u;
  return safe;
}

module.exports = { router, auth, requireRole };

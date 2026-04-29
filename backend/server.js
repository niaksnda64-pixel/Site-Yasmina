require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 4000;

// ─── CORS ───
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl, Postman, même serveur
    const allowed = [
      'http://localhost:3000',
      'http://localhost:5500',
      'http://127.0.0.1:5500',
      'https://zayboutique.netlify.app',
      'https://mazavp.netlify.app',
      process.env.FRONTEND_URL,
    ].filter(Boolean);
    if (allowed.some(o => origin.startsWith(o)) || origin.endsWith('.netlify.app')) {
      return cb(null, true);
    }
    cb(new Error('CORS non autorisé : ' + origin));
  },
  credentials: true,
}));

// ─── WEBHOOK STRIPE (doit être AVANT express.json()) ───
// Le webhook Stripe a besoin du body brut (raw), pas parsé
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), require('./routes/stripe').webhook);

// ─── BODY PARSERS ───
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── ROUTES ───
const { router: authRouter } = require('./routes/auth');
app.use('/api/auth', authRouter);
app.use('/api/orders', require('./routes/orders'));
app.use('/api/stripe', require('./routes/stripe').router);
app.use('/api', require('./routes/products'));

// ─── ROUTES SUPPLÉMENTAIRES (raccourcis) ───
// Config publique accessible sans auth (utilisé par le frontend boutique)
app.get('/api/config', (req, res) => {
  const db = require('./db');
  const rows = db.prepare('SELECT key, value FROM site_config').all();
  const config = {};
  rows.forEach(r => { config[r.key] = r.value; });
  res.json(config);
});

// Historique mails
app.get('/api/mail/log', require('./routes/auth').auth, (req, res) => {
  const db = require('./db');
  const logs = db.prepare('SELECT * FROM email_log ORDER BY sent_at DESC LIMIT 100').all();
  res.json(logs);
});

// Envoyer mail custom
app.post('/api/mail/send', require('./routes/auth').auth, async (req, res) => {
  try {
    const { to, subject, message } = req.body;
    const { sendCustomEmail } = require('./routes/mail');
    await sendCustomEmail(to, subject, message, req.user.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Liste clients
app.get('/api/users/clients', require('./routes/auth').auth, (req, res) => {
  const db = require('./db');
  const clients = db.prepare("SELECT id, email, first_name, last_name, phone, created_at FROM users WHERE role='client' ORDER BY created_at DESC").all();
  res.json(clients);
});

// ─── HEALTH CHECK ───
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ─── 404 ───
app.use((req, res) => res.status(404).json({ error: `Route non trouvée : ${req.method} ${req.path}` }));

// ─── ERREURS GLOBALES ───
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

// ─── DÉMARRAGE ───
async function initAdmin() {
  const db = require('./db');
  const bcrypt = require('bcryptjs');
  const existing = db.prepare("SELECT id FROM users WHERE role='super_admin'").get();
  if (!existing) {
    const email = process.env.ADMIN_EMAIL || 'admin@maison.fr';
    const password = process.env.ADMIN_PASSWORD || 'Maison2024!';
    const hash = await bcrypt.hash(password, 12);
    db.prepare("INSERT OR IGNORE INTO users (email, password, first_name, last_name, role) VALUES (?, ?, 'Admin', 'Principal', 'super_admin')").run(email, hash);
    console.log(`✓ Super admin créé : ${email} / ${password}`);
    console.log('⚠️  Changez ce mot de passe immédiatement via le panel !');
  }
}

app.listen(PORT, async () => {
  await initAdmin();
  console.log(`✓ Serveur MAISON démarré → http://localhost:${PORT}`);
  console.log(`  Frontend URL attendu : ${process.env.FRONTEND_URL || '(non défini)'}`);
});

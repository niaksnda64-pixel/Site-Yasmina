const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'maison.db');
const db = new Database(DB_PATH);

// Performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── TABLES ────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT UNIQUE NOT NULL,
    password     TEXT NOT NULL,
    first_name   TEXT DEFAULT '',
    last_name    TEXT DEFAULT '',
    phone        TEXT DEFAULT '',
    role         TEXT DEFAULT 'client' CHECK(role IN ('client','vendeur','admin','super_admin')),
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    category     TEXT DEFAULT '',
    price        REAL NOT NULL,
    old_price    REAL,
    description  TEXT DEFAULT '',
    materials    TEXT DEFAULT '',
    sizes        TEXT DEFAULT '[]',
    image        TEXT DEFAULT '',
    is_new       INTEGER DEFAULT 0,
    is_promo     INTEGER DEFAULT 0,
    in_collection INTEGER DEFAULT 1,
    active       INTEGER DEFAULT 1,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number      TEXT UNIQUE NOT NULL,
    user_id           INTEGER REFERENCES users(id),
    customer_email    TEXT NOT NULL,
    customer_name     TEXT NOT NULL,
    customer_phone    TEXT DEFAULT '',
    delivery_type     TEXT DEFAULT 'livraison',
    delivery_address  TEXT DEFAULT '',
    items             TEXT NOT NULL,
    subtotal          REAL DEFAULT 0,
    shipping          REAL DEFAULT 0,
    total             REAL DEFAULT 0,
    status            TEXT DEFAULT 'pending' CHECK(status IN ('pending','paid','ready','completed','cancelled')),
    stripe_session_id TEXT UNIQUE,
    notes             TEXT DEFAULT '',
    qr_code           TEXT DEFAULT '',
    paid_at           TEXT,
    created_at        TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pickups (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id      INTEGER NOT NULL REFERENCES orders(id),
    order_number  TEXT NOT NULL,
    vendeur_id    INTEGER REFERENCES users(id),
    vendeur_name  TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    signature     TEXT,
    completed_at  TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS site_config (
    key   TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS dev_config (
    key   TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS email_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email  TEXT NOT NULL,
    subject   TEXT NOT NULL,
    status    TEXT DEFAULT 'sent',
    sent_by   INTEGER REFERENCES users(id),
    sent_at   TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── CONFIG SITE PAR DÉFAUT ─────────────────────────────────
const defaultConfig = {
  site_name: 'MAISON',
  accent_color: '#c9a96e',
  primary_color: '#0a0a0a',
  bg_color: '#f8f6f2',
  hero_eyebrow: 'Nouvelle Collection',
  hero_title: "L'Art de *l'Élégance*",
  hero_subtitle: 'Des pièces pensées pour durer — confectionnées avec soin',
  hero_cta: 'Découvrir',
  promo_banner_active: '0',
  promo_banner_text: 'LIVRAISON OFFERTE DÈS 200€',
  shipping_price: '9.90',
  shipping_free_threshold: '200',
  boutique_address: '12 Rue de la Paix, 75001 Paris',
  boutique_hours: 'Lun–Sam 10h–19h',
  footer_tagline: "L'élégance dans chaque détail.",
};

const insertConfig = db.prepare('INSERT OR IGNORE INTO site_config (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultConfig)) {
  insertConfig.run(key, value);
}

// ─── CONFIG DEV PAR DÉFAUT ──────────────────────────────────
const defaultDev = {
  stripe_secret_key: '',
  stripe_public_key: '',
  stripe_webhook_secret: '',
  gmail_user: '',
  gmail_app_password: '',
};

const insertDev = db.prepare('INSERT OR IGNORE INTO dev_config (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultDev)) {
  insertDev.run(key, value);
}

module.exports = db;

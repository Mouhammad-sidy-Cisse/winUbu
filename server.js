require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { Pool } = require('pg');

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// --- Cloudinary config ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// --- PostgreSQL config ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Crée la table si elle n'existe pas
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      url TEXT NOT NULL,
      cloudinary_public_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      uploaded_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );
  `);
}

// --- Multer + Cloudinary storage ---
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'winUbu-uploads',
    resource_type: 'auto',
    public_id: (req, file) => crypto.randomBytes(8).toString('hex'),
  },
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 4
  }
}));

const loginAttempts = {};
function tooManyAttempts(ip) {
  const entry = loginAttempts[ip];
  if (!entry) return false;
  if (entry.count >= 5 && Date.now() - entry.lastAttempt < 10 * 60 * 1000) return true;
  return false;
}
function registerFailedAttempt(ip) {
  if (!loginAttempts[ip]) loginAttempts[ip] = { count: 0, lastAttempt: 0 };
  loginAttempts[ip].count++;
  loginAttempts[ip].lastAttempt = Date.now();
}
function resetAttempts(ip) {
  delete loginAttempts[ip];
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Non autorisé' });
}

app.use(express.static('public'));

// --- UPLOAD ---
app.post('/upload', upload.array('files'), async (req, res) => {
  const now = Date.now();
  const results = [];

  for (const f of req.files) {
    const id = f.filename; // public_id généré par CloudinaryStorage
    await pool.query(
      `INSERT INTO files (id, original_name, url, cloudinary_public_id, resource_type, uploaded_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, f.originalname, f.path, f.filename, f.resource_type || 'raw', now, now + EXPIRY_MS]
    );
    results.push({ id, name: f.originalname, url: f.path });
  }

  res.json({ files: results });
});

// --- LISTE DES FICHIERS (publique) ---
app.get('/files', async (req, res) => {
  const now = Date.now();
  const result = await pool.query(
    'SELECT id, original_name AS name, expires_at AS "expiresAt" FROM files WHERE expires_at > $1',
    [now]
  );
  res.json(result.rows);
});

// --- TELECHARGEMENT (redirige vers l'URL Cloudinary) ---
app.get('/download/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM files WHERE id = $1', [req.params.id]);
  const info = result.rows[0];
  if (!info) return res.status(404).send('Fichier introuvable ou expiré.');
  if (info.expires_at <= Date.now()) return res.status(404).send('Fichier expiré.');
  res.redirect(info.url);
});

// --- ROUTES ADMIN ---
app.post('/admin/login', async (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 10 minutes.' });
  }

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Identifiants manquants.' });
  }

  const validUser = username === process.env.ADMIN_USER;
  const validPass = validUser && await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);

  if (!validUser || !validPass) {
    registerFailedAttempt(ip);
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }

  resetAttempts(ip);
  req.session.isAdmin = true;
  res.json({ success: true });
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/admin/check', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

app.get('/admin/files', requireAdmin, async (req, res) => {
  const result = await pool.query(
    `SELECT id, original_name AS name, uploaded_at AS "uploadedAt", expires_at AS "expiresAt"
     FROM files ORDER BY uploaded_at DESC`
  );
  res.json(result.rows);
});

app.delete('/admin/files/:id', requireAdmin, async (req, res) => {
  const result = await pool.query('SELECT * FROM files WHERE id = $1', [req.params.id]);
  const info = result.rows[0];
  if (!info) return res.status(404).json({ error: 'Fichier introuvable.' });

  try {
    await cloudinary.uploader.destroy(info.cloudinary_public_id, {
      resource_type: info.resource_type || 'raw'
    });
  } catch (err) {
    console.error('Erreur suppression Cloudinary:', err);
  }

  await pool.query('DELETE FROM files WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// --- NETTOYAGE DES FICHIERS EXPIRÉS ---
async function cleanup() {
  const now = Date.now();
  const result = await pool.query('SELECT * FROM files WHERE expires_at <= $1', [now]);

  for (const info of result.rows) {
    try {
      await cloudinary.uploader.destroy(info.cloudinary_public_id, {
        resource_type: info.resource_type || 'raw'
      });
    } catch (err) {
      console.error('Erreur nettoyage Cloudinary:', err);
    }
  }

  if (result.rows.length > 0) {
    await pool.query('DELETE FROM files WHERE expires_at <= $1', [now]);
  }
}

// --- DÉMARRAGE ---
async function start() {
  await initDb();
  setInterval(cleanup, 60 * 60 * 1000);
  await cleanup();
  app.listen(PORT, () => console.log(`winUbu lancé sur http://localhost:${PORT}`));
}

start().catch(err => {
  console.error('Erreur au démarrage:', err);
  process.exit(1);
});
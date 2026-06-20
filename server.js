require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('express-session');

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(META_FILE)) fs.writeFileSync(META_FILE, '{}');

function loadMeta() {
  return JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
}
function saveMeta(meta) {
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const id = crypto.randomBytes(8).toString('hex');
    const safeName = file.originalname.replace(/\//g, '__');
    cb(null, `${id}___${safeName}`);
  }
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

app.post('/upload', upload.array('files'), (req, res) => {
  const meta = loadMeta();
  const now = Date.now();
  const results = req.files.map(f => {
    meta[f.filename] = {
      originalName: f.originalname,
      uploadedAt: now,
      expiresAt: now + EXPIRY_MS
    };
    return { id: f.filename, name: f.originalname };
  });
  saveMeta(meta);
  res.json({ files: results });
});

app.get('/files', (req, res) => {
  const meta = loadMeta();
  const now = Date.now();
  const list = Object.entries(meta)
    .filter(([id, info]) => info.expiresAt > now)
    .map(([id, info]) => ({ id, name: info.originalName, expiresAt: info.expiresAt }));
  res.json(list);
});

app.get('/download/:id', (req, res) => {
  const meta = loadMeta();
  const info = meta[req.params.id];
  if (!info) return res.status(404).send('Fichier introuvable ou expiré.');
  const filePath = path.join(UPLOAD_DIR, req.params.id);
  if (!fs.existsSync(filePath)) return res.status(404).send('Fichier introuvable.');
  res.download(filePath, info.originalName);
});

// --- ROUTES ADMIN ---
app.post('/admin/login', async (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 10 minutes.' });
  }

  const { username, password } = req.body;

  // --- DEBUG TEMPORAIRE : a retirer une fois le bug trouve ---
  console.log('--- TENTATIVE DE LOGIN ---');
  console.log('Username reçu:', JSON.stringify(username));
  console.log('ADMIN_USER attendu:', JSON.stringify(process.env.ADMIN_USER));
  console.log('Match username:', username === process.env.ADMIN_USER);
  console.log('Password reçu (longueur):', password ? password.length : 'vide');
  console.log('ADMIN_PASSWORD_HASH présent ?', !!process.env.ADMIN_PASSWORD_HASH);
  console.log('ADMIN_PASSWORD_HASH valeur:', process.env.ADMIN_PASSWORD_HASH);
  // --- FIN DEBUG ---

  if (!username || !password) {
    return res.status(400).json({ error: 'Identifiants manquants.' });
  }

  const validUser = username === process.env.ADMIN_USER;
  const validPass = validUser && await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);

  console.log('validUser:', validUser, '| validPass:', validPass);

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

app.get('/admin/files', requireAdmin, (req, res) => {
  const meta = loadMeta();
  const list = Object.entries(meta).map(([id, info]) => ({
    id,
    name: info.originalName,
    uploadedAt: info.uploadedAt,
    expiresAt: info.expiresAt
  }));
  res.json(list);
});

app.delete('/admin/files/:id', requireAdmin, (req, res) => {
  const meta = loadMeta();
  const info = meta[req.params.id];
  if (!info) return res.status(404).json({ error: 'Fichier introuvable.' });

  const filePath = path.join(UPLOAD_DIR, req.params.id);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  delete meta[req.params.id];
  saveMeta(meta);
  res.json({ success: true });
});

function cleanup() {
  const meta = loadMeta();
  const now = Date.now();
  let changed = false;
  for (const [id, info] of Object.entries(meta)) {
    if (info.expiresAt <= now) {
      const filePath = path.join(UPLOAD_DIR, id);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      delete meta[id];
      changed = true;
    }
  }
  if (changed) saveMeta(meta);
}
setInterval(cleanup, 60 * 60 * 1000);
cleanup();

app.listen(PORT, () => console.log(`winUbu lancé sur http://localhost:${PORT}`));
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 1 semaine

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
    // remplace les / du chemin relatif (dossier) par __ pour garder une trace
    const safeName = file.originalname.replace(/\//g, '__');
    cb(null, `${id}___${safeName}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

app.use(express.static('public'));
app.use(express.json());

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
    .map(([id, info]) => ({
      id,
      name: info.originalName,
      expiresAt: info.expiresAt
    }));
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
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const folderInput = document.getElementById('folderInput');
const browseBtn = document.getElementById('browseBtn');
const browseFolderBtn = document.getElementById('browseFolderBtn');
const statusEl = document.getElementById('status');
const fileList = document.getElementById('fileList');
const fileCount = document.getElementById('fileCount');
const modalOverlay = document.getElementById('modalOverlay');
const modalContent = document.getElementById('modalContent');
const modalClose = document.getElementById('modalClose');

let lastFiles = [];

browseBtn.addEventListener('click', () => fileInput.click());
browseFolderBtn.addEventListener('click', () => folderInput.click());

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) uploadFiles(fileInput.files);
});
folderInput.addEventListener('change', () => {
  if (folderInput.files.length) uploadFiles(folderInput.files);
});

['dragenter', 'dragover'].forEach(evt =>
  dropzone.addEventListener(evt, e => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach(evt =>
  dropzone.addEventListener(evt, e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  })
);
dropzone.addEventListener('drop', e => {
  const files = e.dataTransfer.files;
  if (files.length) uploadFiles(files);
});

async function uploadFiles(files) {
  const formData = new FormData();
  for (const f of files) {
    const relPath = f.webkitRelativePath || f.name;
    formData.append('files', f, relPath);
  }

  statusEl.textContent = `envoi de ${files.length} fichier(s)...`;
  try {
    const res = await fetch('/upload', { method: 'POST', body: formData });
    const data = await res.json();
    statusEl.textContent = `✓ ${data.files.length} fichier(s) envoyé(s)`;
    fileInput.value = '';
    folderInput.value = '';
    loadFiles();
  } catch (err) {
    statusEl.textContent = `✗ échec de l'envoi`;
  }
}

function formatExpiry(ts) {
  const diff = ts - Date.now();
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (diff <= 0) return 'expiré';
  return `expire dans ${days}j ${hours}h`;
}

async function loadFiles() {
  const res = await fetch('/files');
  const files = await res.json();
  lastFiles = files;

  fileCount.textContent = `${files.length} fichier${files.length !== 1 ? 's' : ''}`;

  if (files.length === 0) {
    fileList.innerHTML = '<p class="empty">Aucun fichier pour l\'instant.</p>';
    return;
  }

  fileList.innerHTML = files.map(f => `
    <div class="file-row">
      <span class="file-name">${f.name}</span>
      <div class="file-actions">
        <span class="file-meta">${formatExpiry(f.expiresAt)}</span>
        <button class="copy-btn" data-action="preview" data-id="${f.id}">Aperçu</button>
        <button class="copy-btn" data-action="qr" data-id="${f.id}">QR code</button>
        <button class="copy-btn" data-action="copy" data-id="${f.id}">Copier le lien</button>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('[data-action="copy"]').forEach(btn => {
    btn.addEventListener('click', () => copyLink(btn.dataset.id, btn));
  });
  document.querySelectorAll('[data-action="preview"]').forEach(btn => {
    btn.addEventListener('click', () => openPreview(btn.dataset.id));
  });
  document.querySelectorAll('[data-action="qr"]').forEach(btn => {
    btn.addEventListener('click', () => openQr(btn.dataset.id));
  });
}

function copyLink(id, btn) {
  const url = `${window.location.origin}/download/${id}`;
  navigator.clipboard.writeText(url).then(() => {
    const original = btn.textContent;
    btn.textContent = '✓ copié';
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
}

function findFile(id) {
  return lastFiles.find(f => f.id === id);
}

function openPreview(id) {
  const file = findFile(id);
  if (!file) return;

  const downloadUrl = `${window.location.origin}/download/${id}`;
  let previewHtml = '';

  if (file.mimetype.startsWith('image/')) {
    previewHtml = `<img src="${file.url}" alt="${file.name}">`;
  } else if (file.mimetype.startsWith('video/')) {
    previewHtml = `<video src="${file.url}" controls></video>`;
  } else if (file.mimetype === 'application/pdf') {
    previewHtml = `<iframe src="${file.url}"></iframe>`;
  } else {
    previewHtml = `<p class="modal-noPreview">Aperçu non disponible pour ce type de fichier.</p>`;
  }

  modalContent.innerHTML = `
    <p class="modal-filename">${file.name}</p>
    ${previewHtml}
    <div class="modal-actions">
      <a href="${downloadUrl}" class="btn">Télécharger</a>
      <button class="btn btn-ghost" id="modalCancel">Annuler</button>
    </div>
  `;
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  openModal();
}

function openQr(id) {
  const file = findFile(id);
  if (!file) return;

  const downloadUrl = `${window.location.origin}/download/${id}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(downloadUrl)}`;

  modalContent.innerHTML = `
    <p class="modal-filename">${file.name}</p>
    <img src="${qrUrl}" alt="QR code" class="qr-img">
    <p class="modal-noPreview">Scannez pour récupérer ce fichier sur un autre appareil.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">Fermer</button>
    </div>
  `;
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  openModal();
}

function openModal() {
  modalOverlay.classList.add('open');
}
function closeModal() {
  modalOverlay.classList.remove('open');
  modalContent.innerHTML = '';
}
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) closeModal();
});

loadFiles();
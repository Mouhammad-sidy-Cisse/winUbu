const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const folderInput = document.getElementById('folderInput');
const browseBtn = document.getElementById('browseBtn');
const browseFolderBtn = document.getElementById('browseFolderBtn');
const statusEl = document.getElementById('status');
const fileList = document.getElementById('fileList');
const fileCount = document.getElementById('fileCount');

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

  fileCount.textContent = `${files.length} fichier${files.length !== 1 ? 's' : ''}`;

  if (files.length === 0) {
    fileList.innerHTML = '<p class="empty">Aucun fichier pour l\'instant.</p>';
    return;
  }

  fileList.innerHTML = files.map(f => `
    <div class="file-row">
      <a href="/download/${f.id}">${f.name}</a>
      <span class="file-meta">${formatExpiry(f.expiresAt)}</span>
    </div>
  `).join('');
}

loadFiles();
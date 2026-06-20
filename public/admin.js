const loginView = document.getElementById('loginView');
const adminView = document.getElementById('adminView');
const loginError = document.getElementById('loginError');

async function checkSession() {
  const res = await fetch('/admin/check');
  const data = await res.json();
  if (data.isAdmin) {
    loginView.style.display = 'none';
    adminView.style.display = 'block';
    loadAdminFiles();
  } else {
    loginView.style.display = 'block';
    adminView.style.display = 'none';
  }
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const res = await fetch('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (data.success) {
    checkSession();
  } else {
    loginError.textContent = data.error || 'Erreur de connexion';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/admin/logout', { method: 'POST' });
  checkSession();
});

async function loadAdminFiles() {
  const res = await fetch('/admin/files');
  const files = await res.json();
  const list = document.getElementById('adminFileList');

  if (files.length === 0) {
    list.innerHTML = '<p>Aucun fichier.</p>';
    return;
  }

  list.innerHTML = files.map(f => `
    <div class="admin-row">
      <span>${f.name}</span>
      <button class="delete-btn" data-id="${f.id}">Supprimer</button>
    </div>
  `).join('');

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Supprimer ce fichier définitivement ?')) return;
      await fetch(`/admin/files/${btn.dataset.id}`, { method: 'DELETE' });
      loadAdminFiles();
    });
  });
}

checkSession();
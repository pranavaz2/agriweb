const $ = (selector) => document.querySelector(selector);
const state = { user: null, view: 'overview', registrations: [], contacts: [], selected: null };

const registrationStatusLabels = {
  enquiry_received: 'Enquiry received', contacted: 'Contacted', payment_pending: 'Payment pending',
  confirmed: 'Confirmed', enrolled: 'Enrolled', rejected: 'Rejected'
};
const contactStatusLabels = { new: 'New', in_progress: 'In progress', resolved: 'Resolved', spam: 'Spam' };

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function formatDate(value, includeTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', includeTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function showNotice(message, isError = false) {
  const notice = $('#notice');
  notice.textContent = message;
  notice.classList.toggle('error', isError);
  notice.hidden = false;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => { notice.hidden = true; }, 5500);
}

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json();
    if (!response.ok) {
      if (response.status === 401 && !url.endsWith('/login')) showLogin('Your admin session has expired. Please sign in again.');
      throw new Error(payload.error || 'The request could not be completed.');
    }
    return payload;
  }
  if (!response.ok) throw new Error('The request could not be completed.');
  return response;
}

function showLogin(message = '') {
  state.user = null;
  $('#dashboard-view').hidden = true;
  $('#login-view').hidden = false;
  $('#login-message').textContent = message;
  $('#login-message').classList.remove('success');
  $('#password').value = '';
}

function showDashboard(user) {
  state.user = user;
  $('#login-view').hidden = true;
  $('#dashboard-view').hidden = false;
  $('#admin-name').textContent = user.username;
  $('#admin-avatar').textContent = user.username.slice(0, 1).toUpperCase();
  changeView('overview');
  loadOverview();
}

function changeView(view) {
  if (!['overview', 'registrations', 'contacts'].includes(view)) return;
  state.view = view;
  document.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== view; });
  document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  const titles = {
    overview: ['YOUR WORKSPACE', 'Overview', 'A clear view of registrations and community enquiries.'],
    registrations: ['COURSE MANAGEMENT', 'Course registrations', 'Review participant enquiries, payment proof and registration progress.'],
    contacts: ['COMMUNITY MESSAGES', 'Contact enquiries', 'Read and manage messages submitted through the website.']
  };
  $('#page-eyebrow').textContent = titles[view][0];
  $('#page-title').textContent = titles[view][1];
  $('#page-description').textContent = titles[view][2];
  $('#breadcrumb-current').textContent = titles[view][1];
  $('#export-button').hidden = view !== 'registrations';
  $('#sidebar').classList.remove('open');
  $('#mobile-menu-button').setAttribute('aria-expanded', 'false');
  if (view === 'registrations') loadRegistrations();
  if (view === 'contacts') loadContacts();
}

async function loadOverview() {
  try {
    const { stats } = await api('/api/admin/dashboard');
    $('#stat-registrations').textContent = stats.registrations.toLocaleString('en-IN');
    $('#stat-week').textContent = stats.last7Days.toLocaleString('en-IN');
    $('#stat-contacts').textContent = stats.contacts.toLocaleString('en-IN');
    $('#stat-proofs').textContent = stats.paymentProofs.toLocaleString('en-IN');
    $('#registration-nav-count').textContent = stats.registrations.toLocaleString('en-IN');
    $('#contact-nav-count').textContent = stats.contacts.toLocaleString('en-IN');
    const labels = stats.registrationStatuses || [];
    const max = Math.max(1, ...labels.map((item) => Number(item.total)));
    $('#status-breakdown').innerHTML = labels.length ? labels.map((item) => {
      const label = registrationStatusLabels[item.status] || item.status;
      const count = Number(item.total);
      return `<div class="status-line"><span>${escapeHTML(label)}</span><div class="status-track"><div class="status-fill" style="width:${Math.max(2, count / max * 100)}%"></div></div><strong class="status-number">${count}</strong></div>`;
    }).join('') : '<p class="empty-copy">No registrations have been received yet.</p>';
  } catch (error) {
    showNotice(error.message, true);
  }
}

function personCell(name, secondary = '') {
  const initial = String(name || '?').trim().slice(0, 1).toUpperCase();
  return `<div class="person-cell"><span class="person-avatar">${escapeHTML(initial)}</span><span><strong>${escapeHTML(name || '—')}</strong><small>${escapeHTML(secondary)}</small></span></div>`;
}

function statusPill(status, labels) {
  return `<span class="status-pill ${escapeHTML(status)}">${escapeHTML(labels[status] || status || '—')}</span>`;
}

async function loadRegistrations() {
  const query = new URLSearchParams({
    q: $('#registration-search').value.trim(),
    status: $('#registration-status-filter').value,
    limit: '100'
  });
  $('#registrations-table').innerHTML = '<tr><td colspan="7" class="table-empty">Loading registrations…</td></tr>';
  try {
    const data = await api(`/api/admin/registrations?${query}`);
    state.registrations = data.registrations;
    $('#registration-nav-count').textContent = data.total.toLocaleString('en-IN');
    $('#registration-result-count').textContent = `${data.total.toLocaleString('en-IN')} registration${data.total === 1 ? '' : 's'} found`;
    $('#registrations-table').innerHTML = data.registrations.length ? data.registrations.map((item) => `
      <tr>
        <td>${personCell(item.name, item.location)}</td>
        <td><div class="contact-cell"><strong>${escapeHTML(item.phone)}</strong><small>${escapeHTML(item.email || 'No email supplied')}</small></div></td>
        <td>${escapeHTML(item.course)}</td>
        <td>${escapeHTML(formatDate(item.created_at, false))}</td>
        <td>${item.has_payment_proof ? '<span class="proof-yes">● Uploaded</span>' : '<span class="proof-no">— Not supplied</span>'}</td>
        <td>${statusPill(item.status, registrationStatusLabels)}</td>
        <td><button class="row-action" type="button" data-action="registration" data-id="${escapeHTML(item.id)}">View →</button></td>
      </tr>`).join('') : '<tr><td colspan="7" class="table-empty">No registrations match these filters.</td></tr>';
  } catch (error) {
    $('#registrations-table').innerHTML = `<tr><td colspan="7" class="table-empty">${escapeHTML(error.message)}</td></tr>`;
  }
}

async function loadContacts() {
  const query = new URLSearchParams({ q: $('#contact-search').value.trim(), status: $('#contact-status-filter').value });
  $('#contacts-table').innerHTML = '<tr><td colspan="6" class="table-empty">Loading contact enquiries…</td></tr>';
  try {
    const data = await api(`/api/admin/contacts?${query}`);
    state.contacts = data.contacts;
    $('#contact-nav-count').textContent = data.contacts.length.toLocaleString('en-IN');
    $('#contact-result-count').textContent = `${data.contacts.length.toLocaleString('en-IN')} message${data.contacts.length === 1 ? '' : 's'} found`;
    $('#contacts-table').innerHTML = data.contacts.length ? data.contacts.map((item) => `
      <tr>
        <td>${personCell(item.name, item.email)}</td>
        <td>${escapeHTML(item.subject)}</td>
        <td>${escapeHTML(item.message.length > 75 ? `${item.message.slice(0, 75)}…` : item.message)}</td>
        <td>${escapeHTML(formatDate(item.created_at, false))}</td>
        <td>${statusPill(item.status, contactStatusLabels)}</td>
        <td><button class="row-action" type="button" data-action="contact" data-id="${escapeHTML(item.id)}">Read →</button></td>
      </tr>`).join('') : '<tr><td colspan="6" class="table-empty">No contact enquiries match these filters.</td></tr>';
  } catch (error) {
    $('#contacts-table').innerHTML = `<tr><td colspan="6" class="table-empty">${escapeHTML(error.message)}</td></tr>`;
  }
}

function detailField(label, value, full = false, asParagraph = false) {
  const content = asParagraph ? `<p>${escapeHTML(value || '—')}</p>` : `<strong>${escapeHTML(value || '—')}</strong>`;
  return `<div class="detail-field${full ? ' full' : ''}"><small>${escapeHTML(label)}</small>${content}</div>`;
}

function openRegistration(id) {
  const item = state.registrations.find((row) => row.id === id);
  if (!item) return;
  state.selected = { type: 'registration', item };
  $('#detail-eyebrow').textContent = 'COURSE REGISTRATION';
  $('#detail-title').textContent = item.name;
  const proof = item.has_payment_proof
    ? `<a class="button button-outline" href="/api/admin/registrations/${encodeURIComponent(item.id)}/proof">↓ Download payment proof</a>`
    : '<span class="proof-no">No payment proof uploaded</span>';
  $('#detail-content').innerHTML = `
    <div class="detail-grid">
      ${detailField('Phone / WhatsApp', item.phone)}
      ${detailField('Email address', item.email || 'Not supplied')}
      ${detailField('Location', item.location)}
      ${detailField('Preferred language', item.language === 'ml' ? 'Malayalam' : 'English')}
      ${detailField('Course', item.course, true)}
      ${detailField('Received on', formatDate(item.created_at))}
    </div>
    <div class="detail-divider"></div>
    <div class="detail-actions">${proof}<span>${statusPill(item.status, registrationStatusLabels)}</span></div>
    <div class="detail-divider"></div>
    <form id="status-update-form" data-type="registration" data-id="${escapeHTML(item.id)}" class="detail-actions">
      <select name="status" aria-label="Registration status">${Object.entries(registrationStatusLabels).map(([key, label]) => `<option value="${key}" ${key === item.status ? 'selected' : ''}>${label}</option>`).join('')}</select>
      <button class="button button-primary" type="submit">Save status</button>
    </form>
    <p class="detail-meta">Registration ID: ${escapeHTML(item.id)}</p>`;
  $('#detail-dialog').showModal();
}

function openContact(id) {
  const item = state.contacts.find((row) => row.id === id);
  if (!item) return;
  state.selected = { type: 'contact', item };
  $('#detail-eyebrow').textContent = 'CONTACT ENQUIRY';
  $('#detail-title').textContent = item.subject;
  $('#detail-content').innerHTML = `
    <div class="detail-grid">
      ${detailField('From', item.name)}
      ${detailField('Email address', item.email)}
      ${detailField('Received on', formatDate(item.created_at))}
      ${detailField('Language', item.language === 'ml' ? 'Malayalam' : 'English')}
      ${detailField('Message', item.message, true, true)}
    </div>
    <div class="detail-divider"></div>
    <div class="detail-actions"><a class="button button-outline" href="mailto:${encodeURIComponent(item.email)}?subject=${encodeURIComponent(`Re: ${item.subject}`)}">Reply by email ↗</a>${statusPill(item.status, contactStatusLabels)}</div>
    <div class="detail-divider"></div>
    <form id="status-update-form" data-type="contact" data-id="${escapeHTML(item.id)}" class="detail-actions">
      <select name="status" aria-label="Contact enquiry status">${Object.entries(contactStatusLabels).map(([key, label]) => `<option value="${key}" ${key === item.status ? 'selected' : ''}>${label}</option>`).join('')}</select>
      <button class="button button-primary" type="submit">Save status</button>
    </form>
    <p class="detail-meta">Message ID: ${escapeHTML(item.id)}</p>`;
  $('#detail-dialog').showModal();
}

async function updateStatus(form) {
  const type = form.dataset.type;
  const id = form.dataset.id;
  const status = new FormData(form).get('status');
  const endpoint = type === 'registration' ? `/api/admin/registrations/${encodeURIComponent(id)}/status` : `/api/admin/contacts/${encodeURIComponent(id)}/status`;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    await api(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    $('#detail-dialog').close();
    showNotice(type === 'registration' ? 'Registration status updated.' : 'Contact enquiry status updated.');
    if (type === 'registration') { await loadRegistrations(); await loadOverview(); }
    else { await loadContacts(); await loadOverview(); }
  } catch (error) {
    showNotice(error.message, true);
    button.disabled = false;
    button.textContent = 'Save status';
  }
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#login-submit');
  const message = $('#login-message');
  button.disabled = true;
  button.textContent = 'Signing in…';
  message.textContent = '';
  try {
    const form = new FormData(event.currentTarget);
    const result = await api('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: form.get('username'), password: form.get('password') })
    });
    event.currentTarget.reset();
    showDashboard(result.user);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
    button.innerHTML = 'Sign in <span aria-hidden="true">→</span>';
  }
});

$('#logout-button').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); }
  catch { /* The local view is cleared even when the session has expired. */ }
  showLogin('You have signed out.');
});

document.addEventListener('click', (event) => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) changeView(viewButton.dataset.view);
  const rowButton = event.target.closest('[data-action]');
  if (rowButton?.dataset.action === 'registration') openRegistration(rowButton.dataset.id);
  if (rowButton?.dataset.action === 'contact') openContact(rowButton.dataset.id);
});

document.addEventListener('submit', (event) => {
  if (event.target.id === 'registration-filters') { event.preventDefault(); loadRegistrations(); }
  if (event.target.id === 'contact-filters') { event.preventDefault(); loadContacts(); }
  if (event.target.id === 'status-update-form') { event.preventDefault(); updateStatus(event.target); }
});

$('#dialog-close').addEventListener('click', () => $('#detail-dialog').close());
$('#mobile-menu-button').addEventListener('click', () => {
  const open = $('#sidebar').classList.toggle('open');
  $('#mobile-menu-button').setAttribute('aria-expanded', String(open));
});

(async function initialise() {
  try {
    const result = await api('/api/admin/session');
    if (result.authenticated) showDashboard(result.user);
    else showLogin();
  } catch (error) {
    showLogin(error.message);
  }
})();

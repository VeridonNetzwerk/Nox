import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// --- Auth ---
let accessToken = null;
let user = null;

// Security constants
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 60_000; // 60 seconds
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_WARNING_MS = 5 * 60 * 1000; // warn 5 min before timeout

let sessionTimer = null;
let sessionWarningTimer = null;
let sessionCountdownTimer = null;
let lastActivity = Date.now();

// --- Brute-force protection ---
function getFailedAttempts() {
  try { return parseInt(sessionStorage.getItem('nox_analytics_failed') || '0', 10); } catch { return 0; }
}
function setFailedAttempts(n) {
  try { sessionStorage.setItem('nox_analytics_failed', String(n)); } catch {}
}
function getLockoutTime() {
  try { return parseInt(sessionStorage.getItem('nox_analytics_lockout') || '0', 10); } catch { return 0; }
}
function setLockoutTime(ts) {
  try { sessionStorage.setItem('nox_analytics_lockout', String(ts)); } catch {}
}

function isLockedOut() {
  const lockoutEnd = getLockoutTime();
  if (lockoutEnd > Date.now()) return true;
  if (lockoutEnd > 0 && lockoutEnd <= Date.now()) {
    setLockoutTime(0);
    setFailedAttempts(0);
  }
  return false;
}

function startLockoutCountdown() {
  const lockEl = document.getElementById('login-locked');
  const timerEl = document.getElementById('lock-timer');
  lockEl.classList.add('show');
  document.getElementById('login-error').classList.remove('show');
  const update = () => {
    const remaining = Math.ceil((getLockoutTime() - Date.now()) / 1000);
    if (remaining <= 0) {
      lockEl.classList.remove('show');
      setLockoutTime(0);
      setFailedAttempts(0);
      return;
    }
    timerEl.textContent = remaining;
    setTimeout(update, 1000);
  };
  update();
}

// --- Session timeout ---
function resetSessionTimer() {
  lastActivity = Date.now();
  clearTimeout(sessionTimer);
  clearTimeout(sessionWarningTimer);
  clearInterval(sessionCountdownTimer);

  const warningEl = document.getElementById('session-warning');
  warningEl.classList.remove('show');

  sessionWarningTimer = setTimeout(() => {
    warningEl.classList.add('show');
    const countdownEl = document.getElementById('session-countdown');
    let remaining = SESSION_WARNING_MS / 1000;
    sessionCountdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(sessionCountdownTimer);
        return;
      }
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      countdownEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
    }, 1000);
  }, SESSION_TIMEOUT_MS - SESSION_WARNING_MS);

  sessionTimer = setTimeout(() => {
    doLogout();
    const err = document.getElementById('login-error');
    err.textContent = 'Session expired. Please sign in again.';
    err.classList.add('show');
  }, SESSION_TIMEOUT_MS);
}

['click', 'keydown', 'mousemove', 'scroll'].forEach(evt => {
  document.addEventListener(evt, () => {
    if (accessToken) {
      const elapsed = Date.now() - lastActivity;
      if (elapsed > 30_000) {
        resetSessionTimer();
      }
    }
  }, { passive: true });
});

// --- Login ---
async function doLogin(event) {
  event.preventDefault();

  if (isLockedOut()) {
    startLockoutCountdown();
    return false;
  }

  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  err.classList.remove('show');
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!resp.ok) {
      const attempts = getFailedAttempts() + 1;
      setFailedAttempts(attempts);

      if (attempts >= MAX_FAILED_ATTEMPTS) {
        setLockoutTime(Date.now() + LOCKOUT_DURATION_MS);
        startLockoutCountdown();
        btn.disabled = true;
        btn.textContent = 'Sign In';
        document.getElementById('login-password').value = '';
        return false;
      }

      err.textContent = `Invalid email or password (${MAX_FAILED_ATTEMPTS - attempts} attempts remaining)`;
      err.classList.add('show');
      btn.disabled = false;
      btn.textContent = 'Sign In';
      document.getElementById('login-password').value = '';
      return false;
    }

    const data = await resp.json();
    accessToken = data.access_token;
    user = data.user;

    const authorized = user?.app_metadata?.analytics_access === true
      || user?.user_metadata?.analytics_access === true
      || user?.role === 'authenticated';

    if (!authorized) {
      err.textContent = 'Access denied. This account is not authorized for analytics.';
      err.classList.add('show');
      accessToken = null;
      user = null;
      btn.disabled = false;
      btn.textContent = 'Sign In';
      document.getElementById('login-password').value = '';
      return false;
    }

    setFailedAttempts(0);
    setLockoutTime(0);

    sessionStorage.setItem('nox_analytics_session', JSON.stringify({
      access_token: accessToken,
      user: user,
      created_at: Date.now(),
    }));

    document.getElementById('login-password').value = '';
    showDashboard();
  } catch (e) {
    err.textContent = 'Connection error: ' + e.message;
    err.classList.add('show');
  }

  btn.disabled = false;
  btn.textContent = 'Sign In';
  return false;
}

// --- Logout ---
function doLogout() {
  if (accessToken) {
    fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`,
      },
    }).catch(() => {});
  }
  accessToken = null;
  user = null;
  clearTimeout(sessionTimer);
  clearTimeout(sessionWarningTimer);
  clearInterval(sessionCountdownTimer);
  sessionStorage.removeItem('nox_analytics_session');
  document.getElementById('session-warning').classList.remove('show');
  document.getElementById('dashboard').classList.remove('show');
  document.getElementById('login').style.display = 'flex';
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
}

function showDashboard() {
  document.getElementById('login').style.display = 'none';
  document.getElementById('dashboard').classList.add('show');
  resetSessionTimer();
  loadAnalytics();
}

// --- API ---
async function supabaseSelect(table, select = '*', limit = 1000, orderBy = null) {
  if (!accessToken) throw new Error('Not authenticated');
  let url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}&limit=${limit}`;
  if (orderBy) url += `&order=${orderBy}`;
  const resp = await fetch(url, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  if (resp.status === 401) {
    doLogout();
    throw new Error('Session expired');
  }
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

async function loadAnalytics() {
  try {
    const events = await supabaseSelect('nox_events', '*', 5000, 'created_at.desc');
    renderStats(events);
    renderTimeline(events);
    renderEventTypes(events);
    renderCountryBreakdown(events);
    renderErrorCodes(events);
    renderTopTools(events);
    renderRecentEvents(events.slice(0, 50));
  } catch (e) {
    document.querySelectorAll('.loading').forEach(el => {
      el.innerHTML = `<span style="color: var(--red)">Error: ${e.message}</span>`;
    });
  }
}

function renderStats(events) {
  const sessions = new Set(events.map(e => e.session_id).filter(Boolean));
  const starts = events.filter(e => e.event_type === 'app_start');
  const voice = events.filter(e => e.event_type === 'voice_interaction');
  const tools = events.filter(e => e.event_type === 'tool_use');
  const versions = new Set(events.map(e => e.app_version).filter(Boolean));
  const countries = new Set(events.map(e => e.country).filter(Boolean));
  const errors = events.filter(e => e.event_type === 'error');

  document.getElementById('stat-total').textContent = events.length.toLocaleString();
  document.getElementById('stat-sessions').textContent = sessions.size.toLocaleString();
  document.getElementById('stat-starts').textContent = starts.length.toLocaleString();
  document.getElementById('stat-voice').textContent = voice.length.toLocaleString();
  document.getElementById('stat-tools').textContent = tools.length.toLocaleString();
  document.getElementById('stat-versions').textContent = versions.size.toLocaleString();
  document.getElementById('stat-countries').textContent = countries.size.toLocaleString();
  document.getElementById('stat-errors').textContent = errors.length.toLocaleString();
}

function renderCountryBreakdown(events) {
  const counts = {};
  events.forEach(e => {
    const c = e.country || 'Unknown';
    counts[c] = (counts[c] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20);
  const max = Math.max(...sorted.map(s => s[1]), 1);

  const container = document.getElementById('country-breakdown');
  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty">No country data yet</div>';
    return;
  }
  container.innerHTML = sorted.map(([country, count]) =>
    `<div class="bar-row">
      <span class="bar-label">${country}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width: ${(count / max * 100).toFixed(0)}%">${count}</div>
      </div>
    </div>`
  ).join('');
}

function renderErrorCodes(events) {
  const errorEvents = events.filter(e => e.event_type === 'error' || e.error_code);
  const counts = {};
  errorEvents.forEach(e => {
    const code = e.error_code || 'UNKNOWN';
    counts[code] = (counts[code] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...sorted.map(s => s[1]), 1);

  const container = document.getElementById('error-codes');
  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty">No errors recorded</div>';
    return;
  }
  container.innerHTML = sorted.map(([code, count]) =>
    `<div class="bar-row">
      <span class="bar-label"><span class="event-badge error">${code}</span></span>
      <div class="bar-track">
        <div class="bar-fill" style="width: ${(count / max * 100).toFixed(0)}%; background: var(--red)">${count}</div>
      </div>
    </div>`
  ).join('');
}

function renderTimeline(events) {
  const days = 30;
  const now = new Date();
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    buckets.push({ date: d, count: 0, label: d.toLocaleDateString('en', { month: 'short', day: 'numeric' }) });
  }

  events.forEach(e => {
    const d = new Date(e.created_at);
    d.setHours(0, 0, 0, 0);
    const bucket = buckets.find(b => b.date.getTime() === d.getTime());
    if (bucket) bucket.count++;
  });

  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  const container = document.getElementById('timeline');
  container.innerHTML = buckets.map(b => {
    const h = (b.count / maxCount * 100).toFixed(0);
    return `<div class="timeline-bar" style="height: ${h}%">
      <div class="tooltip">${b.label}: ${b.count} events</div>
    </div>`;
  }).join('');

  const labels = document.getElementById('timeline-labels');
  labels.innerHTML = buckets.map((b, i) =>
    `<span>${i % 5 === 0 ? b.label : ''}</span>`
  ).join('');
}

function renderEventTypes(events) {
  const counts = {};
  events.forEach(e => {
    counts[e.event_type] = (counts[e.event_type] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...sorted.map(s => s[1]), 1);

  const container = document.getElementById('event-types');
  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty">No events yet</div>';
    return;
  }
  container.innerHTML = sorted.map(([type, count]) =>
    `<div class="bar-row">
      <span class="bar-label"><span class="event-badge ${type}">${type}</span></span>
      <div class="bar-track">
        <div class="bar-fill" style="width: ${(count / max * 100).toFixed(0)}%">${count}</div>
      </div>
    </div>`
  ).join('');
}

function renderTopTools(events) {
  const toolEvents = events.filter(e => e.event_type === 'tool_use');
  const counts = {};
  toolEvents.forEach(e => {
    const name = e.metadata?.tool || 'unknown';
    counts[name] = (counts[name] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = Math.max(...sorted.map(s => s[1]), 1);

  const container = document.getElementById('top-tools');
  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty">No tool usage yet</div>';
    return;
  }
  container.innerHTML = sorted.map(([name, count]) =>
    `<div class="bar-row">
      <span class="bar-label">${name}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width: ${(count / max * 100).toFixed(0)}%">${count}</div>
      </div>
    </div>`
  ).join('');
}

function renderRecentEvents(events) {
  const container = document.getElementById('recent-events');
  if (events.length === 0) {
    container.innerHTML = '<div class="empty">No events yet</div>';
    return;
  }
  container.innerHTML = `
    <table class="events-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Type</th>
          <th>Country</th>
          <th>Code</th>
          <th>Version</th>
          <th>OS</th>
          <th>Session</th>
        </tr>
      </thead>
      <tbody>
        ${events.map(e => `
          <tr>
            <td>${new Date(e.created_at).toLocaleString()}</td>
            <td><span class="event-badge ${e.event_type}">${e.event_type}</span></td>
            <td>${e.country || '—'}</td>
            <td>${e.error_code ? `<span class="event-badge error">${e.error_code}</span>` : '—'}</td>
            <td>${e.app_version || '—'}</td>
            <td>${e.os || '—'}</td>
            <td style="font-family: monospace; font-size: 11px; color: var(--textDim)">${(e.session_id || '—').slice(0, 8)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// --- Init: attach event listeners (no inline handlers for CSP) ---
document.addEventListener('DOMContentLoaded', () => {
  // Login form
  const loginForm = document.getElementById('login-form');
  if (loginForm) loginForm.addEventListener('submit', doLogin);

  // Logout button
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', doLogout);

  // Check for existing session
  const stored = sessionStorage.getItem('nox_analytics_session');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const sessionAge = Date.now() - (parsed.created_at || 0);
      if (sessionAge > SESSION_TIMEOUT_MS) {
        sessionStorage.removeItem('nox_analytics_session');
      } else {
        accessToken = parsed.access_token;
        user = parsed.user;
        showDashboard();
      }
    } catch {
      sessionStorage.removeItem('nox_analytics_session');
    }
  }

  // Check lockout on page load
  if (isLockedOut()) {
    startLockoutCountdown();
    document.getElementById('login-btn').disabled = true;
  }
});

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
// Nox Analytics Dashboard — pure SVG charts, no external dependencies

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
  document.getElementById('app-shell').classList.remove('show');
  document.getElementById('login').style.display = 'flex';
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
}

function showDashboard() {
  document.getElementById('login').style.display = 'none';
  document.getElementById('app-shell').classList.add('show');
  const email = user?.email || 'admin@nox.app';
  const displayName = email.split('@')[0] || 'Admin User';
  document.getElementById('user-name').textContent = displayName;
  document.getElementById('user-email').textContent = email;
  document.getElementById('user-avatar').textContent = displayName.charAt(0).toUpperCase();
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

let allEvents = [];
let timelineDays = 30;

function filteredEvents() {
  const period = document.getElementById('period-select')?.value || 'Year to Date';
  const now = new Date();
  let cutoff;
  if (period === 'Today') { cutoff = new Date(now); cutoff.setHours(0, 0, 0, 0); }
  else if (period === 'Last 7 days') cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  else if (period === 'Last 30 days') cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  else { cutoff = new Date(now.getFullYear(), 0, 1); }
  return allEvents.filter(e => new Date(e.created_at) >= cutoff);
}

let currentView = 'overview';

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view-section').forEach(s => {
    s.classList.toggle('active', s.dataset.view === view);
  });
  document.querySelectorAll('.nav-item[data-view]').forEach(n => {
    n.classList.toggle('active', n.dataset.view === view);
  });
  const titles = { overview: 'Overview', traffic: 'Traffic', errors: 'Errors' };
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = titles[view] || view;
}

function renderAll() {
  const events = filteredEvents();
  renderStats(events);
  renderTimeline(events, timelineDays);
  renderWeeklyTraffic(events);
  renderWeeklyTraffic2(events);
  renderCountryMap(events);
  renderEventTypes(events);
  renderErrorBreakdown(events);
  renderRecentEvents(events.slice(0, 50));
}

async function loadAnalytics() {
  try {
    allEvents = await supabaseSelect('nox_events', '*', 5000, 'created_at.desc');
    renderAll();
  } catch (e) {
    document.querySelectorAll('.loading').forEach(el => {
      el.innerHTML = `<span style="color: var(--red)">Error: ${e.message}</span>`;
    });
  }
}

// --- Chart colors ---
const CHART_COLORS = ['#6366f1', '#22c55e', '#eab308', '#ef4444', '#818cf8', '#06b6d4', '#f97316', '#ec4899', '#84cc16', '#a855f7'];

// --- Shared custom tooltip ---
let chartTooltip = null;
function getChartTooltip() {
  if (!chartTooltip) {
    chartTooltip = document.createElement('div');
    chartTooltip.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;background:#1f2937;color:#fff;padding:8px 12px;border-radius:8px;font-size:12px;font-family:Inter,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.2);opacity:0;transition:opacity .12s;white-space:nowrap;line-height:1.5';
    document.body.appendChild(chartTooltip);
  }
  return chartTooltip;
}
function attachTooltip(el, label, detail) {
  el.addEventListener('mouseenter', () => {
    const t = getChartTooltip();
    t.innerHTML = `<div style="font-weight:600;font-size:13px">${label}</div>${detail ? `<div style="color:#9ca3af;font-size:11px">${detail}</div>` : ''}`;
    t.style.opacity = '1';
  });
  el.addEventListener('mousemove', (e) => {
    const t = getChartTooltip();
    t.style.left = (e.clientX + 14) + 'px';
    t.style.top = (e.clientY - 10) + 'px';
  });
  el.addEventListener('mouseleave', () => {
    getChartTooltip().style.opacity = '0';
  });
}

// Country code to display name (Intl API, full coverage)
const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
function countryName(code) {
  if (!code || code === 'Unknown') return 'Unknown';
  try { return REGION_NAMES.of(code) || code; } catch { return code; }
}

// Convert country code to flag emoji
function countryFlag(code) {
  if (!code || code.length !== 2) return '';
  const A = 0x1F1E6;
  return String.fromCodePoint(A + code.charCodeAt(0) - 65) + String.fromCodePoint(A + code.charCodeAt(1) - 65);
}

function renderStats(events) {
  const period = document.getElementById('period-select')?.value || 'Year to Date';
  const now = new Date();
  let currStart, prevEnd, prevStart;
  if (period === 'Today') {
    currStart = new Date(now); currStart.setHours(0, 0, 0, 0);
    prevEnd = new Date(currStart);
    prevStart = new Date(currStart.getTime() - 24 * 60 * 60 * 1000);
  } else if (period === 'Last 7 days') {
    currStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    prevEnd = new Date(currStart);
    prevStart = new Date(currStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === 'Last 30 days') {
    currStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    prevEnd = new Date(currStart);
    prevStart = new Date(currStart.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else {
    currStart = new Date(now.getFullYear(), 0, 1);
    prevEnd = new Date(currStart);
    prevStart = new Date(now.getFullYear() - 1, 0, 1);
  }

  const prevEvents = allEvents.filter(e => {
    const t = new Date(e.created_at);
    return t >= prevStart && t < prevEnd;
  });

  function calcChange(curr, prev) {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return ((curr - prev) / prev) * 100;
  }

  function setChange(id, change) {
    const el = document.getElementById(id);
    if (!el) return;
    const sign = change >= 0 ? '▲' : '▼';
    el.textContent = `${sign} ${Math.abs(change).toFixed(1)}%`;
    el.className = 'kpi-change ' + (change >= 0 ? 'up' : 'down');
  }

  function calcSessionRanges(evts) {
    const ranges = {};
    evts.forEach(event => {
      if (!event.session_id || !event.created_at) return;
      const time = new Date(event.created_at).getTime();
      if (!ranges[event.session_id]) ranges[event.session_id] = [time, time];
      ranges[event.session_id][0] = Math.min(ranges[event.session_id][0], time);
      ranges[event.session_id][1] = Math.max(ranges[event.session_id][1], time);
    });
    return Object.values(ranges).map(([start, end]) => Math.min(end - start, 60 * 60 * 1000));
  }

  function avgDuration(evts) {
    const durs = calcSessionRanges(evts);
    return durs.length ? durs.reduce((s, v) => s + v, 0) / durs.length : 0;
  }

  function fmtDuration(ms) {
    if (!ms) return '—';
    const dm = Math.floor(ms / 60000);
    const ds = Math.floor((ms % 60000) / 1000);
    return `${dm}m ${ds}s`;
  }

  const currSessions = new Set(events.map(e => e.session_id).filter(Boolean));
  const prevSessions = new Set(prevEvents.map(e => e.session_id).filter(Boolean));
  setChange('kpi-users-change', calcChange(currSessions.size, prevSessions.size));
  document.getElementById('kpi-users').textContent = currSessions.size.toLocaleString();

  setChange('kpi-events-change', calcChange(events.length, prevEvents.length));
  document.getElementById('kpi-events').textContent = events.length.toLocaleString();

  const currAvg = avgDuration(events);
  const prevAvg = avgDuration(prevEvents);
  document.getElementById('kpi-duration').textContent = fmtDuration(currAvg);
  setChange('kpi-duration-change', calcChange(currAvg, prevAvg));

  const currErrors = events.filter(e => e.event_type === 'error' || e.error_code).length;
  const prevErrors = prevEvents.filter(e => e.event_type === 'error' || e.error_code).length;
  setChange('kpi-errors-change', calcChange(currErrors, prevErrors));
  document.getElementById('kpi-errors').textContent = currErrors.toLocaleString();
}

// --- SVG Area Chart for Timeline (smooth curves) ---
function renderTimeline(events, days = 30) {
  const container = document.getElementById('timeline');
  if (!container) return;
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
  if (events.length === 0) { container.innerHTML = '<div class="empty">No events yet</div>'; return; }

  const W = 800, H = 220, padL = 44, padR = 16, padT = 16, padB = 32;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  const stepX = chartW / (days - 1);

  const pts = buckets.map((b, i) => ({
    x: padL + i * stepX,
    y: padT + chartH - (b.count / maxCount) * chartH,
    label: b.label,
    count: b.count
  }));

  // Smooth bezier path
  function smoothPath(points) {
    if (points.length < 2) return '';
    let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i], p1 = points[i + 1];
      const cpx = (p0.x + p1.x) / 2;
      d += ` C ${cpx.toFixed(1)} ${p0.y.toFixed(1)}, ${cpx.toFixed(1)} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
    }
    return d;
  }
  const linePath = smoothPath(pts);
  const areaPath = linePath + ` L ${pts[pts.length-1].x.toFixed(1)} ${(padT + chartH).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(padT + chartH).toFixed(1)} Z`;

  // Y-axis grid + labels
  const yTicks = [];
  for (let i = 0; i <= 4; i++) {
    const val = Math.round(maxCount * i / 4);
    const y = padT + chartH - (i / 4) * chartH;
    yTicks.push(`<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="${i === 0 ? '0' : '3,3'}"/><text x="${padL - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#9ca3af" font-size="10" font-family="Inter,sans-serif">${val}</text>`);
  }

  // X-axis labels (adaptive)
  const labelStep = Math.max(1, Math.round(days / 7));
  const xLabels = pts.filter((_, i) => i % labelStep === 0 || i === pts.length - 1).map(p =>
    `<text x="${p.x.toFixed(1)}" y="${H - 10}" text-anchor="middle" fill="#9ca3af" font-size="10" font-family="Inter,sans-serif">${p.label}</text>`
  ).join('');

  // Hover dots
  const dots = pts.map(p => {
    const isZero = p.count === 0;
    return `<circle class="chart-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isZero ? 0 : 3.5}" fill="#6366f1" stroke="#fff" stroke-width="2" opacity="${isZero ? 0 : 1}" data-label="${p.label}" data-detail="${p.count} events"></circle>`;
  }).join('');

  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-family:Inter,sans-serif">
    <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#6366f1" stop-opacity="0.02"/>
    </linearGradient></defs>
    ${yTicks.join('')}
    <path d="${areaPath}" fill="url(#areaGrad)"/>
    <path d="${linePath}" fill="none" stroke="#6366f1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
    ${xLabels}
  </svg>`;
  container.querySelectorAll('.chart-dot[data-label]').forEach(el => {
    attachTooltip(el, el.dataset.label, el.dataset.detail);
  });
}

// --- SVG Column Chart for Weekly Traffic ---
function renderWeeklyTraffic(events) {
  const container = document.getElementById('weekly-traffic');
  if (!container) return;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const values = days.map((_, index) => events.filter(event => new Date(event.created_at).getDay() === (index + 1) % 7).length);
  const maxVal = Math.max(...values, 1);
  const W = 360, H = 200, padL = 36, padR = 12, padT = 20, padB = 30;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const barW = chartW / days.length * 0.55;
  const gap = chartW / days.length * 0.45;
  const stepX = chartW / days.length;

  const yTicks = [];
  for (let i = 0; i <= 4; i++) {
    const val = Math.round(maxVal * i / 4);
    const y = padT + chartH - (i / 4) * chartH;
    yTicks.push(`<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="${i === 0 ? '0' : '3,3'}"/><text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#9ca3af" font-size="9" font-family="Inter,sans-serif">${val}</text>`);
  }

  const bars = days.map((day, i) => {
    const val = values[i];
    const h = (val / maxVal) * chartH;
    const x = padL + i * stepX + gap / 2;
    const y = padT + chartH - h;
    const isMax = val === Math.max(...values) && val > 0;
    const color = isMax ? '#4f46e5' : '#6366f1';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${color}" opacity="0.85" style="transition:opacity .15s" class="chart-bar" data-label="${day}" data-detail="${val} events"></rect>${val > 0 ? `<text x="${(x + barW/2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" fill="#6b7280" font-size="10" font-weight="600" font-family="Inter,sans-serif">${val}</text>` : ''}<text x="${(x + barW/2).toFixed(1)}" y="${H - 10}" text-anchor="middle" fill="#9ca3af" font-size="11" font-family="Inter,sans-serif">${day}</text>`;
  }).join('');

  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-family:Inter,sans-serif">${yTicks.join('')}${bars}</svg>`;
  container.querySelectorAll('.chart-bar[data-label]').forEach(el => {
    attachTooltip(el, el.dataset.label, el.dataset.detail);
  });
}

function renderWeeklyTraffic2(events) {
  const container = document.getElementById('weekly-traffic-2');
  if (!container) return;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const values = days.map((_, index) => events.filter(event => new Date(event.created_at).getDay() === (index + 1) % 7).length);
  const maxVal = Math.max(...values, 1);
  const W = 760, H = 240, padL = 40, padR = 16, padT = 20, padB = 32;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const barW = chartW / days.length * 0.6;
  const gap = chartW / days.length * 0.4;
  const stepX = chartW / days.length;

  const yTicks = [];
  for (let i = 0; i <= 4; i++) {
    const val = Math.round(maxVal * i / 4);
    const y = padT + chartH - (i / 4) * chartH;
    yTicks.push(`<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="${i === 0 ? '0' : '3,3'}"/><text x="${padL - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#9ca3af" font-size="10" font-family="Inter,sans-serif">${val}</text>`);
  }

  const bars = days.map((day, i) => {
    const val = values[i];
    const h = (val / maxVal) * chartH;
    const x = padL + i * stepX + gap / 2;
    const y = padT + chartH - h;
    const isMax = val === Math.max(...values) && val > 0;
    const color = isMax ? '#4f46e5' : '#6366f1';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="5" fill="${color}" opacity="0.85" style="transition:opacity .15s" class="chart-bar" data-label="${day}" data-detail="${val} events"></rect>${val > 0 ? `<text x="${(x + barW/2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" fill="#6b7280" font-size="11" font-weight="600" font-family="Inter,sans-serif">${val}</text>` : ''}<text x="${(x + barW/2).toFixed(1)}" y="${H - 10}" text-anchor="middle" fill="#9ca3af" font-size="12" font-family="Inter,sans-serif">${day}</text>`;
  }).join('');

  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;font-family:Inter,sans-serif">${yTicks.join('')}${bars}</svg>`;
  container.querySelectorAll('.chart-bar[data-label]').forEach(el => {
    attachTooltip(el, el.dataset.label, el.dataset.detail);
  });
}

// --- SVG Donut Chart for Event Types ---
function renderEventTypes(events) {
  const container = document.getElementById('event-types');
  if (!container) return;
  const typeCounts = {};
  events.forEach(e => { typeCounts[e.event_type] = (typeCounts[e.event_type] || 0) + 1; });
  const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, c]) => s + c, 0);
  if (sorted.length === 0) { container.innerHTML = '<div class="empty">No events yet</div>'; return; }

  const cx = 80, cy = 80, R = 62, r = 38;
  let angle = -Math.PI / 2;
  const slices = sorted.map(([type, count], i) => {
    const pct = count / total;
    const endAngle = angle + pct * Math.PI * 2;
    const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
    const x2 = cx + R * Math.cos(endAngle), y2 = cy + R * Math.sin(endAngle);
    const x3 = cx + r * Math.cos(endAngle), y3 = cy + r * Math.sin(endAngle);
    const x4 = cx + r * Math.cos(angle), y4 = cy + r * Math.sin(angle);
    const largeArc = pct > 0.5 ? 1 : 0;
    const path = `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} L ${x3.toFixed(1)} ${y3.toFixed(1)} A ${r} ${r} 0 ${largeArc} 0 ${x4.toFixed(1)} ${y4.toFixed(1)} Z`;
    const color = CHART_COLORS[i % CHART_COLORS.length];
    angle = endAngle;
    return { path, color, type, count, pct };
  });

  const svg = `<svg width="170" height="170" viewBox="0 0 170 170" style="flex-shrink:0">${slices.map(s => `<path d="${s.path}" fill="${s.color}" stroke="#fff" stroke-width="2" class="chart-slice" style="transition:opacity .15s" data-label="${s.type}" data-detail="${s.count} (${(s.pct*100).toFixed(1)}%)"></path>`).join('')}<text x="${cx}" y="${cy-4}" text-anchor="middle" fill="#111827" font-size="22" font-weight="700" font-family="Inter,sans-serif">${total.toLocaleString()}</text><text x="${cx}" y="${cy+14}" text-anchor="middle" fill="#9ca3af" font-size="9" font-family="Inter,sans-serif" letter-spacing="1">EVENTS</text></svg>`;
  const legend = `<div style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:100px">${slices.map(s => `<div style="display:flex;align-items:center;gap:8px;font-size:12px"><span style="width:10px;height:10px;border-radius:3px;background:${s.color};flex-shrink:0"></span><span style="color:#6b7280">${s.type}</span><span style="margin-left:auto;font-weight:600;color:#111827">${s.count}</span></div>`).join('')}</div>`;
  container.innerHTML = `<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">${svg}${legend}</div>`;
  container.querySelectorAll('.chart-slice[data-label]').forEach(el => {
    attachTooltip(el, el.dataset.label, el.dataset.detail);
  });
}

// --- SVG Donut Chart for Error Breakdown ---
function renderErrorBreakdown(events) {
  const container = document.getElementById('error-breakdown');
  if (!container) return;
  const errorEvents = events.filter(e => e.event_type === 'error' || e.error_code);
  if (errorEvents.length === 0) {
    container.innerHTML = '<div class="empty">No errors recorded</div>';
    return;
  }
  const codeCounts = {};
  errorEvents.forEach(e => {
    const code = e.error_code || 'unknown';
    codeCounts[code] = (codeCounts[code] || 0) + 1;
  });
  const sorted = Object.entries(codeCounts).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, c]) => s + c, 0);

  const cx = 80, cy = 80, R = 62, r = 38;
  let angle = -Math.PI / 2;
  const errorColors = ['#ef4444', '#f97316', '#eab308', '#f43f5e', '#fb923c', '#facc15', '#f87171', '#fdba74', '#fde047', '#fca5a5'];
  const slices = sorted.map(([code, count], i) => {
    const pct = count / total;
    const endAngle = angle + pct * Math.PI * 2;
    const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
    const x2 = cx + R * Math.cos(endAngle), y2 = cy + R * Math.sin(endAngle);
    const x3 = cx + r * Math.cos(endAngle), y3 = cy + r * Math.sin(endAngle);
    const x4 = cx + r * Math.cos(angle), y4 = cy + r * Math.sin(angle);
    const largeArc = pct > 0.5 ? 1 : 0;
    const path = `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} L ${x3.toFixed(1)} ${y3.toFixed(1)} A ${r} ${r} 0 ${largeArc} 0 ${x4.toFixed(1)} ${y4.toFixed(1)} Z`;
    const color = errorColors[i % errorColors.length];
    angle = endAngle;
    return { path, color, code, count, pct };
  });

  const svg = `<svg width="170" height="170" viewBox="0 0 170 170" style="flex-shrink:0">${slices.map(s => `<path d="${s.path}" fill="${s.color}" stroke="#fff" stroke-width="2" class="chart-slice" style="transition:opacity .15s" data-label="${s.code}" data-detail="${s.count} (${(s.pct*100).toFixed(1)}%)"></path>`).join('')}<text x="${cx}" y="${cy-4}" text-anchor="middle" fill="#111827" font-size="22" font-weight="700" font-family="Inter,sans-serif">${total.toLocaleString()}</text><text x="${cx}" y="${cy+14}" text-anchor="middle" fill="#9ca3af" font-size="9" font-family="Inter,sans-serif" letter-spacing="1">ERRORS</text></svg>`;
  const legend = `<div style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:100px">${slices.map(s => `<div style="display:flex;align-items:center;gap:8px;font-size:12px"><span style="width:10px;height:10px;border-radius:3px;background:${s.color};flex-shrink:0"></span><span style="color:#6b7280;font-family:monospace;font-size:11px">${s.code}</span><span style="margin-left:auto;font-weight:600;color:#111827">${s.count}</span></div>`).join('')}</div>`;
  container.innerHTML = `<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">${svg}${legend}</div>`;
  container.querySelectorAll('.chart-slice[data-label]').forEach(el => {
    attachTooltip(el, el.dataset.label, el.dataset.detail);
  });
}

function renderUsersByTime(events) {
  const container = document.getElementById('users-by-time');
  if (!container) return;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const counts = hours.map(h => days.map((_, d) => events.filter(e => { const dt = new Date(e.created_at); return dt.getDay() === d && dt.getHours() === h; }).length));
  const max = Math.max(...counts.flat(), 1);
  const cellSize = 16;
  const gap = 3;
  const labelW = 28;
  const totalW = labelW + (cellSize + gap) * 7;
  const totalH = 20 + (cellSize + gap) * 24;
  const dayHeaders = days.map((day, i) => `<text x="${labelW + i * (cellSize + gap) + cellSize/2}" y="14" text-anchor="middle" fill="var(--textLight)" font-size="9" font-family="Inter,sans-serif">${day[0]}</text>`).join('');
  const rows = hours.map((h, hi) => {
    const y = 20 + hi * (cellSize + gap);
    const label = `<text x="${labelW - 4}" y="${y + cellSize/2 + 3}" text-anchor="end" fill="var(--textLight)" font-size="8" font-family="Inter,sans-serif">${h.toString().padStart(2,'0')}</text>`;
    const cells = days.map((_, di) => {
      const intensity = counts[hi][di] / max;
      const alpha = intensity > 0 ? 0.12 + intensity * 0.88 : 0;
      return `<rect x="${labelW + di * (cellSize + gap)}" y="${y}" width="${cellSize}" height="${cellSize}" rx="3" fill="rgba(99,102,241,${alpha.toFixed(2)})" class="heatmap-cell" data-label="${days[di]} ${h.toString().padStart(2,'0')}:00" data-detail="${counts[hi][di]} events"></rect>`;
    }).join('');
    return label + cells;
  }).join('');
  container.innerHTML = `<svg viewBox="0 0 ${totalW} ${totalH}" style="width:100%;height:auto;display:block">${dayHeaders}${rows}</svg><div class="heatmap-legend"><span>Less</span><div class="heatmap-legend-bar">${[0.12,0.3,0.5,0.7,0.9].map(a => `<span class="sq" style="background:rgba(99,102,241,${a})"></span>`).join('')}</div><span>More</span></div>`;
  container.querySelectorAll('.heatmap-cell[data-label]').forEach(el => {
    attachTooltip(el, el.dataset.label, el.dataset.detail);
  });
}

// --- SVG World Map (choropleth from world-map.svg) ---
let worldMapSvgCache = null;

async function loadWorldMapSvg() {
  if (worldMapSvgCache) return worldMapSvgCache;
  const resp = await fetch('world-map.svg');
  if (!resp.ok) throw new Error('map_load_failed');
  const text = await resp.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) throw new Error('map_parse_failed');
  worldMapSvgCache = svg;
  return svg;
}

function choroplethColor(intensity) {
  const from = [224, 231, 255];
  const to = [79, 70, 229];
  const t = Math.pow(intensity, 0.55);
  const rgb = from.map((f, i) => Math.round(f + (to[i] - f) * t));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

async function renderCountryMap(events) {
  const container = document.getElementById('country-breakdown');
  if (!container) return;

  const counts = {};
  events.forEach(event => {
    const country = event.country;
    if (country && country !== 'Unknown' && country.length === 2) {
      counts[country] = (counts[country] || 0) + 1;
    }
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = Math.max(events.length, 1);
  const max = Math.max(...sorted.map(([, count]) => count), 1);

  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty">No country data yet</div>';
    return;
  }

  const list = sorted.slice(0, 8).map(([code, count]) => {
    const percent = Math.round((count / total) * 100);
    return `<div class="country-row"><span class="country-flag">${countryFlag(code)}</span><span class="country-name">${countryName(code)}</span><span class="country-bar-bg"><span class="country-bar-fill" style="width:${Math.max(percent, 4)}%"></span></span><span class="country-pct">${percent}%</span></div>`;
  }).join('');

  const totalSessions = new Set(events.map(e => e.session_id).filter(Boolean)).size;
  const totalCountries = sorted.length;
  const infoHtml = `<div><div style="font-size:22px;font-weight:700;margin-bottom:2px">${totalSessions.toLocaleString()}</div><div style="font-size:11px;color:var(--textDim);margin-bottom:2px">Active users from ${totalCountries} ${totalCountries === 1 ? 'country' : 'countries'}</div><div class="country-list" style="margin-top:14px">${list}</div></div>`;

  try {
    const svgTemplate = await loadWorldMapSvg();
    const svg = svgTemplate.cloneNode(true);
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.classList.add('map-svg');
    svg.setAttribute('aria-label', 'World map of active users');

    svg.querySelectorAll('path').forEach(path => {
      let code = (path.id || '').toUpperCase();
      if (!code) {
        let parent = path.parentElement;
        while (parent && parent !== svg) {
          if (parent.id && parent.id.length === 2) { code = parent.id.toUpperCase(); break; }
          parent = parent.parentElement;
        }
      }
      if (!code) return;
      const count = counts[code] || 0;
      path.setAttribute('stroke', '#ffffff');
      path.setAttribute('stroke-width', '0.4');
      if (count > 0) {
        path.setAttribute('fill', choroplethColor(count / max));
        path.style.cursor = 'pointer';
        path.dataset.label = `${countryFlag(code)} ${countryName(code)}`;
        path.dataset.detail = `${count.toLocaleString()} events (${Math.round((count / total) * 100)}%)`;
      } else {
        path.setAttribute('fill', '#e8eaf1');
        path.style.cursor = 'help';
        path.dataset.label = `${countryFlag(code)} ${countryName(code)}`;
        path.dataset.detail = 'no events';
      }
    });

    const legendHtml = `<div style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:10px;color:var(--textDim)"><span>0</span><div style="flex:0 0 90px;height:8px;border-radius:4px;background:linear-gradient(90deg,#e0e7ff,#4f46e5)"></div><span>${max.toLocaleString()} events</span></div>`;
    container.innerHTML = `<div class="map-section"><div><div class="map-holder" style="position:relative"></div>${legendHtml}</div>${infoHtml}</div>`;
    const holder = container.querySelector('.map-holder');
    holder.appendChild(svg);

    svg.querySelectorAll('path[data-label]').forEach(path => {
      attachTooltip(path, path.dataset.label, path.dataset.detail);
    });
  } catch {
    container.innerHTML = `<div class="map-section"><div class="empty">Map unavailable</div>${infoHtml}</div>`;
  }
}

function exportAnalytics() {
  const rows = [['created_at', 'event_type', 'country', 'error_code', 'app_version', 'os', 'session_id']];
  document.querySelectorAll('#recent-events tbody tr').forEach(row => {
    rows.push(Array.from(row.children).map(cell => cell.textContent.trim().replaceAll(',', ' ')));
  });
  const csv = rows.map(row => row.join(',')).join('\\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `nox-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// --- Recent Events Table ---
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
            <td><span class="badge ${e.event_type === 'app_start' ? 'start' : e.event_type === 'voice_interaction' ? 'voice' : e.event_type === 'tool_use' ? 'tool' : e.event_type === 'error' ? 'error' : 'other'}">${e.event_type}</span></td>
            <td>${e.country ? countryFlag(e.country) + ' ' + e.country : '—'}</td>
            <td>${e.error_code ? `<span class="badge error">${e.error_code}</span>` : '—'}</td>
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

  // View switching via sidebar nav
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.addEventListener('click', () => {
      switchView(item.dataset.view);
    });
  });

  // Logout controls
  const logoutNav = document.getElementById('logout-nav');
  if (logoutNav) logoutNav.addEventListener('click', doLogout);

  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) exportBtn.addEventListener('click', exportAnalytics);

  const reportBtn = document.getElementById('report-btn');
  if (reportBtn) reportBtn.addEventListener('click', () => {
    switchView('errors');
    setTimeout(() => document.getElementById('recent-events')?.scrollIntoView({ behavior: 'smooth' }), 50);
  });

  const periodSelect = document.getElementById('period-select');
  if (periodSelect) periodSelect.addEventListener('change', () => {
    if (allEvents.length) renderAll();
  });

  document.querySelectorAll('.card-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      tab.parentElement.querySelectorAll('.card-tab').forEach(other => other.classList.remove('active'));
      tab.classList.add('active');
      timelineDays = tab.dataset.days ? parseInt(tab.dataset.days, 10) : 30;
      if (allEvents.length) renderTimeline(filteredEvents(), timelineDays);
    });
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (allEvents.length) renderAll();
    }, 250);
  });

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

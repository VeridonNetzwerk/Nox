import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
// Nox Analytics Dashboard — SVG-based charts, no external dependencies

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
    renderCountryMap(events);
    renderErrorCodes(events);
    renderTopTools(events);
    renderVersionBreakdown(events);
    renderRecentEvents(events.slice(0, 50));
  } catch (e) {
    document.querySelectorAll('.loading').forEach(el => {
      el.innerHTML = `<span style="color: var(--red)">Error: ${e.message}</span>`;
    });
  }
}

// --- Chart colors ---
const CHART_COLORS = ['#6366f1', '#22c55e', '#eab308', '#ef4444', '#818cf8', '#06b6d4', '#f97316', '#ec4899', '#84cc16', '#a855f7'];

// --- Country code to lat/lng (approximate, for world map) ---
const COUNTRY_COORDS = {
  'US': [39.8, -98.5], 'DE': [51.2, 10.4], 'FR': [46.2, 2.2], 'GB': [55.3, -3.4],
  'JP': [36.2, 138.2], 'CN': [35.0, 104.0], 'IN': [20.6, 78.9], 'BR': [-14.2, -51.9],
  'RU': [61.5, 105.3], 'CA': [56.1, -106.3], 'AU': [-25.3, 133.8], 'KR': [35.9, 127.8],
  'IT': [41.9, 12.6], 'ES': [40.5, -3.7], 'NL': [52.1, 5.3], 'SE': [60.1, 18.6],
  'NO': [60.5, 8.5], 'FI': [61.9, 25.7], 'DK': [56.3, 9.5], 'PL': [51.9, 19.1],
  'TR': [38.9, 35.2], 'MX': [23.6, -102.5], 'AR': [-38.4, -63.6], 'CL': [-35.7, -71.5],
  'ZA': [-30.6, 22.9], 'EG': [26.8, 30.8], 'NG': [9.1, 8.7], 'KE': [-0.0, 37.9],
  'SA': [23.9, 45.1], 'AE': [23.4, 53.8], 'IL': [31.0, 34.9], 'IR': [32.4, 53.7],
  'TH': [15.9, 100.9], 'VN': [14.1, 108.3], 'ID': [-0.8, 113.9], 'PH': [12.9, 121.8],
  'MY': [4.2, 101.9], 'SG': [1.3, 103.8], 'PK': [30.4, 69.3], 'BD': [23.7, 90.4],
  'UA': [48.9, 31.2], 'GR': [39.1, 21.8], 'PT': [39.4, -8.2], 'CH': [46.8, 8.2],
  'AT': [47.5, 14.5], 'BE': [50.5, 4.5], 'CZ': [49.8, 15.5], 'HU': [47.2, 19.5],
  'RO': [45.9, 24.9], 'BG': [42.7, 25.5], 'HR': [45.1, 15.2], 'SK': [48.7, 19.7],
  'SI': [46.2, 14.9], 'LT': [55.2, 23.9], 'LV': [56.9, 24.6], 'EE': [58.6, 25.0],
  'IE': [53.1, -7.7], 'IS': [64.9, -19.0], 'LU': [49.8, 6.1], 'MT': [35.9, 14.4],
  'CY': [35.1, 33.4], 'AL': [41.2, 20.2], 'RS': [44.0, 21.0], 'BA': [43.9, 17.7],
  'NZ': [-40.9, 174.9], 'CO': [4.6, -74.3], 'PE': [-9.2, -75.0], 'VE': [6.4, -66.6],
  'EC': [-1.8, -78.2], 'UY': [-32.5, -55.8], 'PY': [-23.4, -58.4], 'BO': [-16.3, -63.6],
  'CR': [9.7, -83.8], 'PA': [8.5, -80.8], 'GT': [15.8, -90.2], 'CU': [21.5, -77.8],
  'DO': [18.7, -70.2], 'HN': [15.2, -86.2], 'SV': [13.8, -88.9], 'NI': [12.9, -85.2],
  'MA': [31.8, -7.1], 'DZ': [28.0, 1.7], 'TN': [33.9, 9.5], 'LY': [26.3, 17.2],
  'GH': [7.9, -1.0], 'CI': [7.5, -5.5], 'SN': [14.5, -14.5], 'CM': [7.4, 12.4],
  'AO': [-11.2, 17.9], 'MZ': [-18.7, 35.5], 'TZ': [-6.4, 34.9], 'UG': [1.4, 32.3],
  'ET': [9.1, 40.5], 'SD': [12.9, 30.2], 'IQ': [33.2, 43.7], 'JO': [30.6, 36.2],
  'LB': [33.9, 35.9], 'SY': [34.8, 38.9], 'AF': [33.9, 67.7], 'KZ': [48.0, 66.9],
  'UZ': [41.4, 64.6], 'TM': [38.9, 59.6], 'MN': [46.9, 103.8], 'KH': [12.6, 104.9],
  'LA': [19.9, 102.5], 'MM': [21.9, 95.9], 'LK': [7.9, 80.8], 'NP': [28.4, 84.1],
  'TW': [23.7, 121.0], 'HK': [22.3, 114.2],
};

// Convert lat/lng to SVG x/y (equirectangular projection)
function latLngToXY(lat, lng, width, height) {
  const x = ((lng + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return [x, y];
}

// Convert country code to flag emoji
function countryFlag(code) {
  if (!code || code.length !== 2) return '';
  const A = 0x1F1E6;
  return String.fromCodePoint(A + code.charCodeAt(0) - 65) + String.fromCodePoint(A + code.charCodeAt(1) - 65);
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

// --- SVG Line/Area Chart for Timeline ---
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

  const container = document.getElementById('timeline');
  if (events.length === 0) {
    container.innerHTML = '<div class="empty">No events yet</div>';
    return;
  }

  const W = 800, H = 200, padL = 40, padR = 20, padT = 20, padB = 30;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  const stepX = chartW / (days - 1);

  // Build path data
  const points = buckets.map((b, i) => {
    const x = padL + i * stepX;
    const y = padT + chartH - (b.count / maxCount) * chartH;
    return [x, y, b];
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const areaPath = linePath + ` L ${points[points.length-1][0].toFixed(1)} ${padT + chartH} L ${points[0][0].toFixed(1)} ${padT + chartH} Z`;

  // Y-axis labels (4 ticks)
  const yTicks = [];
  for (let i = 0; i <= 4; i++) {
    const val = Math.round(maxCount * i / 4);
    const y = padT + chartH - (i / 4) * chartH;
    yTicks.push(`<line class="grid-line" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" /><text class="axis-text" x="${padL - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end">${val}</text>`);
  }

  // X-axis labels (every 5th)
  const xLabels = points.filter((p, i) => i % 5 === 0).map(p =>
    `<text class="axis-text" x="${p[0].toFixed(1)}" y="${H - 8}" text-anchor="middle">${p[2].label}</text>`
  ).join('');

  // Data points with hover
  const dots = points.map(p => {
    const cx = p[0].toFixed(1), cy = p[1].toFixed(1);
    return `<circle class="data-point" cx="${cx}" cy="${cy}" r="3"><title>${p[2].label}: ${p[2].count} events</title></circle>`;
  }).join('');

  container.innerHTML = `<svg class="svg-chart" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
    </linearGradient></defs>
    ${yTicks.join('')}
    <path d="${areaPath}" fill="url(#areaGradient)" />
    <path class="line-stroke" d="${linePath}" />
    ${dots}
    ${xLabels}
  </svg>`;
}

// --- SVG Donut Chart for Event Types ---
function renderEventTypes(events) {
  const counts = {};
  events.forEach(e => {
    counts[e.event_type] = (counts[e.event_type] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, c]) => s + c, 0);

  const container = document.getElementById('event-types');
  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty">No events yet</div>';
    return;
  }

  const R = 70, r = 42, cx = 90, cy = 90;
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

  const svg = `<svg class="donut-svg" width="180" height="180" viewBox="0 0 180 180">
    ${slices.map(s => `<path d="${s.path}" fill="${s.color}" stroke="var(--surface)" stroke-width="1.5"><title>${s.type}: ${s.count} (${(s.pct*100).toFixed(1)}%)</title></path>`).join('')}
    <text class="donut-center-num donut-center-text" x="${cx}" y="${cy - 6}">${total.toLocaleString()}</text>
    <text class="donut-center-label donut-center-text" x="${cx}" y="${cy + 14}">Events</text>
  </svg>`;

  const legend = `<div class="donut-legend">
    ${slices.map(s => `<div class="donut-legend-item">
      <span class="donut-legend-dot" style="background:${s.color}"></span>
      <span class="donut-legend-label">${s.type}</span>
      <span class="donut-legend-value">${s.count}</span>
    </div>`).join('')}
  </div>`;

  container.innerHTML = `<div class="donut-container">${svg}${legend}</div>`;
}

// --- World Map for Countries ---
function renderCountryMap(events) {
  const counts = {};
  events.forEach(e => {
    const c = e.country || 'Unknown';
    counts[c] = (counts[c] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...sorted.map(s => s[1]), 1);

  const container = document.getElementById('country-breakdown');
  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty">No country data yet</div>';
    return;
  }

  const W = 800, H = 360;

  // Draw dots for countries we have coordinates for
  const dots = sorted.filter(([code]) => COUNTRY_COORDS[code]).map(([code, count]) => {
    const [lat, lng] = COUNTRY_COORDS[code];
    const [x, y] = latLngToXY(lat, lng, W, H);
    const radius = 4 + Math.sqrt(count / max) * 12;
    return { x, y, radius, code, count };
  });

  // Country chips list
  const chips = sorted.slice(0, 20).map(([code, count]) =>
    `<span class="country-chip">
      <span class="cc-flag">${countryFlag(code)}</span>
      <span>${code}</span>
      <span class="cc-count">${count}</span>
    </span>`
  ).join('');

  const tooltipId = 'map-tooltip';
  const dotsSvg = dots.map(d =>
    `<circle class="map-dot" cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${d.radius.toFixed(1)}"
      data-country="${d.code}" data-count="${d.count}"></circle>`
  ).join('');

  container.innerHTML = `<div class="world-map-container">
    <svg class="world-map-svg" viewBox="0 0 ${W} ${H}">
      <rect class="map-bg" x="0" y="0" width="${W}" height="${H}" rx="8" />
      ${dotsSvg}
    </svg>
    <div class="map-tooltip" id="${tooltipId}"></div>
  </div>
  <div class="country-list">${chips}</div>`;

  // Add hover tooltips
  const tooltip = document.getElementById(tooltipId);
  const mapContainer = container.querySelector('.world-map-container');
  container.querySelectorAll('.map-dot').forEach(dot => {
    dot.addEventListener('mouseenter', (e) => {
      const country = e.target.getAttribute('data-country');
      const count = e.target.getAttribute('data-count');
      tooltip.innerHTML = `<span class="mt-country">${countryFlag(country)} ${country}</span> — <span class="mt-count">${count} events</span>`;
      tooltip.classList.add('show');
    });
    dot.addEventListener('mousemove', (e) => {
      const rect = mapContainer.getBoundingClientRect();
      tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
      tooltip.style.top = (e.clientY - rect.top - 30) + 'px';
    });
    dot.addEventListener('mouseleave', () => {
      tooltip.classList.remove('show');
    });
  });
}

// --- Bar Chart for Error Codes ---
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

// --- Bar Chart for Top Tools ---
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

// --- Bar Chart for App Versions ---
function renderVersionBreakdown(events) {
  const counts = {};
  events.forEach(e => {
    const v = e.app_version || 'unknown';
    counts[v] = (counts[v] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = Math.max(...sorted.map(s => s[1]), 1);

  const container = document.getElementById('version-breakdown');
  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty">No version data yet</div>';
    return;
  }
  container.innerHTML = sorted.map(([ver, count]) =>
    `<div class="bar-row">
      <span class="bar-label">v${ver}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width: ${(count / max * 100).toFixed(0)}%; background: var(--green)">${count}</div>
      </div>
    </div>`
  ).join('');
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
            <td><span class="event-badge ${e.event_type}">${e.event_type}</span></td>
            <td>${e.country ? countryFlag(e.country) + ' ' + e.country : '—'}</td>
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

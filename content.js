// Isolated world — has access to chrome.runtime but NOT the page's window.fetch.
// Responsibilities:
//   1. Relay fetch-intercepted data from interceptor.js (MAIN world) to background
//   2. Inject and manage the status overlay UI

// --- Time / formatting helpers ---

function ordinalSuffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

// Formats the reset timestamp for display in the usage lines.
// Same day  → "7pm" or "7:35pm" (rounded to nearest 5 min)
// Other day → "27th"
function formatResetTime(isoString) {
  const at = new Date(isoString);
  const now = new Date();

  if (at.toDateString() === now.toDateString()) {
    let h = at.getHours();
    let m = Math.round(at.getMinutes() / 5) * 5;
    if (m === 60) { h += 1; m = 0; }
    const period = h >= 12 ? 'pm' : 'am';
    const dh = h % 12 || 12;
    return m === 0 ? `${dh}${period}` : `${dh}:${String(m).padStart(2, '0')}${period}`;
  }

  const d = at.getDate();
  return `${d}${ordinalSuffix(d)}`;
}

// Linear extrapolation: given current utilization % at fetchTimestamp,
// project what % will be reached by the end of the usage window.
// Can exceed 100% — that's intentional, it means "on track to go over".
function projectUtilization(utilization, isoResetAt, windowMs, fetchTimestamp) {
  const windowStart = new Date(isoResetAt).getTime() - windowMs;
  const elapsed = fetchTimestamp - windowStart;
  if (elapsed <= 0) return utilization; // shouldn't happen but guard anyway
  const fractionElapsed = elapsed / windowMs;
  return Math.round(utilization / fractionElapsed);
}

function timeAgo(timestamp) {
  const s = Math.floor((Date.now() - timestamp) / 1000);
  if (s < 5)  return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? '1 minute ago' : `${m} minutes ago`;
  const h = Math.floor(m / 60);
  return h === 1 ? '1 hour ago' : `${h} hours ago`;
}

// --- Overlay ---

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

let lastSaveTimestamp = null;
let lastDownloadId = null;

function createOverlay() {
  const el = document.createElement('div');
  el.id = 'claude-usage-tracker';
  el.style.cssText = `
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 99999;
    background: rgba(20, 20, 20, 0.82);
    color: #fff;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 12px;
    line-height: 1.6;
    padding: 8px 12px;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    backdrop-filter: blur(6px);
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    pointer-events: none;
    text-align: right;
  `;

  const statusLine = document.createElement('div');
  statusLine.textContent = '🦀📊 Claude Usage Limit Tracker';
  statusLine.style.color = '#4ade80';
  el.appendChild(statusLine);

  // Shown while waiting for the first API response to be intercepted
  const loadingLine = document.createElement('div');
  loadingLine.id = 'cut-loading';
  loadingLine.textContent = 'Loading...';
  loadingLine.style.color = '#9ca3af';
  el.appendChild(loadingLine);

  document.documentElement.appendChild(el);
}

function updateTimeAgo() {
  const el = document.getElementById('cut-time-ago');
  if (el && lastSaveTimestamp) el.textContent = timeAgo(lastSaveTimestamp);
}

function onSaved({ filename, downloadId, timestamp, data }) {
  lastSaveTimestamp = timestamp;
  lastDownloadId = downloadId;

  const overlay = document.getElementById('claude-usage-tracker');

  // Build the dynamic lines once on first save, then just update their content
  if (!document.getElementById('cut-download-line')) {
    // Remove the loading placeholder now that we have real data
    document.getElementById('cut-loading')?.remove();

    // Line: "[JSON] downloaded"
    // "JSON" is a link that reveals the file in Finder.
    // Content scripts can't call chrome.downloads.show() directly — only background can.
    const downloadLine = document.createElement('div');
    downloadLine.id = 'cut-download-line';
    downloadLine.style.color = '#d1d5db';

    const jsonLink = document.createElement('span');
    jsonLink.textContent = 'JSON';
    jsonLink.title = 'Reveal in Finder';
    jsonLink.style.cssText = 'cursor: pointer; text-decoration: underline; color: #93c5fd; pointer-events: auto;';
    jsonLink.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CLAUDE_USAGE_SHOW_FILE', downloadId: lastDownloadId });
    });

    downloadLine.appendChild(jsonLink);
    downloadLine.appendChild(document.createTextNode(' downloaded'));
    overlay.appendChild(downloadLine);

    // Line: "2 minutes ago" — separate line, updates every second
    const timeAgoLine = document.createElement('div');
    timeAgoLine.id = 'cut-time-ago';
    timeAgoLine.style.color = '#9ca3af';
    overlay.appendChild(timeAgoLine);

    overlay.appendChild(Object.assign(document.createElement('div'), { id: 'cut-five-hour', style: 'color: #d1d5db' }));
    overlay.appendChild(Object.assign(document.createElement('div'), { id: 'cut-seven-day', style: 'color: #d1d5db' }));

    setInterval(updateTimeAgo, 1000);
  }

  updateTimeAgo();

  if (data?.five_hour) {
    const { utilization, resets_at } = data.five_hour;
    const text = resets_at
      ? `5h: ${utilization}% (${projectUtilization(utilization, resets_at, FIVE_HOURS_MS, timestamp)}% by ${formatResetTime(resets_at)})`
      : `5h: ${utilization}%`;
    document.getElementById('cut-five-hour').textContent = text;
  }

  if (data?.seven_day) {
    const { utilization, resets_at } = data.seven_day;
    const text = resets_at
      ? `7d: ${utilization}% (${projectUtilization(utilization, resets_at, SEVEN_DAYS_MS, timestamp)}% by ${formatResetTime(resets_at)})`
      : `7d: ${utilization}%`;
    document.getElementById('cut-seven-day').textContent = text;
  }
}

createOverlay();

// --- Prevent tab freezing and discarding ---

// Chrome can freeze inactive tabs (pausing JS) or discard them (removing from memory).
// Either would stop the fetch interceptor from working.
//
// Web Locks API: holding an exclusive lock indefinitely prevents Chrome from
// freezing this tab's JS execution.
navigator.locks.request('claude-usage-keepalive', { mode: 'exclusive' }, () => new Promise(() => {}));

// Also tell the background to mark this tab as non-discardable. chrome.tabs.update
// can only be called from background, not content scripts.
chrome.runtime.sendMessage({ type: 'CLAUDE_USAGE_PREVENT_DISCARD' });

// --- Message relay: interceptor.js (MAIN world) → background ---

window.addEventListener('message', (event) => {
  if (event.source === window && event.data?.type === 'CLAUDE_USAGE_DATA') {
    console.log('[ClaudeUsage] relaying to background, orgId:', event.data.orgId);
    chrome.runtime.sendMessage(event.data);
  }
});

// --- Messages from background → overlay ---

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'CLAUDE_USAGE_SAVED') {
    onSaved(message);
  }
});

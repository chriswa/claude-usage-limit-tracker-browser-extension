// This script runs in the page's MAIN world (declared in manifest.json) so it
// has direct access to window.fetch. The alternative — injecting a <script> tag
// from a content script — is blocked by claude.ai's Content Security Policy.
//
// MAIN world scripts cannot access chrome.runtime, so intercepted data is handed
// off to content.js (which runs in the isolated world) via window.postMessage.

// --- Keep TanStack Query polling while tab is backgrounded ---
//
// Claude's usage page uses TanStack Query with:
//   refetchOnWindowFocus: true       — refetches when the tab regains focus
//   refetchIntervalInBackground: false — pauses all timers when tab is hidden
//   staleTime: ~300,000ms (5 min)    — data considered stale after 5 minutes
//
// This means: when the tab is backgrounded, all polling stops entirely.
// It only resumes when the user actually switches back to the tab.
//
// Fix has two parts:
//   1. Override document.visibilityState/hidden so TanStack Query's isFocused()
//      always returns true — this prevents it from pausing interval timers.
//   2. Periodically fire fake visibilitychange + focus events so the
//      refetchOnWindowFocus mechanism triggers even without real user interaction.
//
// We fire every 10 minutes. Since staleTime is ~5 minutes, the data will always
// be stale by then, giving us a reliable refresh without risking rate limiting.

Object.defineProperty(Document.prototype, 'visibilityState', {
  get: () => 'visible',
  configurable: true,
});
Object.defineProperty(Document.prototype, 'hidden', {
  get: () => false,
  configurable: true,
});

setInterval(() => {
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
}, 10 * 60 * 1000);

console.log('[ClaudeUsage] fetch interceptor active');

const _fetch = window.fetch;
window.fetch = async function(...args) {
  const response = await _fetch.apply(this, args);
  const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
  if (url && /\/api\/organizations\/[^\/]+\/usage($|\?)/.test(url)) {
    console.log('[ClaudeUsage] intercepted:', url);
    const match = url.match(/\/api\/organizations\/([^\/]+)\/usage/);
    if (match) {
      response.clone().text().then(rawText => {
        // Always save the raw response text, even if it's not valid JSON or the
        // schema changes. Parsing is best-effort — if it fails, data is null and
        // the overlay skips the analysis lines without breaking anything.
        let data = null;
        try { data = JSON.parse(rawText); } catch (e) {
          console.warn('[ClaudeUsage] response was not valid JSON, saving raw text');
        }
        window.postMessage({ type: 'CLAUDE_USAGE_DATA', orgId: match[1], rawText, data }, '*');
      });
    }
  }
  return response;
};

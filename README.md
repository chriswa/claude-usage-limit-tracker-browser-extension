# 🦀📊 Claude Usage Limit Tracker

A Chrome extension that monitors your [Claude.ai](https://claude.ai) usage limits and saves them to a local JSON file — useful for scripting, dashboards, or just keeping an eye on how close you are to your limits.

## What it does

Park a tab on `https://claude.ai/settings/usage`. Whenever the page fetches updated usage data (on load and roughly every 10 minutes), the extension:

- Saves the raw API response to `~/Downloads/claude-usage-{org-id}.json`
- Shows a small overlay in the top-right corner of the page with your current utilisation and a linear extrapolation of where you'll be by the time each window resets

The overlay looks like this:

```
              🦀📊 Claude Usage Limit Tracker
                             JSON downloaded
                                2 minutes ago
                     5h: 65% (108% by 4pm)
                      7d: 18% (27% by 4th)
```

Clicking **JSON** in the overlay reveals the file in Finder.

The extrapolated percentages can exceed 100% — that's intentional. It means you're on track to hit your limit before the window resets.

## Install

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right)
4. Click **Load unpacked** and select the repo folder

## Use

1. Open a tab and navigate to `https://claude.ai/settings/usage`
2. Keep the tab open — the extension will keep it alive even when backgrounded
3. Watch `~/Downloads/claude-usage-{org-id}.json` for updates

The JSON file contains your raw usage data from the Claude API:

```json
{
  "five_hour": {
    "utilization": 65,
    "resets_at": "2026-03-28T16:00:00+00:00"
  },
  "seven_day": {
    "utilization": 18,
    "resets_at": "2026-04-04T02:00:00+00:00"
  },
  ...
}
```

## Permissions used

| Permission | Why |
|---|---|
| `downloads` | Save the JSON file to `~/Downloads/` |
| `downloads.ui` | Suppress the download bubble for silent saves |
| `tabs` | Prevent the parked tab from being discarded by Chrome |
| `host_permissions: https://claude.ai/*` | Intercept the usage API response |

No data is sent anywhere. Everything stays on your machine.

// We use chrome.downloads to write the usage JSON to ~/Downloads rather than
// requiring a native messaging host or a local server. This keeps the extension
// fully self-contained with no external dependencies.
//
// Downside: chrome.downloads normally pops open Chrome's download bubble/shelf,
// which would be surprising and noisy for what should be a silent background save.
// We suppress it with setUiOptions around each download (requires "downloads.ui"
// permission). The UI state is per-extension, so toggling it here does not affect
// what other extensions have set.

function hideDownloadUI() {
  return chrome.downloads.setUiOptions({ enabled: false });
}

function restoreDownloadUI() {
  return chrome.downloads.setUiOptions({ enabled: true });
}

// chrome.downloads.download()'s callback fires when the download *starts*, not
// when it finishes. Re-enabling the UI at that point still allows the bubble to
// appear for the in-progress download. We instead wait for the onChanged event
// that signals state === 'complete' before restoring the UI.
function waitForDownloadComplete(downloadId) {
  return new Promise((resolve) => {
    const listener = (delta) => {
      if (delta.id === downloadId && delta.state?.current === 'complete') {
        chrome.downloads.onChanged.removeListener(listener);
        resolve();
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  });
}

async function saveUsageFile(orgId, rawText, data, tabId) {
  // data is passed through to the content script so the overlay can display
  // usage analysis without re-parsing the file. It may be null if the response
  // wasn't valid JSON — in that case we still save the raw text.
  const filename = `claude-usage-${orgId}.json`;
  // data: URLs work reliably in MV3 service workers; Blob URLs via
  // URL.createObjectURL() do not.
  const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(rawText);

  await hideDownloadUI();

  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename,
    conflictAction: 'overwrite',
    saveAs: false,
  });

  await waitForDownloadComplete(downloadId);
  await restoreDownloadUI();

  console.log(`[ClaudeUsage] saved ${filename} (download #${downloadId})`);

  // Notify the content script so it can update the overlay. tabId is the tab
  // that triggered the save (the claude.ai/settings/usage tab).
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      type: 'CLAUDE_USAGE_SAVED',
      filename,
      downloadId,
      timestamp: Date.now(),
      data,
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'CLAUDE_USAGE_PREVENT_DISCARD' && sender.tab?.id) {
    // Prevent Chrome from silently discarding this tab from memory while it's
    // parked on the usage page. JS freezing is handled by the Web Lock in content.js.
    chrome.tabs.update(sender.tab.id, { autoDiscardable: false });
  }

  if (message.type === 'CLAUDE_USAGE_DATA') {
    saveUsageFile(message.orgId, message.rawText, message.data, sender.tab?.id)
      .catch((err) => console.error('[ClaudeUsage] error:', err));
  }

  // The content script can't call chrome.downloads.show() directly — only
  // background scripts have access to the downloads API.
  if (message.type === 'CLAUDE_USAGE_SHOW_FILE') {
    chrome.downloads.show(message.downloadId);
  }
});

// UI Elements
const preConnectSection = document.getElementById("preConnectSection");
const postConnectSection = document.getElementById("postConnectSection");
const connectBtn = document.getElementById("connectBtn");
const archiveBtn = document.getElementById("archiveBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const editSettingsBtn = document.getElementById("editSettingsBtn");
const tokenInput = document.getElementById("tokenInput");
const dbIdInput = document.getElementById("dbIdInput");
const closeAfterArchiveCheckbox = document.getElementById("closeAfterArchive");
const tabCountElement = document.getElementById("tabCount");
const archiveStatus = document.getElementById("archiveStatus");
const statusMessage = document.getElementById("statusMessage");
const statusCard = document.getElementById("statusCard");
const openNotionBtn = document.getElementById("openNotionBtn");

// Premium Feature UI Elements
const analyticsBtn = document.getElementById("analyticsBtn");
const offlineIndicator = document.getElementById("offlineIndicator");
const collectionSelect = document.getElementById("collectionSelect");
const snoozeActiveTabBtn = document.getElementById("snoozeActiveTabBtn");
const previewSelectBtn = document.getElementById("previewSelectBtn");
const snoozeActiveDropdown = document.getElementById("snoozeActiveDropdown");
const purgeStaleBtn = document.getElementById("purgeStaleBtn");

// Initialize on load
document.addEventListener("DOMContentLoaded", async () => {
  updateTabCount();
  checkAuthStatus();
  setupEventListeners();
  checkOfflineStatus();
});

// Update tab count
function updateTabCount() {
  chrome.tabs.query({}, (tabs) => {
    const count = tabs.length;
    tabCountElement.textContent = `${count} tab${count !== 1 ? "s" : ""} ready`;
  });
}

// Setup event listeners
function setupEventListeners() {
  connectBtn.addEventListener("click", handleConnect);
  archiveBtn.addEventListener("click", handleArchive);
  disconnectBtn.addEventListener("click", handleDisconnect);
  editSettingsBtn.addEventListener("click", handleEditSettings);

  // Open Notion button
  if (openNotionBtn) {
    openNotionBtn.addEventListener("click", handleOpenNotion);
  }

  // Visual Analytics Button
  if (analyticsBtn) {
    analyticsBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("src/pages/analytics.html") });
    });
  }

  // Preview Tabs Button
  if (previewSelectBtn) {
    previewSelectBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("src/pages/tab-preview.html") });
    });
  }

  // Snooze active tab toggle
  if (snoozeActiveTabBtn) {
    snoozeActiveTabBtn.addEventListener("click", () => {
      snoozeActiveDropdown.classList.toggle("hidden");
    });
  }

  // Snooze choice selection
  document.querySelectorAll(".snooze-choice-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const mins = parseInt(btn.dataset.mins);
      snoozeActiveDropdown.classList.add("hidden");
      await handleSnoozeActiveTab(mins);
    });
  });

  // Offline event listeners
  window.addEventListener("online", checkOfflineStatus);
  window.addEventListener("offline", checkOfflineStatus);

  // Purge Stale Pages button
  if (purgeStaleBtn) {
    purgeStaleBtn.addEventListener("click", handlePurgeStalePages);
  }

  // Load saved preferences
  chrome.storage.local.get(["closeAfterArchive", "selectedCollection"], (data) => {
    closeAfterArchiveCheckbox.checked = data.closeAfterArchive || false;
    if (data.selectedCollection && collectionSelect) {
      collectionSelect.value = data.selectedCollection;
    }
  });

  if (collectionSelect) {
    collectionSelect.addEventListener("change", (e) => {
      chrome.storage.local.set({ selectedCollection: e.target.value });
    });
  }

  closeAfterArchiveCheckbox.addEventListener("change", (e) => {
    chrome.storage.local.set({ closeAfterArchive: e.target.checked });
  });
}

// Check authentication status
async function checkAuthStatus() {
  const isAuth = await notionAuth.isAuthenticated();
  const token = await notionAuth.getToken();
  const dbId = await notionAuth.getDatabaseId();

  if (isAuth && token && dbId) {
    showPostConnectUI();
  } else {
    showPreConnectUI();
  }
}

// Show pre-connect UI
function showPreConnectUI() {
  preConnectSection.classList.add("active");
  postConnectSection.classList.remove("active");

  // Pre-fill with saved values if they exist
  chrome.storage.sync.get(
    ["notion_integration_token", "notion_database_id"],
    (data) => {
      if (data.notion_integration_token) {
        tokenInput.value = data.notion_integration_token;
      }
      if (data.notion_database_id) {
        dbIdInput.value = data.notion_database_id;
      }
    },
  );
}

// Show post-connect UI
function showPostConnectUI() {
  preConnectSection.classList.remove("active");
  postConnectSection.classList.add("active");
  updateTabCount();
}

// Handle connect
async function handleConnect() {
  const token = tokenInput.value.trim();
  const dbId = dbIdInput.value.trim();

  if (!token || !dbId) {
    alert("Please fill in both token and database ID");
    return;
  }

  if (!token.startsWith("ntn_")) {
    alert('Token should start with "ntn_"');
    return;
  }

  connectBtn.disabled = true;
  connectBtn.innerHTML =
    '<div class="spinner" style="margin-right: 8px; display: inline-block;"></div> Connecting...';

  try {
    // Save the credentials directly (skip API validation for now)
    console.log("Saving credentials...");
    await notionAuth.initializeWithToken(token, dbId);

    // Save Notion DB URL
    const databaseUrl = `https://www.notion.so/${dbId.replace(/-/g, "")}`;

    chrome.storage.sync.set({
      notion_database_url: databaseUrl,
    });

    // Show success message
    connectBtn.innerHTML = "✓ Connected!";
    connectBtn.style.background =
      "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)";

    console.log("Connection successful!");

    // Switch UI after a moment
    setTimeout(() => {
      showPostConnectUI();
    }, 1500);
  } catch (error) {
    console.error("Connection error:", error);
    alert(`Error: ${error.message}`);
    connectBtn.disabled = false;
    connectBtn.innerHTML = "🔗 Connect to Notion";
  }
}

// Handle archive
async function handleArchive() {
  const tabs = await new Promise((resolve) => chrome.tabs.query({}, resolve));

  if (tabs.length === 0) {
    alert("No tabs to archive");
    return;
  }

  const selectedCollection = collectionSelect ? collectionSelect.value : "General";

  // Check offline status
  if (!navigator.onLine) {
    // Offline Cache Mode
    archiveBtn.disabled = true;
    showArchiveStatus("Offline! Saving tabs to Offline Queue...", "loading");
    
    try {
      const tabsWithContent = await Promise.all(tabs.map(async (tab) => {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: () => document.body.innerText.substring(0, 3000).trim(),
        }).catch(() => [{ result: "" }]);
        
        return {
          id: tab.id,
          url: tab.url,
          title: tab.title,
          content: result?.result || "",
          favicon: tab.favIconUrl || "",
          collection: selectedCollection
        };
      }));

      chrome.runtime.sendMessage({
        action: "queueOfflineTabs",
        tabs: tabsWithContent,
        closeAfterArchive: closeAfterArchiveCheckbox.checked
      }, (response) => {
        archiveBtn.disabled = false;
        if (response && response.success) {
          showArchiveStatus(
            `✓ ${response.queued} tabs saved to Offline Queue! Will sync when online.`,
            "success"
          );
          setTimeout(() => {
            archiveStatus.classList.add("hidden");
          }, 4000);
        } else {
          showArchiveStatus(`Error: ${response?.error || "Offline caching failed"}`, "error");
        }
      });
    } catch (err) {
      showArchiveStatus(`Offline cache error: ${err.message}`, "error");
      archiveBtn.disabled = false;
    }
    return;
  }

  archiveBtn.disabled = true;
  showArchiveStatus(`Fetching content from ${tabs.length} tabs...`);

  try {
    const token = await notionAuth.getToken();
    const dbId = await notionAuth.getDatabaseId();

    if (!token || !dbId) {
      alert("Not connected to Notion. Please reconnect.");
      archiveBtn.disabled = false;
      return;
    }

    // Send to background script with progress tracking
    chrome.runtime.sendMessage(
      {
        action: "archiveTabs",
        notionToken: token,
        databaseId: dbId,
        closeAfterArchive: closeAfterArchiveCheckbox.checked,
        tabCount: tabs.length,
        collection: selectedCollection
      },
      (response) => {
        if (response && response.success) {
          showArchiveStatus(
            `✓ ${response.archived} tab${response.archived !== 1 ? "s" : ""} archived to Notion!`,
            "success",
            { current: response.archived, total: response.archived },
          );
          archiveBtn.disabled = false;
          setTimeout(() => {
            archiveStatus.classList.add("hidden");
          }, 3000);
        } else {
          showArchiveStatus(
            `Error: ${response?.error || "Unknown error"}`,
            "error",
          );
          archiveBtn.disabled = false;
        }
      },
    );

    // Listen for progress updates from background script
    const listener = (request, sender, sendResponse) => {
      if (request.action === "archiveProgress") {
        showArchiveStatus(request.message, "loading", {
          current: request.current,
          total: request.total,
        });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  } catch (error) {
    showArchiveStatus(`Error: ${error.message}`, "error");
    archiveBtn.disabled = false;
  }
}

// Handle disconnect
async function handleDisconnect() {
  if (confirm("Are you sure you want to disconnect from Notion?")) {
    await notionAuth.disconnect();
    showPreConnectUI();
    tokenInput.value = "";
    dbIdInput.value = "";
  }
}

// Handle edit settings
function handleEditSettings() {
  showPreConnectUI();
}

// Show archive status
function showArchiveStatus(message, type = "loading", progress = null) {
  archiveStatus.classList.remove("hidden");
  statusMessage.textContent = message;

  // Update progress bar if provided
  if (progress !== null) {
    const { current, total } = progress;
    const percentage = Math.round((current / total) * 100);
    document.getElementById("progressBar").style.width = percentage + "%";
    document.getElementById("progressText").textContent =
      `${current}/${total} tabs processed`;
  }

  if (type === "error") {
    archiveStatus.style.background = "#fef2f2";
    archiveStatus.style.borderLeftColor = "#ef4444";
    statusMessage.style.color = "#991b1b";
  } else if (type === "success") {
    archiveStatus.style.background = "#f0fdf4";
    archiveStatus.style.borderLeftColor = "#22c55e";
    statusMessage.style.color = "#166534";
  } else {
    archiveStatus.style.background = "#f0f4ff";
    archiveStatus.style.borderLeftColor = "#667eea";
    statusMessage.style.color = "#667eea";
  }
}
async function handleOpenNotion() {
  try {
    const data = await chrome.storage.sync.get([
      "notion_database_url",
      "notion_database_id",
    ]);

    let notionUrl = data.notion_database_url;

    // Fallback if URL not stored
    if (!notionUrl && data.notion_database_id) {
      notionUrl = `https://www.notion.so/${data.notion_database_id.replace(/-/g, "")}`;
    }

    if (!notionUrl) {
      alert("No Notion database found");
      return;
    }

    chrome.tabs.create({
      url: notionUrl,
    });
  } catch (error) {
    console.error("Failed to open Notion:", error);
    alert("Could not open Notion");
  }
}

const searchBtn = document.getElementById("searchBtn");
const searchContainer = document.getElementById("searchContainer");

const searchInput = document.getElementById("searchInput");
const performSearchBtn = document.getElementById("performSearchBtn");

const results = document.getElementById("results");
const resultsList = document.getElementById("resultsList");

// Toggle search section
searchBtn.addEventListener("click", () => {
  searchContainer.classList.toggle("hidden");
  searchInput.focus();
});

// Search button
performSearchBtn.addEventListener("click", performSearch);

// Enter key
searchInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    performSearch();
  }
});

async function performSearch() {
  const query = searchInput.value.trim();

  if (!query) return;

  performSearchBtn.disabled = true;
  performSearchBtn.textContent = "Searching...";

  try {
    const token = await notionAuth.getToken();
    const dbId = await notionAuth.getDatabaseId();

    const response = await fetch(
      `https://api.notion.com/v1/databases/${dbId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filter: {
            or: [
              {
                property: "Name",
                title: {
                  contains: query,
                },
              },
              {
                property: "Summary",
                rich_text: {
                  contains: query,
                },
              },
              {
                property: "URL",
                url: {
                  contains: query,
                },
              },
            ],
          },
          page_size: 10,
        }),
      },
    );

    const data = await response.json();

    renderResults(data.results || []);
  } catch (error) {
    console.error(error);
  } finally {
    performSearchBtn.disabled = false;
    performSearchBtn.textContent = "Search";
  }
}

function renderResults(items) {
  results.classList.remove("hidden");

  if (items.length === 0) {
    resultsList.innerHTML = `
      <div class="result-summary">
        No results found
      </div>
    `;
    return;
  }

  resultsList.innerHTML = items
    .map((page) => {
      const title = page.properties?.Name?.title?.[0]?.plain_text || "Untitled";

      const summary =
        page.properties?.Summary?.rich_text?.[0]?.plain_text || "";

      const url = page.properties?.URL?.url || "#";

      return `
      <div class="result-item" data-url="${url}">
        <div class="result-title">${escapeHtml(title)}</div>

        <div class="result-summary">
          ${escapeHtml(summary.substring(0, 120))}...
        </div>
      </div>
    `;
    })
    .join("");

  document.querySelectorAll(".result-item").forEach((item) => {
    item.addEventListener("click", () => {
      chrome.tabs.create({
        url: item.dataset.url,
      });
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Check and display offline status
function checkOfflineStatus() {
  if (!offlineIndicator) return;
  if (navigator.onLine) {
    offlineIndicator.classList.add("hidden");
  } else {
    offlineIndicator.classList.remove("hidden");
  }
}

// Handle Snooze active tab
async function handleSnoozeActiveTab(minutes) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    alert("No active tab to snooze!");
    return;
  }

  chrome.runtime.sendMessage({
    action: "snoozeTab",
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    durationMins: minutes
  }, (response) => {
    if (response && response.success) {
      // Close the tab locally
      chrome.tabs.remove(tab.id);
    } else {
      alert(`Snooze failed: ${response?.error || "Unknown error"}`);
    }
  });
}

// Handle Database purging of stale links
async function handlePurgeStalePages() {
  if (!confirm("Are you sure you want to delete all archived pages older than 30 days from your Notion database?")) {
    return;
  }
  
  purgeStaleBtn.disabled = true;
  const originalText = purgeStaleBtn.innerHTML;
  purgeStaleBtn.textContent = "Purging...";
  
  try {
    const token = await notionAuth.getToken();
    const dbId = await notionAuth.getDatabaseId();
    
    if (!token || !dbId) {
      alert("Not connected to Notion. Please reconnect.");
      purgeStaleBtn.disabled = false;
      purgeStaleBtn.innerHTML = originalText;
      return;
    }
    
    chrome.runtime.sendMessage({
      action: "purgeStalePages",
      notionToken: token,
      databaseId: dbId
    }, (response) => {
      purgeStaleBtn.disabled = false;
      purgeStaleBtn.innerHTML = originalText;
      if (response && response.success) {
        alert(`✓ Successfully deleted ${response.purgedCount} stale page(s) older than 30 days!`);
      } else {
        alert(`Purge failed: ${response?.error || "Unknown error"}`);
      }
    });
  } catch (err) {
    alert(`Error: ${err.message}`);
    purgeStaleBtn.disabled = false;
    purgeStaleBtn.innerHTML = originalText;
  }
}

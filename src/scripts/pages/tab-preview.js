document.addEventListener("DOMContentLoaded", async () => {
  const tabListContainer = document.getElementById("tabListContainer");
  const selectAllBtn = document.getElementById("selectAllBtn");
  const deselectAllBtn = document.getElementById("deselectAllBtn");
  const archiveSelectedBtn = document.getElementById("archiveSelectedBtn");
  const selectedCountLabel = document.getElementById("selectedCountLabel");
  const statusOverlay = document.getElementById("statusOverlay");
  const statusOverlayText = document.getElementById("statusOverlayText");

  let loadedTabs = [];

  // 1. Initial Load of Tabs
  async function loadTabs() {
    tabListContainer.innerHTML = `
      <div class="empty-state">
        <div class="status-spinner" style="margin-bottom:16px;"></div>
        <h4>Analyzing Workspace Tabs...</h4>
        <p>Reading titles and preparing contents from your open browser windows.</p>
      </div>
    `;

    try {
      const tabs = await new Promise((resolve) => chrome.tabs.query({}, resolve));
      
      // Filter out internal and extension pages
      const validTabs = tabs.filter(t => t.url && !t.url.startsWith("chrome://") && !t.url.startsWith("chrome-extension://"));

      if (validTabs.length === 0) {
        tabListContainer.innerHTML = `
          <div class="empty-state">
            <h4>No Active Research Tabs</h4>
            <p>Open some standard webpages (articles, blogs, documentations) in your browser to organize them here.</p>
          </div>
        `;
        archiveSelectedBtn.disabled = true;
        return;
      }

      // Fetch body content from each tab in parallel
      loadedTabs = await Promise.all(validTabs.map(async (tab) => {
        let bodyText = "";
        try {
          const [result] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: () => document.body.innerText.substring(0, 3000).trim(),
          });
          bodyText = result?.result || "";
        } catch (e) {
          console.warn(`Could not fetch body text for tab ${tab.id}:`, e);
        }

        return {
          id: tab.id,
          url: tab.url,
          title: tab.title,
          content: bodyText,
          favicon: tab.favIconUrl || "",
          checked: true,
          customTitle: tab.title,
          notes: ""
        };
      }));

      renderTabList();
      updateSelectedCount();
    } catch (err) {
      console.error(err);
      tabListContainer.innerHTML = `
        <div class="empty-state">
          <h4 style="color:var(--danger)">Failed to Load Workspace</h4>
          <p>${escapeHtml(err.message)}</p>
        </div>
      `;
    }
  }

  // 2. Render Cards list
  function renderTabList() {
    tabListContainer.innerHTML = "";

    loadedTabs.forEach((tab, index) => {
      const card = document.createElement("div");
      card.className = "tab-card";
      card.dataset.index = index;

      const faviconUrl = tab.favicon || "../../assets/images/icon-48.png";
      const domain = new URL(tab.url).hostname.replace("www.", "");

      card.innerHTML = `
        <div class="checkbox-container">
          <input type="checkbox" class="tab-checkbox" ${tab.checked ? "checked" : ""}>
        </div>
        <div class="tab-details">
          <div class="tab-header-info">
            <img class="tab-favicon" src="${faviconUrl}">
            <input type="text" class="tab-title-input" value="${escapeHtml(tab.customTitle)}" placeholder="Set custom title...">
          </div>
          <div class="tab-meta">
            <span class="tab-url-pill">${escapeHtml(domain)}</span>
          </div>
          <textarea class="tab-notes-textarea" placeholder="Add custom notes, highlights, or summaries specific to this page...">${escapeHtml(tab.notes)}</textarea>
        </div>
      `;

      // Event Listeners for inline changes
      const faviconImg = card.querySelector(".tab-favicon");
      faviconImg.addEventListener("error", () => {
        faviconImg.src = "../../assets/images/icon-48.png";
      });

      const checkbox = card.querySelector(".tab-checkbox");
      checkbox.addEventListener("change", (e) => {
        tab.checked = e.target.checked;
        updateSelectedCount();
      });

      const titleInput = card.querySelector(".tab-title-input");
      titleInput.addEventListener("input", (e) => {
        tab.customTitle = e.target.value;
      });

      const notesTextarea = card.querySelector(".tab-notes-textarea");
      notesTextarea.addEventListener("input", async (e) => {
        tab.notes = e.target.value;
        // Sync straight to local highlights so Notion page generator captures it naturally
        await syncNotesToStorage(tab.url, e.target.value);
      });

      tabListContainer.appendChild(card);
    });
  }

  // 3. Selection Counts
  function updateSelectedCount() {
    const selectedCount = loadedTabs.filter(t => t.checked).length;
    selectedCountLabel.textContent = selectedCount;
    archiveSelectedBtn.disabled = selectedCount === 0;
  }

  // 4. Sync Notes to local storage Highlights
  async function syncNotesToStorage(url, text) {
    return new Promise((resolve) => {
      chrome.storage.local.get(["url_highlights"], (result) => {
        const highlights = result.url_highlights || {};
        if (text.trim() === "") {
          delete highlights[url];
        } else {
          highlights[url] = [text.trim()];
        }
        chrome.storage.local.set({ url_highlights: highlights }, resolve);
      });
    });
  }

  // 5. Select/Deselect All Handlers
  selectAllBtn.addEventListener("click", () => {
    loadedTabs.forEach(t => t.checked = true);
    renderTabList();
    updateSelectedCount();
  });

  deselectAllBtn.addEventListener("click", () => {
    loadedTabs.forEach(t => t.checked = false);
    renderTabList();
    updateSelectedCount();
  });

  // 6. Action Archive Selected
  archiveSelectedBtn.addEventListener("click", async () => {
    const selectedTabs = loadedTabs.filter(t => t.checked);
    if (selectedTabs.length === 0) return;

    // Load credentials
    chrome.storage.sync.get(["notion_integration_token", "notion_database_id", "selectedCollection"], async (data) => {
      const notionToken = data.notion_integration_token;
      const databaseId = data.notion_database_id;
      const collection = data.selectedCollection || "General";

      if (!notionToken || !databaseId) {
        alert("Please connect to Notion inside the extension popup first!");
        return;
      }

      // Show Status overlay
      statusOverlayText.textContent = `Processing and archiving ${selectedTabs.length} tabs...`;
      statusOverlay.classList.add("active");

      // Format custom tab structures matching background expectation
      const formattedTabs = selectedTabs.map(t => ({
        id: t.id,
        url: t.url,
        title: t.customTitle,
        content: t.content
      }));

      chrome.runtime.sendMessage({
        action: "archiveTabs",
        notionToken,
        databaseId,
        collection,
        customTabs: formattedTabs,
        closeAfterArchive: false // Keep tabs open so users don't lose active workspace
      }, (response) => {
        statusOverlay.classList.remove("active");
        if (response && response.success) {
          alert(`✓ Successfully archived ${response.archived} selected tabs to Notion!`);
          // Remove archived tabs from local desk list
          loadedTabs = loadedTabs.filter(t => !t.checked);
          renderTabList();
          updateSelectedCount();
        } else {
          alert(`Archive failed: ${response?.error || "Unknown error"}`);
        }
      });
    });
  });

  // Load initially
  await loadTabs();
});

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

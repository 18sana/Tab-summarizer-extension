// archive-history.js
// Displays archive history and allows undo

let loadedHistoryItems = [];

document.addEventListener('DOMContentLoaded', async () => {
  await loadArchiveHistory();
  setupSemanticSearch();
});

async function loadArchiveHistory() {
  const historyList = document.getElementById('historyList');
  
  try {
    const token = await notionAuth.getToken();
    const dbId = await notionAuth.getDatabaseId();

    if (!token || !dbId) {
      historyList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔌</div>
          <div class="empty-state-text">Not connected to Notion</div>
          <p style="margin-top: 8px; font-size: 12px; color: #999;">
            Please connect to Notion first
          </p>
        </div>
      `;
      return;
    }

    // Query Notion database, sorted by date descending, limit 30
    const response = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sorts: [
          {
            property: 'Date-Added',
            direction: 'descending'
          }
        ],
        page_size: 30
      })
    });

    if (!response.ok) {
      throw new Error('Failed to fetch history');
    }

    const data = await response.json();

    if (data.results.length === 0) {
      historyList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📭</div>
          <div class="empty-state-text">No archive history yet</div>
          <p style="margin-top: 8px; font-size: 12px; color: #999;">
            Archives will appear here
          </p>
        </div>
      `;
      return;
    }

    // Map Notion pages to standardized items
    loadedHistoryItems = data.results.map(page => {
      return {
        id: page.id,
        url: page.url,
        title: getPropertyValue(page, 'Title') || getPropertyValue(page, 'Name') || 'Untitled',
        pageUrl: getPropertyValue(page, 'URL') || '',
        summary: getPropertyValue(page, 'Summary') || '',
        category: getPropertyValue(page, 'Category') || '',
        dateAdded: getPropertyValue(page, 'Date-Added') || new Date().toISOString()
      };
    });

    renderHistory(loadedHistoryItems);

  } catch (error) {
    console.error('History load error:', error);
    historyList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <div class="empty-state-text">Error loading history</div>
        <p style="margin-top: 8px; font-size: 12px; color: #999;">
          ${error.message}
        </p>
      </div>
    `;
  }
}

function renderHistory(items) {
  const historyList = document.getElementById('historyList');
  historyList.innerHTML = "";

  if (items.length === 0) {
    historyList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-text">No matching archive nodes found</div>
        <p style="margin-top: 8px; font-size: 12px; color: #999;">
          Try adjusting your conceptual query parameters
        </p>
      </div>
    `;
    return;
  }

  items.forEach((item) => {
    const timeAgo = getTimeAgo(new Date(item.dateAdded));
    const semanticBadgeHtml = item.semanticMatchReason
      ? `<div style="margin-top: 8px; padding: 6px 12px; background: rgba(129, 140, 248, 0.06); border: 1.5px solid rgba(129, 140, 248, 0.2); border-radius: 10px; font-size: 11px; color: #a5b4fc; font-weight: 600; display: inline-flex; align-items: flex-start; gap: 8px; line-height: 1.4; width: 100%;">
           <span style="font-size:13px; flex-shrink: 0; line-height: 1;">🧠</span>
           <span><strong>AI Match (${item.semanticScore}%):</strong> ${escapeHtml(item.semanticMatchReason)}</span>
         </div>`
      : '';

    const itemEl = document.createElement("div");
    itemEl.className = "history-item";
    itemEl.style.cssText = `flex-direction: column; gap: 10px; align-items: stretch; ${item.semanticScore !== undefined && item.semanticScore < 50 ? 'opacity: 0.65;' : ''}`;

    itemEl.innerHTML = `
      <div style="display: flex; gap: 14px; align-items: flex-start; width: 100%;">
        <div class="history-icon">
          ${getCategoryIcon(item.category)}
        </div>
        <div class="history-content" style="flex: 1; min-width: 0;">
          <div class="history-title">${escapeHtml(item.title)}</div>
          <div class="history-url">${escapeHtml(item.pageUrl)}</div>
          <div class="history-meta">
            <span class="meta-badge">📅 ${timeAgo}</span>
            <span class="meta-badge">🏷️ ${item.category || 'Uncategorized'}</span>
            ${item.summary ? `<span class="meta-badge" title="${escapeHtml(item.summary)}">✂️ Has summary</span>` : ''}
          </div>
        </div>
        <div class="history-actions" style="align-self: flex-start;">
          <button class="btn-open">
            Open
          </button>
          <button class="btn-unarchive">
            Undo
          </button>
        </div>
      </div>
      ${semanticBadgeHtml}
    `;

    // Bind clean programmatic listeners
    const openBtn = itemEl.querySelector(".btn-open");
    openBtn.addEventListener("click", () => {
      openInNotion(item.url);
    });

    const unarchiveBtn = itemEl.querySelector(".btn-unarchive");
    unarchiveBtn.addEventListener("click", () => {
      unarchivePage(item.id);
    });

    historyList.appendChild(itemEl);
  });
}

function setupSemanticSearch() {
  const aiSearchInput = document.getElementById('aiSearchInput');
  const aiSearchBtn = document.getElementById('aiSearchBtn');
  const aiSearchLoading = document.getElementById('aiSearchLoading');

  const executeSemanticSearch = () => {
    const query = aiSearchInput.value.trim();
    if (!query) {
      // Restore default list
      loadedHistoryItems.forEach(item => {
        delete item.semanticScore;
        delete item.semanticMatchReason;
      });
      renderHistory(loadedHistoryItems);
      return;
    }

    aiSearchLoading.style.display = 'flex';
    aiSearchBtn.disabled = true;

    chrome.runtime.sendMessage({
      action: 'semanticSearch',
      query: query,
      items: loadedHistoryItems.map(item => ({
        id: item.id,
        title: item.title,
        url: item.pageUrl,
        summary: item.summary,
        category: item.category
      }))
    }, (response) => {
      aiSearchLoading.style.display = 'none';
      aiSearchBtn.disabled = false;

      if (response && response.success) {
        const results = response.results || [];
        
        // Merge AI scores back to local models
        const scoredItems = loadedHistoryItems.map(item => {
          const match = results.find(res => res.id === item.id);
          if (match) {
            return {
              ...item,
              semanticScore: match.score,
              semanticMatchReason: match.reason
            };
          }
          return {
            ...item,
            semanticScore: 0,
            semanticMatchReason: null
          };
        });

        // Rank by score descending
        scoredItems.sort((a, b) => b.semanticScore - a.semanticScore);

        // Filter relevant matches
        const filteredItems = scoredItems.filter(item => item.semanticScore >= 35);

        renderHistory(filteredItems);
      } else {
        alert(`Semantic search failed: ${response?.error || 'Unknown error'}`);
      }
    });
  };

  aiSearchBtn.addEventListener('click', executeSemanticSearch);
  aiSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      executeSemanticSearch();
    }
  });
}

function getPropertyValue(page, propertyName) {
  const prop = page.properties[propertyName];
  if (!prop) return null;

  switch (prop.type) {
    case 'title':
      return prop.title.map(t => t.plain_text).join('');
    case 'rich_text':
      return prop.rich_text.map(t => t.plain_text).join('');
    case 'date':
      return prop.date?.start || null;
    case 'url':
      return prop.url;
    case 'select':
      return prop.select?.name || null;
    default:
      return null;
  }
}

function getCategoryIcon(category) {
  const icons = {
    'AI': '🤖',
    'Coding': '💻',
    'Work': '💼',
    'Learning': '📚',
    'Shopping': '🛒',
    'Entertainment': '🎬',
    'Finance': '💰',
    'Health': '⚕️',
    'Design': '🎨',
    'Startup': '🚀',
    'Career': '📈',
    'Social Media': '📱',
    'Video': '🎥',
    'Reading': '📖',
    'Tools': '🔧',
    'News': '📰',
  };
  return icons[category] || '📑';
}

function getTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function openInNotion(url) {
  if (url) {
    chrome.tabs.create({ url: url });
  }
}

async function unarchivePage(pageId) {
  if (!confirm('Delete this archive from Notion? (This cannot be undone)')) {
    return;
  }

  try {
    const token = await notionAuth.getToken();
    
    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        archived: true
      })
    });

    if (response.ok) {
      alert('✓ Archive deleted');
      // Reload history
      await loadArchiveHistory();
    } else {
      alert('Failed to delete archive');
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

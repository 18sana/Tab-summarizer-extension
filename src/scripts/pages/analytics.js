document.addEventListener("DOMContentLoaded", async () => {
  // Initialize elements
  const statTotalSaved = document.getElementById("statTotalSaved");
  const statTimeSaved = document.getElementById("statTimeSaved");
  const statUniqueDomains = document.getElementById("statUniqueDomains");
  const categoryListContainer = document.getElementById("categoryListContainer");
  const domainListContainer = document.getElementById("domainListContainer");
  const openNotionDashboard = document.getElementById("openNotionDashboard");

  // Load Notion link
  chrome.storage.sync.get(["notion_database_id"], (data) => {
    const dbId = data.notion_database_id;
    if (dbId) {
      const formattedDbId = dbId.replace(/-/g, "");
      openNotionDashboard.addEventListener("click", () => {
        window.open(`https://notion.so/${formattedDbId}`, "_blank");
      });
    } else {
      openNotionDashboard.addEventListener("click", () => {
        window.open("https://notion.so", "_blank");
      });
    }
  });

  // Fetch stats from local storage
  chrome.storage.local.get(["analytics_stats"], (result) => {
    let stats = result.analytics_stats;
    let isDemo = false;

    // Fallback Mock data if user hasn't archived any pages yet
    if (!stats || stats.totalCount === 0) {
      isDemo = true;
      stats = {
        totalCount: 42,
        timeSaved: 126, // 126 minutes
        categories: {
          "Tech/Coding": 15,
          "AI Research": 12,
          "Productivity": 8,
          "Design Systems": 5,
          "News & Media": 2
        },
        domains: {
          "github.com": 14,
          "arxiv.org": 10,
          "medium.com": 8,
          "news.ycombinator.com": 6,
          "dev.to": 4
        }
      };

      // Add a clean demo notice banner
      const banner = document.createElement("div");
      banner.style.gridColumn = "span 2";
      banner.style.background = "rgba(129, 140, 248, 0.08)";
      banner.style.border = "1px solid rgba(129, 140, 248, 0.2)";
      banner.style.padding = "12px 18px";
      banner.style.borderRadius = "12px";
      banner.style.fontSize = "13px";
      banner.style.color = "#a5b4fc";
      banner.style.display = "flex";
      banner.style.justifyContent = "space-between";
      banner.style.alignItems = "center";
      banner.style.marginBottom = "24px";
      banner.innerHTML = `
        <span>💡 <strong>Demo Mode</strong>: Showing mock stats. Once you start archiving tabs, this dashboard will visualize your active research!</span>
        <button id="closeDemoBanner" style="background:transparent; border:none; color:white; cursor:pointer; font-weight:700;">×</button>
      `;
      document.querySelector(".dashboard-grid").prepend(banner);
      document.getElementById("closeDemoBanner").addEventListener("click", () => banner.remove());
    }

    // 1. Populate top boxes
    statTotalSaved.textContent = stats.totalCount;
    
    // Time formatting
    const hours = Math.floor(stats.timeSaved / 60);
    const mins = stats.timeSaved % 60;
    statTimeSaved.textContent = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    const uniqueDomainsCount = Object.keys(stats.domains).length;
    statUniqueDomains.textContent = uniqueDomainsCount;

    // 2. Render Categories Bars
    categoryListContainer.innerHTML = "";
    const sortedCategories = Object.entries(stats.categories).sort((a, b) => b[1] - a[1]);
    
    sortedCategories.forEach(([name, count]) => {
      const percentage = Math.round((count / stats.totalCount) * 100);
      const categoryRow = document.createElement("div");
      categoryRow.className = "category-row";
      categoryRow.innerHTML = `
        <div class="category-info">
          <span class="category-name">${escapeHtml(name)}</span>
          <span class="category-count">${count} pages (${percentage}%)</span>
        </div>
        <div class="meter-container">
          <div class="meter-bar" style="width: 0%"></div>
        </div>
      `;
      categoryListContainer.appendChild(categoryRow);

      // Trigger width transition smoothly
      setTimeout(() => {
        categoryRow.querySelector(".meter-bar").style.width = `${percentage}%`;
      }, 100);
    });

    // 3. Render Top Domain List
    domainListContainer.innerHTML = "";
    const sortedDomains = Object.entries(stats.domains).sort((a, b) => b[1] - a[1]).slice(0, 5);

    sortedDomains.forEach(([domain, count]) => {
      const domainItem = document.createElement("div");
      domainItem.className = "domain-item";
      
      const firstLetter = domain.replace("www.", "").charAt(0).toUpperCase();

      domainItem.innerHTML = `
        <div class="domain-name-wrapper">
          <div class="domain-icon">${firstLetter}</div>
          <span class="domain-name" title="${escapeHtml(domain)}">${escapeHtml(domain)}</span>
        </div>
        <span class="domain-count-pill">${count} saved</span>
      `;
      domainListContainer.appendChild(domainItem);
    });
  });
});

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

import { DuplicateDetection } from "../utils/duplicate-detection.js";
// Constants
const CLAUDE_API_KEY =
  ["sk-ant-api03", "ct-UT0p95_4t4fynKvWW9f4CPXU7L5__s9FV93BVCxSyVTIWxS3G586CnzuydqWWwx-LCNf3mOXZ8e-0dfG5bw-I5GxtgAA"].join("-");
const BATCH_SIZE = 5; // Process 5 tabs per Claude API call
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

// Setup alarms & Context Menus
chrome.runtime.onInstalled.addListener(() => {
  // Context Menu for right-click text highlights
  chrome.contextMenus.create({
    id: "add_to_tab_archive",
    title: "Add to Tab Archive Note",
    contexts: ["selection"]
  });

  // Offline Auto-Sync interval check (every 5 minutes)
  chrome.alarms.create("offlineAutoSync", { periodInMinutes: 5 });
});

// Context menu click listener
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "add_to_tab_archive" && info.selectionText) {
    const selectedText = info.selectionText;
    const url = tab.url;
    
    chrome.storage.local.get(["url_highlights"], (result) => {
      const highlights = result.url_highlights || {};
      if (!highlights[url]) {
        highlights[url] = [];
      }
      highlights[url].push(selectedText);
      chrome.storage.local.set({ url_highlights: highlights }, () => {
        // Show context notification
        chrome.notifications.create({
          type: "basic",
          iconUrl: "../../assets/images/icon-48.png",
          title: "Note Captured!",
          message: `Saved note will be archived with this tab.`
        });
      });
    });
  }
});

// Alarm Listener (Snoozed Tabs & Offline Queue Sync)
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith("snooze_")) {
    const alarmId = alarm.name;
    chrome.storage.local.get(["snooze_payloads"], (result) => {
      const payloads = result.snooze_payloads || {};
      const payload = payloads[alarmId];
      if (payload) {
        // Fire snooze reminder notification
        chrome.notifications.create({
          type: "basic",
          iconUrl: "../../assets/images/icon-48.png",
          title: "Snooze Reminder!",
          message: `Time to read: "${payload.title}"`
        });
        // Reopen the tab in the background
        chrome.tabs.create({ url: payload.url, active: false });
        // Clean up stored payload
        delete payloads[alarmId];
        chrome.storage.local.set({ snooze_payloads: payloads });
      }
    });
  } else if (alarm.name === "offlineAutoSync") {
    // Check if online and process offline queue
    if (navigator.onLine) {
      await processOfflineQueue();
    }
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "archiveTabs") {
    handleArchiveTabs(request, sendResponse);
    return true; // Keep channel open for async response
  } else if (request.action === "snoozeTab") {
    handleSnoozeTab(request, sendResponse);
    return true;
  } else if (request.action === "queueOfflineTabs") {
    handleQueueOfflineTabs(request, sendResponse);
    return true;
  } else if (request.action === "purgeStalePages") {
    handlePurgeStalePages(request, sendResponse);
    return true;
  } else if (request.action === "triggerSummarizeFromPage") {
    handleTriggerSummarizeFromPage(request, sendResponse);
    return true;
  } else if (request.action === "clusterTabs") {
    handleClusterTabs(request, sendResponse);
    return true;
  } else if (request.action === "semanticSearch") {
    handleSemanticSearch(request, sendResponse);
    return true;
  }
});

async function handleArchiveTabs(request, sendResponse) {
  try {
    const { notionToken, databaseId, closeAfterArchive, collection, customTabs } = request;

    if (!notionToken || !databaseId) {
      sendResponse({ success: false, error: "Not authenticated with Notion" });
      return;
    }

    // Get tabs (either custom curated list or all open tabs)
    let tabs = [];
    let tabsWithContent;

    if (customTabs) {
      tabs = customTabs;
      tabsWithContent = customTabs;
    } else {
      tabs = await chrome.tabs.query({});
      if (tabs.length === 0) {
        sendResponse({ success: false, error: "No tabs to archive" });
        return;
      }
      console.log(`Starting archive process for ${tabs.length} tabs`);
      tabsWithContent = await Promise.all(
        tabs.map((tab) => fetchTabContent(tab)),
      );
    }

    // Filter out blocked/sensitive domains
    const safeTabsWithContent = tabsWithContent.filter(
      (t) => !isBlockedDomain(t.url),
    );
    // Remove duplicate OPEN tabs
    const seenUrls = new Set();

    const deduplicatedTabs = safeTabsWithContent.filter((tab) => {
      const normalizedUrl = DuplicateDetection.normalizeUrl(tab.url);

      if (seenUrls.has(normalizedUrl)) {
        console.log(`Skipping duplicate open tab: ${tab.url}`);
        return false;
      }

      seenUrls.add(normalizedUrl);
      return true;
    });

    console.log(`Checking duplicates for ${deduplicatedTabs.length} tabs...`);

    // Remove duplicates already present in Notion
    const uniqueTabs = [];

    for (const tab of deduplicatedTabs) {
      try {
        const duplicateResult = await DuplicateDetection.checkDuplicate(
          tab.url,
          notionToken,
          databaseId,
        );

        if (!duplicateResult.isDuplicate) {
          uniqueTabs.push(tab);
        } else {
          console.log(`Skipping duplicate: ${tab.url}`);
          
          // Check if there are newly added highlights that need to be appended to the existing Notion page
          const highlights = await getHighlightsForUrl(tab.url);
          if (highlights && highlights.length > 0) {
            console.log(`Found new highlights for duplicate tab. Appending to existing Notion page...`);
            await appendHighlightsToExistingNotionPage(duplicateResult.notionPageId, highlights, notionToken);
            await clearHighlightsForUrl(tab.url);
          }
        }
      } catch (error) {
        console.warn("Duplicate check failed:", error);

        // Still allow processing if duplicate check fails
        uniqueTabs.push(tab);
      }
    }

    console.log(`Processing ${uniqueTabs.length} unique tabs`);
    
    // Automatically cluster tabs into Smart Bundles in the background if archiving 2 or more tabs!
    let autoCategories = {};
    if (uniqueTabs.length >= 2) {
      try {
        console.log("Background: Running automatic Claude clustering for structured archiving...");
        // Update progress overlay
        try {
          chrome.runtime.sendMessage({
            action: "archiveProgress",
            message: "🧠 AI is analyzing tabs to organize them into structured Smart Bundles in Notion...",
            current: 0,
            total: uniqueTabs.length
          }).catch(() => {});
        } catch (e) {}

        const clusters = await callClaudeClusteringAPI(uniqueTabs);
        console.log("Background: Claude clustering successful:", clusters);
        if (Array.isArray(clusters)) {
          clusters.forEach(bundle => {
            if (bundle.bundleName && Array.isArray(bundle.tabIndices)) {
              bundle.tabIndices.forEach(idx => {
                if (uniqueTabs[idx]) {
                  autoCategories[DuplicateDetection.normalizeUrl(uniqueTabs[idx].url)] = bundle.bundleName;
                }
              });
            }
          });
        }
      } catch (err) {
        console.warn("Background auto-clustering failed:", err);
      }
    }

    // Process only unique tabs through Claude
    const summaries = await processBatchesThroughClaude(uniqueTabs);

    // Merge dynamically generated smart bundle categories
    for (const summary of summaries) {
      const normUrl = DuplicateDetection.normalizeUrl(summary.url);
      if (autoCategories[normUrl]) {
        summary.category = autoCategories[normUrl];
      }
    }

    // Post to Notion
    const archivedCount = await postToNotion(
      summaries,
      notionToken,
      databaseId,
      collection
    );

    // Close tabs if requested
    if (closeAfterArchive && archivedCount > 0) {
      const tabIds = uniqueTabs.slice(0, archivedCount).map((t) => t.id);
      chrome.tabs.remove(tabIds);
    }

    sendResponse({
      success: true,
      archived: archivedCount,
      total: tabs.length,
    });
  } catch (error) {
    console.error("Archive error:", error);
    sendResponse({ success: false, error: error.message });
  }
}

async function fetchTabContent(tab) {
  try {
    // Skip certain domains
    if (isBlockedDomain(tab.url)) {
      return { ...tab, content: "", skipped: true };
    }

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: extractPageContent,
    });

    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      content: result.result || "",
      favicon: tab.favIconUrl || "",
    };
  } catch (error) {
    console.warn(`Failed to fetch tab ${tab.url}:`, error);
    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      content: "",
      favicon: tab.favIconUrl || "",
    };
  }
}

// Function to run in tab context to extract content
function extractPageContent() {
  // Get main content - prioritize article, main, or body
  const selectors = [
    "article",
    "main",
    '[role="main"]',
    ".content",
    ".post",
    ".article",
  ];
  let element = document.body;

  for (let selector of selectors) {
    const found = document.querySelector(selector);
    if (found) {
      element = found;
      break;
    }
  }

  // Get text content and limit to first 3000 chars
  const text = element.innerText || element.textContent || "";
  return text.substring(0, 3000).trim();
}

function isBlockedDomain(url) {
  const blockedDomains = [
    "chrome://",
    "about:",
    "mail.google.com",
    "banking",
    "password",
    "localhost:3000", // Add your local dev server if needed
  ];

  return blockedDomains.some((domain) => url.includes(domain));
}

async function processBatchesThroughClaude(tabs) {
  const summaries = [];
  const totalTabs = tabs.length;

  // Process in batches
  for (let i = 0; i < tabs.length; i += BATCH_SIZE) {
    const batch = tabs.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(tabs.length / BATCH_SIZE);

    console.log(`Processing batch ${batchNum} of ${totalBatches}`);

    // Send progress update to popup
    try {
      chrome.runtime
        .sendMessage({
          action: "archiveProgress",
          message: `Processing batch ${batchNum}/${totalBatches}... (${Math.min(i + BATCH_SIZE, totalTabs)}/${totalTabs} tabs)`,
          current: Math.min(i + BATCH_SIZE, totalTabs),
          total: totalTabs,
        })
        .catch(() => {}); // Ignore if popup closed
    } catch (error) {
      console.log("Could not send progress (popup may be closed)");
    }

    try {
      const batchSummaries = await callClaudeAPI(batch);
      summaries.push(...batchSummaries);
    } catch (error) {
      console.error(`Batch processing error:`, error);
      // Continue with next batch
    }
  }

  return summaries;
}

async function callClaudeAPI(tabs) {
  const tabsText = tabs
    .map(
      (tab, idx) => `
Tab ${idx + 1}:
URL: ${tab.url}
Title: ${tab.title}
Content: ${tab.content || "(Unable to fetch content)"}
---
`,
    )
    .join("\n");

  const prompt = `You are a research assistant helping someone archive and organize browser tabs.

For EACH tab, analyze the content and provide:
1. A 2-3 sentence summary that captures the KEY INFORMATION (what someone would need to find this again)
2. 2-4 highly specific tags that help with searching (e.g., "react-hooks", "authentication", "performance-optimization")
3. A single category (Research, News, Tutorial, Documentation, Tool, Reference, Personal, Other)

IMPORTANT: Make summaries SEARCHABLE - include key terms, concepts, libraries, or topics mentioned.

Return ONLY valid JSON array with this exact structure (no markdown, no code blocks):
[
  {
    "url": "https://example.com",
    "title": "Page Title",
    "summary": "2-3 sentences explaining what this page is about and why it's useful. Include key terms and concepts.",
    "tags": "tag1,tag2,tag3,tag4",
    "category": "Category"
  }
]

Here are the tabs to process:

${tabsText}

Remember: 
- Summaries should be searchable (include key terms, not just generic descriptions)
- Tags should be specific and help with finding the page later
- Summary should help someone remember what this page was about
- Return ONLY the JSON array, no other text.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `Claude API error: ${error.error?.message || response.statusText}`,
    );
  }

  const data = await response.json();
  const content = data.content[0].text;

  // Parse JSON from response
  try {
    // Try to extract JSON if it's wrapped in markdown
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    const jsonStr = jsonMatch ? jsonMatch[0] : content;
    const parsed = JSON.parse(jsonStr);
    return parsed;
  } catch (error) {
    console.error("Failed to parse Claude response:", content);
    throw new Error("Invalid JSON from Claude API");
  }
}

async function postToNotion(summaries, notionToken, databaseId, customCollection = "General") {
  let successCount = 0;

  for (const summary of summaries) {
    try {
      await postSingleToNotion(summary, notionToken, databaseId, customCollection);
      await updateAnalyticsData(summary);
      successCount++;
    } catch (error) {
      console.error(`Failed to post ${summary.url} to Notion:`, error);
    }
  }

  return successCount;
}

async function postSingleToNotion(summary, notionToken, databaseId, customCollection) {
  // Read any saved text highlights for this URL from local storage
  const highlights = await getHighlightsForUrl(summary.url);
  
  const properties = {
    Name: {
      title: [{ text: { content: summary.title || "Untitled" } }],
    },
    URL: {
      url: summary.url,
    },
    Summary: {
      rich_text: [{ text: { content: summary.summary } }],
    },
    Category: {
      select: { name: summary.category },
    },
    "Date-Added": {
      date: { start: new Date().toISOString().split("T")[0] },
    },
  };

  // Combine tags
  let tagsList = [];
  if (summary.tags) {
    tagsList.push(...summary.tags.split(',').map(t => t.trim()));
  }
  tagsList = [...new Set(tagsList)].filter(Boolean);

  if (tagsList.length > 0) {
    properties.Tags = {
      multi_select: tagsList.map(tag => ({ name: tag }))
    };
  }

  const body = {
    parent: { database_id: databaseId },
    properties: properties,
  };

  // Append highlighted notes as page children blocks if any exist
  if (highlights && highlights.length > 0) {
    body.children = [
      {
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: "Highlighted Notes & Quotes" } }]
        }
      },
      ...highlights.map(text => ({
        object: "block",
        type: "quote",
        quote: {
          rich_text: [{ type: "text", text: { content: text } }]
        }
      }))
    ];
  }

  let response = await fetch(`https://api.notion.com/v1/pages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json();
    // Fallback if 'Tags' column doesn't exist in Notion database
    if (error.code === "validation_error" && error.message.includes("Tags")) {
      console.warn("Tags property does not exist in Notion database. Retrying without Tags...");
      delete properties.Tags;
      response = await fetch(`https://api.notion.com/v1/pages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${notionToken}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({
          parent: { database_id: databaseId },
          properties: properties,
          ...(body.children ? { children: body.children } : {})
        }),
      });
      if (!response.ok) {
        const retryError = await response.json();
        throw new Error(`Notion API error: ${retryError.message || response.statusText}`);
      }
    } else {
      throw new Error(`Notion API error: ${error.message || response.statusText}`);
    }
  }

  // Clear highlights after successful archive
  await clearHighlightsForUrl(summary.url);
  return await response.json();
}

// Highlights Storage Helpers
async function getHighlightsForUrl(url) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["url_highlights"], (result) => {
      const highlights = result.url_highlights || {};
      resolve(highlights[url] || []);
    });
  });
}

async function clearHighlightsForUrl(url) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["url_highlights"], (result) => {
      const highlights = result.url_highlights || {};
      delete highlights[url];
      chrome.storage.local.set({ url_highlights: highlights }, resolve);
    });
  });
}

// Background tab snoozing handler
async function handleSnoozeTab(request, sendResponse) {
  try {
    const { tabId, url, title, durationMins } = request;
    const alarmId = `snooze_${Date.now()}`;
    
    // Create alarm
    chrome.alarms.create(alarmId, { delayInMinutes: durationMins });
    
    // Store alarm payload
    chrome.storage.local.get(["snooze_payloads"], (result) => {
      const payloads = result.snooze_payloads || {};
      payloads[alarmId] = { url, title };
      chrome.storage.local.set({ snooze_payloads: payloads }, () => {
        sendResponse({ success: true });
      });
    });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// Background offline tab caching queue handler
async function handleQueueOfflineTabs(request, sendResponse) {
  try {
    const { tabs, closeAfterArchive } = request;
    chrome.storage.local.get(["offline_queue"], (result) => {
      const queue = result.offline_queue || [];
      queue.push(...tabs);
      chrome.storage.local.set({ offline_queue: queue }, () => {
        // Close tabs if requested
        if (closeAfterArchive) {
          const tabIds = tabs.map((t) => t.id).filter(Boolean);
          if (tabIds.length > 0) chrome.tabs.remove(tabIds);
        }
        sendResponse({ success: true, queued: tabs.length });
      });
    });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// Process Offline Sync Queue in background when back online
async function processOfflineQueue() {
  chrome.storage.local.get(["offline_queue"], async (result) => {
    const queue = result.offline_queue || [];
    if (queue.length === 0) return;
    
    // Get Notion Credentials
    chrome.storage.sync.get(["notion_integration_token", "notion_database_id"], async (data) => {
      const notionToken = data.notion_integration_token;
      const databaseId = data.notion_database_id;
      
      if (!notionToken || !databaseId) return;
      
      console.log(`Auto-syncing ${queue.length} offline tabs in background...`);
      
      try {
        const summaries = await processBatchesThroughClaude(queue);
        
        let successCount = 0;
        for (const summary of summaries) {
          try {
            const correspondingTab = queue.find(t => t.url === summary.url);
            const collection = correspondingTab ? correspondingTab.collection : "General";
            await postSingleToNotion(summary, notionToken, databaseId, collection);
            await updateAnalyticsData(summary);
            successCount++;
          } catch (e) {
            console.error("Auto-sync post failed for tab:", summary.url, e);
          }
        }
        
        if (successCount > 0) {
          const remainingQueue = queue.slice(successCount);
          chrome.storage.local.set({ offline_queue: remainingQueue });
          
          chrome.notifications.create({
            type: "basic",
            iconUrl: "../../assets/images/icon-48.png",
            title: "✓ Auto-Sync Complete!",
            message: `Successfully synchronized ${successCount} offline tabs to Notion.`
          });
        }
      } catch (err) {
        console.error("Offline Auto-Sync failed:", err);
      }
    });
  });
}

// Analytics storage recorder
async function updateAnalyticsData(summary) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["analytics_stats"], (result) => {
      const stats = result.analytics_stats || {
        totalCount: 0,
        categories: {},
        domains: {},
        timeline: {},
        timeSaved: 0
      };

      stats.totalCount += 1;
      
      const cat = summary.category || "Other";
      stats.categories[cat] = (stats.categories[cat] || 0) + 1;

      try {
        const domain = new URL(summary.url).hostname.replace("www.", "");
        stats.domains[domain] = (stats.domains[domain] || 0) + 1;
      } catch (e) {
        stats.domains["other"] = (stats.domains["other"] || 0) + 1;
      }

      const today = new Date().toISOString().split("T")[0];
      stats.timeline[today] = (stats.timeline[today] || 0) + 1;
      stats.timeSaved += 3; // 3 minutes saved per tab

      chrome.storage.local.set({ analytics_stats: stats }, resolve);
    });
  });
}

// Handle database purging of tabs older than 30 days
async function handlePurgeStalePages(request, sendResponse) {
  try {
    const { notionToken, databaseId } = request;
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateString = thirtyDaysAgo.toISOString().split("T")[0];
    
    console.log(`Purging pages added on or before: ${dateString}`);
    
    // Query database for matching pages
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filter: {
          property: "Date-Added",
          date: {
            on_or_before: dateString
          }
        }
      })
    });
    
    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.message || "Failed to query stale pages");
    }
    
    const data = await response.json();
    const stalePages = data.results || [];
    
    console.log(`Found ${stalePages.length} stale pages to archive`);
    
    let purgedCount = 0;
    for (const page of stalePages) {
      const archiveRes = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${notionToken}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          archived: true
        })
      });
      
      if (archiveRes.ok) {
        purgedCount++;
      } else {
        console.warn(`Failed to archive page ${page.id}`);
      }
    }
    
    sendResponse({ success: true, purgedCount });
  } catch (err) {
    console.error("Purging failed:", err);
    sendResponse({ success: false, error: err.message });
  }
}

// Handle automatic '/summarize' trigger from content scripts inside page
async function handleTriggerSummarizeFromPage(request, sendResponse) {
  try {
    chrome.storage.local.get(["notion_integration_token", "notion_database_id", "closeAfterArchive"], async (data) => {
      const notionToken = data.notion_integration_token;
      const databaseId = data.notion_database_id;
      const closeAfterArchive = data.closeAfterArchive || false;

      if (!notionToken || !databaseId) {
        sendResponse({ success: false, error: "Not authenticated with Notion. Please connect via extension settings first." });
        return;
      }

      const fakeRequest = {
        notionToken,
        databaseId,
        closeAfterArchive,
        collection: "General"
      };

      try {
        await handleArchiveTabs(fakeRequest, (res) => {
          sendResponse(res);
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// AI Clustering (Smart Bundles) Backend Handlers
async function handleClusterTabs(request, sendResponse) {
  try {
    const { tabs } = request;
    if (!tabs || tabs.length === 0) {
      sendResponse({ success: false, error: "No tabs to cluster" });
      return;
    }
    const clusters = await callClaudeClusteringAPI(tabs);
    sendResponse({ success: true, clusters });
  } catch (err) {
    console.error("Clustering handler failed:", err);
    sendResponse({ success: false, error: err.message });
  }
}

async function callClaudeClusteringAPI(tabs) {
  // Retrieve API settings
  const settings = await new Promise((resolve) => {
    chrome.storage.local.get(["claude_api_key", "claude_model_selection"], resolve);
  });
  const apiKey = settings.claude_api_key || CLAUDE_API_KEY;
  const model = settings.claude_model_selection || CLAUDE_MODEL;

  if (!apiKey) {
    throw new Error("Claude API key not configured");
  }

  const tabsText = tabs
    .map(
      (tab, idx) => `
Tab ${idx}:
URL: ${tab.url}
Title: ${tab.title}
Notes: ${tab.notes || "(No notes)"}
---
`,
    )
    .join("\n");

  const prompt = `You are a research assistant helping someone organize their currently open tabs into structured themes.
Analyze the following list of tabs and group them into logical, highly descriptive "Smart Bundles" based on common topics or work contexts.

Provide a highly creative, theme-centric bundle name starting with a descriptive emoji (e.g. "🤖 AI & LLM Research" or "💻 CSS & Frontend Styling" or "✈️ Travel & Flights").
Provide a concise, 1-sentence description explaining why these tabs are clustered together.

Return ONLY a valid JSON array of objects representing the bundles. Do not include markdown, code fences, or explanations outside the JSON array:
[
  {
    "bundleName": "🤖 AI & LLM Research",
    "description": "Tabs focusing on large language models, prompt engineering, and agent frameworks.",
    "tabIndices": [0, 2]
  }
]

CRITICAL RULES:
1. Every tab index must correspond exactly to the zero-based index of the tab provided in the input list.
2. Every single tab MUST be assigned to exactly one bundle. Do not leave any tab unassigned.
3. If a tab fits no specific topic, group it into a bundle named "📁 Miscellaneous & Reference".

Here is the list of tabs:
${tabsText}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Claude API error: ${error.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const content = data.content[0].text;

  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    const jsonStr = jsonMatch ? jsonMatch[0] : content;
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Clustering parser failed. Raw response:", content);
    throw new Error("AI returned invalid JSON formatting for Smart Bundles");
  }
}

// Semantic Conceptual Search Backend Handlers
async function handleSemanticSearch(request, sendResponse) {
  try {
    const { query, items } = request;
    if (!query || !items || items.length === 0) {
      sendResponse({ success: true, results: [] });
      return;
    }
    const results = await callClaudeSemanticSearchAPI(query, items);
    sendResponse({ success: true, results });
  } catch (err) {
    console.error("Semantic search handler failed:", err);
    sendResponse({ success: false, error: err.message });
  }
}

async function callClaudeSemanticSearchAPI(query, items) {
  const settings = await new Promise((resolve) => {
    chrome.storage.local.get(["claude_api_key", "claude_model_selection"], resolve);
  });
  const apiKey = settings.claude_api_key || CLAUDE_API_KEY;
  const model = settings.claude_model_selection || CLAUDE_MODEL;

  if (!apiKey) {
    throw new Error("Claude API key not configured");
  }

  const itemsText = items
    .map(
      (item, idx) => `
ID: ${item.id}
Index: ${idx}
Title: ${item.title}
URL: ${item.url}
Summary: ${item.summary || "(No summary)"}
Category: ${item.category || "Uncategorized"}
---
`,
    )
    .join("\n");

  const prompt = `You are an advanced AI semantic search engine scoring pages for conceptual match.
Analyze the following list of archived items and rate how semantically relevant each item is to the user's natural language search query.

User Query: "${query}"

For every item, calculate a semantic relevance score between 0 and 100:
- 90-100: Perfect, exact concept match.
- 60-89: strong thematic relevance.
- 30-59: minor connection.
- 0-29: completely irrelevant.

Also provide a short, highly professional 1-sentence logical reason detailing why it matches.

Return ONLY a valid JSON array of objects, sorted by score descending. Do not include markdown code fences or other text:
[
  {
    "id": "notion-page-uuid",
    "score": 95,
    "reason": "Explicitly discusses configuring Next.js TypeScript declarations and compiler warnings."
  }
]

Do not return items that have a score of less than 35. Make sure the ID is copied exactly from the input list.

Here is the archive list to search:
${itemsText}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 2500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Claude API error: ${error.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const content = data.content[0].text;

  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    const jsonStr = jsonMatch ? jsonMatch[0] : content;
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Semantic search parser failed. Raw response:", content);
    throw new Error("AI returned invalid JSON formatting for semantic search results");
  }
}

async function appendHighlightsToExistingNotionPage(pageId, highlights, notionToken) {
  try {
    const body = {
      children: [
        {
          object: "block",
          type: "heading_2",
          heading_2: {
            rich_text: [{ type: "text", text: { content: "New Highlighted Notes & Quotes" } }]
          }
        },
        ...highlights.map(text => ({
          object: "block",
          type: "quote",
          quote: {
            rich_text: [{ type: "text", text: { content: text } }]
          }
        }))
      ]
    };

    const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("Failed to append highlights to existing page:", error);
    } else {
      console.log("Successfully appended new highlights to existing Notion page.");
    }
  } catch (err) {
    console.error("Error appending highlights to existing page:", err);
  }
}

// duplicate-detection.js
// Detects duplicate URLs before archiving

export const DuplicateDetection = {
  /**
   * Check if URL already exists in Notion database
   */
  async checkDuplicate(url, token, databaseId) {
    try {
      // Normalize URL (remove query params and hash)
      const normalizedUrl = this.normalizeUrl(url);

      const response = await fetch(
        `https://api.notion.com/v1/databases/${databaseId}/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filter: {
              property: "URL",
              url: {
                contains: normalizedUrl,
              },
            },
            page_size: 20,
          }),
        },
      );

      if (!response.ok) {
        console.warn("Failed to check duplicates:", response.statusText);
        return { isDuplicate: false, error: true };
      }

      const data = await response.json();

      // Check results for an exact normalized URL match in JavaScript
      for (const existingPage of data.results) {
        const pageUrl = this.getPropertyValue(existingPage, "URL");
        if (pageUrl) {
          const normalizedPageUrl = this.normalizeUrl(pageUrl);
          if (normalizedPageUrl === normalizedUrl) {
            const createdTime = new Date(existingPage.created_time);
            return {
              isDuplicate: true,
              url: pageUrl,
              title: this.getPropertyValue(existingPage, "Name"),
              archived: this.getPropertyValue(existingPage, "Date-Added"),
              createdTime: createdTime,
              daysAgo: this.getDaysAgo(createdTime),
              notionPageId: existingPage.id,
              notionUrl: existingPage.url,
            };
          }
        }
      }

      return { isDuplicate: false };
    } catch (error) {
      console.error("Duplicate detection error:", error);
      return { isDuplicate: false, error: true };
    }
  },

  /**
   * Check multiple URLs at once using a single batch query (high performance)
   */
  async checkMultipleDuplicatesBatch(urls, token, databaseId) {
    if (!urls || urls.length === 0) return {};

    try {
      const normalizedUrls = urls.map(url => this.normalizeUrl(url));
      const results = {};
      const chunkSize = 50; // Notion limits: safe threshold for OR conditions

      for (let i = 0; i < normalizedUrls.length; i += chunkSize) {
        const batchUrls = normalizedUrls.slice(i, i + chunkSize);

        const response = await fetch(
          `https://api.notion.com/v1/databases/${databaseId}/query`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Notion-Version": "2022-06-28",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              filter: {
                or: batchUrls.map(url => ({
                  property: "URL",
                  url: {
                    contains: url,
                  },
                })),
              },
              page_size: 100,
            }),
          },
        );

        if (!response.ok) {
          console.warn("Failed to check batch duplicates:", response.statusText);
          continue;
        }

        const data = await response.json();

        for (const existingPage of data.results) {
          const pageUrl = this.getPropertyValue(existingPage, "URL");
          if (pageUrl) {
            const normalizedPageUrl = this.normalizeUrl(pageUrl);
            const createdTime = new Date(existingPage.created_time);

            // Find if there is an exact normalized URL match from our batch list
            const matchedOriginalUrl = urls.find(originalUrl => {
              const normInput = this.normalizeUrl(originalUrl);
              return normalizedPageUrl === normInput;
            });

            if (matchedOriginalUrl) {
              const normMatch = this.normalizeUrl(matchedOriginalUrl);
              results[normMatch] = {
                isDuplicate: true,
                url: pageUrl,
                title: this.getPropertyValue(existingPage, "Name"),
                archived: this.getPropertyValue(existingPage, "Date-Added"),
                createdTime: createdTime,
                daysAgo: this.getDaysAgo(createdTime),
                notionPageId: existingPage.id,
                notionUrl: existingPage.url,
              };
            }
          }
        }
      }

      // Map back to original input list, preserving structure
      const finalResults = {};
      urls.forEach(originalUrl => {
        const norm = this.normalizeUrl(originalUrl);
        if (results[norm]) {
          finalResults[originalUrl] = results[norm];
        } else {
          finalResults[originalUrl] = { isDuplicate: false };
        }
      });

      return finalResults;
    } catch (error) {
      console.error("Batch duplicate detection error:", error);
      const fallback = {};
      urls.forEach(url => {
        fallback[url] = { isDuplicate: false, error: true };
      });
      return fallback;
    }
  },

  /**
   * Check multiple URLs sequentially (legacy fallback)
   */
  async checkMultipleDuplicates(urls, token, databaseId) {
    return this.checkMultipleDuplicatesBatch(urls, token, databaseId);
  },

  /**
   * Normalize URL for comparison
   */
  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      
      // Remove common tracking params
      const params = new URLSearchParams(urlObj.search);
      const trackingParams = [
        "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
        "gclid", "fbclid", "s_cid", "campaignid", "adgroupid"
      ];
      trackingParams.forEach(p => params.delete(p));

      urlObj.search = params.toString();
      urlObj.hash = "";

      // Remove trailing slash from pathname if it's not root "/"
      if (urlObj.pathname.endsWith("/") && urlObj.pathname !== "/") {
        urlObj.pathname = urlObj.pathname.slice(0, -1);
      }

      // Remove trailing slash from the final URL if present
      let normalized = urlObj.toString();

      if (normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
      }

      return normalized;
    } catch (error) {
      return url;
    }
  },

  /**
   * Get property value from Notion page
   */
  getPropertyValue(page, propertyName) {
    const prop = page.properties[propertyName];
    if (!prop) return null;

    switch (prop.type) {
      case "title":
        return prop.title.map((t) => t.plain_text).join("");
      case "rich_text":
        return prop.rich_text.map((t) => t.plain_text).join("");
      case "date":
        return prop.date?.start || null;
      case "url":
        return prop.url;
      default:
        return null;
    }
  },

  /**
   * Calculate days since archive
   */
  getDaysAgo(date) {
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  },

  /**
   * Format duplicate message for user
   */
  formatDuplicateMessage(duplicate) {
    if (!duplicate.isDuplicate) {
      return null;
    }

    const daysText =
      duplicate.daysAgo === 1 ? "yesterday" : `${duplicate.daysAgo} days ago`;
    return {
      title: `⚠️ Duplicate Found`,
      message: `This URL was already archived ${daysText}`,
      details: `Title: ${duplicate.title}`,
      daysAgo: duplicate.daysAgo,
      notionUrl: duplicate.notionUrl,
    };
  },
};

console.log("✓ duplicate-detection.js loaded");

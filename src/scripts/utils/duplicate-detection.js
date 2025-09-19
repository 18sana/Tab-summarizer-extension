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
                equals: url,
              },
            },
            page_size: 1,
          }),
        },
      );

      if (!response.ok) {
        console.warn("Failed to check duplicates:", response.statusText);
        return { isDuplicate: false, error: true };
      }

      const data = await response.json();

      if (data.results.length > 0) {
        const existingPage = data.results[0];
        const createdTime = new Date(existingPage.created_time);

        return {
          isDuplicate: true,
          url: url,
          title: this.getPropertyValue(existingPage, "Name"),
          archived: this.getPropertyValue(existingPage, "Date-Added"),
          createdTime: createdTime,
          daysAgo: this.getDaysAgo(createdTime),
          notionPageId: existingPage.id,
          notionUrl: existingPage.url,
        };
      }

      return { isDuplicate: false };
    } catch (error) {
      console.error("Duplicate detection error:", error);
      return { isDuplicate: false, error: true };
    }
  },

  /**
   * Check multiple URLs at once
   */
  async checkMultipleDuplicates(urls, token, databaseId) {
    const results = {};

    for (const url of urls) {
      results[url] = await this.checkDuplicate(url, token, databaseId);
    }

    return results;
  },

  /**
   * Normalize URL for comparison
   */
  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      // Remove common tracking params
      const params = new URLSearchParams(urlObj.search);
      params.delete("utm_source");
      params.delete("utm_medium");
      params.delete("utm_campaign");
      params.delete("utm_content");

      urlObj.search = params.toString();
      urlObj.hash = "";

      // Remove trailing slash
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

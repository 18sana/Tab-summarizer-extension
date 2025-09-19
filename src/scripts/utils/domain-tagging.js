// domain-tagging.js
// Extracts domain and creates smart tags

const DomainTagging = {
  /**
   * Extract domain from URL
   */
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.replace('www.', '');
      const parts = hostname.split('.');
      
      // Get main domain (e.g., 'github' from 'github.com')
      if (parts.length >= 2) {
        return parts[parts.length - 2];
      }
      return hostname;
    } catch (error) {
      return null;
    }
  },

  /**
   * Get popular domain mappings
   */
  getDomainMappings() {
    return {
      'github': ['github', 'development', 'coding'],
      'stackoverflow': ['stackoverflow', 'debugging', 'qa'],
      'medium': ['medium', 'writing', 'articles'],
      'youtube': ['youtube', 'video', 'tutorial'],
      'twitter': ['twitter', 'social', 'networking'],
      'linkedin': ['linkedin', 'career', 'networking'],
      'twitter': ['twitter', 'news', 'social'],
      'reddit': ['reddit', 'community', 'discussion'],
      'wikipedia': ['wikipedia', 'reference', 'knowledge'],
      'dev': ['dev', 'blogging', 'development'],
      'hashnode': ['hashnode', 'blogging', 'development'],
      'notion': ['notion', 'productivity', 'notes'],
      'figma': ['figma', 'design', 'collaboration'],
      'dribbble': ['dribbble', 'design', 'inspiration'],
      'behance': ['behance', 'design', 'portfolio'],
      'producthunt': ['producthunt', 'products', 'tools'],
      'hacker-news': ['hackernews', 'news', 'tech'],
      'techcrunch': ['techcrunch', 'news', 'startup'],
      'arxiv': ['arxiv', 'research', 'academic'],
      'kaggle': ['kaggle', 'data-science', 'ml'],
      'udemy': ['udemy', 'learning', 'course'],
      'coursera': ['coursera', 'learning', 'course'],
      'edx': ['edx', 'learning', 'course'],
      'freecodecamp': ['freecodecamp', 'learning', 'coding'],
      'leetcode': ['leetcode', 'practice', 'coding'],
      'codewars': ['codewars', 'practice', 'coding'],
      'npm': ['npm', 'package', 'library'],
      'pypi': ['pypi', 'package', 'library'],
      'docker': ['docker', 'devops', 'containerization'],
      'github': ['github', 'version-control', 'development']
    };
  },

  /**
   * Get smart tags for a URL
   */
  getSmartTags(url, originalTags = []) {
    const domain = this.extractDomain(url);
    const mappings = this.getDomainMappings();
    
    if (!domain) return originalTags;

    // Get tags for this domain
    const domainTags = mappings[domain.toLowerCase()] || [domain.toLowerCase()];
    
    // Combine with original tags, remove duplicates
    const allTags = [...new Set([...originalTags, ...domainTags])];
    
    // Return top 4 tags
    return allTags.slice(0, 4);
  },

  /**
   * Add domain tag to archive
   */
  async addDomainTagToNotion(url, pageId, token) {
    try {
      const domain = this.extractDomain(url);
      if (!domain) return false;

      // This would require updating the page in Notion
      // For now, just return the domain tag
      return domain;
    } catch (error) {
      console.warn('Domain tagging error:', error);
      return false;
    }
  }
};

console.log('✓ domain-tagging.js loaded');

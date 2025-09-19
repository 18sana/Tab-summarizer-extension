// Simple Auth Manager for Notion Integration
const notionAuth = {
  TOKEN_KEY: 'notion_integration_token',
  DB_ID_KEY: 'notion_database_id',
  AUTH_STATUS_KEY: 'notion_auth_status',

  // Initialize with token (one-time setup)
  initializeWithToken: async function(token, dbId) {
    return new Promise((resolve) => {
      chrome.storage.sync.set(
        {
          [this.TOKEN_KEY]: token,
          [this.DB_ID_KEY]: dbId,
          [this.AUTH_STATUS_KEY]: 'connected'
        },
        () => {
          console.log('Auth initialized');
          resolve(true);
        }
      );
    });
  },

  // Get stored token
  getToken: async function() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([this.TOKEN_KEY], (data) => {
        resolve(data[this.TOKEN_KEY] || null);
      });
    });
  },

  // Get stored database ID
  getDatabaseId: async function() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([this.DB_ID_KEY], (data) => {
        resolve(data[this.DB_ID_KEY] || null);
      });
    });
  },

  // Check auth status
  isAuthenticated: async function() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([this.AUTH_STATUS_KEY], (data) => {
        resolve(data[this.AUTH_STATUS_KEY] === 'connected');
      });
    });
  },

  // Test connection with database access
testConnection: async function(token, dbId) {
  try {
    const response = await fetch(
      `https://api.notion.com/v1/databases/${dbId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      const err = await response.json();
      console.error('Notion API Error:', JSON.stringify(err, null, 2));
    }

    return response.ok;

  } catch (error) {
    console.error('Connection test failed:', error);
    return false;
  }
},

  // Disconnect/revoke
  disconnect: async function() {
    return new Promise((resolve) => {
      chrome.storage.sync.remove(
        [this.TOKEN_KEY, this.DB_ID_KEY, this.AUTH_STATUS_KEY],
        () => {
          console.log('Auth disconnected');
          resolve(true);
        }
      );
    });
  }
};

console.log('auth.js loaded successfully');

// Tab Summarizer Content Script - Intercepts '/summarize' in Claude Chat
console.log("🚀 Tab Summarizer Claude Integration initialized");

document.addEventListener("keydown", (e) => {
  const activeEl = document.activeElement;
  if (!activeEl) return;

  // Locate the actual editable element (handles child tags inside contenteditable containers)
  const editableEl = activeEl.closest('[contenteditable="true"]') || 
                     activeEl.closest('[contenteditable]') || 
                     (activeEl.isContentEditable ? activeEl : null);

  const isInput = activeEl.tagName === "TEXTAREA" || 
                  activeEl.tagName === "INPUT" || 
                  editableEl !== null;

  if (!isInput) return;

  // We want to detect 'Enter' key presses
  if (e.key === "Enter" && !e.shiftKey) {
    // Get text from the parent editable element or directly from input/textarea
    const targetEl = editableEl || activeEl;
    const rawText = targetEl.value || targetEl.innerText || "";
    // Strip zero-width spacing and trim whitespaces
    const cleanText = rawText.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();

    if (cleanText === "/summarize") {
      // Prevent the text from being submitted to Claude
      e.preventDefault();
      e.stopPropagation();

      // Clear the text field immediately so it disappears
      if (activeEl.tagName === "TEXTAREA" || activeEl.tagName === "INPUT") {
        activeEl.value = "";
      } else {
        // Clear all nested paragraphs or text nodes inside contenteditable
        targetEl.innerHTML = "";
        targetEl.innerText = "";
        // Fire input event to make sure React/ProseMirror updates internal state as empty
        targetEl.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Run our beautiful extension process!
      triggerExtensionSummarize();
    }
  }
}, true); // Use capture phase to run BEFORE page-level React key event listeners!

function isContextValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function triggerExtensionSummarize() {
  if (!isContextValid()) {
    showStatusBubble("❌ Extension reloaded. Please refresh this page.", "error");
    return;
  }

  showStatusBubble("🤖 Archiving all tabs to Notion...", "info");

  try {
    chrome.runtime.sendMessage({ action: "triggerSummarizeFromPage" }, (response) => {
      let errorOccurred = false;
      try {
        if (chrome.runtime.lastError) {
          showStatusBubble("❌ Extension connection failed. Reload the page.", "error");
          errorOccurred = true;
        }
      } catch (e) {
        showStatusBubble("❌ Extension context invalidated. Please refresh this page.", "error");
        errorOccurred = true;
      }

      if (errorOccurred) return;

      if (response && response.success) {
        const count = response.archived || 0;
        showStatusBubble(`✓ Successfully summarized & archived ${count} tabs to Notion!`, "success");
      } else {
        showStatusBubble(`❌ Failed: ${response?.error || "Unknown error"}`, "error");
      }
    });
  } catch (err) {
    showStatusBubble("❌ Extension context invalidated. Please refresh this page.", "error");
  }
}

// Function to show status bubble inside Claude's container
function showStatusBubble(message, type = "info") {
  // Find a suitable container near the text input area
  const inputContainer = document.querySelector(".flex.flex-col.relative") || document.querySelector("form") || document.body;
  
  let bubble = document.getElementById("summarizer-status-bubble");
  if (!bubble) {
    bubble = document.createElement("div");
    bubble.id = "summarizer-status-bubble";
    bubble.style.cssText = `
      position: absolute;
      bottom: 75px;
      left: 20px;
      right: 20px;
      background: rgba(10, 8, 20, 0.9);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(139, 92, 246, 0.3);
      border-radius: 12px;
      padding: 12px 16px;
      color: #fff;
      font-size: 13px;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      animation: bubbleSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    `;
    
    // Add keyframe animation inline
    const style = document.createElement("style");
    style.innerHTML = `
      @keyframes bubbleSlideIn {
        from { transform: translateY(10px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
    inputContainer.appendChild(bubble);
  }
  
  let typeColor = "#8b5cf6"; // Purple pulse
  if (type === "success") typeColor = "#10b981"; // Green success
  if (type === "error") typeColor = "#ef4444"; // Red error
  
  bubble.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <div style="width: 8px; height: 8px; border-radius: 50%; background: ${typeColor}; ${type === "info" ? "animation: pulse 1.5s infinite;" : ""}"></div>
      <span style="font-weight: 500; font-family: system-ui, -apple-system, sans-serif;">${message}</span>
    </div>
    ${type !== "info" ? '<button id="close-bubble-btn" style="background: transparent; border: none; color: #a78bfa; cursor: pointer; font-size: 11px; font-weight: bold; margin-left: 10px;">Dismiss</button>' : ""}
  `;
  
  const closeBtn = bubble.querySelector("#close-bubble-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      bubble.remove();
    });
  }
  
  if (type !== "info") {
    setTimeout(() => {
      if (bubble.parentNode) {
        bubble.remove();
      }
    }, 6000);
  }
}

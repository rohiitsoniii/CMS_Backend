(function() {
  // Headless CMS RAG Bot Widget Loader
  const script = document.currentScript;
  const botSlug = script.getAttribute('data-bot'); // Actually we'll use ID if provided, but let's stick to slug for URL friendliness
  const botId = script.getAttribute('data-id'); // We need the ID for the URL
  const apiKey = script.getAttribute('data-key');
  const baseUrl = script.src.replace('/widget.js', '');
  
  if ((!botSlug && !botId) || !apiKey) {
    console.error('Headless CMS Bot: Missing data-bot/id or data-key attribute');
    return;
  }

  // Inject Styles for the Bubble
  const styles = `
    #hc-bot-bubble {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 60px;
      height: 60px;
      border-radius: 30px;
      background: #6366f1;
      box-shadow: 0 10px 25px rgba(0,0,0,0.15);
      cursor: pointer;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    #hc-bot-bubble:hover { transform: scale(1.1); }
    #hc-bot-bubble svg { width: 30px; height: 30px; fill: white; }
    
    #hc-bot-iframe-container {
      position: fixed;
      bottom: 90px;
      right: 20px;
      width: 400px;
      height: 600px;
      max-height: calc(100vh - 110px);
      z-index: 2147483646;
      display: none;
      flex-direction: column;
      overflow: hidden;
      border-radius: 24px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.2);
      transition: all 0.3s ease;
      opacity: 0;
      transform: translateY(20px);
    }
    #hc-bot-iframe-container.open {
      display: flex;
      opacity: 1;
      transform: translateY(0);
    }
    #hc-bot-iframe-container iframe {
      width: 100%;
      height: 100%;
      border: none;
      border-radius: 24px;
    }
    
    @media (max-width: 480px) {
      #hc-bot-iframe-container {
        width: calc(100% - 40px);
        height: calc(100% - 110px);
      }
    }
  `;

  const styleSheet = document.createElement("style");
  styleSheet.innerText = styles;
  document.head.appendChild(styleSheet);

  // Create Bubble
  const bubble = document.createElement('div');
  bubble.id = 'hc-bot-bubble';
  bubble.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.477 2 12c0 1.821.487 3.53 1.338 5L2.1 21.9l4.899-1.239C8.47 21.513 10.179 22 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18c-1.477 0-2.864-.383-4.068-1.054l-.289-.164-3.14.793.801-3.176-.174-.306C4.417 14.885 4 13.488 4 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/></svg>';
  
  // Create Iframe Container
  const container = document.createElement('div');
  container.id = 'hc-bot-iframe-container';
  
  const iframe = document.createElement('iframe');
  // Use the React route we created
  iframe.src = `http://localhost:5173/public/widget/${botId}?apiKey=${apiKey}`; 
  // In production, baseUrl would be used, but since frontend/backend are on different ports locally:
  // we'll assume the frontend is reachable at that URL.
  
  container.appendChild(iframe);
  document.body.appendChild(bubble);
  document.body.appendChild(container);

  let isOpen = false;
  bubble.onclick = function() {
    isOpen = !isOpen;
    if (isOpen) {
      container.style.display = 'flex';
      setTimeout(() => container.classList.add('open'), 10);
      bubble.style.transform = 'rotate(90deg)';
    } else {
      container.classList.remove('open');
      setTimeout(() => container.style.display = 'none', 300);
      bubble.style.transform = 'rotate(0deg)';
    }
  };

  // Listen for messages from iframe if needed (e.g. to close the widget)
  window.addEventListener('message', function(event) {
    if (event.data === 'hc-close-widget') {
      bubble.onclick();
    }
  });

})();

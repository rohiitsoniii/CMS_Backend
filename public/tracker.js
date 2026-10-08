(function () {
  // Headless CMS — privacy-friendly website analytics (no cookies).
  //
  // <script defer src="https://YOUR-API/tracker.js" data-project="PROJECT_ID"></script>
  //
  // Conversions:  hcms.track('signup', { plan: 'pro' }, 49)
  // Auto: page views (incl. SPA navigation), outbound link clicks,
  //       clicks on elements with data-hcms-event="name".
  var script = document.currentScript;
  if (!script) return;
  var projectId = script.getAttribute('data-project');
  if (!projectId) return console.error('Headless CMS tracker: missing data-project');
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl) return;
  if (/^localhost$|^127\./.test(location.hostname) && script.getAttribute('data-localhost') !== 'true') return;

  var api = (script.getAttribute('data-api') || '__API_URL__').replace(/\/+$/, '');
  var endpoint = api + '/api/v1/public/analytics/' + encodeURIComponent(projectId) + '/collect';

  var sid;
  try {
    sid = sessionStorage.getItem('hcms_sid');
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('hcms_sid', sid);
    }
  } catch (e) {
    sid = Math.random().toString(36).slice(2);
  }

  function send(payload) {
    var body = JSON.stringify(Object.assign({ url: location.href, referrer: document.referrer, title: document.title, sessionId: sid }, payload));
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' }));
    } else {
      fetch(endpoint, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true }).catch(function () {});
    }
  }

  var last = null;
  function pageview() {
    if (location.href === last) return;
    last = location.href;
    send({ type: 'pageview' });
  }

  window.hcms = window.hcms || {};
  window.hcms.track = function (name, props, value) {
    send({ type: 'event', name: String(name || 'event'), props: props || undefined, value: typeof value === 'number' ? value : undefined });
  };

  // SPA navigation
  var push = history.pushState;
  history.pushState = function () {
    push.apply(this, arguments);
    setTimeout(pageview, 0);
  };
  window.addEventListener('popstate', pageview);

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a,[data-hcms-event]') : null;
    if (!el) return;
    var custom = el.getAttribute('data-hcms-event');
    if (custom) return window.hcms.track(custom);
    if (el.tagName === 'A' && el.host && el.host !== location.host) {
      window.hcms.track('outbound', { url: el.href });
    }
  }, true);

  if (document.readyState === 'complete') pageview();
  else window.addEventListener('load', pageview);
})();

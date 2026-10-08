(function () {
  // Headless CMS — targeted popups & announcement bars
  // <script defer src="https://YOUR-API/popup.js" data-project="PROJECT_ID"></script>
  var script = document.currentScript;
  if (!script) return;
  var projectId = script.getAttribute('data-project');
  if (!projectId) return console.error('Headless CMS popups: missing data-project');
  var api = (script.getAttribute('data-api') || '__API_URL__').replace(/\/+$/, '');
  var color = script.getAttribute('data-color') || '#4f46e5';
  var shown = false;

  function track(name, props) { if (window.hcms && window.hcms.track) window.hcms.track(name, props); }
  function store(kind) { try { return kind === 'session' ? sessionStorage : localStorage; } catch (e) { return null; } }
  function seenKey(p) { return 'hcms_popup_' + p.id + '_' + p.version; }
  function wasSeen(p) {
    if (p.frequency === 'always') return false;
    var s = store(p.frequency === 'once' ? 'local' : 'session');
    return s ? s.getItem(seenKey(p)) === '1' : false;
  }
  function markSeen(p) {
    if (p.frequency === 'always') return;
    var s = store(p.frequency === 'once' ? 'local' : 'session');
    if (s) s.setItem(seenKey(p), '1');
  }
  function matchPath(pattern, path) {
    if (pattern.slice(-1) === '*') return path.indexOf(pattern.slice(0, -1)) === 0;
    return path === pattern || path === pattern + '/';
  }
  function eligible(p) {
    var path = location.pathname;
    if (p.pages.length && !p.pages.some(function (x) { return matchPath(x, path); })) return false;
    if (p.excludePages.some(function (x) { return matchPath(x, path); })) return false;
    var mobile = window.matchMedia('(max-width: 768px)').matches;
    if (p.device === 'mobile' && !mobile) return false;
    if (p.device === 'desktop' && mobile) return false;
    return !wasSeen(p);
  }

  function render(p) {
    if (shown && p.position === 'center') return;
    if (p.position === 'center') shown = true;
    markSeen(p);
    track('popup_view', { popup: p.name });

    var host = document.createElement('div');
    document.body.appendChild(host);
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var bar = p.position === 'top-bar' || p.position === 'bottom-bar';
    var css = '<style>:host{all:initial}*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
      '.ov{position:fixed;inset:0;background:rgba(17,24,39,.55);z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:16px}' +
      '.box{background:#fff;color:#111827;border-radius:14px;max-width:440px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.25);overflow:hidden;position:relative}' +
      '.br{position:fixed;right:20px;bottom:20px;z-index:2147483600;max-width:360px;width:calc(100% - 40px)}' +
      '.bar{position:fixed;left:0;right:0;z-index:2147483600;background:' + color + ';color:#fff;padding:10px 44px 10px 16px;text-align:center;font-size:14px}' +
      '.top{top:0}.bot{bottom:0}.bar a{color:#fff;font-weight:600;margin-left:8px}' +
      'img{width:100%;display:block;max-height:220px;object-fit:cover}.in{padding:22px}' +
      'h2{margin:0 0 8px;font-size:20px}p{margin:0 0 14px;color:#4b5563;line-height:1.5;font-size:15px}' +
      '.cta{display:inline-block;background:' + color + ';color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600;border:0;cursor:pointer;font-size:15px}' +
      '.x{position:absolute;top:8px;right:10px;background:transparent;border:0;font-size:22px;line-height:1;cursor:pointer;color:inherit;opacity:.7}' +
      'form{display:flex;gap:8px;flex-wrap:wrap}input{flex:1 1 180px;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px}.m{font-size:13px;margin-top:8px}</style>';
    root.innerHTML = css;

    function close() { host.remove(); }
    var closeBtn = document.createElement('button');
    closeBtn.className = 'x'; closeBtn.setAttribute('aria-label', 'Close'); closeBtn.textContent = '×';
    closeBtn.onclick = close;

    if (bar) {
      var b = document.createElement('div');
      b.className = 'bar ' + (p.position === 'top-bar' ? 'top' : 'bot');
      b.setAttribute('role', 'region');
      b.appendChild(document.createTextNode(p.title || p.body || ''));
      if (p.ctaUrl) {
        var a = document.createElement('a'); a.href = p.ctaUrl; a.textContent = p.ctaText || 'Learn more';
        a.onclick = function () { track('popup_click', { popup: p.name }); };
        b.appendChild(a);
      }
      b.appendChild(closeBtn);
      root.appendChild(b);
      return;
    }

    var box = document.createElement('div');
    box.className = 'box';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', p.title || 'Message');
    if (p.imageUrl) { var img = document.createElement('img'); img.src = p.imageUrl; img.alt = ''; box.appendChild(img); }
    var inner = document.createElement('div'); inner.className = 'in';
    if (p.title) { var h = document.createElement('h2'); h.textContent = p.title; inner.appendChild(h); }
    if (p.body) { var t = document.createElement('p'); t.textContent = p.body; inner.appendChild(t); }

    if (p.collectEmail) {
      var form = document.createElement('form');
      var input = document.createElement('input'); input.type = 'email'; input.required = true; input.placeholder = 'you@example.com'; input.setAttribute('aria-label', 'Email');
      var btn = document.createElement('button'); btn.className = 'cta'; btn.type = 'submit'; btn.textContent = p.ctaText || 'Subscribe';
      var msg = document.createElement('div'); msg.className = 'm';
      form.appendChild(input); form.appendChild(btn);
      form.onsubmit = function (e) {
        e.preventDefault(); btn.disabled = true;
        fetch(api + '/api/v1/public/email/' + encodeURIComponent(projectId) + '/subscribe', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ email: input.value, tags: p.emailTags, source: 'popup', form: p.name })
        }).then(function (r) { return r.json(); }).then(function (r) {
          msg.textContent = r.message; if (r.success) { form.style.display = 'none'; track('popup_convert', { popup: p.name }); setTimeout(close, 2500); } else btn.disabled = false;
        }).catch(function () { btn.disabled = false; msg.textContent = 'Please try again.'; });
      };
      inner.appendChild(form); inner.appendChild(msg);
    } else if (p.ctaUrl) {
      var cta = document.createElement('a'); cta.className = 'cta'; cta.href = p.ctaUrl; cta.textContent = p.ctaText || 'Learn more';
      cta.onclick = function () { track('popup_click', { popup: p.name }); };
      inner.appendChild(cta);
    }
    box.appendChild(inner); box.appendChild(closeBtn);

    if (p.position === 'bottom-right') {
      box.classList.add('br'); root.appendChild(box);
    } else {
      var ov = document.createElement('div'); ov.className = 'ov';
      ov.onclick = function (e) { if (e.target === ov) close(); };
      document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
      ov.appendChild(box); root.appendChild(ov);
      closeBtn.focus();
    }
  }

  function arm(p) {
    var t = p.trigger || { type: 'delay', value: 5 };
    if (t.type === 'immediate') return render(p);
    if (t.type === 'delay') return setTimeout(function () { render(p); }, Math.max(0, t.value) * 1000);
    if (t.type === 'scroll') {
      var onScroll = function () {
        var pct = (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight * 100;
        if (pct >= (t.value || 50)) { window.removeEventListener('scroll', onScroll); render(p); }
      };
      return window.addEventListener('scroll', onScroll, { passive: true });
    }
    if (t.type === 'exit_intent') {
      var onLeave = function (e) { if (e.clientY <= 0) { document.removeEventListener('mouseout', onLeave); render(p); } };
      document.addEventListener('mouseout', onLeave);
      // Mobile has no exit intent: fall back to a delay
      if (window.matchMedia('(max-width: 768px)').matches) setTimeout(function () { render(p); }, 15000);
    }
  }

  fetch(api + '/api/v1/public/popups/' + encodeURIComponent(projectId))
    .then(function (r) { return r.json(); })
    .then(function (r) { (r.data || []).filter(eligible).forEach(arm); })
    .catch(function () {});
})();

(function () {
  // Headless CMS — embeddable newsletter / lead signup form
  //
  // <script src="https://YOUR-API/subscribe.js"
  //         data-project="PROJECT_ID"
  //         data-title="Join our newsletter"
  //         data-button="Subscribe"
  //         data-tags="newsletter,homepage"
  //         data-name="true"
  //         data-form="Footer signup"
  //         data-color="#4f46e5"
  //         data-target="#signup"></script>
  //
  // Or call window.HeadlessCMSSubscribe(email, { name, tags }) from your own form.
  var script = document.currentScript;
  if (!script) return;
  var apiBase = (script.getAttribute('data-api') || '__API_URL__').replace(/\/+$/, '');
  var projectId = script.getAttribute('data-project');
  if (!projectId) {
    console.error('Headless CMS subscribe: missing data-project attribute');
    return;
  }
  var attr = function (k, d) { var v = script.getAttribute('data-' + k); return v === null ? d : v; };
  var endpoint = apiBase + '/api/v1/public/email/' + encodeURIComponent(projectId) + '/subscribe';

  function utm() {
    var out = {};
    try {
      var p = new URLSearchParams(window.location.search);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
        if (p.get(k)) out[k] = p.get(k);
      });
    } catch (e) { /* ignore */ }
    return out;
  }

  function send(payload) {
    var body = Object.assign({ source: 'form', form: attr('form', document.title || 'Website form') }, utm(), payload);
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || !j.success) throw new Error(j.message || 'Could not subscribe');
        return j;
      });
    });
  }

  // Programmatic API for custom forms
  window.HeadlessCMSSubscribe = function (email, opts) {
    opts = opts || {};
    return send({ email: email, name: opts.name, tags: opts.tags, fields: opts.fields });
  };

  if (attr('render', 'true') === 'false') return;

  var host = document.createElement('div');
  var target = attr('target', null) && document.querySelector(attr('target'));
  if (target) target.appendChild(host);
  else script.parentNode.insertBefore(host, script.nextSibling);

  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  var color = attr('color', '#4f46e5');
  var withName = attr('name', 'false') === 'true';

  root.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '.f{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:480px;color:#111827}' +
    '.t{font-size:18px;font-weight:600;margin:0 0 4px}.d{font-size:14px;color:#4b5563;margin:0 0 12px}' +
    '.r{display:flex;gap:8px;flex-wrap:wrap}' +
    'input{flex:1 1 180px;min-width:0;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px}' +
    'input:focus{outline:2px solid ' + color + ';outline-offset:1px}' +
    'button{padding:10px 18px;border:0;border-radius:8px;background:' + color + ';color:#fff;font-size:14px;font-weight:600;cursor:pointer}' +
    'button[disabled]{opacity:.6;cursor:default}' +
    '.m{font-size:13px;margin-top:8px}.ok{color:#047857}.err{color:#b91c1c}' +
    '.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}' +
    '.c{font-size:11px;color:#6b7280;margin-top:8px}' +
    '</style>' +
    '<form class="f" novalidate>' +
    (attr('title', '') ? '<p class="t"></p>' : '') +
    (attr('description', '') ? '<p class="d"></p>' : '') +
    '<div class="r">' +
    (withName ? '<input name="name" type="text" autocomplete="name" aria-label="Name">' : '') +
    '<input name="email" type="email" required autocomplete="email" aria-label="Email address">' +
    '<button type="submit"></button>' +
    '</div>' +
    '<div class="hp" aria-hidden="true"><input name="website_url" tabindex="-1" autocomplete="off"></div>' +
    '<p class="m" role="status" aria-live="polite"></p>' +
    (attr('consent', '') ? '<p class="c"></p>' : '') +
    '</form>';

  // Set user-provided text via textContent (never innerHTML)
  var q = function (s) { return root.querySelector(s); };
  if (q('.t')) q('.t').textContent = attr('title', '');
  if (q('.d')) q('.d').textContent = attr('description', '');
  if (q('.c')) q('.c').textContent = attr('consent', '');
  q('button').textContent = attr('button', 'Subscribe');
  q('input[name=email]').placeholder = attr('placeholder', 'you@example.com');
  if (withName) q('input[name=name]').placeholder = attr('name-placeholder', 'Your name');

  var form = q('form');
  var msg = q('.m');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = q('input[name=email]').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      msg.className = 'm err';
      msg.textContent = 'Please enter a valid email address.';
      return;
    }
    var btn = q('button');
    btn.disabled = true;
    msg.className = 'm';
    msg.textContent = '';
    send({
      email: email,
      name: withName ? q('input[name=name]').value.trim() : undefined,
      tags: attr('tags', '').split(',').map(function (t) { return t.trim(); }).filter(Boolean),
      website_url: q('input[name=website_url]').value,
      consent: attr('consent', undefined),
    })
      .then(function (res) {
        msg.className = 'm ok';
        msg.textContent = res.needsConfirmation ? attr('confirm-message', 'Almost done — check your inbox to confirm.') : attr('success', 'Thanks for subscribing!');
        form.querySelector('.r').style.display = 'none';
      })
      .catch(function (err) {
        msg.className = 'm err';
        msg.textContent = err.message;
        btn.disabled = false;
      });
  });
})();

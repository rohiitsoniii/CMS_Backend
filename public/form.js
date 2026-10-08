(function () {
  // Headless CMS — embeddable form
  // <script src="https://YOUR-API/form.js" data-form="FORM_ID" data-color="#4f46e5"></script>
  var script = document.currentScript;
  if (!script) return;
  var formId = script.getAttribute('data-form');
  if (!formId) return console.error('Headless CMS form: missing data-form');
  var api = (script.getAttribute('data-api') || '__API_URL__').replace(/\/+$/, '');
  var color = script.getAttribute('data-color') || '#4f46e5';
  var base = api + '/api/v1/public/forms/' + encodeURIComponent(formId);

  var host = document.createElement('div');
  var target = script.getAttribute('data-target') && document.querySelector(script.getAttribute('data-target'));
  if (target) target.appendChild(host); else script.parentNode.insertBefore(host, script.nextSibling);
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var css = '<style>:host{all:initial}.f{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:560px;color:#111827}' +
    '.t{font-size:20px;font-weight:600;margin:0 0 4px}.d{font-size:14px;color:#4b5563;margin:0 0 16px}' +
    '.g{margin-bottom:14px}label{display:block;font-size:14px;font-weight:500;margin-bottom:4px}' +
    'input,textarea,select{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font:inherit;font-size:14px;background:#fff}' +
    'input:focus,textarea:focus,select:focus{outline:2px solid ' + color + ';outline-offset:1px}' +
    '.opt{display:flex;align-items:center;gap:8px;font-weight:400}.opt input{width:auto}' +
    '.h{font-size:12px;color:#6b7280;margin-top:4px}.e{font-size:12px;color:#b91c1c;margin-top:4px}' +
    'button{padding:11px 20px;border:0;border-radius:8px;background:' + color + ';color:#fff;font-size:15px;font-weight:600;cursor:pointer}button[disabled]{opacity:.6}' +
    '.ok{padding:16px;border-radius:8px;background:#ecfdf5;color:#065f46}.hp{position:absolute;left:-9999px}</style>';

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    if (text) e.textContent = text;
    return e;
  }

  function utm() {
    var out = {};
    try { var p = new URLSearchParams(location.search); ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) { if (p.get(k)) out[k] = p.get(k); }); } catch (e) {}
    return out;
  }

  fetch(base).then(function (r) { return r.json(); }).then(function (res) {
    if (!res.success) { root.innerHTML = css + '<p class="f">This form is unavailable.</p>'; return; }
    var def = res.data;
    root.innerHTML = css;
    var form = el('form', { class: 'f', novalidate: true });
    if (script.getAttribute('data-title') !== 'false') form.appendChild(el('p', { class: 't' }, def.name));
    if (def.description) form.appendChild(el('p', { class: 'd' }, def.description));

    def.fields.forEach(function (f) {
      var id = 'hc_' + f.key;
      if (f.type === 'hidden') { form.appendChild(el('input', { type: 'hidden', name: f.key, value: f.defaultValue || '' })); return; }
      var g = el('div', { class: 'g' });
      var input;
      if (f.type === 'consent' || f.type === 'checkbox' && !(f.options && f.options.length)) {
        var lab = el('label', { class: 'opt' });
        input = el('input', { type: 'checkbox', name: f.key, id: id, value: 'yes', required: f.required });
        lab.appendChild(input); lab.appendChild(document.createTextNode(f.label + (f.required ? ' *' : '')));
        g.appendChild(lab);
      } else {
        g.appendChild(el('label', { for: id }, f.label + (f.required ? ' *' : '')));
        if (f.type === 'textarea') input = el('textarea', { name: f.key, id: id, rows: 5, required: f.required, placeholder: f.placeholder });
        else if (f.type === 'select') {
          input = el('select', { name: f.key, id: id, required: f.required });
          input.appendChild(el('option', { value: '' }, f.placeholder || 'Choose…'));
          (f.options || []).forEach(function (o) { input.appendChild(el('option', { value: o }, o)); });
        } else if (f.type === 'radio' || f.type === 'checkbox') {
          input = null;
          (f.options || []).forEach(function (o, i) {
            var l = el('label', { class: 'opt' });
            l.appendChild(el('input', { type: f.type, name: f.key, value: o, id: id + '_' + i }));
            l.appendChild(document.createTextNode(o));
            g.appendChild(l);
          });
        } else {
          var map = { phone: 'tel', email: 'email', number: 'number', date: 'date', url: 'url' };
          input = el('input', { type: map[f.type] || 'text', name: f.key, id: id, required: f.required, placeholder: f.placeholder, value: f.defaultValue || '' });
        }
        if (input) g.appendChild(input);
      }
      if (f.helpText) g.appendChild(el('div', { class: 'h' }, f.helpText));
      g.appendChild(el('div', { class: 'e', 'data-err': f.key }));
      form.appendChild(g);
    });

    var hp = el('div', { class: 'hp', 'aria-hidden': 'true' });
    hp.appendChild(el('input', { name: '_hp', tabindex: '-1', autocomplete: 'off' }));
    form.appendChild(hp);
    var btn = el('button', { type: 'submit' }, def.submitLabel || 'Send');
    form.appendChild(btn);
    var msg = el('p', { class: 'e', role: 'status', 'aria-live': 'polite' });
    form.appendChild(msg);
    root.appendChild(form);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = { _t: def.renderedAt, _page: location.href };
      Object.assign(data, utm());
      new FormData(form).forEach(function (v, k) {
        if (data[k] !== undefined && k.charAt(0) !== '_') data[k] = [].concat(data[k], v); else data[k] = v;
      });
      root.querySelectorAll('[data-err]').forEach(function (n) { n.textContent = ''; });
      btn.disabled = true; msg.textContent = '';
      fetch(base + '/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          if (r.success) {
            if (window.hcms && window.hcms.track) window.hcms.track('form_submit', { form: def.name });
            if (r.redirectUrl) { location.href = r.redirectUrl; return; }
            var ok = el('div', { class: 'ok f' }, r.message);
            form.replaceWith(ok);
          } else {
            btn.disabled = false;
            msg.textContent = r.message || 'Something went wrong';
            Object.keys(r.errors || {}).forEach(function (k) { var n = root.querySelector('[data-err="' + k + '"]'); if (n) n.textContent = r.errors[k]; });
          }
        })
        .catch(function () { btn.disabled = false; msg.textContent = 'Network error, please try again.'; });
    });
  }).catch(function () { root.innerHTML = css + '<p class="f">This form could not be loaded.</p>'; });
})();

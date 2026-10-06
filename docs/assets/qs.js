// Quantum-safety checker front end. Talks to the sha3.si checker service and
// renders the report with textContent only, so nothing a checked site returns
// can inject markup into this page.
(function () {
  var form = document.getElementById('qs-form');
  if (!form) return;
  var API = form.getAttribute('data-api');
  var input = document.getElementById('qs-host');
  var btn = document.getElementById('qs-go');
  var out = document.getElementById('qs-out');

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function row(label, value, state) {
    var r = el('div', 'qs-row ' + (state || ''));
    var mark = state === 'good' ? '✔' : state === 'bad' ? '✖' : state === 'warn' ? '!' : '•';
    r.appendChild(el('span', 'qs-mark', mark));
    var t = el('div', 'qs-text');
    t.appendChild(el('b', null, label));
    if (value) t.appendChild(el('span', null, value));
    r.appendChild(t);
    return r;
  }

  function render(d) {
    out.textContent = '';
    var card = el('div', 'qs-card');
    if (!d.reachable) {
      card.appendChild(el('h2', null, d.host || 'Could not check'));
      card.appendChild(el('p', 'qs-error', d.error || d.verdict || 'Something went wrong.'));
      out.appendChild(card);
      return;
    }
    var safe = d.pq_key_exchange && d.pq_key_exchange.supported;
    var head = el('div', 'qs-head ' + (safe ? 'good' : 'bad'));
    head.appendChild(el('div', 'qs-badge', safe ? 'QUANTUM-SAFE' : 'NOT QUANTUM-SAFE'));
    head.appendChild(el('h2', null, d.host));
    head.appendChild(el('div', 'qs-score', 'Score ' + d.score + ' / ' + d.max_score));
    card.appendChild(head);
    card.appendChild(el('p', 'qs-verdict', d.verdict));

    var list = el('div', 'qs-list');
    list.appendChild(row('Post-quantum key exchange (ML-KEM)',
      safe ? 'Accepted: ' + d.pq_key_exchange.group
           : 'Not accepted. ' + (d.pq_key_exchange.detail || ''),
      safe ? 'good' : 'bad'));
    if (d.tls) {
      list.appendChild(row('TLS version', d.tls.version + ', cipher ' + d.tls.cipher, d.tls.tls13 ? 'good' : 'bad'));
      if (d.tls.default_key_exchange) {
        list.appendChild(row('Key exchange used by default', d.tls.default_key_exchange,
          d.tls.default_key_exchange.indexOf('MLKEM') >= 0 ? 'good' : 'warn'));
      }
    }
    if (d.certificate) {
      var c = d.certificate;
      list.appendChild(row('Certificate',
        c.key_type + ', signed ' + c.signature + ', by ' + c.issuer +
        '. ' + (c.valid ? 'Valid' : 'Not valid') + ', expires ' + c.not_after + ' (' + c.days_left + ' days).',
        c.valid ? 'info' : 'bad'));
      list.appendChild(row('Certificate quantum-safety',
        'Classical signature, as on every public website today: certificate authorities do not issue post-quantum (ML-DSA) certificates yet. This is expected and not counted against the score.',
        'info'));
    }
    card.appendChild(list);

    if (d.advice && d.advice.length) {
      card.appendChild(el('h3', null, 'How to fix it'));
      var ul = el('ul', 'qs-advice');
      d.advice.forEach(function (a) { ul.appendChild(el('li', null, a)); });
      card.appendChild(ul);
    }

    var share = el('div', 'qs-share');
    var url = location.origin + location.pathname + '?host=' + encodeURIComponent(d.host);
    var text = d.host + (safe ? ' is quantum-safe' : ' is not quantum-safe yet') + '. Check any website:';
    var copy = el('button', 'btn', 'Copy link to this result');
    copy.type = 'button';
    copy.addEventListener('click', function () {
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { copy.textContent = 'Copied'; });
    });
    var x = el('a', 'btn', 'Share on X');
    x.href = 'https://x.com/intent/post?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url);
    x.target = '_blank'; x.rel = 'noopener';
    var li = el('a', 'btn', 'Share on LinkedIn');
    li.href = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url);
    li.target = '_blank'; li.rel = 'noopener';
    share.appendChild(copy); share.appendChild(x); share.appendChild(li);
    card.appendChild(share);
    card.appendChild(el('p', 'note', 'Checked ' + new Date(d.checked_at).toLocaleString() + (d.cached ? ' (recent result, cached for a few minutes)' : '') + '.'));
    out.appendChild(card);
  }

  function run(host) {
    host = (host || '').trim();
    if (!host) { input.focus(); return; }
    btn.disabled = true;
    btn.textContent = 'Checking...';
    out.textContent = '';
    out.appendChild(el('p', 'note', 'Connecting to ' + host + ' with post-quantum and classical handshakes. This takes a few seconds.'));
    history.replaceState(null, '', '?host=' + encodeURIComponent(host));
    fetch(API + '/check?host=' + encodeURIComponent(host))
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { render({ reachable: false, host: host, error: res.j.error }); return; }
        render(res.j);
        if (window.gtag) gtag('event', 'qs_check', { pq: res.j.pq_key_exchange ? res.j.pq_key_exchange.supported : false });
      })
      .catch(function () { render({ reachable: false, host: host, error: 'The checker could not be reached. Please try again in a moment.' }); })
      .then(function () { btn.disabled = false; btn.textContent = 'Check'; });
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); run(input.value); });
  document.querySelectorAll('[data-try]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); input.value = a.getAttribute('data-try'); run(input.value); });
  });
  var q = new URLSearchParams(location.search).get('host');
  if (q) { input.value = q; run(q); }
})();

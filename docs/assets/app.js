// SHA-3 calculator. Everything runs in the browser: nothing typed or dropped
// here is ever sent to a server. Hashing is done by js-sha3 (MIT, emn178),
// loaded before this file as window.sha3_256, window.keccak256, etc.
(function () {
  var input = document.getElementById('in');
  if (!input) return;

  var ALGOS = [
    { id: 'sha3_224', name: 'SHA3-224', bits: 224, fn: function () { return window.sha3_224; } },
    { id: 'sha3_256', name: 'SHA3-256', bits: 256, fn: function () { return window.sha3_256; } },
    { id: 'sha3_384', name: 'SHA3-384', bits: 384, fn: function () { return window.sha3_384; } },
    { id: 'sha3_512', name: 'SHA3-512', bits: 512, fn: function () { return window.sha3_512; } },
    { id: 'shake128', name: 'SHAKE128', xof: true, fn: function () { return window.shake128; } },
    { id: 'shake256', name: 'SHAKE256', xof: true, fn: function () { return window.shake256; } },
    { id: 'keccak256', name: 'Keccak-256', bits: 256, tag: 'Ethereum', fn: function () { return window.keccak256; } }
  ];

  var out = document.getElementById('results');
  var fmtSel = document.getElementById('fmt');
  var modeSel = document.getElementById('mode');
  var xofLen = document.getElementById('xoflen');
  var errBox = document.getElementById('err');
  var fileInfo = document.getElementById('fileinfo');
  var lastBytes = null; // bytes of the last dropped file, or null in text mode
  var tab = 'text';

  // Build the result rows once.
  ALGOS.forEach(function (a) {
    var row = document.createElement('div');
    row.className = 'row';
    var label = a.xof ? a.name + ' <span class="tag">XOF</span>' : a.name + ' <span class="tag">' + a.bits + '-bit</span>';
    if (a.tag) label += '<span class="tag">' + a.tag + '</span>';
    row.innerHTML = '<div class="name"><b>' + label + '</b><button class="copy" type="button">Copy</button></div>' +
      '<div class="val" id="v_' + a.id + '"></div>';
    row.querySelector('.copy').addEventListener('click', function (e) {
      var v = document.getElementById('v_' + a.id).textContent;
      if (!v) return;
      var btn = e.currentTarget;
      var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1200); };
      if (navigator.clipboard) navigator.clipboard.writeText(v).then(done, function () {}); else done();
    });
    out.appendChild(row);
  });

  // On an algorithm page (body data-focus="sha3_512"), lift that row to the top.
  var focus = document.body.getAttribute('data-focus');
  if (focus) {
    var fv = document.getElementById('v_' + focus);
    if (fv) {
      var frow = fv.parentNode;
      frow.classList.add('focus');
      out.insertBefore(frow, out.firstChild);
    }
  }

  function hexToBytes(h) {
    h = h.replace(/^0x/i, '').replace(/[^0-9a-fA-F]/g, '');
    if (h.length % 2) throw new Error('Hex input must have an even number of digits.');
    var b = new Uint8Array(h.length / 2);
    for (var i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16);
    return b;
  }

  function format(arr) {
    var f = fmtSel.value;
    if (f === 'b64') {
      var s = '';
      for (var i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
      return btoa(s);
    }
    var hex = '';
    for (var j = 0; j < arr.length; j++) hex += (arr[j] < 16 ? '0' : '') + arr[j].toString(16);
    return f === 'HEX' ? hex.toUpperCase() : hex;
  }

  function outBits() {
    var n = parseInt(xofLen.value, 10);
    if (!(n >= 8 && n <= 8192)) n = 256;
    return n - (n % 8);
  }

  function run() {
    errBox.textContent = '';
    var data;
    try {
      if (tab === 'file') {
        if (!lastBytes) { clear(); return; }
        data = lastBytes;
      } else if (modeSel.value === 'hex') {
        data = hexToBytes(input.value);
      } else {
        data = input.value; // js-sha3 encodes strings as UTF-8
      }
    } catch (e) {
      errBox.textContent = e.message;
      clear();
      return;
    }
    ALGOS.forEach(function (a) {
      var f = a.fn();
      var bytes = a.xof ? f.array(data, outBits()) : f.array(data);
      document.getElementById('v_' + a.id).textContent = format(bytes);
    });
  }

  function clear() {
    ALGOS.forEach(function (a) { document.getElementById('v_' + a.id).textContent = ''; });
  }

  // Tabs: text vs file
  var tabs = document.querySelectorAll('[data-tab]');
  tabs.forEach(function (b) {
    b.addEventListener('click', function () {
      tab = b.getAttribute('data-tab');
      tabs.forEach(function (x) { x.classList.toggle('on', x === b); });
      document.getElementById('pane-text').classList.toggle('hidden', tab !== 'text');
      document.getElementById('pane-file').classList.toggle('hidden', tab !== 'file');
      run();
    });
  });

  // File hashing: read in the browser only.
  var drop = document.getElementById('drop');
  var picker = document.getElementById('file');
  function takeFile(file) {
    if (!file) return;
    fileInfo.textContent = 'Reading ' + file.name + '...';
    var r = new FileReader();
    r.onload = function () {
      lastBytes = new Uint8Array(r.result);
      fileInfo.textContent = file.name + ' (' + file.size.toLocaleString() + ' bytes), hashed locally in your browser.';
      run();
    };
    r.onerror = function () { fileInfo.textContent = 'Could not read that file.'; };
    r.readAsArrayBuffer(file);
  }
  drop.addEventListener('click', function () { picker.click(); });
  picker.addEventListener('change', function () { takeFile(picker.files[0]); });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) { takeFile(e.dataTransfer.files[0]); });

  input.addEventListener('input', run);
  [fmtSel, modeSel, xofLen].forEach(function (el) { el.addEventListener('change', run); el.addEventListener('input', run); });

  // Allow ?q=... links (handy for docs and for sharing a worked example).
  var q = new URLSearchParams(location.search).get('q');
  if (q !== null) input.value = q;
  run();
})();

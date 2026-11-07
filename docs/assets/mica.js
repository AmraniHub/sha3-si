/* sha3.si MiCA website evidence: scan, report, checkout, account and evidence
   pages. Plain JavaScript, no framework. Everything from the API or from a
   scanned website is rendered as text, never as HTML. */
(function () {
  "use strict";

  var meta = document.querySelector('meta[name="sha3si-api"]');
  var local = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && location.port === "8792";
  var API = local ? "" : (meta && meta.content) || "https://api.sha3.si";

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function short(h) { return h ? h.slice(0, 12) + "…" : ""; }
  function params() { var o = {}; new URLSearchParams(location.search).forEach(function (v, k) { o[k] = v; }); return o; }
  function safeHref(u) { return /^https?:\/\//i.test(String(u || "")) ? u : null; }
  function fmtDate(iso) { try { return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC"; } catch (e) { return iso; } }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  var STATE = {
    ok: ["good", "Found"], two_clicks: ["good", "Found"], not_linked: ["bad", "Not prominent"], missing: ["bad", "Missing"],
    broken: ["bad", "Broken"], review: ["warn", "Review"], unverified: ["muted", "Not verified"], na: ["muted", "N/A"],
  };
  var AI_TO_CHECK = { risk_warning: "risk" };

  /* ---------------------------------------------------------------- report */
  function renderReport(report, box, extra) {
    box.textContent = "";
    var s = report.score || { passed: 0, gaps: 0, review: 0, applicable: 0 };
    var firm = report.firm;
    var head = el("div", { class: "rep-head" }, [
      el("div", { class: "rep-score" }, [
        el("b", { text: s.passed + "/" + s.applicable }),
        el("span", { text: "checks passed" }),
      ]),
      el("div", { class: "rep-meta" }, [
        el("h2", { text: (firm && (firm.commercial_name || firm.name)) || report.target.host }),
        el("p", { text: firm ? firm.name + " · " + firm.authority + " (" + firm.state + ") · LEI " + (firm.lei || "n/a") : "Not found in ESMA's MiCA register" }),
        el("p", { class: "rep-small", text: "Read from " + (report.scanned_from ? report.scanned_from.place : "an unrecorded location") + " on " + fmtDate(report.scanned_at) + " · " + (report.target.final_url || report.target.url) }),
        el("div", { class: "rep-tally" }, [
          el("span", { class: "pill bad", text: s.gaps + " gap" + (s.gaps === 1 ? "" : "s") }),
          el("span", { class: "pill warn", text: s.review + " to review" }),
          el("span", { class: "pill good", text: s.passed + " passed" }),
        ]),
      ]),
    ]);
    box.appendChild(head);
    $(".rep-score", head).style.setProperty("--p", (s.applicable ? Math.round((100 * s.passed) / s.applicable) : 0) + "%");

    if (report.unreadable || (report.limits && report.limits.length)) {
      box.appendChild(el("div", { class: "rep-limits" }, (report.limits || []).map(function (l) { return el("p", { text: l }); })));
    }

    var ai = report.ai;
    if (ai && ai.summary) {
      box.appendChild(el("div", { class: "rep-ai" }, [
        el("div", { class: "rep-ai-tag", text: "Claude's reading" + (ai.reused ? " (from today's earlier review)" : "") }),
        el("p", { text: ai.summary }),
      ]));
    }

    var byCheck = {};
    ((ai && ai.findings) || []).forEach(function (f) {
      var id = AI_TO_CHECK[f.check] || f.check;
      (byCheck[id] = byCheck[id] || []).push(f);
    });

    var list = el("div", { class: "rep-checks" });
    (report.checks || []).forEach(function (c) {
      var st = STATE[c.state] || ["muted", c.label];
      var body = [el("p", { text: c.detail })];
      if (c.snippet) body.push(el("blockquote", { text: "“" + c.snippet + "”" }));
      if (c.link && safeHref(c.link.href)) body.push(el("p", { class: "rep-small" }, ["Link: ", el("a", { href: c.link.href, rel: "nofollow noopener", target: "_blank", text: c.link.text || c.link.href })]));
      if (c.page && c.page.sha3_256) body.push(el("p", { class: "rep-small mono", text: "Evidence: SHA3-256 " + c.page.sha3_256 }));
      (byCheck[c.id] || []).forEach(function (f) { body.push(finding(f)); });
      delete byCheck[c.id];
      list.appendChild(el("details", { class: "rep-check " + st[0], open: st[0] === "bad" ? "" : null }, [
        el("summary", null, [el("span", { class: "pill " + st[0], text: st[1] }), el("b", { text: c.title }), el("span", { class: "rep-ref", text: c.ref })]),
        el("div", { class: "rep-body" }, body),
      ]));
    });
    box.appendChild(list);
    var rest = Object.keys(byCheck).reduce(function (a, k) { return a.concat(byCheck[k]); }, []);
    if (rest.length) {
      box.appendChild(el("h3", { text: "Marketing claims Claude flagged" }));
      rest.forEach(function (f) { box.appendChild(finding(f)); });
    }
    if (ai && ai.skipped) box.appendChild(el("p", { class: "rep-small", text: "AI review: not run (" + ai.skipped + "). The checks above are rule-based." }));

    var ev = el("details", { class: "rep-evidence" }, [
      el("summary", { text: "Evidence: " + (report.evidence || []).length + " requests, each fingerprinted with SHA3-256" }),
      el("div", { class: "tablewrap" }, [table(report.evidence || [])]),
      el("p", { class: "rep-small mono", text: "Record fingerprint (SHA3-256 of this report): " + (report.record_hash || "") }),
      report.record_hash ? el("p", { class: "rep-small" }, [el("a", { href: "/evidence/?h=" + report.record_hash, text: "Verify this record and its Bitcoin anchor →" })]) : null,
    ]);
    box.appendChild(ev);
    if (extra) box.appendChild(extra);
    box.appendChild(el("p", { class: "rep-small", text: "These are observations of what the website showed at the time above, not legal advice." }));
  }

  function finding(f) {
    var cls = f.verdict === "pass" ? "good" : f.verdict === "gap" ? "bad" : "warn";
    return el("div", { class: "finding " + cls }, [
      el("div", { class: "finding-head" }, [el("span", { class: "pill " + cls, text: f.verdict === "pass" ? "Claude: pass" : f.verdict === "gap" ? "Claude: gap (" + f.severity + ")" : "Claude: unclear" }), el("b", { text: f.title })]),
      f.quote ? el("blockquote", { text: "“" + f.quote + "”" }) : null,
      el("p", { text: f.explanation }),
      el("p", { class: "finding-fix" }, [el("b", { text: "Fix: " }), f.fix]),
    ]);
  }

  function table(rows) {
    var t = el("table", { class: "ev" }, [el("tr", null, ["What", "Status", "Bytes", "SHA3-256", "Fetched"].map(function (h) { return el("th", { text: h }); }))]);
    rows.forEach(function (r) {
      t.appendChild(el("tr", null, [
        el("td", null, [el("span", { class: "rep-small", text: r.role + " " }), safeHref(r.final_url || r.url) ? el("a", { href: r.final_url || r.url, rel: "nofollow noopener", target: "_blank", text: (r.final_url || r.url).replace(/^https?:\/\//, "").slice(0, 60) }) : null]),
        el("td", { text: String(r.status) }), el("td", { text: String(r.bytes || "") }),
        el("td", { class: "mono", text: r.sha3_256 || "" }), el("td", { class: "rep-small", text: r.fetched_at ? r.fetched_at.slice(11, 19) + "Z" : "" }),
      ]));
    });
    return t;
  }

  /* ---------------------------------------------------------- firm search */
  var registerData = null;
  function loadRegister() {
    if (registerData) return Promise.resolve(registerData);
    return fetch("/assets/register.json").then(function (r) { return r.json(); }).then(function (d) { registerData = d; return d; });
  }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }

  function attachSearch(input, list, onPick) {
    var items = [];
    var active = -1;
    function close() { list.hidden = true; active = -1; }
    function render(q) {
      if (!registerData || q.length < 2) return close();
      var needle = q.toLowerCase();
      // Name or website starting with the query first, then a word in the
      // name starting with it, then anything containing it.
      function rank(f) {
        var name = (f.c || f.n).toLowerCase();
        var hosts = f.w.map(hostOf).join(" ");
        if (name.indexOf(needle) === 0 || hosts.indexOf(needle) === 0) return 0;
        if ((" " + name + " " + f.n.toLowerCase() + " " + hosts).indexOf(" " + needle) >= 0) return 1;
        return (f.c + " " + f.n + " " + hosts + " " + f.lei).toLowerCase().indexOf(needle) >= 0 ? 2 : 9;
      }
      items = registerData.firms.map(function (f) { return [rank(f), f]; })
        .filter(function (x) { return x[0] < 9; })
        .sort(function (a, b) { return a[0] - b[0] || (a[1].c || a[1].n).length - (b[1].c || b[1].n).length; })
        .slice(0, 8).map(function (x) { return x[1]; });
      list.textContent = "";
      items.forEach(function (f, i) {
        list.appendChild(el("li", { role: "option", "data-i": i, onmousedown: function (e) { e.preventDefault(); pick(i); } }, [
          el("b", { text: f.c || f.n }), el("span", { text: (f.w[0] ? hostOf(f.w[0]) + " · " : "") + f.a + " · " + f.s }),
        ]));
      });
      list.hidden = !items.length;
    }
    function pick(i) {
      var f = items[i];
      if (!f) return;
      input.value = f.w[0] ? hostOf(f.w[0]) : f.c || f.n;
      close();
      onPick(f);
    }
    input.addEventListener("focus", function () { loadRegister().then(function () { render(input.value.trim()); }); });
    input.addEventListener("input", function () { onPick(null); loadRegister().then(function () { render(input.value.trim()); }); });
    input.addEventListener("blur", close);
    input.addEventListener("keydown", function (e) {
      if (list.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        Array.prototype.forEach.call(list.children, function (li, i) { li.classList.toggle("on", i === active); });
      } else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(active); }
      else if (e.key === "Escape") close();
    });
  }

  /* ----------------------------------------------------------------- scan */
  function startScan(form) {
    var input = $("#scan-url", form);
    var btn = $("button[type=submit]", form);
    var out = $("#scan-out");
    var log = el("ol", { class: "scan-log", "aria-live": "polite" });
    var result = el("div", { class: "scan-result" });
    out.hidden = false;
    out.textContent = "";
    out.appendChild(el("div", { class: "scan-term" }, [el("div", { class: "scan-term-head" }, [el("span", { class: "dot" }), el("span", { class: "dot" }), el("span", { class: "dot" }), el("span", { text: "sha3.si scanner" })]), log]));
    out.appendChild(result);
    out.scrollIntoView({ behavior: "smooth", block: "start" });
    btn.disabled = true;
    btn.textContent = "Scanning…";

    function line(cls, text, hash) {
      var li = el("li", { class: cls }, [el("span", { text: text })]);
      if (hash) li.appendChild(el("code", { text: "sha3 " + short(hash) }));
      log.appendChild(li);
      log.scrollTop = log.scrollHeight;
    }
    var body = { url: input.value.trim() };
    if (form.dataset.lei) body.lei = form.dataset.lei;

    fetch(API + "/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (res) {
        if (!res.ok || !res.body) return res.json().then(function (j) { throw new Error(j.error || "The scan could not start."); });
        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = "";
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            buf += dec.decode(r.value, { stream: true });
            var parts = buf.split("\n");
            buf = parts.pop();
            parts.forEach(function (p) { if (p.trim()) handle(JSON.parse(p)); });
            return pump();
          });
        }
        return pump();
      })
      .catch(function (e) { line("err", e.message || "The scan failed."); })
      .then(function () { btn.disabled = false; btn.textContent = "Scan again"; });

    function handle(ev) {
      if (ev.type === "step") line("step", ev.msg);
      else if (ev.type === "fetch") {
        if (ev.error) line("err", "✗ " + ev.url.replace(/^https?:\/\//, "") + " (" + ev.error + ")");
        else line(ev.status < 400 ? "ok" : "err", (ev.status < 400 ? "✓ " : "✗ ") + ev.status + " " + ev.url.replace(/^https?:\/\//, "").slice(0, 70) + " · " + Math.round(ev.bytes / 1024) + " KB", ev.sha3_256);
      } else if (ev.type === "check") {
        var st = STATE[ev.state] || ["muted", ev.label];
        line("check " + st[0], (st[0] === "good" ? "● " : st[0] === "bad" ? "■ " : "◆ ") + ev.title + ": " + ev.label);
      } else if (ev.type === "beat") line("beat", "…");
      else if (ev.type === "ai") line("step", ev.ai.findings ? "Claude finished: " + ev.ai.findings.length + " findings" : "AI review not run: " + ev.ai.skipped);
      else if (ev.type === "error") line("err", ev.error);
      else if (ev.type === "done") done(ev);
    }

    function done(ev) {
      line("step", "Done. Report sealed with SHA3-256 " + short(ev.report.record_hash));
      var extra = el("div", { class: "rep-next" });
      if (ev.id && ev.token) {
        var link = location.origin + "/r/?id=" + ev.id + "&t=" + ev.token;
        store("sha3si:last", link);
        extra.appendChild(el("div", { class: "rep-link" }, [
          el("b", { text: "Private link to this report" }),
          el("input", { type: "text", readonly: "", value: link, onfocus: function (e) { e.target.select(); } }),
          el("button", { type: "button", class: "btn", text: "Copy", onclick: function () { navigator.clipboard && navigator.clipboard.writeText(link); } }),
        ]));
      }
      extra.appendChild(offer(ev.report, ev.id));
      renderReport(ev.report, result, extra);
    }
  }

  /* -------------------------------------------------------- offer & leads */
  function offer(report, scanId) {
    var host = report && report.target ? report.target.host.replace(/^www\./, "") : "";
    var gaps = report && report.score ? report.score.gaps : 0;
    return el("div", { class: "offer" }, [
      el("h3", { text: gaps ? "Close " + (gaps === 1 ? "this gap" : "these " + gaps + " gaps") + " before your supervisor finds them" : "Keep it this way: get told the day something breaks" }),
      el("p", { text: "The audit adds a browser-rendered pass, a person checking every finding against the regulation, replacement wording in your site's language, and a signed evidence pack. The monitor re-reads your site every week and keeps a tamper-evident log." }),
      el("div", { class: "offer-btns" }, [
        el("button", { type: "button", class: "btn primary", text: "Order the audit · €1,490", onclick: function () { checkout("audit", host, scanId); } }),
        el("button", { type: "button", class: "btn", text: "Monitor weekly · €290/month", onclick: function () { checkout("monitor_month", host, scanId); } }),
        el("button", { type: "button", class: "btn", text: "Email me this report", onclick: function () { openLead(scanId, host); } }),
      ]),
    ]);
  }

  var PLAN_NAMES = { audit: "MiCA website audit · €1,490 one-off", monitor_month: "Monitor · €290 per month", monitor_year: "Monitor · €2,900 per year, audit included" };

  function checkout(plan, host, scanId) {
    var dlg = $("#buy-dialog");
    if (!dlg) return;
    var f = $("#buy-form", dlg);
    f.plan.value = plan;
    f.scan_id.value = scanId || "";
    f.email.value = store("sha3si:email") || f.email.value;
    if (host) f.host.value = host;
    $("#buy-plan", dlg).textContent = PLAN_NAMES[plan] || plan;
    $("#buy-err", dlg).textContent = "";
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }

  function wireBuy() {
    var dlg = $("#buy-dialog");
    if (!dlg) return;
    $("#buy-close", dlg).addEventListener("click", function () { dlg.close ? dlg.close() : dlg.removeAttribute("open"); });
    $("#buy-form", dlg).addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target;
      var err = $("#buy-err", dlg);
      var btn = $("button[type=submit]", f);
      err.textContent = "";
      btn.disabled = true;
      store("sha3si:email", f.email.value);
      fetch(API + "/api/checkout", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: f.plan.value, email: f.email.value, host: f.host.value, scan_id: f.scan_id.value }) })
        .then(function (r) { return r.json().then(function (j) { return [r, j]; }); })
        .then(function (rj) {
          btn.disabled = false;
          if (rj[0].ok && rj[1].url) { location.href = rj[1].url; return; }
          if (rj[1].closed) {
            dlg.close ? dlg.close() : dlg.removeAttribute("open");
            openLead(f.scan_id.value, f.host.value, "Online payment opens shortly. Leave your details and we send the invoice today.", f.plan.value);
            return;
          }
          err.textContent = rj[1].error || "The payment page could not be opened.";
        })
        .catch(function () { btn.disabled = false; err.textContent = "The payment page could not be opened. Email hello@sha3.si."; });
    });
  }

  function openLead(scanId, host, note, plan) {
    var dlg = $("#lead-dialog");
    if (!dlg) return;
    $("#lead-scan", dlg).value = scanId || "";
    $("#lead-note", dlg).textContent = note || "We send the full report, and nothing else unless you ask.";
    $("#lead-msg", dlg).value = plan ? "Interested in: " + plan + (host ? " for " + host : "") : host ? "Website: " + host : "";
    $("#lead-ok", dlg).hidden = true;
    $("#lead-form", dlg).hidden = false;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }

  function wireLead() {
    var dlg = $("#lead-dialog");
    if (!dlg) return;
    $("#lead-close", dlg).addEventListener("click", function () { dlg.close ? dlg.close() : dlg.removeAttribute("open"); });
    $("#lead-form", dlg).addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target;
      var data = { email: f.email.value, name: f.name.value, company: f.company.value, role: f.role.value, message: f.message.value,
        scan_id: f.scan_id.value, consent: f.consent.checked, website: f.website.value, source: location.pathname };
      var err = $("#lead-err", dlg);
      err.textContent = "";
      fetch(API + "/api/lead", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().then(function (j) { return [r, j]; }); })
        .then(function (rj) {
          if (!rj[0].ok) { err.textContent = rj[1].error || "That did not go through."; return; }
          store("sha3si:email", data.email);
          f.hidden = true;
          $("#lead-ok", dlg).hidden = false;
        })
        .catch(function () { err.textContent = "That did not go through. Email hello@sha3.si."; });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-lead]"), function (b) {
      b.addEventListener("click", function () { openLead("", "", null, b.getAttribute("data-lead")); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-plan]"), function (b) {
      b.addEventListener("click", function () { checkout(b.getAttribute("data-plan"), "", ""); });
    });
  }

  /* ---------------------------------------------------------------- pages */
  function home() {
    var form = $("#scan-form");
    if (!form) return;
    attachSearch($("#scan-url"), $("#scan-suggest"), function (f) { form.dataset.lei = f ? f.lei : ""; });
    form.addEventListener("submit", function (e) { e.preventDefault(); if ($("#scan-url").value.trim()) startScan(form); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-try]"), function (a) {
      a.addEventListener("click", function (e) { e.preventDefault(); $("#scan-url").value = a.getAttribute("data-try"); form.dataset.lei = ""; startScan(form); });
    });
  }

  function reportPage() {
    var box = $("#report");
    if (!box) return;
    var p = params();
    if (!p.id || !p.t) { box.textContent = "This link is incomplete."; return; }
    fetch(API + "/api/scan?id=" + encodeURIComponent(p.id) + "&t=" + encodeURIComponent(p.t))
      .then(function (r) { return r.json().then(function (j) { return [r, j]; }); })
      .then(function (rj) {
        if (!rj[0].ok) { box.textContent = rj[1].error || "No report at this link."; return; }
        renderReport(rj[1].report, box, offer(rj[1].report, p.id));
      })
      .catch(function () { box.textContent = "The report could not be loaded. Try again in a minute."; });
  }

  function accountPage() {
    var box = $("#account");
    if (!box) return;
    var p = params();
    var url = p.session_id ? "/api/account?session_id=" + encodeURIComponent(p.session_id)
      : p.o && p.t ? "/api/account?o=" + encodeURIComponent(p.o) + "&t=" + encodeURIComponent(p.t) : null;
    if (!url) { box.textContent = "Open the private account link from your confirmation, or contact hello@sha3.si."; return; }
    fetch(API + url).then(function (r) { return r.json().then(function (j) { return [r, j]; }); }).then(function (rj) {
      var j = rj[1];
      box.textContent = "";
      if (!rj[0].ok) { box.appendChild(el("p", { text: j.error || "Not found." })); return; }
      if (j.paid === false) {
        box.appendChild(el("div", { class: "rep-limits" }, [el("p", { text: "This payment is not complete yet. If you just paid, reload this page in a minute; otherwise write to hello@sha3.si." })]));
        return;
      }
      var o = j.order;
      if (j.link) {
        store("sha3si:account", j.link);
        box.appendChild(el("div", { class: "rep-ai" }, [
          el("div", { class: "rep-ai-tag", text: j.paid ? "Payment received" : "Payment pending" }),
          el("p", { text: o.plan_name + (o.host ? " for " + o.host : "") + ". Keep this private link: it opens your account, reports and evidence." }),
          el("div", { class: "rep-link" }, [el("input", { type: "text", readonly: "", value: j.link, onfocus: function (e) { e.target.select(); } }), el("a", { class: "btn primary", href: j.link, text: "Open my account" })]),
        ]));
        return;
      }
      box.appendChild(el("h2", { text: o.plan_name }));
      box.appendChild(el("p", { text: (o.host || "") + " · status: " + o.status + " · since " + fmtDate(o.created_at) }));
      var bill = el("button", { type: "button", class: "btn", text: "Invoices and billing", onclick: function () {
        fetch(API + "/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ o: p.o, t: p.t }) })
          .then(function (r) { return r.json(); }).then(function (x) { if (x.url) location.href = x.url; else window.alert(x.error || "Not available yet."); });
      } });
      var packLink = el("a", { class: "btn", href: API + "/api/account?o=" + encodeURIComponent(p.o) + "&t=" + encodeURIComponent(p.t) + "&pack=1", text: "Download evidence pack (JSON)" });
      box.appendChild(el("p", { class: "offer-btns" }, [bill, packLink]));
      box.appendChild(el("h3", { text: "Scans and evidence" }));
      if (!j.scans.length) box.appendChild(el("p", { text: "Your first scan runs within the hour, and the reviewed audit follows within 48 hours." }));
      var t = el("table", { class: "ev" }, [el("tr", null, ["When", "Type", "Passed", "Gaps", "Record"].map(function (h) { return el("th", { text: h }); }))]);
      j.scans.forEach(function (s) {
        t.appendChild(el("tr", null, [el("td", { text: fmtDate(s.created_at) }), el("td", { text: s.kind }), el("td", { text: s.passed + "/" + s.applicable }), el("td", { text: String(s.gaps) }),
          el("td", null, [el("a", { class: "mono", href: "/evidence/?h=" + s.record_hash, text: short(s.record_hash) })])]));
      });
      box.appendChild(el("div", { class: "tablewrap" }, [t]));
    }).catch(function () { box.textContent = "The account could not be loaded. Try again in a minute."; });
  }

  function hexToBytes(h) { var a = new Uint8Array(h.length / 2); for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
  function pairHash(a, b) { var buf = new Uint8Array(64); buf.set(hexToBytes(a), 0); buf.set(hexToBytes(b), 32); return window.sha3_256(buf); }

  function evidencePage() {
    var box = $("#evidence");
    if (!box) return;
    var form = $("#ev-form");
    var p = params();
    if (p.h) $("#ev-hash").value = p.h;
    form.addEventListener("submit", function (e) { e.preventDefault(); history.replaceState(null, "", "?h=" + $("#ev-hash").value.trim()); show($("#ev-hash").value.trim()); });
    if (p.h) show(p.h);
    function show(h) {
      box.textContent = "Looking up…";
      fetch(API + "/api/evidence?h=" + encodeURIComponent(h)).then(function (r) { return r.json().then(function (j) { return [r, j]; }); }).then(function (rj) {
        var j = rj[1];
        box.textContent = "";
        if (!rj[0].ok) { box.appendChild(el("p", { text: j.error })); return; }
        box.appendChild(el("h2", { text: (j.firm ? j.firm.name : j.host) }));
        box.appendChild(el("p", { text: "Scanned " + fmtDate(j.scanned_at) + " from " + (j.scanned_from ? j.scanned_from.place : "an unrecorded location") + " · " + j.host + " · " + j.score.passed + "/" + j.score.applicable + " checks passed" }));
        var steps = el("ol", { class: "ev-steps" });
        steps.appendChild(el("li", null, [el("b", { text: "Each page has its own fingerprint. " }), "The SHA3-256 of the exact bytes received is in the table below."]));
        steps.appendChild(el("li", null, [el("b", { text: "The record has a fingerprint. " }), el("code", { class: "mono", text: j.record_hash })]));
        if (j.anchor && j.anchor.proof) {
          var hcur = j.record_hash;
          j.anchor.proof.forEach(function (s) { hcur = s.side === "right" ? pairHash(hcur, s.hash) : pairHash(s.hash, hcur); });
          var ok = hcur === j.anchor.root;
          steps.appendChild(el("li", null, [el("b", { text: "It is in the day's Merkle tree. " }), "Recomputed in your browser from " + j.anchor.proof.length + " sibling hashes: ",
            el("span", { class: "pill " + (ok ? "good" : "bad"), text: ok ? "root matches" : "root does not match" }), " ", el("code", { class: "mono", text: j.anchor.root })]));
          steps.appendChild(el("li", null, [el("b", { text: "The root is anchored in Bitcoin. " }),
            j.anchor.status === "confirmed" ? "OpenTimestamps reports Bitcoin block " + j.anchor.bitcoin_block + ". " : "Submitted to the OpenTimestamps calendars; Bitcoin confirmation usually takes a few hours. ",
            el("a", { href: API + "/api/evidence?day=" + j.day + "&file=txt", text: "anchor file" }), " · ",
            el("a", { href: API + "/api/evidence?day=" + j.day + "&file=ots", text: "proof (.ots)" }),
            ". Check it yourself with the OpenTimestamps client: ", el("code", { text: "ots verify sha3si-" + j.day + ".txt.ots" })]));
        } else {
          steps.appendChild(el("li", null, [el("b", { text: "Bitcoin anchor: " }), "records are anchored after their day ends (UTC). Come back tomorrow for the proof."]));
        }
        box.appendChild(steps);
        box.appendChild(el("h3", { text: "Checks" }));
        var ul = el("ul");
        j.checks.forEach(function (c) { var st = STATE[c.state] || ["muted", c.label]; ul.appendChild(el("li", null, [el("span", { class: "pill " + st[0], text: st[1] }), " " + c.title + " (" + c.ref + ")"])); });
        box.appendChild(ul);
        box.appendChild(el("h3", { text: "Pages read" }));
        box.appendChild(el("div", { class: "tablewrap" }, [table(j.pages)]));
      }).catch(function () { box.textContent = "The evidence service could not be reached."; });
    }
  }

  wireLead();
  wireBuy();
  home();
  reportPage();
  accountPage();
  evidencePage();
})();

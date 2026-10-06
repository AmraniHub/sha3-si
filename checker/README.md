# sha3.si checker

Post-quantum TLS checker behind https://sha3.si/quantum-safe/ . Go, no dependencies.

- `GET /check?host=example.com` returns JSON (ML-KEM support, TLS version, certificate, score, advice).
- `GET /healthz` returns `{"ok":true}`.
- Only dials port 443 of vetted public IPs; rate limited; results cached 10 minutes; no per-host logging.

Deployed on Railway (project sha3-si-checker, service pq-checker) from this folder.

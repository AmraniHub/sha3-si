# sha3.si API (MiCA website evidence)

Vercel project `sha3si-app`, functions pinned to **fra1 (Frankfurt)**, so scans read sites as an EU visitor.
The static site in `../docs` (GitHub Pages) calls it from the browser.

Live: https://sha3si-app-amranihubs-projects.vercel.app/api/health

## Routes

| Route | What |
|---|---|
| `POST /api/scan` | NDJSON stream: progress, checks, Claude review, sealed report |
| `GET /api/scan?id&t` | a stored report (private link) |
| `POST /api/lead` | contact request (honeypot, rate limit, consent required) |
| `POST /api/checkout` | Stripe Checkout for `audit`, `monitor_month`, `monitor_year` |
| `GET/POST /api/account` | after checkout, private account page, billing portal |
| `POST /api/stripe-webhook` | 503 until configured, 400 on a bad signature |
| `GET /api/evidence` | public record lookup, Merkle proof, daily anchor `.txt` / `.ots` |
| `GET /api/cron` | hourly (Bearer CRON_SECRET): Bitcoin anchors, upgrades, paid audits, weekly monitors |
| `GET/POST /api/admin` | Bearer ADMIN_KEY: leads, orders, spend; `connect_stripe`; `prospect` |
| `POST /api/telegram` | customer bot webhook: a user sends a website, gets the free scan as a rich message (401 without the secret header, 503 until configured) |
| `GET /api/health` | what is configured, no values |

## Environment

| Variable | Set by | Purpose |
|---|---|---|
| `CRON_SECRET`, `ADMIN_KEY`, `IP_SALT` | `deploy.py --secrets` (done) | cron auth, admin auth, IP hashing. ADMIN_KEY copy: `%USERPROFILE%\keys\sha3si-admin.key` |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | owner | storage: reports, evidence, leads, orders, AI spend |
| `ANTHROPIC_API_KEY` | owner | Claude review (Opus 5.5; monthly cap `AI_MONTHLY_CAP_USD`, default 90; free-scan daily cap `AI_FREE_DAILY_CAP_USD`, default 3) |
| `STRIPE_SECRET_KEY` | owner | payments; the webhook endpoint is then created by `POST /api/admin {"action":"connect_stripe"}` and its secret kept in the database |
| `TELEGRAM_CUSTOMER_BOT_TOKEN` | owner, optional | the public sha3.si bot from @BotFather; then `POST /api/admin {"action":"telegram_setup"}` sets its webhook (secret derived from the token) |
| `TELEGRAM_CHAT_ID` | owner, optional | the owner's chat for alerts: new scans, leads, payments, audit drafts, monitor changes. Send `/id` to the customer bot to read it |
| `TELEGRAM_BOT_TOKEN` | owner, optional | a different bot for the alerts; without it, alerts come from the customer bot. Never give the customer bot the token of a bot read with getUpdates elsewhere: the webhook would silence it |
| `CLAUDE_MODEL` | optional | override the model (default `claude-opus-5-5`) |

Owner commands, from this folder, in **cmd** (value asked for interactively, never in chat):

```
set "NODE_OPTIONS=--dns-result-order=ipv4first"
vercel env add TURSO_DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production --sensitive
vercel env add ANTHROPIC_API_KEY production --sensitive
vercel env add STRIPE_SECRET_KEY production --sensitive
```

Then redeploy: `python -I deploy.py`.

### Telegram

Every message is a Bot API **rich message** (`sendRichMessage`, Bot API 10.1-10.3: heading, findings table, SHA3-256 fingerprint,
the sealed record attached as a document block, buttons). If Telegram refuses it, the same content goes as plain text with an
inline keyboard, then the record with `sendDocument` (`lib/telegram.js`). The attached `.json` is the canonical record, so its
SHA3-256 equals the fingerprint in the message. The bot's buy button opens `/r/?id&t&buy=audit`, which opens the checkout form.

```
vercel env add TELEGRAM_CUSTOMER_BOT_TOKEN production --sensitive
vercel env add TELEGRAM_CHAT_ID production
python -I deploy.py
```

Then `POST /api/admin {"action":"telegram_setup"}` (webhook, commands) and `{"action":"telegram_test"}` (one scan message to
the owner chat; `"plain":true` forces the fallback, `"audience":"owner"` the alert layout, `"url"` scans a site first).

## Develop and test

```
npm test                                     # unit tests (address blocking, signatures, Merkle, .ots, store, Telegram)
set LOCAL_DB=.data\dev.db && node tests\dev-server.mjs   # site + API on http://127.0.0.1:8792
python -I tests\e2e.py                       # browser test of the whole flow
node tests\scan-cli.mjs coinhouse.com        # one scan in the terminal
node tests\ots-live.mjs                      # stamp a test file on the OpenTimestamps calendars
```

Local scans say "read from a test machine outside the EU": the place in a report always comes from the real
server region, never from a constant.

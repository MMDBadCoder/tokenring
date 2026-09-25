<div align="center">

# TokenRing

**An OpenAI-compatible proxy that pools your team's API keys and balances every request across them.**

</div>

---

Your team has several API keys for the same OpenAI-compatible provider, each with
its own per-minute rate limit. Individually they run out; together they rarely do.
TokenRing sits in front of them: your agents point at one URL with one key, and it
picks whichever real key has capacity right now. When a teammate isn't working,
their headroom is not wasted.

```
  agent ─┐
  agent ─┼──▶  TokenRing  ──▶  chooses a key with headroom  ──▶  provider
  agent ─┘     one URL              (round robin, least loaded, …)
               one key each
```

**Why the name.** The keys sit in a ring and each request takes the next one with
capacity — the token-ring topology, applied to API tokens. It is also a keyring.

---

## What it does

- **Drop-in OpenAI compatibility.** Every `/v1/*` endpoint is forwarded byte for
  byte, streaming included. The official SDKs, LangChain, LiteLLM, Cursor, Aider
  and anything else that speaks the protocol work with only a base URL change.
- **Four balancing strategies** — least loaded (default), round robin, weighted
  random, and failover — switchable from the dashboard with no restart.
- **Rate-limit aware.** Declare each key's requests-per-minute, tokens-per-minute
  and daily caps; TokenRing tracks a sliding window per key and routes around
  anything that is saturated.
- **Automatic recovery.** A `429` quarantines a key for exactly as long as the
  provider's `Retry-After` says. Connection errors and `5xx` quarantine after a
  threshold. A `401`/`403` disables the key outright, because that means revoked.
- **Retries on a different key.** A failed attempt is retried against another
  credential before the client ever sees an error.
- **Waits instead of failing.** When every key is momentarily saturated, a
  request is held briefly rather than bounced with a `429` (configurable).
- **Two key lists, both managed in the UI.** Upstream keys (the real ones, stored
  encrypted) and TokenRing keys (the ones you hand out, stored as hashes).
- **Per-key usage accounting.** Requests, prompt/completion tokens, error rate and
  latency for every issued key and every pooled key, with real token counts read
  from the provider's own `usage` field — including on streamed responses.
- **Quotas per issued key.** Requests/minute, requests/day, tokens/day, an expiry
  date, and an optional model allowlist.

## Quick start

> **Setting this up for your team?** [`SETUP.md`](SETUP.md) is the step-by-step
> guide — installation, first-time configuration, connecting agents, putting it
> on a shared server, backups and troubleshooting. What follows is the short
> version.

```bash
git clone <your-repo> tokenring && cd tokenring
npm install
npm run build
npm start
```

Open <http://localhost:4000>. On first boot a dashboard password is generated and
printed to the console once — or set `TOKENRING_ADMIN_PASSWORD` beforehand to
choose your own.

With Docker:

```bash
docker compose up -d
docker compose logs tokenring | grep password
```

Then, in the dashboard:

1. **Settings → Providers** — point the default provider at your upstream, e.g.
   `https://api.openai.com/v1`. The base URL includes the version segment.
2. **Upstream keys → Add key** — add one key per teammate, with its rate limits.
   Use the ⚡ button to check the key against the live provider.
3. **TokenRing keys → Generate key** — one per person or agent. The key is shown
   exactly once.

## Connecting an agent

Only the base URL and the key change:

```bash
export OPENAI_BASE_URL="http://localhost:4000/v1"
export OPENAI_API_KEY="sk-ring-…"
```

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:4000/v1",
    api_key="sk-ring-…",
)

client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
)
```

Issued keys carry the `sk-` prefix on purpose: many clients validate it locally
before a request is ever sent.

## The dashboard

| Page | What it is for |
|---|---|
| **Overview** | Requests and tokens over time, success rate, live throughput, pool health, and which key is spending what. |
| **Upstream keys** | The pooled provider keys, their live headroom this minute, and their status — ready, cooling down, at limit, disabled. |
| **TokenRing keys** | The keys you have issued, their usage and quotas, with rotate and revoke. |
| **Activity** | Every proxied request: which issued key made it, which pooled key served it, tokens, latency, and how many attempts it took. |
| **Settings** | Balancing strategy, retry and cooldown policy, token accounting, providers, and log retention. |

## Configuration

Operational settings live in the dashboard so they can change without a restart.
The environment only covers what must be known before the process starts — see
`.env.example` for the annotated list.

| Variable | Default | Purpose |
|---|---|---|
| `TOKENRING_HOST` / `TOKENRING_PORT` | `0.0.0.0` / `4000` | Listen address. |
| `TOKENRING_DATA_DIR` | `./data` | SQLite database and the generated master key. |
| `TOKENRING_ADMIN_PASSWORD` | generated | Dashboard password. |
| `TOKENRING_ENCRYPTION_KEY` | generated | 32 bytes (hex or base64) encrypting upstream secrets. |
| `TOKENRING_DEFAULT_PROVIDER_BASE_URL` | `https://api.openai.com/v1` | Seeds the first provider on an empty database. |
| `TOKENRING_PUBLIC_URL` | derived | Used for the copy-paste snippets in the dashboard. |
| `TOKENRING_SESSION_TTL_HOURS` | `168` | How long a dashboard login lasts. |
| `TOKENRING_TRUST_PROXY` | `0` | Honour `X-Forwarded-For`. Only behind a reverse proxy you control. |
| `TOKENRING_LOG_LEVEL` | `info` | Pino log level. |

### Runtime settings (dashboard → Settings)

| Setting | Default | Meaning |
|---|---|---|
| Balancing strategy | `least_loaded` | How the next key is chosen. |
| Attempts per request | `3` | Distinct keys tried before giving up. |
| Wait for capacity | `10s` | Hold a request while the pool is saturated instead of returning `429`. |
| Upstream timeout | `120s` | Abort an upstream call that produces no response. |
| Rate-limit cooldown | `20s` | Quarantine after a `429` with no `Retry-After`. |
| Failure cooldown / threshold | `30s` / `3` | Quarantine after repeated connection or `5xx` failures. |
| Disable on auth error | on | A `401`/`403` means the key is revoked. |
| Ask for token counts on streams | on | Adds `stream_options.include_usage`. |
| Estimate missing tokens | on | Approximates when the provider reports none; such rows are marked `≈`. |
| Forward `x-ratelimit-*` headers | off | Those describe one pooled key, not the pool. |
| Keep activity for | `30` days | Older request logs are pruned automatically. |

## How balancing works

Each key carries a live one-minute sliding window of requests and tokens, plus a
per-UTC-day counter. Before every request TokenRing measures each key's **load** —
its worst utilisation across the limits you declared — and filters out anything
disabled, quarantined, or already at a limit. The strategy then picks from what
remains:

- **Least loaded** — the key with the most headroom. Best when teammates are on
  different plans.
- **Round robin** — strict rotation through the keys that currently have capacity.
- **Weighted random** — proportional to each key's weight.
- **Failover** — always the highest-weight key until it is exhausted.

If nothing has capacity, the request waits up to *Wait for capacity* for a slot to
open before returning a `429` with an accurate `Retry-After`.

Windows are rebuilt from the request log at startup, so a restart does not hand
out capacity the provider has already spent.

## Security

- Upstream secrets are encrypted with AES-256-GCM before they reach disk. The API
  returns only a masked hint (`sk-abc…wxyz`); the plaintext is never sent to the
  browser.
- Issued keys are stored as SHA-256 hashes. Losing one means rotating it, not
  recovering it.
- The dashboard password is stored as a scrypt hash. Changing it ends every
  session.
- `Authorization` headers from clients are stripped before forwarding — a caller
  can never smuggle their own upstream credential through.

TokenRing has no transport security of its own. Run it on a private network, or
behind a reverse proxy that terminates TLS, and set `TOKENRING_TRUST_PROXY=1`
only when that proxy is one you control.

## Architecture

```
server/src
├── main.ts                  process entry: migrate, seed, hydrate, listen
├── config/env.ts            environment parsing
├── core/
│   ├── balancer.ts          capacity measurement + the four strategies
│   ├── usageWindows.ts      in-memory sliding windows and daily counters
│   ├── proxyEngine.ts       one request end to end: select, forward, retry, bill
│   ├── upstreamClient.ts    header hygiene, dispatch, failure classification
│   ├── openaiProtocol.ts    model/stream inspection, usage extraction, SSE scan
│   └── apiErrors.ts         OpenAI-shaped error bodies
├── db/                      schema, migrations, repositories
├── http/                    Fastify app, auth, proxy route, dashboard API
└── util/                    ids, time, encryption and hashing

web/src
├── pages/                   Overview · UpstreamKeys · VirtualKeys · Activity · Settings
├── components/              shell, charts, tables, dialogs, primitives
├── lib/                     API client, formatting, hooks
└── styles/                  design tokens and the stylesheet
```

The database is SQLite in WAL mode. Migrations in `server/src/db/schema.ts` run in
order on boot and are recorded, so adding one is always safe.

### Visual language

Charts use a palette validated for colour-vision deficiency and for contrast
against both the light and dark chart surfaces: blue for the primary series, red
reserved for failure, and status colours that always ship with a label rather than
carrying meaning through hue alone. Both themes are defined explicitly — dark is
its own set of steps, not an inverted light.

## Development

```bash
npm run dev          # API on :4000, dashboard on :4001 with hot reload
npm run typecheck    # server + web
npm run build        # web bundle, then server
```

The dev dashboard proxies `/api`, `/v1` and `/health` to the API, so the browser
only ever talks to one origin.

## API

Everything under `/v1/*` is the provider's own API, authenticated with an issued
TokenRing key.

The dashboard API under `/api/*` uses a session cookie:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` · `/logout` · `/password` | Session management. |
| `GET` | `/api/overview?window=24h` | Everything the Overview page renders. |
| `GET` `POST` `PATCH` `DELETE` | `/api/providers[/:id]` | Providers. |
| `GET` `POST` `PATCH` `DELETE` | `/api/upstream-keys[/:id]` | Pooled keys. |
| `POST` | `/api/upstream-keys/:id/test` · `/reset` | Check a key live · lift a quarantine. |
| `GET` `POST` `PATCH` `DELETE` | `/api/virtual-keys[/:id]` | Issued keys. |
| `POST` | `/api/virtual-keys/:id/rotate` | Issue a new token, invalidating the old one. |
| `GET` | `/api/logs` | Request log, filterable and paged. |
| `GET` `PATCH` | `/api/settings` | Runtime settings. |

`GET /health` is public and needs no session.

## Limitations

- Usage windows are per process, so TokenRing runs as a single instance. Two
  instances sharing one database would each track only their own traffic and
  could jointly exceed a provider limit.
- Token counts come from the provider's `usage` field. When a provider omits it
  and estimation is on, the figure is approximate and marked `≈`.
- Costs are not modelled — TokenRing counts tokens, not currency.

## Licence

MIT.

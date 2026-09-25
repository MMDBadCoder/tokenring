# Setting up TokenRing

A step-by-step guide to getting the key pool running and pointing your agents at
it. Start to finish it takes about ten minutes.

**Contents**

1. [Before you start](#1-before-you-start)
2. [Get it running](#2-get-it-running)
3. [Sign in](#3-sign-in)
4. [Point it at your provider](#4-point-it-at-your-provider)
5. [Add everyone's real keys](#5-add-everyones-real-keys)
6. [Issue a key to each person](#6-issue-a-key-to-each-person)
7. [Connect your agent](#7-connect-your-agent)
8. [Put it on a shared server](#8-put-it-on-a-shared-server)
9. [Configuration reference](#9-configuration-reference)
10. [Everyday operations](#10-everyday-operations)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Before you start

You need:

- **Node.js 20.11 or newer** (`node --version`) — or **Docker**, if you would
  rather not install Node. Node 22 is what this is developed against.
- **At least one real API key** for an OpenAI-compatible provider. Two or more is
  the point, but one works while you are testing.
- **The provider's base URL**, including its version segment — for example
  `https://api.openai.com/v1`.

One person runs TokenRing; everyone else just receives a key from them. Decide who
that is before you start, because the real provider keys are entered on their
machine or server.

> **A note on trust.** Everyone's real API key goes into one pool. TokenRing
> encrypts them and never shows them again, but whoever runs the server can reach
> the database. Run it somewhere the whole group is comfortable with.

---

## 2. Get it running

Pick **one** of the three options below.

### Option A — Docker (recommended for a shared server)

```bash
git clone <your-repo-url> tokenring
cd tokenring
docker compose up -d
```

That builds the image, starts it on port 4000, and stores the database in a
Docker volume called `tokenring-data` so it survives restarts and upgrades.

Set your own password and encryption key first if you like — create a `.env` file
next to `docker-compose.yml`:

```bash
cat > .env <<'EOF'
TOKENRING_ADMIN_PASSWORD=pick-something-long
TOKENRING_ENCRYPTION_KEY=   # paste the output of: openssl rand -hex 32
TOKENRING_DEFAULT_PROVIDER_BASE_URL=https://api.openai.com/v1
EOF
docker compose up -d
```

Check it came up:

```bash
docker compose ps
curl http://localhost:4000/health
```

### Option B — From source

```bash
git clone <your-repo-url> tokenring
cd tokenring
npm install
npm run build
npm start
```

`npm start` runs on port 4000 and writes its database to `./data`.

To choose the port, password and provider up front, create a `.env` file in the
project root — copy `.env.example` and edit it:

```bash
cp .env.example .env
```

### Option C — Development mode

Only if you intend to change the code. Run two terminals:

```bash
npm run dev:server   # API on http://localhost:4000, restarts on change
npm run dev:web      # dashboard on http://localhost:4001, hot reload
```

Open **http://localhost:4001**. The dev dashboard forwards `/api`, `/v1` and
`/health` to the API, so the browser only talks to one origin.

(`npm run dev` starts both at once, but backgrounds the server, so stopping it
cleanly is fiddlier. Two terminals is the nicer way.)

---

## 3. Sign in

Open **http://localhost:4000**.

If you set `TOKENRING_ADMIN_PASSWORD`, use that. If you did not, TokenRing
generated one on first boot and printed it to the console **once**:

```
Dashboard password (shown once, stored hashed): ExampleOnlyNotYours1
  Set TOKENRING_ADMIN_PASSWORD to choose your own, or change it in Settings.
```

With Docker, read it from the logs:

```bash
docker compose logs tokenring | grep "Dashboard password"
```

Only the hash is stored, so this is the only time it appears. **If you miss it,
do not delete the database** — that would take every key with it. Set
`TOKENRING_ADMIN_PASSWORD` in the environment and restart; it overrides whatever
is stored, and nothing else is affected.

You can change it later in **Settings → Change dashboard password**. Doing so
signs out every session, including yours.

---

## 4. Point it at your provider

**Settings → Providers.** A provider called `Default` already exists, pointing at
whatever `TOKENRING_DEFAULT_PROVIDER_BASE_URL` was set to. Click **Edit** and set
the base URL to your provider's.

> **Include the version segment.** `https://api.openai.com/v1`, not
> `https://api.openai.com`. TokenRing strips the `/v1` prefix from the incoming
> path and appends the rest to this URL, so a client calling
> `POST /v1/chat/completions` reaches `<base URL>/chat/completions`.

Common base URLs:

| Provider | Base URL |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| Together | `https://api.together.xyz/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Local llama.cpp / vLLM / Ollama | `http://localhost:8000/v1` |

If your group uses **more than one** provider, add each as its own provider and
assign each real key to the right one. A TokenRing key can be pinned to a
specific provider, or left on the default.

---

## 5. Add everyone's real keys

**Upstream keys → Add key.** One entry per real key.

| Field | What to put |
|---|---|
| **Label** | Something you will recognise — `Ali — Pro plan`. |
| **Owner** | Whose key it is. Shows up in the usage charts. |
| **Provider API key** | The real key. Encrypted before it hits disk; you will never see it again. |
| **Requests per minute** | The provider's limit for this key. |
| **Tokens per minute** | The provider's limit, if it has one. |
| **Requests per day** | A daily cap, if the plan has one. |
| **Weight** | Leave at `1` unless one account is much bigger — see below. |

**The rate limits are the important part.** They are what TokenRing balances
against: it tracks a rolling one-minute window per key and routes around anything
that has hit its ceiling. Leave a field blank if you genuinely do not know the
limit — the key still takes its turn, TokenRing just cannot predict when it will
be rejected, and will fall back to reacting to the provider's `429`s.

Find the real numbers on your provider's limits page (for OpenAI: **Settings →
Limits** in the platform dashboard, per model and per tier).

After adding a key, click the **⚡** button on its row. That calls the provider's
`/models` endpoint with that key and tells you whether it actually works:

```
Ali — Pro plan: Key works. 47 model(s) available. (312ms)
```

Repeat for each friend's key.

**About weight:** it only matters for the *weighted random* and *failover*
strategies. With the default *least loaded* strategy, balancing follows the rate
limits you entered, and weight is ignored.

---

## 6. Issue a key to each person

**TokenRing keys → Generate key.** One per person, or per agent — separate keys
are what make the per-key usage charts useful.

| Field | Notes |
|---|---|
| **Name** | The agent or app — `Sara's research agent`. |
| **Owner** | Who to ask about it. |
| **Requests per minute** | Optional ceiling for this key alone. |
| **Requests per day** / **Tokens per day** | Optional. Stops one runaway agent draining the pool. |
| **Expires on** | Optional. Useful for a guest or a short project. |
| **Allowed models** | Optional comma-separated allowlist. Blank means any model. |

The key is shown **once**, right after it is created, together with ready-made
environment variables and a Python snippet:

```
sk-ring-EXAMPLEonly00000000000000000000000000000
```

Copy it and send it to its owner. Only a hash is stored — if it is lost, use
**Rotate** to issue a new one rather than trying to recover the old.

These quotas are per key and sit *on top of* the pool's own limits. A key with no
quotas can still only go as fast as the pool allows.

---

## 7. Connect your agent

Nothing about your code changes except the base URL and the key.

### Environment variables

Most tools read these directly:

```bash
export OPENAI_BASE_URL="http://localhost:4000/v1"
export OPENAI_API_KEY="sk-ring-..."
```

### Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:4000/v1",
    api_key="sk-ring-...",
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
)
print(response.choices[0].message.content)
```

### Node / TypeScript

```js
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:4000/v1',
  apiKey: 'sk-ring-...',
});

const response = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

### curl

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-ring-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'
```

### Other tools

| Tool | Where to set it |
|---|---|
| **LangChain** (Python) | `ChatOpenAI(base_url="http://…/v1", api_key="sk-ring-…")` |
| **LlamaIndex** | `OpenAI(api_base="http://…/v1", api_key="sk-ring-…")` |
| **Aider** | `aider --openai-api-base http://…/v1 --openai-api-key sk-ring-…` |
| **Continue / Cline** | `apiBase` and `apiKey` in the model config |
| **Cursor** | Settings → Models → Override OpenAI base URL |
| **LiteLLM** | `api_base` and `api_key` on an `openai/` model |

Streaming works exactly as it does against the provider directly, and streamed
responses still report real token usage.

**Check it worked:** make one request, then open **Activity** in the dashboard.
You should see the request, which TokenRing key made it, and which of your
friends' keys served it.

---

## 8. Put it on a shared server

Running on `localhost` only helps the person running it. To let the group use it,
put it on a machine everyone can reach.

TokenRing does **not** terminate TLS itself. Either keep it on a private network
(a VPN, Tailscale, a LAN) or put a reverse proxy in front of it.

### Keep it running — systemd

For the from-source install. Adjust paths and user:

```ini
# /etc/systemd/system/tokenring.service
[Unit]
Description=TokenRing API key pool
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=tokenring
WorkingDirectory=/opt/tokenring
EnvironmentFile=/opt/tokenring/.env
ExecStart=/usr/bin/node server/dist/main.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/tokenring/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tokenring
sudo systemctl status tokenring
journalctl -u tokenring -f          # this is where the first-boot password appears
```

With Docker, `restart: unless-stopped` in `docker-compose.yml` already handles it.

### Reverse proxy — Caddy

Caddy gets you HTTPS with no extra configuration:

```caddyfile
tokenring.example.com {
    reverse_proxy localhost:4000 {
        flush_interval -1
    }
}
```

`flush_interval -1` disables response buffering. **Without it, streaming replies
arrive all at once at the end** instead of token by token.

### Reverse proxy — nginx

```nginx
server {
    listen 443 ssl;
    server_name tokenring.example.com;

    ssl_certificate     /etc/letsencrypt/live/tokenring.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tokenring.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Streaming: without these, SSE responses are buffered and arrive at the end.
        proxy_buffering off;
        proxy_cache off;

        # LLM calls are slow. The default 60s will cut long generations short.
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;

        client_max_body_size 64m;   # requests can carry base64 images
    }
}
```

### After putting a proxy in front

Set these in the environment and restart:

```bash
TOKENRING_PUBLIC_URL=https://tokenring.example.com
TOKENRING_TRUST_PROXY=1
```

`TOKENRING_PUBLIC_URL` makes the dashboard hand out the right base URL in its
copy-paste snippets. `TOKENRING_TRUST_PROXY=1` makes the activity log record the
real client IP instead of the proxy's — **only set it when the proxy in front is
one you control**, since otherwise callers can forge the header.

Then tell everyone to use `https://tokenring.example.com/v1` as their base URL.

---

## 9. Configuration reference

### Environment — needed before the process starts

Set these in `.env`, in the systemd unit, or in `docker-compose.yml`. Every one
has a working default; `.env.example` has the annotated list.

| Variable | Default | What it does |
|---|---|---|
| `TOKENRING_PORT` | `4000` | Port to listen on. |
| `TOKENRING_HOST` | `0.0.0.0` | Interface. Use `127.0.0.1` when a reverse proxy is in front. |
| `TOKENRING_DATA_DIR` | `./data` | Database and generated encryption key. |
| `TOKENRING_ADMIN_PASSWORD` | generated | Dashboard password. |
| `TOKENRING_ENCRYPTION_KEY` | generated | 32 bytes, hex or base64, encrypting the real API keys. |
| `TOKENRING_DEFAULT_PROVIDER_BASE_URL` | `https://api.openai.com/v1` | Seeds the first provider. Ignored once one exists. |
| `TOKENRING_PUBLIC_URL` | derived | The URL shown in the dashboard's snippets. |
| `TOKENRING_SESSION_TTL_HOURS` | `168` | How long a dashboard login lasts. |
| `TOKENRING_TRUST_PROXY` | `0` | Honour `X-Forwarded-For`. Only behind a proxy you control. |
| `TOKENRING_LOG_LEVEL` | `info` | `trace` · `debug` · `info` · `warn` · `error` · `silent`. |

Generate an encryption key with:

```bash
openssl rand -hex 32
```

Setting `TOKENRING_ENCRYPTION_KEY` explicitly is worth doing before you add any
real keys — see the backup note in [§10](#10-everyday-operations).

### Settings page — changeable at any time, no restart

| Setting | Default | What it does |
|---|---|---|
| Balancing strategy | Least loaded | How the next key is picked. |
| Attempts per request | `3` | How many different keys to try before giving up. |
| Wait for capacity | `10s` | Hold a request while the pool is saturated instead of failing it. |
| Upstream timeout | `120s` | Give up on an upstream call that produces nothing. |
| Rate-limit cooldown | `20s` | Quarantine after a `429` that carries no `Retry-After`. |
| Failure cooldown | `30s` | Quarantine after connection errors or `5xx`. |
| Failures before quarantine | `3` | How many consecutive failures are tolerated first. |
| Disable a key when the provider rejects it | on | A `401`/`403` means revoked. |
| Ask for token counts on streamed replies | on | Adds `stream_options.include_usage`. Turn off only if a client chokes on the final usage chunk. |
| Estimate tokens when the provider reports none | on | Approximates from text length; such rows are marked `≈`. |
| Forward upstream `x-ratelimit-*` headers | off | They describe one pooled key, not the pool, and mislead clients that read them. |
| Keep activity for | `30` days | Older request logs are pruned automatically. |

### Which balancing strategy?

| Strategy | Use it when |
|---|---|
| **Least loaded** *(default)* | Almost always — especially when people are on different plans with different limits. |
| **Round robin** | You want strict, predictable rotation and everyone's limits are the same. |
| **Weighted random** | One account is much larger and should take proportionally more. |
| **Failover** | One key should absorb everything and the others are only a backup. Set weights to rank them. |

---

## 10. Everyday operations

### Someone joins

Add their real key under **Upstream keys**, and generate them a key under
**TokenRing keys**. Nothing needs restarting.

### Someone leaves

Delete their entry under **Upstream keys** (their real key stops being used) and
revoke their key under **TokenRing keys**. Their past usage stays in Activity.

### A key leaked, or an agent is misbehaving

**TokenRing keys → Rotate** issues a new key and invalidates the old one
immediately. Or the **toggle** on the row suspends it without deleting the
history.

### A key shows "Rejected"

The provider returned `401`/`403`, meaning that real key is revoked or wrong.
TokenRing disabled it so it stops wasting attempts. Edit the row, paste the
replacement into **Replace secret**, and saving re-enables it automatically.

### A key shows "Cooling down"

It hit a `429` or failed repeatedly and is quarantined for a short while.
TokenRing brings it back on its own. The **↻** button on the row returns it to
rotation immediately, once you have fixed whatever was wrong.

### Backups

> **Back up the whole `data/` directory, not just the database.** If
> `TOKENRING_ENCRYPTION_KEY` is not set in the environment, the key that decrypts
> the real API keys is generated into `data/master.key`. Without that file the
> stored secrets cannot be recovered, and everyone would have to re-enter their
> key.

From source — stop, copy, start:

```bash
sudo systemctl stop tokenring
tar czf tokenring-backup-$(date +%F).tar.gz -C /opt/tokenring data
sudo systemctl start tokenring
```

With Docker — stop it first too, so the database and its write-ahead log are
captured in a consistent state:

```bash
docker compose stop
docker run --rm -v tokenring-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/tokenring-backup-$(date +%F).tar.gz -C /data .
docker compose start
```

The archive should contain `tokenring.db`, its `-wal` and `-shm` companions, and
`master.key` if TokenRing generated one. If `master.key` is missing and you never
set `TOKENRING_ENCRYPTION_KEY`, the backup was taken before any real key was
added — take another one now.

Setting `TOKENRING_ENCRYPTION_KEY` yourself and storing it in a password manager
is the more robust arrangement — then a lost `data/` directory costs you history,
not everyone's credentials.

### Upgrading

```bash
git pull
npm install
npm run build
sudo systemctl restart tokenring
```

With Docker:

```bash
git pull
docker compose up -d --build
```

Database migrations run automatically on boot and are recorded, so an upgrade is
safe to repeat. The volume and its data are untouched.

### Is it healthy?

```bash
curl http://localhost:4000/health
```

```json
{"status":"ok","service":"tokenring","providers":1,"upstreamKeys":3,"uptimeSeconds":8241}
```

No authentication needed, so it works as an uptime-monitor target. `upstreamKeys`
counts the keys currently enabled — if it drops, one has been auto-disabled.

---

## 11. Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| `401 invalid_api_key` | The key is not registered, or was rotated or deleted. | Check the key against the hint on the **TokenRing keys** page; rotate and re-issue if needed. |
| `401 missing_api_key` | No `Authorization` header arrived. | Send `Authorization: Bearer sk-ring-…`. Check the client is reading `OPENAI_API_KEY`. |
| `403 model_not_allowed` | This key has a model allowlist that excludes the model. | Edit the key and add the model, or clear the allowlist. |
| `403 key_disabled` / `key_expired` | The key was suspended, or passed its expiry date. | Re-enable it or extend the expiry on the **TokenRing keys** page. |
| `429 pool_exhausted` | Every real key is at its limit right now. | Expected under load. Raise **Wait for capacity**, add another key, or check whether the limits you entered are lower than reality. |
| `429 key_rpm_exceeded` | This one TokenRing key hit *its own* quota, not the pool's. | Raise or clear the quota on that key. |
| `503 no_upstream_key` | No enabled real key exists for the provider. | Add one, or re-enable a disabled one under **Upstream keys**. |
| `502` with `auth_failed` | Every real key was rejected by the provider. | Test each key with the **⚡** button; replace the ones that fail. |
| Everything is slow, then fails | The provider is slow, or the timeout is too short. | Raise **Upstream timeout**; check `proxy_read_timeout` if nginx is in front. |
| Streaming arrives all at once | A reverse proxy is buffering the response. | `proxy_buffering off` in nginx, `flush_interval -1` in Caddy. |
| Token counts show `≈` | The provider reported no usage, so it was estimated. | Turn on **Ask for token counts on streamed replies**, or accept the estimate. |
| Charts are empty | No traffic in the selected window. | Switch the range (1h / 24h / 7d / 30d) in the top right. |
| Dashboard loads but nothing works | The API is unreachable or the session expired. | `curl /health`, then sign in again. |
| Forgot the dashboard password | Only its hash is stored. | Set `TOKENRING_ADMIN_PASSWORD` in the environment and restart — it overrides the stored one. |
| `EADDRINUSE` on start | Port 4000 is taken. | Set `TOKENRING_PORT`, or stop whatever is using it. |

### Reading the logs

```bash
journalctl -u tokenring -f        # systemd
docker compose logs -f tokenring  # docker
```

Set `TOKENRING_LOG_LEVEL=debug` for more detail. Individual proxied requests are
not written to the log — they go to the **Activity** page, which is more useful
for them.

---

## What next

- The **Overview** page is the one to keep open. Pool health shows each key's
  headroom this minute; the charts show whether the group is near its ceiling.
- If `429 pool_exhausted` starts appearing regularly, the pool is genuinely too
  small — that is the signal to add another key.
- `README.md` covers how the balancing works internally, the security model, and
  the dashboard API.

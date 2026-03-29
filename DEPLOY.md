# Jordan v2 — Deployment Guide

## Architecture

```
Discord <--> jordan-bot (Node.js, namespace jordan)
                 |
                 +--> Stock-Screener API   (signals, analysis, market, portfolio)
                 |    http://stock-screener-api.trading:8000
                 |
                 +--> n8n Webhook          (free-form chat via Claude AI)
                 |    https://n8n.neko-it.be/webhook/jordan
                 |
                 +--> IB Gateway           (orders, positions via Stock-Screener)
```

## Steps

### 1. Create the GitHub repo

```bash
git init
git add -A
git commit -m "feat: jordan v2 — trading assistant discord bot"
git remote add origin git@github.com:John6810/jordan-bot.git
git push -u origin main
```

### 2. Create the K8s secret

```bash
kubectl create namespace jordan

kubectl create secret generic jordan-secrets -n jordan \
  --from-literal=DISCORD_TOKEN='...' \
  --from-literal=DISCORD_CHANNEL_ID='1486045625392042115' \
  --from-literal=N8N_WEBHOOK_URL='https://n8n.neko-it.be/webhook/jordan'
```

The `SCREENER_API_URL` is set directly in the deployment manifest (not in the secret).

### 3. Create the GHCR pull secret

```bash
kubectl create secret docker-registry ghcr-pull -n jordan \
  --docker-server=ghcr.io \
  --docker-username=John6810 \
  --docker-password='<GITHUB_PAT>'
```

### 4. Register slash commands (one-time)

```bash
DISCORD_TOKEN='...' DISCORD_CLIENT_ID='1486041074232332368' node src/register-commands.js
```

### 5. Set up ArgoCD

Copy `deployment.yaml` to the GitOps repo:

```
argocd-apps/apps/jordan-bot/deployment.yaml
```

Create the ArgoCD Application pointing to that path.

### 6. Build & Deploy

Push to `main` -> GitHub Actions builds the image, pushes to GHCR, updates the image tag in `argocd-apps` -> ArgoCD syncs automatically.

The CI pipeline triggers on changes to `src/`, `package*.json`, or `Dockerfile`.

### 7. Verify

```bash
kubectl -n jordan get pods
kubectl -n jordan logs deploy/jordan-bot -f
```

## Discord Commands

| Command | Description |
|---------|-------------|
| `/scan` | Scan tickers, identify BUY signals |
| `/analyze TICKER [CAPITAL]` | Full analysis with trade setup |
| `/market` | Sector performance, indices, gainers/losers |
| `/discover [TOP] [SECTOR]` | Find best US equity candidates |
| `/check` | Economic calendar next 24h |
| `/portfolio` | Portfolio overview: positions, P&L, heat, sector exposure |
| `/review` | EOD review — flag EXIT signals and near-stop positions |
| `/orders` | Open orders on IB Gateway |
| `/confluence TICKER` | Multi-timeframe alignment (daily vs weekly) |
| `/performance` | Trading performance stats |
| `/alerts` | Signal changes since last scan |
| `/movers [MIN_MOVE] [PERIOD]` | Unusual momentum moves on watchlist |
| *Free chat* | Trading questions answered by Claude AI via n8n |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Bot authentication token |
| `DISCORD_CLIENT_ID` | `1486041074232332368` |
| `DISCORD_CHANNEL_ID` | `1486045625392042115` |
| `N8N_WEBHOOK_URL` | `https://n8n.neko-it.be/webhook/jordan` |
| `SCREENER_API_URL` | `http://stock-screener-api.trading:8000` (set in deployment manifest) |

## Resource Limits

| Resource | Request | Limit |
|----------|---------|-------|
| CPU | 10m | 100m |
| Memory | 64Mi | 128Mi |

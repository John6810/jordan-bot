# Jordan v2

Discord trading assistant bot providing real-time trading signals, market analysis, and portfolio management via the [Stock-Screener](https://github.com/John6810/stock-screener) API.

## Architecture

```
Discord <--> jordan-bot (Node.js)
                 |
                 +--> Stock-Screener API   (signals, analysis, market, portfolio)
                 +--> n8n Webhook          (free-form chat via Claude AI)
                 +--> IB Gateway           (orders, positions)
```

## Commands

| Command | Description |
|---------|-------------|
| `/scan` | Scan tickers, identify BUY signals |
| `/analyze TICKER [CAPITAL]` | Full technical & fundamental analysis with trade setup |
| `/market` | Sector performance, indices, top gainers/losers |
| `/discover [TOP] [SECTOR]` | Find best US equity candidates by discovery score |
| `/check` | Economic calendar — macro events in the next 24h |
| `/portfolio` | Portfolio overview: positions, P&L, heat, sector exposure |
| `/review` | EOD review — flag EXIT signals and near-stop positions |
| `/orders` | Open orders on IB Gateway |
| `/confluence TICKER` | Multi-timeframe alignment check (daily vs weekly) |
| `/performance` | Trading performance stats from journal |
| `/alerts` | Signal changes since last scan |
| `/movers [MIN_MOVE] [PERIOD]` | Detect unusual momentum moves on watchlist |
| *Free chat* | Trading questions answered by Claude AI via n8n |

## Tech Stack

- **Runtime**: Node.js >= 20
- **Framework**: discord.js v14
- **HTTP**: axios
- **Deployment**: Docker, Kubernetes, ArgoCD
- **CI/CD**: GitHub Actions -> GHCR -> ArgoCD

## Quick Start

### Environment Variables

```env
DISCORD_TOKEN=         # Bot authentication token
DISCORD_CLIENT_ID=     # Client ID for slash command registration
DISCORD_CHANNEL_ID=    # Channel where the bot listens for messages
N8N_WEBHOOK_URL=       # n8n webhook URL for Claude chat
SCREENER_API_URL=      # Stock-Screener API URL (default: http://stock-screener-api.trading:8000)
```

### Local

```bash
npm install

# Register slash commands (one-time setup)
npm run register

# Start the bot
npm start
```

### Docker

```bash
docker build -t jordan-bot .
docker run -e DISCORD_TOKEN='...' \
           -e DISCORD_CHANNEL_ID='...' \
           -e N8N_WEBHOOK_URL='...' \
           jordan-bot
```

### Kubernetes

The bot deploys automatically via the CI/CD pipeline:

1. Push to `main` -> GitHub Actions builds the image and pushes to GHCR
2. Image SHA is updated in `argocd-apps/apps/jordan-bot/deployment.yaml`
3. ArgoCD automatically syncs the deployment

```bash
# Check deployment status
kubectl -n jordan get pods
kubectl -n jordan logs deploy/jordan-bot -f
```

## Project Structure

```
src/
  bot.js                 # Main bot logic and command handlers
  register-commands.js   # Slash command registration utility
Dockerfile               # Alpine Node.js 20 image
.github/workflows/
  build.yml              # CI/CD pipeline
```

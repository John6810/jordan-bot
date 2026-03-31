/**
 * Jordan v2 — Discord Trading Assistant
 *
 * Architecture:
 *   Discord ←→ bot.js ←→ Stock-Screener API (data)
 *                      ←→ n8n webhook (Claude chat only)
 *
 * Commands:
 *   /scan           — Scan tickers, show BUY signals
 *   /analyze TICKER — Full analysis with trade setup
 *   /market         — Sector perf + gainers/losers
 *   /discover       — Find best US equities
 *   /check          — Economic calendar next 24h
 *   /portfolio      — Portfolio overview (IB Gateway)
 *   /review         — EOD review: flag exits/near-stop
 *   /orders         — Open orders
 *   /confluence     — Multi-timeframe check
 *   /performance    — Trading performance stats
 *   /alerts         — Signal changes
 *   (free chat)     — Trading questions to Claude via n8n
 */
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');
const axios = require('axios');

// ─── Config ──────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const API_BASE = process.env.SCREENER_API_URL || 'http://stock-screener-api.trading:8000';
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

// ─── Colors ──────────────────────────────────────────────────
const COLORS = {
  BUY: 0x00D4AA,
  STRONG_BUY: 0x00FF88,
  NEUTRAL: 0xFFA500,
  SELL: 0xFF4757,
  STRONG_SELL: 0xFF0000,
  INFO: 0x1565C0,
  WARNING: 0xE65100,
  SUCCESS: 0x00D4AA,
  DEFAULT: 0x2F3136,
};

// ─── Helpers ─────────────────────────────────────────────────

async function callAPI(path) {
  try {
    const res = await axios.get(`${API_BASE}${path}`, { timeout: 180000 });
    return res.data;
  } catch (err) {
    const detail = err.response?.data?.detail || err.message;
    console.error(`API error ${path}:`, detail);
    return { error: true, message: detail };
  }
}

async function callN8n(payload) {
  if (!N8N_WEBHOOK_URL) return { error: true, message: 'N8N_WEBHOOK_URL not configured' };
  try {
    const res = await axios.post(N8N_WEBHOOK_URL, payload, { timeout: 120000 });
    return res.data;
  } catch (err) {
    console.error('n8n error:', err.message);
    return { error: true, message: 'Erreur de connexion.' };
  }
}

function chunk(text, maxLen = 4096) {
  if (!text || text.length <= maxLen) return [text || ''];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.3) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

function embed(title, description, color = COLORS.INFO) {
  const e = new EmbedBuilder()
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: 'Jordan v2 · Trading Assistant' });
  if (title) e.setTitle(title);
  if (description) e.setDescription(description.substring(0, 4096));
  return e;
}

function signalColor(signal) { return COLORS[signal] || COLORS.DEFAULT; }

function formatNumber(n) { return n != null ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : 'N/A'; }
function formatPct(n) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : 'N/A'; }

// ─── Format API data into Discord text ──────────────────────

function formatScan(data) {
  if (!data.results?.length) return 'Aucun résultat.';
  const warns = (data.macro_warnings || []).map(w => `⚠️ ${w.event} (${w.date})`).join('\n');
  let text = warns ? warns + '\n\n' : '';
  text += '```\n';
  text += 'TICKER  SCORE  SIGNAL       TECH  FUND\n';
  text += '─'.repeat(45) + '\n';
  for (const r of data.results.slice(0, 20)) {
    const sig = r.signal.padEnd(12);
    text += `${r.ticker.padEnd(7)} ${r.combined_score.toFixed(1).padStart(5)}  ${sig} ${r.technical_score.toFixed(1).padStart(5)} ${r.fundamental_score.toFixed(1).padStart(5)}\n`;
  }
  text += '```\n';
  const buys = data.results.filter(r => r.signal === 'BUY' || r.signal === 'STRONG_BUY').length;
  text += `**${data.tickers_scanned}** tickers | **${buys}** BUY signals`;
  return text;
}

function formatAnalyze(data) {
  let text = `**Signal:** ${data.signal} | **Score:** ${data.combined_score?.toFixed(1)}\n`;
  text += `Tech: ${data.technical_score?.toFixed(1)} | Fund: ${data.fundamental_score?.toFixed(1)} | Conviction: ${data.conviction}/5\n\n`;

  if (data.trade_setup) {
    const ts = data.trade_setup;
    text += '```\n';
    text += `Entry:  $${formatNumber(ts.entry)}\n`;
    text += `Stop:   $${formatNumber(ts.stop_loss)}  (ATR: ${formatNumber(ts.atr)})\n`;
    text += `TP1:    $${formatNumber(ts.tp1)}\n`;
    text += `TP2:    $${formatNumber(ts.tp2)}\n`;
    text += `Shares: ${ts.position_size}  |  Risk: $${formatNumber(ts.risk_amount)}\n`;
    text += '```\n';
  }

  if (data.price_momentum) {
    const pm = data.price_momentum;
    text += `**Momentum:** 1D ${formatPct(pm['1D'])} | 1M ${formatPct(pm['1M'])} | 3M ${formatPct(pm['3M'])} | 1Y ${formatPct(pm['1Y'])}\n`;
  }

  if (data.analyst_sentiment) {
    const as_ = data.analyst_sentiment;
    text += `**Analysts:** ${as_.bullish_pct?.toFixed(0)}% bullish | Target $${formatNumber(as_.price_target_consensus)} (${formatPct(as_.upside_pct)} upside)\n`;
  }

  return text;
}

function formatMarket(data) {
  let text = '';
  if (data.sectors?.length) {
    text += '**Sector Performance**\n```\n';
    for (const s of data.sectors) {
      const pct = s.changesPercentage >= 0 ? `+${s.changesPercentage.toFixed(2)}%` : `${s.changesPercentage.toFixed(2)}%`;
      const bar = s.changesPercentage >= 0 ? '█'.repeat(Math.min(10, Math.round(s.changesPercentage * 3))) : '';
      text += `${s.sector.padEnd(25)} ${pct.padStart(7)} ${bar}\n`;
    }
    text += '```\n';
  }
  if (data.gainers?.length) {
    text += '**Top Gainers:** ' + data.gainers.slice(0, 5).map(g => `${g.symbol} +${g.changesPercentage.toFixed(1)}%`).join(', ') + '\n';
  }
  if (data.losers?.length) {
    text += '**Top Losers:** ' + data.losers.slice(0, 5).map(l => `${l.symbol} ${l.changesPercentage.toFixed(1)}%`).join(', ') + '\n';
  }
  if (data.macro_events?.length) {
    text += '\n⚠️ **Macro Events:**\n' + data.macro_events.map(e => `- ${e.event} (${e.date})`).join('\n');
  }
  return text || 'Aucune donnée.';
}

function formatPortfolio(data) {
  let text = `**NAV:** $${formatNumber(data.account?.nav)} | **Cash:** $${formatNumber(data.account?.cash)} | **P&L:** $${formatNumber(data.account?.unrealized_pnl)}\n\n`;
  if (data.positions?.length) {
    text += '```\n';
    text += 'TICKER  QTY    P&L%    VALUE     WT%\n';
    text += '─'.repeat(42) + '\n';
    for (const p of data.positions) {
      if (p.quantity === 0) continue;
      text += `${p.ticker.padEnd(7)} ${String(p.quantity).padStart(3)}  ${formatPct(p.pnl_pct).padStart(7)}  $${formatNumber(p.market_value).padStart(8)}  ${p.weight_pct.toFixed(1).padStart(4)}%\n`;
    }
    text += '```\n';
  }
  if (data.heat) {
    const h = data.heat;
    const icon = h.blocked ? '🔴' : h.heat_pct > 3 ? '🟡' : '🟢';
    text += `${icon} **Heat:** ${h.heat_pct.toFixed(1)}% NAV ($${formatNumber(h.total_risk)} risk)`;
    if (h.blocked) text += ' — **BLOCKED**';
    text += '\n';
  }
  if (data.sector_exposure) {
    const sectors = Object.entries(data.sector_exposure).sort((a, b) => b[1] - a[1]);
    text += '\n**Sectors:** ' + sectors.map(([s, pct]) => `${s} ${pct.toFixed(0)}%`).join(' | ');
  }
  return text;
}

function formatReview(data) {
  if (!data.positions?.length) return 'Aucune position ouverte.';
  let text = '```\n';
  text += 'TICKER  SIGNAL       SCORE   P&L%  ACTION\n';
  text += '─'.repeat(48) + '\n';
  for (const p of data.positions) {
    const sig = (p.signal || '').padEnd(12);
    const score = p.score != null ? p.score.toFixed(1).padStart(5) : '  N/A';
    text += `${p.ticker.padEnd(7)} ${sig} ${score}  ${formatPct(p.pnl_pct).padStart(7)}  ${p.action}\n`;
  }
  text += '```\n';
  const s = data.summary;
  text += `**${s.exit}** EXIT | **${s.near_stop}** near stop | **${s.hold}** hold\n`;
  if (data.heat) text += `Heat: ${data.heat.heat_pct.toFixed(1)}% ${data.heat.blocked ? '🔴 BLOCKED' : ''}`;
  return text;
}

function formatOrders(data) {
  if (!data.orders?.length) return 'Aucun ordre ouvert.';
  let text = '```\n';
  text += 'ID    TICKER  ACT   TYPE  QTY    PRICE     STATUS\n';
  text += '─'.repeat(55) + '\n';
  for (const o of data.orders) {
    text += `${String(o.order_id).padEnd(5)} ${o.ticker.padEnd(7)} ${o.action.padEnd(5)} ${o.order_type.padEnd(4)} ${String(o.quantity).padStart(4)}  $${formatNumber(o.price).padStart(8)}  ${o.status}\n`;
  }
  text += '```';
  return text;
}

function formatPerformance(data) {
  if (!data.total_trades) return 'Aucun trade dans le journal.';
  let text = '```\n';
  text += `Total trades:   ${data.total_trades}\n`;
  text += `Win rate:       ${data.win_rate}% (${data.winners}W / ${data.losers}L)\n`;
  text += `Avg P&L:        $${formatNumber(data.avg_pnl)}\n`;
  text += `Total P&L:      $${formatNumber(data.total_pnl)}\n`;
  text += `Avg R multiple: ${data.avg_r_multiple}R\n`;
  text += '```\n';
  if (data.best_trade) text += `**Best:** ${data.best_trade.ticker} +$${formatNumber(data.best_trade.pnl)}\n`;
  if (data.worst_trade) text += `**Worst:** ${data.worst_trade.ticker} $${formatNumber(data.worst_trade.pnl)}`;
  return text;
}

// ─── Command definitions ────────────────────────────────────
const commands = [
  new SlashCommandBuilder().setName('scan').setDescription('Scan tickers and show BUY signals'),
  new SlashCommandBuilder().setName('analyze').setDescription('Full analysis with trade setup')
    .addStringOption(o => o.setName('ticker').setDescription('Ticker (e.g. AAPL)').setRequired(true))
    .addIntegerOption(o => o.setName('capital').setDescription('Capital for sizing (default: 10000)')),
  new SlashCommandBuilder().setName('market').setDescription('Sector performance + gainers/losers'),
  new SlashCommandBuilder().setName('discover').setDescription('Discover top US equity candidates')
    .addIntegerOption(o => o.setName('top').setDescription('Number of results (default: 10)').setMinValue(5).setMaxValue(25))
    .addStringOption(o => o.setName('sector').setDescription('Filter by sector')
      .addChoices(
        { name: 'Technology', value: 'Technology' },
        { name: 'Healthcare', value: 'Healthcare' },
        { name: 'Financial Services', value: 'Financial Services' },
        { name: 'Energy', value: 'Energy' },
        { name: 'Consumer Defensive', value: 'Consumer Defensive' },
        { name: 'Industrials', value: 'Industrials' },
        { name: 'Basic Materials', value: 'Basic Materials' },
        { name: 'Communication Services', value: 'Communication Services' },
      )),
  new SlashCommandBuilder().setName('check').setDescription('Economic calendar — macro events next 24h'),
  new SlashCommandBuilder().setName('portfolio').setDescription('Portfolio overview: positions, P&L, heat, sectors'),
  new SlashCommandBuilder().setName('review').setDescription('EOD review: flag EXIT signals and near-stop positions'),
  new SlashCommandBuilder().setName('orders').setDescription('Show open orders from IB Gateway'),
  new SlashCommandBuilder().setName('confluence').setDescription('Multi-timeframe check: daily vs weekly alignment')
    .addStringOption(o => o.setName('ticker').setDescription('Ticker (e.g. AAPL)').setRequired(true)),
  new SlashCommandBuilder().setName('performance').setDescription('Trading performance stats from journal'),
  new SlashCommandBuilder().setName('alerts').setDescription('Check for signal changes vs last scan'),
  new SlashCommandBuilder().setName('movers').setDescription('Detect unusual momentum moves on watchlist')
    .addNumberOption(o => o.setName('min_move').setDescription('Min % move to flag (default: 3)'))
    .addStringOption(o => o.setName('period').setDescription('Period (default: 1D)')
      .addChoices(
        { name: '1 Day', value: '1D' },
        { name: '5 Days', value: '5D' },
        { name: '1 Month', value: '1M' },
        { name: '3 Months', value: '3M' },
      )),
];

// ─── Ready ───────────────────────────────────────────────────
client.once('ready', async () => {
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands.map(c => c.toJSON()) });
  console.log(`Jordan v2 connected: ${client.user.tag} — ${commands.length} commands synced`);
  client.user.setActivity('US markets', { type: 3 });
});

// ─── Slash commands ──────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options } = interaction;

  try {
    // ── /scan ──
    if (commandName === 'scan') {
      await interaction.deferReply();
      const data = await callAPI('/api/scan');
      if (data.error) return await interaction.editReply({ embeds: [embed('Erreur', data.message, COLORS.WARNING)] });
      const buys = (data.results || []).filter(r => r.signal === 'BUY' || r.signal === 'STRONG_BUY').length;
      const color = buys > 0 ? COLORS.BUY : COLORS.NEUTRAL;
      await interaction.editReply({ embeds: [embed(`Scan — ${buys} BUY signals`, formatScan(data), color)] });
    }

    // ── /analyze ──
    else if (commandName === 'analyze') {
      await interaction.deferReply();
      const ticker = options.getString('ticker').toUpperCase();
      const capital = options.getInteger('capital') || 10000;
      const data = await callAPI(`/api/analyze?ticker=${ticker}&capital=${capital}`);
      if (data.error) return await interaction.editReply({ embeds: [embed('Erreur', data.message, COLORS.WARNING)] });
      const color = signalColor(data.signal || 'NEUTRAL');
      await interaction.editReply({ embeds: [embed(`${ticker} — ${data.signal} (${data.combined_score?.toFixed(1)})`, formatAnalyze(data), color)] });
    }

    // ── /market ──
    else if (commandName === 'market') {
      await interaction.deferReply();
      const data = await callAPI('/api/market');
      if (data.error) return await interaction.editReply({ embeds: [embed('Erreur', data.message, COLORS.WARNING)] });
      await interaction.editReply({ embeds: [embed('Market Overview', formatMarket(data), COLORS.INFO)] });
    }

    // ── /discover ──
    else if (commandName === 'discover') {
      await interaction.deferReply();
      const top = options.getInteger('top') || 10;
      const sector = options.getString('sector');
      const params = sector ? `top=${top}&sectors=${encodeURIComponent(sector)}&quick=true` : `top=${top}&quick=true`;
      const data = await callAPI(`/api/discover?${params}`);
      if (data.error) return await interaction.editReply({ embeds: [embed('Erreur', data.message, COLORS.WARNING)] });
      let text = `**${data.total_candidates}** candidats analysés\n\n`;
      if (data.results?.length) {
        text += '```\n';
        for (const [i, r] of data.results.entries()) {
          text += `${String(i + 1).padStart(2)}. ${(r.ticker || r.symbol || '').padEnd(7)} score ${(r.discovery_score || r.score || 0).toFixed(1).padStart(5)}  ${(r.sector || '').slice(0, 15)}\n`;
        }
        text += '```';
      }
      await interaction.editReply({ embeds: [embed(`Discovery — Top ${top}`, text, COLORS.BUY)] });
    }

    // ── /check ──
    else if (commandName === 'check') {
      await interaction.deferReply();
      const data = await callAPI('/api/market');
      if (data.error) return await interaction.editReply({ embeds: [embed('Erreur', data.message, COLORS.WARNING)] });
      const events = data.macro_events || [];
      const color = events.length > 0 ? COLORS.WARNING : COLORS.SUCCESS;
      const title = events.length > 0 ? `${events.length} event(s) macro` : 'Pas d\'event macro';
      const text = events.length > 0
        ? events.map(e => `- **${e.event}** (${e.date})`).join('\n')
        : 'Aucun événement macro majeur dans les prochaines 24h.';
      await interaction.editReply({ embeds: [embed(title, text, color)] });
    }

    // ── /portfolio ──
    else if (commandName === 'portfolio') {
      await interaction.deferReply();
      const data = await callAPI('/api/portfolio?no_score=true');
      if (data.error) return await interaction.editReply({ embeds: [embed('Erreur', data.message, COLORS.WARNING)] });
      await interaction.editReply({ embeds: [embed('Portfolio', formatPortfolio(data), COLORS.INFO)] });
    }

    // ── /review ──
    else if (commandName === 'review') {
      await interaction.deferReply();
      const data = await callAPI('/api/review');
      if (data.error) return await interaction.editReply({ embeds: [embed('Erreur', data.message, COLORS.WARNING)] });
      const exits = data.summary?.exit || 0;
      const color = exits > 0 ? COLORS.SELL : COLORS.SUCCESS;
      await interaction.editReply({ embeds: [embed(`Review — ${exits} EXIT`, formatReview(data), color)] });
    }

    // ── /orders ──
    else if (commandName === 'orders') {
      await interaction.deferReply();
      const data = await callAPI('/api/orders');
      if (data.error) return await interaction.editReply({ embeds: [embed('Erreur', data.message, COLORS.WARNING)] });
      await interaction.editReply({ embeds: [embed(`Orders (${data.count})`, formatOrders(data), COLORS.INFO)] });
    }

    // ── /confluence ──
    else if (commandName === 'confluence') {
      await interaction.deferReply();
      const ticker = options.getString('ticker').toUpperCase();
      const data = await callAPI(`/api/confluence?ticker=${ticker}`);
      if (data.error) return await interaction.editReply({ embeds: [embed('Erreur', data.message, COLORS.WARNING)] });
      const color = data.verdict === 'STRONG_CONFLUENCE' ? COLORS.BUY : data.verdict === 'COUNTER_TREND' ? COLORS.SELL : COLORS.NEUTRAL;
      let text = `**Daily:** ${data.daily_signal} (score ${data.daily_score})\n`;
      if (data.weekly_bias) {
        const w = data.weekly_bias;
        text += `**Weekly:** ${w.bias} (RSI ${w.weekly_rsi}, SMA slope ${w.sma20w_slope}%)\n`;
      }
      text += `\n**Verdict:** ${data.verdict}`;
      if (data.warning) text += `\n⚠️ ${data.warning}`;
      await interaction.editReply({ embeds: [embed(`Confluence — ${ticker}`, text, color)] });
    }

    // ── /performance ──
    else if (commandName === 'performance') {
      await interaction.deferReply();
      const data = await callAPI('/api/performance');
      if (data.error) return await interaction.editReply({ embeds: [embed('Erreur', data.message, COLORS.WARNING)] });
      await interaction.editReply({ embeds: [embed('Performance', formatPerformance(data), COLORS.INFO)] });
    }

    // ── /alerts ──
    else if (commandName === 'alerts') {
      await interaction.deferReply();
      const data = await callAPI('/api/alerts/check');
      if (data.error) return await interaction.editReply({ embeds: [embed('Erreur', data.message, COLORS.WARNING)] });
      if (!data.changes?.length) {
        return await interaction.editReply({ embeds: [embed('Alerts', 'Aucun changement de signal.', COLORS.SUCCESS)] });
      }
      let text = '';
      for (const c of data.changes) {
        const icon = c.direction === 'UPGRADE' ? '⬆️' : '⬇️';
        text += `${icon} **${c.ticker}** ${c.old_signal} → **${c.new_signal}** (score ${c.score})\n`;
      }
      const color = data.changes.some(c => c.direction === 'DOWNGRADE') ? COLORS.SELL : COLORS.BUY;
      await interaction.editReply({ embeds: [embed(`${data.count} Signal Change(s)`, text, color)] });
    }

    // ── /movers ──
    else if (commandName === 'movers') {
      await interaction.deferReply();
      const minMove = options.getNumber('min_move') || 3;
      const period = options.getString('period') || '1D';
      const data = await callAPI(`/api/movers?min_move=${minMove}&period=${period}&source=both`);
      if (data.error) return await interaction.editReply({ embeds: [embed('Erreur', data.message, COLORS.WARNING)] });
      if (!data.movers?.length) {
        return await interaction.editReply({ embeds: [embed('Movers', `Aucun move > ${minMove}% (${period}) sur ${data.total_scanned} tickers.`, COLORS.NEUTRAL)] });
      }
      let text = '```\n';
      text += 'TICKER   MOVE     PRICE\n';
      text += '─'.repeat(30) + '\n';
      for (const m of data.movers.slice(0, 20)) {
        const sign = m.change_pct >= 0 ? '+' : '';
        text += `${m.ticker.padEnd(8)} ${(sign + m.change_pct.toFixed(2) + '%').padStart(8)}  $${formatNumber(m.price)}\n`;
      }
      text += '```';
      text += `\n**${data.movers_count}** mover(s) / **${data.total_scanned}** scanned`;
      const hasUp = data.movers.some(m => m.direction === 'UP');
      const hasDown = data.movers.some(m => m.direction === 'DOWN');
      const color = hasUp && !hasDown ? COLORS.BUY : hasDown && !hasUp ? COLORS.SELL : COLORS.NEUTRAL;
      await interaction.editReply({ embeds: [embed(`Movers ${period} (>${minMove}%)`, text, color)] });
    }

  } catch (err) {
    console.error('Command error:', err);
    const reply = { embeds: [embed('Erreur', err.message, COLORS.WARNING)] };
    if (interaction.deferred) await interaction.editReply(reply);
    else await interaction.reply(reply);
  }
});

// ─── Free chat (messages in channel) ─────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== DISCORD_CHANNEL_ID) return;
  if (message.content.startsWith('/')) return;

  console.log(`[${message.author.username}] ${message.content}`);
  await message.channel.sendTyping();

  const data = await callN8n({
    type: 'chat',
    userId: message.author.id,
    username: message.author.username,
    content: message.content,
  });

  if (data.error) {
    await message.reply(data.message);
    return;
  }

  const reply = data.reply || data.analysis || (typeof data === 'string' ? data : JSON.stringify(data));
  const chunks = chunk(reply, 2000);
  for (const c of chunks) {
    if (c && c.trim()) await message.reply(c);
  }
});

// ─── Scheduled tasks ─────────────────────────────────────────

/**
 * Post EOD scan results to the channel every weekday at 22:35 Brussels time.
 * Also post signal alerts every 30 min during market hours (15:30-22:00).
 */
function scheduleEODScan() {
  const SCAN_HOUR = 22, SCAN_MIN = 35;
  const TZ = 'Europe/Brussels';

  setInterval(async () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
    const day = now.getDay(); // 0=Sun, 6=Sat
    const hour = now.getHours();
    const min = now.getMinutes();

    // EOD Scan: Mon-Fri at 22:35
    if (day >= 1 && day <= 5 && hour === SCAN_HOUR && min === SCAN_MIN) {
      console.log('Scheduled EOD scan starting...');
      await postScheduledScan();
    }

    // Signal alerts: Mon-Fri every :00 and :30 during 16:00-21:30
    if (day >= 1 && day <= 5 && hour >= 16 && hour <= 21 && (min === 0 || min === 30)) {
      console.log('Scheduled signal alert check...');
      await postSignalAlerts();
    }
  }, 60_000); // check every minute
}

async function postScheduledScan() {
  const channel = client.channels.cache.get(DISCORD_CHANNEL_ID);
  if (!channel) return;

  try {
    const data = await callAPI('/api/scan');
    if (data.error || !data.results) return;

    const buys = data.results.filter(r => r.signal === 'BUY' || r.signal === 'STRONG_BUY');
    const color = buys.length > 0 ? COLORS.BUY : COLORS.NEUTRAL;

    await channel.send({ embeds: [embed(
      `EOD Scan — ${buys.length} BUY signal(s)`,
      formatScan(data),
      color,
    )] });
    console.log(`EOD scan posted: ${data.results.length} tickers, ${buys.length} BUY`);
  } catch (err) {
    console.error('Scheduled scan failed:', err.message);
  }
}

async function postSignalAlerts() {
  const channel = client.channels.cache.get(DISCORD_CHANNEL_ID);
  if (!channel) return;

  try {
    const data = await callAPI('/api/alerts/check');
    if (data.error || !data.changes?.length) return;

    let text = '';
    for (const c of data.changes) {
      const icon = c.direction === 'UPGRADE' ? '⬆️' : '⬇️';
      text += `${icon} **${c.ticker}** ${c.old_signal} → **${c.new_signal}** (score ${c.score})\n`;
    }
    const color = data.changes.some(c => c.direction === 'DOWNGRADE') ? COLORS.SELL : COLORS.BUY;
    await channel.send({ embeds: [embed(`${data.count} Signal Change(s)`, text, color)] });
    console.log(`Signal alerts posted: ${data.count} changes`);
  } catch (err) {
    console.error('Signal alert check failed:', err.message);
  }
}

// ─── Login ───────────────────────────────────────────────────
client.once('ready', () => {
  scheduleEODScan();
  console.log('Scheduled tasks activated (EOD scan 22:35, alerts every 30min)');
});

client.login(process.env.DISCORD_TOKEN);

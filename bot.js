/**
 * Meme Intelligence Telegram Bot (Node.js)
 *
 * Commands:
 *   /start  - Welcome message
 *   /pepe   - Full PEPE intelligence report
 *   /market - Live market data (DexScreener)
 *   /social - Social buzz (placeholder)
 *   /trust  - Trust analysis (placeholder)
 *   /alert  - Breakout probability
 *   /help   - List commands
 */

const TelegramBot = require("node-telegram-bot-api");
const https = require("https");

const TELEGRAM_BOT_TOKEN = "8761931814:AAGH6N9Kw7F4HoOcL2UAxxRd9LkrqQ_FQyI";

const PEPE_ADDRESS = "0x6982508145454Ce325dDbE47a25d4ec3d2311933";

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// ── DexScreener fetch (no API key needed) ──────────────────────────

function fetchMarketData() {
  return new Promise((resolve, reject) => {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${PEPE_ADDRESS}`;
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            const pairs = json.pairs || [];
            if (!pairs.length) return resolve({ error: "No pairs found" });

            const ethPairs = pairs.filter((p) => p.chainId === "ethereum");
            const sorted = (ethPairs.length ? ethPairs : pairs).sort(
              (a, b) =>
                (parseFloat(b.liquidity?.usd) || 0) -
                (parseFloat(a.liquidity?.usd) || 0)
            );
            const pair = sorted[0];

            const pc = pair.priceChange || {};
            const vol = pair.volume || {};
            const liq = pair.liquidity || {};
            const txns24h = (pair.txns || {}).h24 || {};

            resolve({
              price: parseFloat(pair.priceUsd) || 0,
              priceChange5m: parseFloat(pc.m5) || 0,
              priceChange1h: parseFloat(pc.h1) || 0,
              priceChange6h: parseFloat(pc.h6) || 0,
              priceChange24h: parseFloat(pc.h24) || 0,
              volume24h: parseFloat(vol.h24) || 0,
              liquidity: parseFloat(liq.usd) || 0,
              marketCap: parseFloat(pair.marketCap) || 0,
              fdv: parseFloat(pair.fdv) || 0,
              buys24h: parseInt(txns24h.buys) || 0,
              sells24h: parseInt(txns24h.sells) || 0,
              dex: pair.dexId || "?",
            });
          } catch (e) {
            resolve({ error: "Failed to parse DexScreener response" });
          }
        });
      })
      .on("error", (e) => resolve({ error: e.message }));
  });
}

// ── Placeholder data ───────────────────────────────────────────────

function getPlaceholderSocial() {
  return {
    mentionCount: "--",
    uniqueAuthors: "--",
    sentiment: "--",
    conviction: "--",
    topAccounts: "Waiting for Twitter API credits",
    score: "--",
  };
}

function getPlaceholderTrust() {
  return {
    score: "--",
    riskLevel: "--",
    promoterQuality: "--",
    coordination: "--",
    redFlags: "N/A (needs Twitter data)",
  };
}

// ── Breakout calculation ───────────────────────────────────────────

function calculateBreakout(market) {
  let marketScore = 0;

  if (market.priceChange1h > 0) marketScore += Math.min(market.priceChange1h * 2, 15);
  if (market.priceChange24h > 0) marketScore += Math.min(market.priceChange24h * 0.5, 15);
  if (market.volume24h > 0) marketScore += Math.min(Math.log10(market.volume24h + 1) * 3, 20);
  if (market.liquidity > 10000) marketScore += Math.min(Math.log10(market.liquidity) * 3, 15);

  const total = market.buys24h + market.sells24h;
  if (total > 0 && market.buys24h / total > 0.5) {
    marketScore += (market.buys24h / total - 0.5) * 20;
  }

  marketScore = Math.min(marketScore, 100);

  let status, emoji;
  if (marketScore >= 60 && market.priceChange1h > 5) {
    status = "MARKET CONFIRMING"; emoji = "🟢";
  } else if (marketScore >= 40) {
    status = "ACTIVE"; emoji = "🟡";
  } else if (market.priceChange1h < -5) {
    status = "COOLING"; emoji = "🔴";
  } else {
    status = "STABLE"; emoji = "⚪";
  }

  return {
    marketScore: marketScore.toFixed(1),
    socialScore: "--",
    trustScore: "--",
    memeScore: "--",
    breakoutProbability: `${(marketScore * 0.25).toFixed(1)} (market only)`,
    status,
    emoji,
  };
}

// ── Format helpers ─────────────────────────────────────────────────

function fmtPrice(n) {
  return n < 0.001 ? `$${n.toFixed(10)}` : `$${n.toFixed(6)}`;
}

function fmtUsd(n) {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(n) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function utcNow() {
  return new Date().toISOString().slice(11, 16) + " UTC";
}

// ── Command handlers ───────────────────────────────────────────────

bot.onText(/\/start|\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `🐸 *Meme Intelligence Bot*\n\n` +
      `Tracking PEPE with real-time market data.\n` +
      `Social & trust analysis coming soon (Twitter API).\n\n` +
      `*Commands:*\n` +
      `/pepe - Full intelligence report\n` +
      `/market - Live market data\n` +
      `/social - Social buzz (placeholder)\n` +
      `/trust - Trust analysis (placeholder)\n` +
      `/alert - Breakout probability\n` +
      `/help - This message`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/market/, async (msg) => {
  bot.sendMessage(msg.chat.id, "Fetching live market data...");

  const market = await fetchMarketData();
  if (market.error) {
    return bot.sendMessage(msg.chat.id, `Error: ${market.error}`);
  }

  const total = market.buys24h + market.sells24h;
  const buyPct = total > 0 ? `${((market.buys24h / total) * 100).toFixed(0)}%` : "N/A";

  bot.sendMessage(
    msg.chat.id,
    `📊 *PEPE Market Data*\n\n` +
      `💰 Price: ${fmtPrice(market.price)}\n` +
      `📈 5m: ${fmtPct(market.priceChange5m)}\n` +
      `📈 1h: ${fmtPct(market.priceChange1h)}\n` +
      `📈 6h: ${fmtPct(market.priceChange6h)}\n` +
      `📈 24h: ${fmtPct(market.priceChange24h)}\n\n` +
      `📊 Volume 24h: ${fmtUsd(market.volume24h)}\n` +
      `💧 Liquidity: ${fmtUsd(market.liquidity)}\n` +
      `🏛 Market Cap: ${fmtUsd(market.marketCap)}\n\n` +
      `🟢 Buys 24h: ${market.buys24h.toLocaleString()} (${buyPct})\n` +
      `🔴 Sells 24h: ${market.sells24h.toLocaleString()}\n` +
      `🔄 DEX: ${market.dex}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/social/, (msg) => {
  const s = getPlaceholderSocial();
  bot.sendMessage(
    msg.chat.id,
    `🐦 *PEPE Social Analysis*\n\n` +
      `📢 Mentions (1h): ${s.mentionCount}\n` +
      `👥 Unique Authors: ${s.uniqueAuthors}\n` +
      `😊 Sentiment: ${s.sentiment}\n` +
      `💪 Conviction: ${s.conviction}\n` +
      `🐋 Top Accounts: ${s.topAccounts}\n\n` +
      `*Score: ${s.score}/100*\n\n` +
      `⚠️ _Twitter API credits depleted. Social data will be live once credits reset or plan is upgraded._`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/trust/, (msg) => {
  const t = getPlaceholderTrust();
  bot.sendMessage(
    msg.chat.id,
    `🔍 *PEPE Trust Analysis*\n\n` +
      `🛡 Trust Score: ${t.score}/100\n` +
      `⚠️ Risk Level: ${t.riskLevel}\n` +
      `👤 Promoter Quality: ${t.promoterQuality}\n` +
      `🤝 Coordination Detection: ${t.coordination}\n` +
      `🚩 Red Flags: ${t.redFlags}\n\n` +
      `⚠️ _Trust analysis requires Twitter data to evaluate promoter accounts and detect coordination._`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/alert/, async (msg) => {
  bot.sendMessage(msg.chat.id, "Calculating breakout probability...");

  const market = await fetchMarketData();
  if (market.error) {
    return bot.sendMessage(msg.chat.id, `Error: ${market.error}`);
  }

  const b = calculateBreakout(market);

  bot.sendMessage(
    msg.chat.id,
    `🎯 *PEPE Breakout Alert* ${b.emoji}\n\n` +
      `*Scores:*\n` +
      `├ Meme Relevance: ${b.memeScore}\n` +
      `├ Social Heat: ${b.socialScore}\n` +
      `├ Trust Score: ${b.trustScore}\n` +
      `├ Market Confirmation: ${b.marketScore}/100\n` +
      `└ *Breakout Probability: ${b.breakoutProbability}*\n\n` +
      `*Status:* ${b.status}\n\n` +
      `_Full probability available once Twitter data is connected._`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/pepe/, async (msg) => {
  bot.sendMessage(msg.chat.id, "🐸 Running full PEPE intelligence scan...");

  const market = await fetchMarketData();
  if (market.error) {
    return bot.sendMessage(msg.chat.id, `Error: ${market.error}`);
  }

  const social = getPlaceholderSocial();
  const trust = getPlaceholderTrust();
  const b = calculateBreakout(market);

  const total = market.buys24h + market.sells24h;
  const buyPct = total > 0 ? `${((market.buys24h / total) * 100).toFixed(0)}%` : "N/A";

  bot.sendMessage(
    msg.chat.id,
    `🐸 *PEPE Intelligence Report* ${b.emoji}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `💰 *Market Data (LIVE)*\n` +
      `├ Price: ${fmtPrice(market.price)}\n` +
      `├ 1h: ${fmtPct(market.priceChange1h)} | 24h: ${fmtPct(market.priceChange24h)}\n` +
      `├ Volume 24h: ${fmtUsd(market.volume24h)}\n` +
      `├ Liquidity: ${fmtUsd(market.liquidity)}\n` +
      `├ MCap: ${fmtUsd(market.marketCap)}\n` +
      `└ Buys: ${market.buys24h.toLocaleString()} (${buyPct}) | Sells: ${market.sells24h.toLocaleString()}\n\n` +
      `🐦 *Social Heat (PENDING)*\n` +
      `├ Mentions: ${social.mentionCount}\n` +
      `├ Sentiment: ${social.sentiment}\n` +
      `└ Score: ${social.score}/100\n\n` +
      `🔍 *Trust (PENDING)*\n` +
      `├ Score: ${trust.score}/100\n` +
      `└ Risk: ${trust.riskLevel}\n\n` +
      `🎯 *Breakout Probability*\n` +
      `├ Market Score: ${b.marketScore}/100\n` +
      `├ Combined: ${b.breakoutProbability}\n` +
      `└ Status: ${b.status}\n\n` +
      `🕐 ${utcNow()} | _Social & trust data pending Twitter API_`,
    { parse_mode: "Markdown" }
  );
});

// ── Start ──────────────────────────────────────────────────────────

console.log("🐸 Meme Intelligence Bot is running...");

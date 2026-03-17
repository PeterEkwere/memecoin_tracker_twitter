/**
 * Meme Intelligence Telegram Bot (Node.js)
 *
 * Commands:
 *   /start    - Welcome message
 *   /pepe     - Full PEPE intelligence report
 *   /market   - Live market data (DexScreener)
 *   /scan     - Volume surge + buy pressure momentum scan
 *   /trending - DexScreener boosted/trending tokens
 *   /newpairs - Freshly launched tokens (< 24h, filtered)
 *   /rug      - Quick rug-pull risk check
 *   /social   - Social buzz (placeholder)
 *   /trust    - Trust analysis (placeholder)
 *   /alert    - Breakout probability
 *   /help     - List commands
 */

const TelegramBot = require("node-telegram-bot-api");
const https = require("https");

const TELEGRAM_BOT_TOKEN = "8761931814:AAGH6N9Kw7F4HoOcL2UAxxRd9LkrqQ_FQyI";

const PEPE_ADDRESS = "0x6982508145454Ce325dDbE47a25d4ec3d2311933";

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// ── Generic HTTPS GET helper ───────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      })
      .on("error", () => resolve(null));
  });
}

// ── DexScreener fetch helpers ──────────────────────────────────────

function parsePair(pair) {
  const pc = pair.priceChange || {};
  const vol = pair.volume || {};
  const liq = pair.liquidity || {};
  const txns = pair.txns || {};
  const t5m = txns.m5 || {};
  const t1h = txns.h1 || {};
  const t24h = txns.h24 || {};

  return {
    name: pair.baseToken?.name || "?",
    symbol: pair.baseToken?.symbol || "?",
    address: pair.baseToken?.address || "",
    chain: pair.chainId || "?",
    dex: pair.dexId || "?",
    pairAddress: pair.pairAddress || "",
    price: parseFloat(pair.priceUsd) || 0,
    priceChange5m: parseFloat(pc.m5) || 0,
    priceChange1h: parseFloat(pc.h1) || 0,
    priceChange6h: parseFloat(pc.h6) || 0,
    priceChange24h: parseFloat(pc.h24) || 0,
    volume5m: parseFloat(vol.m5) || 0,
    volume1h: parseFloat(vol.h1) || 0,
    volume6h: parseFloat(vol.h6) || 0,
    volume24h: parseFloat(vol.h24) || 0,
    liquidity: parseFloat(liq.usd) || 0,
    marketCap: parseFloat(pair.marketCap) || 0,
    fdv: parseFloat(pair.fdv) || 0,
    buys5m: parseInt(t5m.buys) || 0,
    sells5m: parseInt(t5m.sells) || 0,
    buys1h: parseInt(t1h.buys) || 0,
    sells1h: parseInt(t1h.sells) || 0,
    buys24h: parseInt(t24h.buys) || 0,
    sells24h: parseInt(t24h.sells) || 0,
    pairCreatedAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : null,
    url: pair.url || "",
    profile: pair.profile || null,
    boosts: pair.boosts?.active || 0,
  };
}

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

async function fetchFullPairData(address) {
  const json = await httpGet(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
  if (!json || !json.pairs || !json.pairs.length) return null;

  // Get top pair by liquidity
  const sorted = json.pairs.sort(
    (a, b) => (parseFloat(b.liquidity?.usd) || 0) - (parseFloat(a.liquidity?.usd) || 0)
  );
  return parsePair(sorted[0]);
}

async function fetchBoostedTokens() {
  const json = await httpGet("https://api.dexscreener.com/token-boosts/latest/v1");
  if (!json || !Array.isArray(json)) return [];
  return json;
}

async function fetchTokenProfiles() {
  const json = await httpGet("https://api.dexscreener.com/token-profiles/latest/v1");
  if (!json || !Array.isArray(json)) return [];
  return json;
}

async function searchToken(query) {
  const json = await httpGet(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`);
  if (!json || !json.pairs || !json.pairs.length) return [];

  // Dedupe by token address, keep highest liquidity
  const seen = {};
  for (const pair of json.pairs) {
    const addr = pair.baseToken?.address;
    if (!addr) continue;
    const liq = parseFloat(pair.liquidity?.usd) || 0;
    if (!seen[addr] || liq > seen[addr].liq) {
      seen[addr] = { pair, liq };
    }
  }
  return Object.values(seen).map((s) => parsePair(s.pair));
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
      `Tracking memecoins with real-time market data.\n\n` +
      `*Market Commands:*\n` +
      `/pepe - Full PEPE intelligence report\n` +
      `/market - Live PEPE market data\n` +
      `/scan - Momentum scan (volume surges + buy pressure)\n` +
      `/alert - Breakout probability\n\n` +
      `*Discovery Commands:*\n` +
      `/trending - Boosted/trending tokens on DexScreener\n` +
      `/newpairs - Freshly launched tokens (<24h)\n` +
      `/rug <token> - Rug-pull risk check (name or address)\n\n` +
      `*Social (coming soon):*\n` +
      `/social - Social buzz (pending Twitter API)\n` +
      `/trust - Trust analysis (pending Twitter API)`,
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

// ── /scan — Momentum scan across all timeframes ───────────────────

bot.onText(/\/scan/, async (msg) => {
  bot.sendMessage(msg.chat.id, "Scanning PEPE momentum...");

  const t = await fetchFullPairData(PEPE_ADDRESS);
  if (!t) return bot.sendMessage(msg.chat.id, "Error fetching data");

  // Volume surge detection
  const avgVolPerHour = t.volume24h / 24;
  const volumeSurge1h = avgVolPerHour > 0 ? (t.volume1h / avgVolPerHour) : 0;
  const volumeSurge5m = avgVolPerHour > 0 ? ((t.volume5m * 12) / avgVolPerHour) : 0;

  let surgeEmoji = "⚪";
  let surgeLabel = "Normal";
  if (volumeSurge5m >= 5) { surgeEmoji = "🔴"; surgeLabel = "EXTREME SURGE"; }
  else if (volumeSurge5m >= 3) { surgeEmoji = "🟠"; surgeLabel = "HIGH SURGE"; }
  else if (volumeSurge5m >= 1.5) { surgeEmoji = "🟡"; surgeLabel = "ELEVATED"; }

  // Buy pressure across timeframes
  const bp5m = (t.buys5m + t.sells5m) > 0 ? (t.buys5m / (t.buys5m + t.sells5m) * 100) : 50;
  const bp1h = (t.buys1h + t.sells1h) > 0 ? (t.buys1h / (t.buys1h + t.sells1h) * 100) : 50;
  const bp24h = (t.buys24h + t.sells24h) > 0 ? (t.buys24h / (t.buys24h + t.sells24h) * 100) : 50;

  const bpEmoji = (bp) => bp >= 60 ? "🟢" : bp >= 50 ? "🟡" : "🔴";

  // Price momentum
  const momEmoji = (pc) => pc > 5 ? "🚀" : pc > 0 ? "📈" : pc > -5 ? "📉" : "💥";

  bot.sendMessage(
    msg.chat.id,
    `⚡ *PEPE Momentum Scan*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `*Price Action:*\n` +
      `├ ${momEmoji(t.priceChange5m)} 5m: ${fmtPct(t.priceChange5m)}\n` +
      `├ ${momEmoji(t.priceChange1h)} 1h: ${fmtPct(t.priceChange1h)}\n` +
      `├ ${momEmoji(t.priceChange6h)} 6h: ${fmtPct(t.priceChange6h)}\n` +
      `└ ${momEmoji(t.priceChange24h)} 24h: ${fmtPct(t.priceChange24h)}\n\n` +
      `*Volume Surge:* ${surgeEmoji} ${surgeLabel}\n` +
      `├ 5m: ${fmtUsd(t.volume5m)} (${volumeSurge5m.toFixed(1)}x avg)\n` +
      `├ 1h: ${fmtUsd(t.volume1h)} (${volumeSurge1h.toFixed(1)}x avg)\n` +
      `└ 24h: ${fmtUsd(t.volume24h)}\n\n` +
      `*Buy Pressure:*\n` +
      `├ ${bpEmoji(bp5m)} 5m: ${bp5m.toFixed(0)}% buys (${t.buys5m}B/${t.sells5m}S)\n` +
      `├ ${bpEmoji(bp1h)} 1h: ${bp1h.toFixed(0)}% buys (${t.buys1h}B/${t.sells1h}S)\n` +
      `└ ${bpEmoji(bp24h)} 24h: ${bp24h.toFixed(0)}% buys (${t.buys24h}B/${t.sells24h}S)\n\n` +
      `💧 Liquidity: ${fmtUsd(t.liquidity)}\n` +
      `🕐 ${utcNow()}`,
    { parse_mode: "Markdown" }
  );
});

// ── /trending — Boosted tokens on DexScreener ─────────────────────

bot.onText(/\/trending/, async (msg) => {
  bot.sendMessage(msg.chat.id, "Fetching trending tokens...");

  const boosted = await fetchBoostedTokens();
  if (!boosted.length) {
    return bot.sendMessage(msg.chat.id, "No trending tokens found right now.");
  }

  // Dedupe by token address, count boosts
  const seen = {};
  for (const item of boosted) {
    const key = `${item.chainId}:${item.tokenAddress}`;
    if (!seen[key]) {
      seen[key] = {
        chain: item.chainId || "?",
        address: item.tokenAddress || "",
        description: item.description || "",
        totalBoosts: item.amount || 1,
        url: item.url || "",
      };
    } else {
      seen[key].totalBoosts += item.amount || 1;
    }
  }

  // Sort by boost count, take top 10
  const sorted = Object.values(seen)
    .sort((a, b) => b.totalBoosts - a.totalBoosts)
    .slice(0, 10);

  // Fetch price data for top 5
  let msg_text = `🔥 *Trending / Boosted Tokens*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (let i = 0; i < Math.min(sorted.length, 8); i++) {
    const item = sorted[i];
    const token = await fetchFullPairData(item.address);

    if (token) {
      const pc1h = fmtPct(token.priceChange1h);
      const pc24h = fmtPct(token.priceChange24h);
      msg_text +=
        `*${i + 1}. ${token.symbol}* (${token.chain})\n` +
        `├ Price: ${fmtPrice(token.price)} | 1h: ${pc1h} | 24h: ${pc24h}\n` +
        `├ Vol 24h: ${fmtUsd(token.volume24h)} | Liq: ${fmtUsd(token.liquidity)}\n` +
        `└ Boosts: ${item.totalBoosts}\n\n`;
    } else {
      msg_text +=
        `*${i + 1}.* ${item.chain} | ${item.address.slice(0, 10)}...\n` +
        `└ Boosts: ${item.totalBoosts} (no pair data)\n\n`;
    }
  }

  msg_text += `🕐 ${utcNow()}`;
  bot.sendMessage(msg.chat.id, msg_text, { parse_mode: "Markdown" });
});

// ── /newpairs — Freshly launched tokens ───────────────────────────

bot.onText(/\/newpairs/, async (msg) => {
  bot.sendMessage(msg.chat.id, "Scanning for new pairs (<24h old)...");

  const profiles = await fetchTokenProfiles();
  if (!profiles.length) {
    return bot.sendMessage(msg.chat.id, "Could not fetch new token data.");
  }

  // Get token data for recent profiles
  const now = Date.now();
  const results = [];

  for (let i = 0; i < Math.min(profiles.length, 20); i++) {
    const p = profiles[i];
    if (!p.tokenAddress) continue;

    const token = await fetchFullPairData(p.tokenAddress);
    if (!token || !token.pairCreatedAt) continue;

    const ageMs = now - token.pairCreatedAt.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    // Only tokens < 24h old with at least $1K liquidity
    if (ageHours <= 24 && token.liquidity >= 1000) {
      results.push({ ...token, ageHours });
    }

    if (results.length >= 8) break;
  }

  if (!results.length) {
    return bot.sendMessage(msg.chat.id, "No new pairs found with >$1K liquidity in the last 24h.");
  }

  // Sort by liquidity desc
  results.sort((a, b) => b.liquidity - a.liquidity);

  let msg_text = `🆕 *New Pairs (< 24h old)*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (let i = 0; i < results.length; i++) {
    const t = results[i];
    const ageLabel = t.ageHours < 1
      ? `${Math.round(t.ageHours * 60)}m ago`
      : `${t.ageHours.toFixed(1)}h ago`;

    const total5m = t.buys5m + t.sells5m;
    const bp5m = total5m > 0 ? (t.buys5m / total5m * 100).toFixed(0) : "50";

    msg_text +=
      `*${i + 1}. ${t.symbol}* (${t.chain})\n` +
      `├ 🕐 Launched: ${ageLabel}\n` +
      `├ 💰 Price: ${fmtPrice(t.price)} | 5m: ${fmtPct(t.priceChange5m)}\n` +
      `├ 💧 Liq: ${fmtUsd(t.liquidity)} | Vol: ${fmtUsd(t.volume24h)}\n` +
      `├ 📊 Buy pressure 5m: ${bp5m}%\n` +
      `└ 🔗 ${t.chain}:${t.address.slice(0, 10)}...\n\n`;
  }

  msg_text += `⚠️ _New tokens are extremely high risk. DYOR._\n🕐 ${utcNow()}`;
  bot.sendMessage(msg.chat.id, msg_text, { parse_mode: "Markdown" });
});

// ── /rug — Quick rug-pull risk check ──────────────────────────────

bot.onText(/\/rug(?:\s+(.+))?/, async (msg, match) => {
  const query = (match && match[1]) ? match[1].trim() : "";

  if (!query) {
    return bot.sendMessage(
      msg.chat.id,
      "Usage: `/rug <token name or address>`\nExample: `/rug PEPE` or `/rug 0x6982...`",
      { parse_mode: "Markdown" }
    );
  }

  bot.sendMessage(msg.chat.id, `Checking rug risk for: ${query}...`);

  let token;

  // If it looks like an address, fetch directly
  if (query.startsWith("0x") || query.length > 30) {
    token = await fetchFullPairData(query);
  } else {
    // Search by name/symbol
    const results = await searchToken(query);
    if (results.length > 0) {
      // Pick highest liquidity match
      results.sort((a, b) => b.liquidity - a.liquidity);
      token = results[0];
    }
  }

  if (!token) {
    return bot.sendMessage(msg.chat.id, `Could not find token: ${query}`);
  }

  // Risk analysis
  const risks = [];
  const warnings = [];
  let riskScore = 0;

  // Liquidity check
  if (token.liquidity < 1000) {
    risks.push("🚨 Extremely low liquidity (<$1K) — likely untradeble");
    riskScore += 35;
  } else if (token.liquidity < 5000) {
    risks.push("🚨 Very low liquidity (<$5K)");
    riskScore += 25;
  } else if (token.liquidity < 10000) {
    warnings.push("⚠️ Low liquidity (<$10K)");
    riskScore += 15;
  } else if (token.liquidity < 50000) {
    warnings.push("⚠️ Moderate liquidity (<$50K)");
    riskScore += 5;
  }

  // Pair age check
  if (token.pairCreatedAt) {
    const ageHours = (Date.now() - token.pairCreatedAt.getTime()) / (1000 * 60 * 60);
    if (ageHours < 1) {
      risks.push("🚨 Token less than 1 hour old");
      riskScore += 25;
    } else if (ageHours < 6) {
      risks.push("🚨 Token less than 6 hours old");
      riskScore += 20;
    } else if (ageHours < 24) {
      warnings.push("⚠️ Token less than 24 hours old");
      riskScore += 10;
    } else if (ageHours < 72) {
      warnings.push("⚠️ Token less than 3 days old");
      riskScore += 5;
    }
  } else {
    warnings.push("⚠️ Unknown pair creation date");
    riskScore += 10;
  }

  // Volume vs liquidity ratio (high vol + low liq = manipulation risk)
  if (token.liquidity > 0 && token.volume24h > token.liquidity * 10) {
    warnings.push("⚠️ Volume/liquidity ratio very high (possible wash trading)");
    riskScore += 15;
  }

  // Sell pressure check
  const total24h = token.buys24h + token.sells24h;
  const sellPct = total24h > 0 ? (token.sells24h / total24h * 100) : 50;
  if (sellPct > 65) {
    risks.push(`🚨 Heavy sell pressure: ${sellPct.toFixed(0)}% sells in 24h`);
    riskScore += 15;
  } else if (sellPct > 55) {
    warnings.push(`⚠️ Sell-side dominant: ${sellPct.toFixed(0)}% sells in 24h`);
    riskScore += 5;
  }

  // Price dump check
  if (token.priceChange24h < -50) {
    risks.push(`🚨 Price crashed ${fmtPct(token.priceChange24h)} in 24h`);
    riskScore += 20;
  } else if (token.priceChange24h < -30) {
    warnings.push(`⚠️ Major price drop ${fmtPct(token.priceChange24h)} in 24h`);
    riskScore += 10;
  }

  // Market cap vs liquidity (low liq relative to mcap = easy to rug)
  if (token.marketCap > 0 && token.liquidity > 0) {
    const ratio = token.liquidity / token.marketCap;
    if (ratio < 0.02) {
      risks.push("🚨 Liquidity is <2% of market cap — very easy to rug");
      riskScore += 20;
    } else if (ratio < 0.05) {
      warnings.push("⚠️ Liquidity is <5% of market cap");
      riskScore += 10;
    }
  }

  riskScore = Math.min(riskScore, 100);

  let riskLevel, riskEmoji;
  if (riskScore >= 60) { riskLevel = "EXTREME"; riskEmoji = "🔴"; }
  else if (riskScore >= 40) { riskLevel = "HIGH"; riskEmoji = "🟠"; }
  else if (riskScore >= 20) { riskLevel = "MODERATE"; riskEmoji = "🟡"; }
  else { riskLevel = "LOW"; riskEmoji = "🟢"; }

  // Pair age label
  let ageLabel = "Unknown";
  if (token.pairCreatedAt) {
    const ageH = (Date.now() - token.pairCreatedAt.getTime()) / (1000 * 60 * 60);
    if (ageH < 1) ageLabel = `${Math.round(ageH * 60)} minutes`;
    else if (ageH < 24) ageLabel = `${ageH.toFixed(1)} hours`;
    else ageLabel = `${(ageH / 24).toFixed(1)} days`;
  }

  let msg_text =
    `🔍 *Rug Check: ${token.symbol}* ${riskEmoji}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `*Risk Score: ${riskScore}/100 — ${riskLevel}*\n\n` +
    `*Token Info:*\n` +
    `├ Name: ${token.name}\n` +
    `├ Chain: ${token.chain}\n` +
    `├ DEX: ${token.dex}\n` +
    `├ Age: ${ageLabel}\n` +
    `├ Price: ${fmtPrice(token.price)}\n` +
    `├ Liq: ${fmtUsd(token.liquidity)}\n` +
    `├ MCap: ${fmtUsd(token.marketCap)}\n` +
    `├ Vol 24h: ${fmtUsd(token.volume24h)}\n` +
    `└ 24h: ${fmtPct(token.priceChange24h)}\n`;

  if (risks.length) {
    msg_text += `\n*Red Flags:*\n`;
    for (const r of risks) msg_text += `${r}\n`;
  }

  if (warnings.length) {
    msg_text += `\n*Warnings:*\n`;
    for (const w of warnings) msg_text += `${w}\n`;
  }

  if (!risks.length && !warnings.length) {
    msg_text += `\n✅ No major red flags detected\n`;
  }

  msg_text += `\n⚠️ _This is automated analysis only. Always DYOR._\n🕐 ${utcNow()}`;
  bot.sendMessage(msg.chat.id, msg_text, { parse_mode: "Markdown" });
});

// ── Start ──────────────────────────────────────────────────────────

console.log("🐸 Meme Intelligence Bot is running...");

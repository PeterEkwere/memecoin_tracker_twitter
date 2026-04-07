/**
 * Meme Intelligence Telegram Bot (Node.js)
 *
 * Commands:
 *   /start         - Welcome message
 *   /market <token> - Live market data
 *   /scan <token>   - Volume surge + buy pressure momentum scan
 *   /alert <token>  - Breakout probability
 *   /rug <token>    - Quick rug-pull risk check
 *   /trending       - DexScreener boosted/trending tokens
 *   /newpairs       - Freshly launched tokens (< 24h)
 *   /social         - Social buzz (placeholder)
 *   /trust          - Trust analysis (placeholder)
 *   /help           - List commands
 */

const TelegramBot = require("node-telegram-bot-api");
const https = require("https");

const TELEGRAM_BOT_TOKEN = "8761931814:AAGH6N9Kw7F4HoOcL2UAxxRd9LkrqQ_FQyI";

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

/**
 * Resolve a user query (token name, symbol, or address) into full pair data.
 * Returns the highest-liquidity pair found, or null.
 */
async function resolveToken(query) {
  if (!query) return null;

  // If it looks like a contract address, fetch directly
  if (query.startsWith("0x") || query.length > 30) {
    return await fetchFullPairData(query);
  }

  // Otherwise search by name/symbol
  const results = await searchToken(query);
  if (!results.length) return null;

  // Return highest liquidity match
  results.sort((a, b) => b.liquidity - a.liquidity);
  return results[0];
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

// ── Helius RPC (Solana) ────────────────────────────────────────────

const HELIUS_API_KEY = "9e4131db-46f0-44b0-9823-34a95674fb59";

/**
 * Fetch top 20 largest token holders via Helius RPC (getTokenLargestAccounts).
 */
function fetchHeliusTopHolders(mintAddress) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenLargestAccounts",
      params: [mintAddress],
    });
    const opts = {
      hostname: "mainnet.helius-rpc.com",
      path: `/?api-key=${HELIUS_API_KEY}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(postData) },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.write(postData);
    req.end();
  });
}

/**
 * Fetch total supply for a Solana token via Helius RPC (getTokenSupply).
 */
function fetchHeliusTokenSupply(mintAddress) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenSupply",
      params: [mintAddress],
    });
    const opts = {
      hostname: "mainnet.helius-rpc.com",
      path: `/?api-key=${HELIUS_API_KEY}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(postData) },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.write(postData);
    req.end();
  });
}

// ── Moralis API helpers ────────────────────────────────────────────

const MORALIS_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IjAxODZjZGZhLTgwMzYtNGQ1OS1iMDBjLTY3MDc4N2RlNzMwYyIsIm9yZ0lkIjoiNTA1ODI0IiwidXNlcklkIjoiNTIwNDYyIiwidHlwZUlkIjoiMDQzNGJlOGItYjdkOC00OTBhLWJhYmMtNzliNzZmNjczNTZhIiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NzM3NjQ4MzAsImV4cCI6NDkyOTUyNDgzMH0.k1DDMBzzEexgFVKKQo52q-H4Kz-L0Fnu9Byam2uY8mk";

function moralisGet(path) {
  return new Promise((resolve) => {
    const opts = {
      hostname: "deep-index.moralis.io",
      path,
      headers: { "X-API-Key": MORALIS_API_KEY, Accept: "application/json" },
    };
    https
      .get(opts, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      })
      .on("error", () => resolve(null));
  });
}

/**
 * Get all pairs for a token from Moralis, then fetch snipers for each pair.
 * Returns { pairAddress, pairLabel, exchange, snipers[], blockTimestamp }
 */
async function fetchSnipers(tokenAddress, chain) {
  // Map DexScreener chain IDs to Moralis chain params
  const chainMap = {
    ethereum: "eth", eth: "eth",
    bsc: "bsc", arbitrum: "arbitrum",
    polygon: "polygon", base: "base",
    optimism: "optimism", avalanche: "avalanche",
  };
  const moralisChain = chainMap[chain] || "eth";

  // Step 1: Get pairs from Moralis
  const pairsData = await moralisGet(
    `/api/v2.2/erc20/${tokenAddress}/pairs?chain=${moralisChain}`
  );

  const pairs = pairsData?.pairs || [];
  if (!pairs.length) return { error: "No pairs found on Moralis" };

  // Step 2: Try snipers on each pair (start with V2, then V3)
  // Prefer standard 42-char addresses (V2/V3), skip V4 hashes
  const sortedPairs = pairs.sort((a, b) => {
    const aStd = a.pair_address?.length === 42 ? 1 : 0;
    const bStd = b.pair_address?.length === 42 ? 1 : 0;
    return bStd - aStd;
  });

  for (const pair of sortedPairs.slice(0, 5)) {
    const snipersData = await moralisGet(
      `/api/v2.2/pairs/${pair.pair_address}/snipers?chain=${moralisChain}`
    );

    if (snipersData && snipersData.result && snipersData.result.length > 0) {
      return {
        pairAddress: pair.pair_address,
        pairLabel: pair.pair_label || "?",
        exchange: pair.exchange_name || "?",
        blockNumber: snipersData.blockNumber,
        blockTimestamp: snipersData.blockTimestamp,
        snipers: snipersData.result,
      };
    }
  }

  // No snipers found on any pair
  return {
    pairAddress: sortedPairs[0]?.pair_address || "",
    pairLabel: sortedPairs[0]?.pair_label || "?",
    exchange: sortedPairs[0]?.exchange_name || "?",
    blockNumber: 0,
    blockTimestamp: "",
    snipers: [],
  };
}

/**
 * Fetch top holders for a token via Moralis (EVM).
 * Returns { totalSupply, holders[], error? }
 */
async function fetchHolders(tokenAddress, chain) {
  const chainMap = {
    ethereum: "eth", eth: "eth",
    bsc: "bsc", arbitrum: "arbitrum",
    polygon: "polygon", base: "base",
    optimism: "optimism", avalanche: "avalanche",
  };
  const moralisChain = chainMap[chain] || "eth";

  const data = await moralisGet(
    `/api/v2.2/erc20/${tokenAddress}/owners?chain=${moralisChain}&limit=50&order=DESC`
  );

  if (!data || data.message) {
    return { error: data?.message || "Failed to fetch holders" };
  }

  return {
    totalSupply: data.totalSupply || "0",
    holders: data.result || [],
  };
}

/**
 * Fetch holder stats for a Solana token via Moralis Solana Gateway.
 * Returns aggregate data: totalHolders, distribution tiers, supply concentration, acquisition methods.
 */
function fetchSolanaHolders(tokenAddress) {
  return new Promise((resolve) => {
    const opts = {
      hostname: "solana-gateway.moralis.io",
      path: `/token/mainnet/holders/${tokenAddress}`,
      headers: { "X-API-Key": MORALIS_API_KEY, Accept: "application/json" },
    };
    https
      .get(opts, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      })
      .on("error", () => resolve(null));
  });
}

// ── Breakout calculation ───────────────────────────────────────────

function calculateBreakout(t) {
  let marketScore = 0;

  if (t.priceChange1h > 0) marketScore += Math.min(t.priceChange1h * 2, 15);
  if (t.priceChange24h > 0) marketScore += Math.min(t.priceChange24h * 0.5, 15);
  if (t.volume24h > 0) marketScore += Math.min(Math.log10(t.volume24h + 1) * 3, 20);
  if (t.liquidity > 10000) marketScore += Math.min(Math.log10(t.liquidity) * 3, 15);

  const total = t.buys24h + t.sells24h;
  if (total > 0 && t.buys24h / total > 0.5) {
    marketScore += (t.buys24h / total - 0.5) * 20;
  }

  marketScore = Math.min(marketScore, 100);

  let status, emoji;
  if (marketScore >= 60 && t.priceChange1h > 5) {
    status = "MARKET CONFIRMING"; emoji = "🟢";
  } else if (marketScore >= 40) {
    status = "ACTIVE"; emoji = "🟡";
  } else if (t.priceChange1h < -5) {
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

bot.onText(/\/start(@\w+)?(\s|$)/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `🐸 *Meme Intelligence Bot*\n\n` +
      `Real-time token intelligence powered by DexScreener.\n` +
      `Use /help for the full command list.`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/help(@\w+)?(\s|$)/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `💼 *WALLET & TRADING*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `/wallet — Show your Solana address + SOL/USDC balance\n` +
      `/balance — List all SPL tokens you hold with $ values\n` +
      `/positions — Holdings with PnL vs entry price\n` +
      `/quote <mint> <sol> — Dry-run a buy, no execution\n` +
      `/buy <mint> <sol> — Buy token with SOL via Jupiter\n` +
      `/sell <mint> <pct> — Sell N% of a token back to SOL\n` +
      `/slippage <bps> — Set slippage (default 500 = 5%)\n` +
      `/export — DM your private key (danger)\n\n` +
      `🚀 *PUMP.FUN BONDING*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `/bonding — Top tokens >80% bonded\n` +
      `/bonding <pct> — Custom threshold (e.g. /bonding 50)\n` +
      `/bonding_watch — Alert when any token crosses 80%\n` +
      `/bonding_stop — Stop watch alerts\n\n` +
      `🐸 *Meme Intelligence Bot — Commands*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +

      `📊 */market <token>*\n` +
      `_Get live market data for any token._\n` +
      `Shows price, price changes (5m/1h/6h/24h), volume, liquidity, market cap, and buy/sell counts.\n` +
      `Use this to get a quick snapshot of where a token stands right now.\n` +
      `Example: /market PEPE\n` +
      `Example: /market 0x6982508145454Ce325dDbE47a25d4ec3d2311933\n\n` +

      `⚡ */scan <token>*\n` +
      `_Momentum scanner — detect volume surges and buy pressure shifts._\n` +
      `Compares current 5m volume against the 24h average to detect unusual spikes. Shows buy vs sell pressure across 5m, 1h, and 24h timeframes.\n` +
      `Use this to spot tokens that are heating up RIGHT NOW before the price moves.\n` +
      `Example: /scan BONK\n\n` +

      `🎯 */alert <token>*\n` +
      `_Calculate breakout probability score._\n` +
      `Scores a token from 0-100 based on price momentum, volume strength, liquidity depth, and buy pressure. Tells you if the market is CONFIRMING, ACTIVE, STABLE, or COOLING.\n` +
      `Use this to decide if a token has real momentum or is fading.\n` +
      `Example: /alert WIF\n\n` +

      `🔍 */rug <token>*\n` +
      `_Quick rug-pull risk assessment._\n` +
      `Checks liquidity depth, token age, sell pressure, price dumps, volume/liquidity ratio, and market cap/liquidity ratio. Scores risk from 0-100 (LOW to EXTREME).\n` +
      `Use this before aping into any new token.\n` +
      `Example: /rug DOGE\n\n` +

      `🔥 */trending*\n` +
      `_See what tokens are being promoted on DexScreener._\n` +
      `Shows the top boosted tokens with their price, volume, and liquidity. Projects spend money to boost their tokens here — useful to see what's getting marketing push.\n\n` +

      `🆕 */newpairs*\n` +
      `_Discover freshly launched tokens (<24h old)._\n` +
      `Filters for new pairs with at least $1K liquidity. Shows launch time, price, volume, and buy pressure. Extremely high risk — for discovery only.\n\n` +

      `🔫 */sniper <token>*\n` +
      `_Detect sniper bots that bought in the first blocks after launch._\n` +
      `Shows how many wallets sniped, whether they bought in the same block as liquidity (most suspicious), their profit/loss, and if they still hold or dumped.\n` +
      `Use this to check if a token had insider buying at launch.\n` +
      `Example: /sniper NUR\n` +
      `Note: EVM chains only (ETH, BSC, Base, etc.)\n\n` +

      `👥 */holders <token>*\n` +
      `_Full holder distribution analysis._\n` +
      `Shows top 10 holders with labels (exchanges, contracts, burn addresses), concentration risk (top 5/10/20), whale vs retail breakdown, and exchange presence.\n` +
      `Use this to check if a token is well-distributed or if a few wallets control everything.\n` +
      `Example: /holders PEPE or /holders WIF\n` +
      `Supports EVM (ETH, BSC, Base, etc.) & Solana\n\n` +

      `🐦 */social* — _Coming soon (needs Twitter API)_\n` +
      `🔍 */trust* — _Coming soon (needs Twitter API)_\n\n` +

      `*How to pass a token:*\n` +
      `• By name: /market PEPE\n` +
      `• By symbol: /scan BONK\n` +
      `• By contract address: /rug 0x6982...\n` +
      `The bot searches DexScreener and picks the highest-liquidity match.`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/market(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
  const query = (match && match[1]) ? match[1].trim() : "";
  if (!query) {
    return bot.sendMessage(msg.chat.id, "Usage: `/market <token>`\nExample: `/market PEPE`", { parse_mode: "Markdown" });
  }

  bot.sendMessage(msg.chat.id, `Fetching market data for: ${query}...`);

  const t = await resolveToken(query);
  if (!t) return bot.sendMessage(msg.chat.id, `Could not find token: ${query}`);

  const total = t.buys24h + t.sells24h;
  const buyPct = total > 0 ? `${((t.buys24h / total) * 100).toFixed(0)}%` : "N/A";

  bot.sendMessage(
    msg.chat.id,
    `📊 *${t.symbol} Market Data* (${t.chain})\n\n` +
      `💰 Price: ${fmtPrice(t.price)}\n` +
      `📈 5m: ${fmtPct(t.priceChange5m)}\n` +
      `📈 1h: ${fmtPct(t.priceChange1h)}\n` +
      `📈 6h: ${fmtPct(t.priceChange6h)}\n` +
      `📈 24h: ${fmtPct(t.priceChange24h)}\n\n` +
      `📊 Volume 24h: ${fmtUsd(t.volume24h)}\n` +
      `💧 Liquidity: ${fmtUsd(t.liquidity)}\n` +
      `🏛 Market Cap: ${fmtUsd(t.marketCap)}\n\n` +
      `🟢 Buys 24h: ${t.buys24h.toLocaleString()} (${buyPct})\n` +
      `🔴 Sells 24h: ${t.sells24h.toLocaleString()}\n` +
      `🔄 DEX: ${t.dex}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/social(?:@\w+)?(\s|$)/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `🐦 *Social Analysis*\n\n` +
      `⚠️ _Twitter API credits depleted. Social data will be live once credits reset or plan is upgraded._`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/trust(?:@\w+)?(\s|$)/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `🔍 *Trust Analysis*\n\n` +
      `⚠️ _Trust analysis requires Twitter data to evaluate promoter accounts and detect coordination._`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/alert(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
  const query = (match && match[1]) ? match[1].trim() : "";
  if (!query) {
    return bot.sendMessage(msg.chat.id, "Usage: `/alert <token>`\nExample: `/alert PEPE`", { parse_mode: "Markdown" });
  }

  bot.sendMessage(msg.chat.id, `Calculating breakout probability for: ${query}...`);

  const t = await resolveToken(query);
  if (!t) return bot.sendMessage(msg.chat.id, `Could not find token: ${query}`);

  const b = calculateBreakout(t);

  bot.sendMessage(
    msg.chat.id,
    `🎯 *${t.symbol} Breakout Alert* ${b.emoji}\n\n` +
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

// ── /scan — Momentum scan across all timeframes ───────────────────

bot.onText(/\/scan(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
  const query = (match && match[1]) ? match[1].trim() : "";
  if (!query) {
    return bot.sendMessage(msg.chat.id, "Usage: `/scan <token>`\nExample: `/scan PEPE`", { parse_mode: "Markdown" });
  }

  bot.sendMessage(msg.chat.id, `Scanning momentum for: ${query}...`);

  const t = await resolveToken(query);
  if (!t) return bot.sendMessage(msg.chat.id, `Could not find token: ${query}`);

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
    `⚡ *${t.symbol} Momentum Scan*\n` +
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

bot.onText(/\/trending(?:@\w+)?(\s|$)/, async (msg) => {
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

bot.onText(/\/newpairs(?:@\w+)?(\s|$)/, async (msg) => {
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

bot.onText(/\/rug(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
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

// ── /sniper — Sniper bot detection via Moralis ────────────────────

bot.onText(/\/sniper(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
  const query = (match && match[1]) ? match[1].trim() : "";
  if (!query) {
    return bot.sendMessage(
      msg.chat.id,
      "Usage: `/sniper <token name or address>`\n" +
        "Example: `/sniper 0xf4BC00...` or `/sniper NUR`\n\n" +
        "_Detects wallets that bought in the first blocks after liquidity was added. " +
        "Shows profit/loss, holding status, and entry timing._",
      { parse_mode: "Markdown" }
    );
  }

  bot.sendMessage(msg.chat.id, `🔫 Scanning for snipers on: ${query}...`);

  // Resolve token via DexScreener first to get address + chain
  const token = await resolveToken(query);
  if (!token) {
    return bot.sendMessage(msg.chat.id, `Could not find token: ${query}`);
  }

  // Only EVM chains supported by Moralis snipers API
  const evmChains = ["ethereum", "bsc", "arbitrum", "polygon", "base", "optimism", "avalanche"];
  if (!evmChains.includes(token.chain)) {
    return bot.sendMessage(
      msg.chat.id,
      `Sniper detection currently supports EVM chains only.\n${token.symbol} is on ${token.chain}.`
    );
  }

  const data = await fetchSnipers(token.address, token.chain);

  if (data.error) {
    return bot.sendMessage(msg.chat.id, `Error: ${data.error}`);
  }

  if (!data.snipers.length) {
    return bot.sendMessage(
      msg.chat.id,
      `🔫 *Sniper Check: ${token.symbol}*\n\n` +
        `Pair: ${data.pairLabel} (${data.exchange})\n\n` +
        `✅ No snipers detected on this pair.\n` +
        `_This could mean the token is older (data not available) or no wallets bought in the first blocks._`,
      { parse_mode: "Markdown" }
    );
  }

  // Analyze snipers
  const snipers = data.snipers;
  const totalSnipers = snipers.length;

  // Categorize
  const stillHolding = snipers.filter((s) => s.currentBalance > 0);
  const soldAll = snipers.filter((s) => s.currentBalance === 0);
  const profitable = snipers.filter((s) => s.realizedProfitUsd > 0);
  const totalSnipedUsd = snipers.reduce((sum, s) => sum + (s.totalSnipedUsd || 0), 0);
  const totalSoldUsd = snipers.reduce((sum, s) => sum + (s.totalSoldUsd || 0), 0);
  const totalRealizedProfit = snipers.reduce((sum, s) => sum + (s.realizedProfitUsd || 0), 0);
  const totalUnrealizedProfit = snipers.reduce((sum, s) => sum + (s.unrealizedProfitUsd || 0), 0);

  // Block 0 snipers (same block as liquidity = most suspicious)
  const block0 = snipers.filter((s) =>
    s.snipedTransactions?.some((tx) => tx.blocksAfterCreation === 0)
  );
  const block1 = snipers.filter((s) =>
    s.snipedTransactions?.some((tx) => tx.blocksAfterCreation === 1)
  );

  // Format creation info
  let creationInfo = "";
  if (data.blockTimestamp) {
    const created = new Date(data.blockTimestamp);
    const ageH = (Date.now() - created.getTime()) / (1000 * 60 * 60);
    const ageLabel =
      ageH < 1 ? `${Math.round(ageH * 60)}m ago` :
      ageH < 24 ? `${ageH.toFixed(1)}h ago` :
      `${(ageH / 24).toFixed(1)}d ago`;
    creationInfo = `Pair created: ${created.toISOString().slice(0, 16)} UTC (${ageLabel})`;
  }

  // Build message
  let text =
    `🔫 *Sniper Analysis: ${token.symbol}*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `*Pair:* ${data.pairLabel} (${data.exchange})\n` +
    (creationInfo ? `*${creationInfo}*\n` : "") +
    `\n` +
    `*Overview:*\n` +
    `├ Total snipers: ${totalSnipers}\n` +
    `├ Same-block (block 0): ${block0.length} 🚨\n` +
    `├ Block 1: ${block1.length}\n` +
    `├ Still holding: ${stillHolding.length}\n` +
    `├ Sold everything: ${soldAll.length}\n` +
    `└ Profitable: ${profitable.length}/${totalSnipers}\n\n` +
    `*Money Flow:*\n` +
    `├ Total sniped: ${fmtUsd(totalSnipedUsd)}\n` +
    `├ Total sold: ${fmtUsd(totalSoldUsd)}\n` +
    `├ Realized P/L: ${totalRealizedProfit >= 0 ? "+" : ""}${fmtUsd(totalRealizedProfit)}\n` +
    `└ Unrealized P/L: ${totalUnrealizedProfit >= 0 ? "+" : ""}${fmtUsd(totalUnrealizedProfit)}\n`;

  // Top snipers detail (top 5 by sniped amount)
  const topSnipers = [...snipers]
    .sort((a, b) => (b.totalSnipedUsd || 0) - (a.totalSnipedUsd || 0))
    .slice(0, 5);

  text += `\n*Top Snipers:*\n`;

  for (let i = 0; i < topSnipers.length; i++) {
    const s = topSnipers[i];
    const addr = s.walletAddress;
    const shortAddr = `${addr.slice(0, 6)}...${addr.slice(-4)}`;

    // Earliest entry
    const earliestBlock = s.snipedTransactions?.length
      ? Math.min(...s.snipedTransactions.map((tx) => tx.blocksAfterCreation))
      : "?";

    const holdingStatus = s.currentBalance > 0
      ? `holding ${fmtUsd(s.currentBalanceUsdValue || 0)}`
      : "SOLD ALL";

    const pnl = s.realizedProfitUsd !== 0
      ? `P/L: ${s.realizedProfitUsd >= 0 ? "+" : ""}${fmtUsd(s.realizedProfitUsd)} (${s.realizedProfitPercentage >= 0 ? "+" : ""}${(s.realizedProfitPercentage || 0).toFixed(0)}%)`
      : s.unrealizedProfitUsd !== 0
        ? `Unrealized: ${s.unrealizedProfitUsd >= 0 ? "+" : ""}${fmtUsd(s.unrealizedProfitUsd)}`
        : "No P/L yet";

    const blockEmoji = earliestBlock === 0 ? "🚨" : earliestBlock <= 2 ? "⚠️" : "📍";

    text +=
      `\n${blockEmoji} *${i + 1}. ${shortAddr}*\n` +
      `├ Entry: block +${earliestBlock} | Sniped: ${fmtUsd(s.totalSnipedUsd || 0)}\n` +
      `├ ${holdingStatus}\n` +
      `└ ${pnl}\n`;
  }

  // Risk assessment
  const sameBlockPct = totalSnipers > 0 ? (block0.length / totalSnipers * 100) : 0;
  const soldAllPct = totalSnipers > 0 ? (soldAll.length / totalSnipers * 100) : 0;

  let riskLevel, riskEmoji;
  if (block0.length >= 3 && soldAllPct > 60) {
    riskLevel = "HIGH — Multiple same-block snipers + most dumped";
    riskEmoji = "🔴";
  } else if (block0.length >= 2 || (totalSnipers >= 5 && soldAllPct > 50)) {
    riskLevel = "MODERATE — Sniper activity detected";
    riskEmoji = "🟠";
  } else if (totalSnipers >= 1) {
    riskLevel = "LOW — Minor sniper activity";
    riskEmoji = "🟡";
  } else {
    riskLevel = "NONE";
    riskEmoji = "🟢";
  }

  text +=
    `\n${riskEmoji} *Sniper Risk: ${riskLevel}*\n\n` +
    `⚠️ _Same-block buyers (block 0) are most likely bots or insiders. ` +
    `This does not confirm deployer affiliation — use /rug for additional risk signals._\n` +
    `🕐 ${utcNow()}`;

  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// ── /holders — Token holder analysis via Moralis ──────────────────

bot.onText(/\/holders(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
  const query = (match && match[1]) ? match[1].trim() : "";
  if (!query) {
    return bot.sendMessage(
      msg.chat.id,
      "Usage: `/holders <token name or address>`\n" +
        "Example: `/holders PEPE` or `/holders 0x6982...`\n\n" +
        "_Shows top holders, concentration risk, whale vs retail breakdown, " +
        "and flags suspicious distribution patterns._",
      { parse_mode: "Markdown" }
    );
  }

  bot.sendMessage(msg.chat.id, `📊 Analyzing holders for: ${query}...`);

  // Resolve token
  const token = await resolveToken(query);
  if (!token) {
    return bot.sendMessage(msg.chat.id, `Could not find token: ${query}`);
  }

  const evmChains = ["ethereum", "bsc", "arbitrum", "polygon", "base", "optimism", "avalanche"];
  const isSolana = token.chain === "solana";

  if (!isSolana && !evmChains.includes(token.chain)) {
    return bot.sendMessage(
      msg.chat.id,
      `Holder analysis supports EVM & Solana chains only.\n${token.symbol} is on ${token.chain}.`
    );
  }

  // ── Solana path ──
  if (isSolana) {
    // Fetch individual wallets (Helius) + aggregate stats (Moralis) in parallel
    const [heliusRes, supplyRes, sol] = await Promise.all([
      fetchHeliusTopHolders(token.address),
      fetchHeliusTokenSupply(token.address),
      fetchSolanaHolders(token.address),
    ]);

    const wallets = heliusRes?.result?.value || [];
    const totalSupplyRaw = parseFloat(supplyRes?.result?.value?.uiAmountString) || 0;

    if (!wallets.length) {
      return bot.sendMessage(msg.chat.id, `No holder data found for ${token.symbol} on Solana.`);
    }

    // Moralis aggregate stats (optional — may fail, still show wallets)
    const total = sol?.totalHolders || 0;
    const dist = sol?.holderDistribution || {};
    const acq = sol?.holdersByAcquisition || {};
    const change = sol?.holderChange || {};

    // Calculate percentages for each wallet
    const holdersWithPct = wallets.map((w) => {
      const amount = parseFloat(w.uiAmountString || w.amount) || 0;
      const pct = totalSupplyRaw > 0 ? (amount / totalSupplyRaw) * 100 : 0;
      return { address: w.address, amount, pct };
    }).sort((a, b) => b.pct - a.pct);

    // Tier emoji based on percentage
    function tierEmoji(pct) {
      if (pct >= 10) return "🐋";
      if (pct >= 5) return "🦈";
      if (pct >= 1) return "🐬";
      if (pct >= 0.1) return "🐠";
      return "🦐";
    }

    // ── Risk assessment ──
    let riskScore = 0;
    const risks = [];
    const positives = [];

    const top1pct = holdersWithPct[0]?.pct || 0;
    const top5pct = holdersWithPct.slice(0, 5).reduce((s, h) => s + h.pct, 0);
    const top10pct = holdersWithPct.slice(0, 10).reduce((s, h) => s + h.pct, 0);

    if (top1pct > 50) {
      risks.push(`🚨 #1 wallet holds ${top1pct.toFixed(1)}% — extreme dominance`);
      riskScore += 35;
    } else if (top1pct > 20) {
      risks.push(`⚠️ #1 wallet holds ${top1pct.toFixed(1)}%`);
      riskScore += 20;
    } else if (top1pct > 10) {
      risks.push(`⚠️ #1 wallet holds ${top1pct.toFixed(1)}%`);
      riskScore += 10;
    }

    if (top5pct > 50) {
      risks.push(`🚨 Top 5 hold ${top5pct.toFixed(1)}% — heavy concentration`);
      riskScore += 25;
    } else if (top5pct > 30) {
      risks.push(`⚠️ Top 5 hold ${top5pct.toFixed(1)}%`);
      riskScore += 10;
    } else {
      positives.push(`✅ Top 5 hold only ${top5pct.toFixed(1)}% — well distributed`);
    }

    const whaleWallets = holdersWithPct.filter((h) => h.pct >= 5);
    if (whaleWallets.length >= 3 && top10pct > 40) {
      risks.push(`⚠️ ${whaleWallets.length} whale wallets (>5% each) — dump risk`);
      riskScore += 15;
    }

    if (total > 0 && total < 100) {
      risks.push(`🚨 Only ${total} total holders — very thin`);
      riskScore += 20;
    } else if (total > 10000) {
      positives.push(`✅ ${total.toLocaleString()} total holders — strong community`);
    } else if (total > 1000) {
      positives.push(`✅ ${total.toLocaleString()} holders`);
    }

    // 24h trend
    const h24 = change["24h"] || {};
    if (h24.change && h24.change < 0) {
      risks.push(`⚠️ Lost ${Math.abs(h24.change)} holders in 24h (${(h24.changePercent || 0).toFixed(2)}%)`);
      riskScore += 10;
    } else if (h24.change && h24.change > 0) {
      positives.push(`✅ +${h24.change} holders in 24h (+${(h24.changePercent || 0).toFixed(2)}%)`);
    }

    // Airdrop check
    const totalAcq = (acq.swap || 0) + (acq.transfer || 0) + (acq.airdrop || 0);
    if (totalAcq > 0 && acq.airdrop > 0) {
      const airdropPct = (acq.airdrop / totalAcq) * 100;
      if (airdropPct > 30) {
        risks.push(`⚠️ ${airdropPct.toFixed(0)}% of holders from airdrops — possible wash`);
        riskScore += 10;
      }
    }

    riskScore = Math.min(riskScore, 100);

    let riskLevel, riskEmoji;
    if (riskScore >= 50) { riskLevel = "HIGH"; riskEmoji = "🔴"; }
    else if (riskScore >= 25) { riskLevel = "MODERATE"; riskEmoji = "🟠"; }
    else if (riskScore >= 10) { riskLevel = "LOW"; riskEmoji = "🟡"; }
    else { riskLevel = "HEALTHY"; riskEmoji = "🟢"; }

    // ── Build message ──
    let text =
      `👥 *Top Wallets for ${token.symbol}* ${riskEmoji}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Top 10 wallets with individual addresses
    const display = holdersWithPct.slice(0, 10);
    for (let i = 0; i < display.length; i++) {
      const h = display[i];
      const addr = h.address;
      const pct = h.pct.toFixed(1);
      const emoji = tierEmoji(h.pct);
      text += `*#${i + 1}* [${pct}%] ${emoji}\n\`${addr}\`\n`;
    }

    // Concentration summary
    text += `\n*Concentration:*\n` +
      `├ Top 5: ${top5pct.toFixed(1)}%\n` +
      `├ Top 10: ${top10pct.toFixed(1)}%\n` +
      `└ Top 20: ${holdersWithPct.slice(0, 20).reduce((s, h) => s + h.pct, 0).toFixed(1)}%\n`;

    // Moralis extras (if available)
    if (total > 0) {
      text += `\n*Total Holders:* ${total.toLocaleString()}\n`;

      // Tiers
      const tierList = [
        ["🐋", dist.whales], ["🦈", dist.sharks], ["🐬", dist.dolphins],
        ["🐠", dist.fish], ["🐙", dist.octopus], ["🦀", dist.crabs], ["🦐", dist.shrimps],
      ].filter(([, c]) => c > 0);
      if (tierList.length) {
        text += tierList.map(([e, c]) => `${e}${c}`).join(" · ") + "\n";
      }

      // Acquisition
      if (totalAcq > 0) {
        text += `\n*Acquired via:* 🔄 ${(acq.swap || 0).toLocaleString()} swap · 📤 ${(acq.transfer || 0).toLocaleString()} transfer · 🎁 ${(acq.airdrop || 0).toLocaleString()} airdrop\n`;
      }

      // Trend (compact)
      const intervals = ["1h", "6h", "24h", "7d", "30d"];
      const trendParts = [];
      for (const iv of intervals) {
        const c = change[iv];
        if (c && c.change !== undefined && c.change !== null) {
          const sign = c.change >= 0 ? "+" : "";
          trendParts.push(`${iv}: ${sign}${c.change}`);
        }
      }
      if (trendParts.length) {
        text += `\n*Trend:* ${trendParts.join(" | ")}\n`;
      }
    }

    // Signals
    if (risks.length || positives.length) {
      text += `\n*Signals:*\n`;
      for (const r of risks) text += `${r}\n`;
      for (const p of positives) text += `${p}\n`;
    }

    text +=
      `\n${riskEmoji} *Holder Risk: ${riskLevel}* (${riskScore}/100)\n\n` +
      `🕐 ${utcNow()}`;

    return bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
  }

  // ── EVM path ──

  const data = await fetchHolders(token.address, token.chain);

  if (data.error) {
    return bot.sendMessage(msg.chat.id, `Error: ${data.error}`);
  }

  if (!data.holders.length) {
    return bot.sendMessage(msg.chat.id, `No holder data found for ${token.symbol}.`);
  }

  const holders = data.holders;

  // ── Categorize holders ──

  // Known infrastructure (exchanges, bridges, burn, LP pools)
  const infraKeywords = [
    "binance", "coinbase", "kraken", "okx", "bybit", "kucoin", "bitfinex",
    "gate.io", "huobi", "htx", "bithumb", "upbit", "bitstamp", "gemini",
    "uniswap", "sushiswap", "pancakeswap", "curve", "balancer",
    "burn", "dead", "null", "bridge", "hot wallet", "cold wallet",
    "pool", "router", "treasury",
  ];

  function isInfra(h) {
    const label = (h.owner_address_label || "").toLowerCase();
    const addr = h.owner_address.toLowerCase();
    if (addr === "0x0000000000000000000000000000000000000000") return true;
    if (addr === "0x000000000000000000000000000000000000dead") return true;
    if (h.is_contract) return true;
    return infraKeywords.some((kw) => label.includes(kw));
  }

  const infraHolders = holders.filter(isInfra);
  const realHolders = holders.filter((h) => !isInfra(h));

  // ── Concentration metrics ──

  const top5 = realHolders.slice(0, 5);
  const top10 = realHolders.slice(0, 10);
  const top20 = realHolders.slice(0, 20);

  const top5pct = top5.reduce((s, h) => s + (h.percentage_relative_to_total_supply || 0), 0);
  const top10pct = top10.reduce((s, h) => s + (h.percentage_relative_to_total_supply || 0), 0);
  const top20pct = top20.reduce((s, h) => s + (h.percentage_relative_to_total_supply || 0), 0);

  const infraPct = infraHolders.reduce((s, h) => s + (h.percentage_relative_to_total_supply || 0), 0);

  // ── Whale tiers ──

  const whales = realHolders.filter((h) => (h.percentage_relative_to_total_supply || 0) >= 1);
  const midBags = realHolders.filter((h) => {
    const pct = h.percentage_relative_to_total_supply || 0;
    return pct >= 0.1 && pct < 1;
  });
  const smallBags = realHolders.filter((h) => (h.percentage_relative_to_total_supply || 0) < 0.1);

  // ── Risk assessment ──

  let riskScore = 0;
  const risks = [];
  const positives = [];

  // Single holder dominance
  if (realHolders[0] && realHolders[0].percentage_relative_to_total_supply > 10) {
    risks.push(`🚨 Top holder owns ${realHolders[0].percentage_relative_to_total_supply.toFixed(1)}% of supply`);
    riskScore += 30;
  } else if (realHolders[0] && realHolders[0].percentage_relative_to_total_supply > 5) {
    risks.push(`⚠️ Top holder owns ${realHolders[0].percentage_relative_to_total_supply.toFixed(1)}%`);
    riskScore += 15;
  }

  // Top 5 concentration
  if (top5pct > 30) {
    risks.push(`🚨 Top 5 wallets hold ${top5pct.toFixed(1)}% — heavy concentration`);
    riskScore += 25;
  } else if (top5pct > 15) {
    risks.push(`⚠️ Top 5 wallets hold ${top5pct.toFixed(1)}%`);
    riskScore += 10;
  } else {
    positives.push(`✅ Top 5 wallets hold only ${top5pct.toFixed(1)}% — well distributed`);
  }

  // Whale count
  if (whales.length >= 5 && top10pct > 25) {
    risks.push(`⚠️ ${whales.length} whales (>1% each) — coordinated dump risk`);
    riskScore += 15;
  }

  // Few real holders in top 50
  if (realHolders.length < 10) {
    risks.push(`🚨 Only ${realHolders.length} non-infrastructure holders in top 50`);
    riskScore += 20;
  } else if (realHolders.length > 30) {
    positives.push(`✅ ${realHolders.length} unique wallets in top 50 — good spread`);
  }

  // Exchange presence (positive signal)
  const exchanges = infraHolders.filter((h) => {
    const label = (h.owner_address_label || "").toLowerCase();
    return ["binance", "coinbase", "kraken", "okx", "bybit", "kucoin", "bithumb", "upbit", "bitfinex", "gemini"].some((ex) => label.includes(ex));
  });
  if (exchanges.length >= 3) {
    positives.push(`✅ Listed on ${exchanges.length} major exchanges`);
  } else if (exchanges.length >= 1) {
    positives.push(`✅ On ${exchanges.length} exchange(s)`);
  }

  riskScore = Math.min(riskScore, 100);

  let riskLevel, riskEmoji;
  if (riskScore >= 50) { riskLevel = "HIGH"; riskEmoji = "🔴"; }
  else if (riskScore >= 25) { riskLevel = "MODERATE"; riskEmoji = "🟠"; }
  else if (riskScore >= 10) { riskLevel = "LOW"; riskEmoji = "🟡"; }
  else { riskLevel = "HEALTHY"; riskEmoji = "🟢"; }

  // ── Build message ──

  let text =
    `👥 *${token.symbol} Holder Analysis* ${riskEmoji}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Concentration overview
  text +=
    `*Concentration (non-infrastructure wallets):*\n` +
    `├ Top 1 holder: ${realHolders[0] ? realHolders[0].percentage_relative_to_total_supply.toFixed(2) + "%" : "N/A"}\n` +
    `├ Top 5 hold: ${top5pct.toFixed(2)}%\n` +
    `├ Top 10 hold: ${top10pct.toFixed(2)}%\n` +
    `└ Top 20 hold: ${top20pct.toFixed(2)}%\n\n`;

  // Distribution breakdown
  text +=
    `*Distribution:*\n` +
    `├ 🐋 Whales (>1%): ${whales.length} wallets\n` +
    `├ 💼 Mid bags (0.1-1%): ${midBags.length} wallets\n` +
    `├ 🐟 Small bags (<0.1%): ${smallBags.length} wallets\n` +
    `└ 🏛 Infrastructure: ${infraHolders.length} (${infraPct.toFixed(1)}% of supply)\n\n`;

  // Top 10 holders
  text += `*Top 10 Holders:*\n`;

  const displayHolders = holders.slice(0, 10);
  for (let i = 0; i < displayHolders.length; i++) {
    const h = displayHolders[i];
    const addr = h.owner_address;
    const pct = (h.percentage_relative_to_total_supply || 0).toFixed(2);
    const usd = parseFloat(h.usd_value) || 0;
    const label = h.owner_address_label || "";
    const tag = h.is_contract ? " [contract]" : label ? ` [${label}]` : "";

    text += `*${i + 1}.* ${pct}% — ${fmtUsd(usd)}${tag}\n\`${addr}\`\n`;
  }

  // Exchanges detected
  if (exchanges.length > 0) {
    text += `\n*Exchange Presence:*\n`;
    for (const ex of exchanges.slice(0, 5)) {
      const pct = (ex.percentage_relative_to_total_supply || 0).toFixed(2);
      text += `├ ${ex.owner_address_label}: ${pct}%\n`;
    }
  }

  // Risk flags
  if (risks.length || positives.length) {
    text += `\n*Signals:*\n`;
    for (const r of risks) text += `${r}\n`;
    for (const p of positives) text += `${p}\n`;
  }

  text +=
    `\n${riskEmoji} *Holder Risk: ${riskLevel}* (${riskScore}/100)\n\n` +
    `🕐 ${utcNow()}`;

  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// ════════════════════════════════════════════════════════════════════
// WALLET + JUPITER TRADING + PUMP.FUN BONDING SCANNER
// ════════════════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");
const {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");
const bs58 = require("bs58").default || require("bs58");

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const connection = new Connection(HELIUS_RPC, "confirmed");

const WALLET_FILE = path.join(__dirname, "wallet.json");
const TRADES_FILE = path.join(__dirname, "trades.json");
const WATCH_FILE = path.join(__dirname, "bonding_watch.json");

// ── Persistent JSON helpers ────────────────────────────────────────
function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Wallet (single user, hardcoded use) ────────────────────────────
let walletState = loadJson(WALLET_FILE, null);
if (!walletState) {
  const kp = Keypair.generate();
  walletState = {
    publicKey: kp.publicKey.toBase58(),
    secretKey: bs58.encode(kp.secretKey),
    slippageBps: 500,
  };
  saveJson(WALLET_FILE, walletState);
  console.log(`✨ New wallet generated: ${walletState.publicKey}`);
}
function getKeypair() {
  return Keypair.fromSecretKey(bs58.decode(walletState.secretKey));
}

// ── Generic JSON fetch (POST/GET) ──────────────────────────────────
function httpJson(url, options = {}) {
  return new Promise((resolve) => {
    const lib = require("https");
    const u = new URL(url);
    const req = lib.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      }
    );
    req.on("error", () => resolve(null));
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ── Jupiter price + quote + swap ───────────────────────────────────
async function jupPrice(mints) {
  const ids = Array.isArray(mints) ? mints.join(",") : mints;
  const r = await httpJson(`https://lite-api.jup.ag/price/v2?ids=${ids}`);
  return r?.data || {};
}

async function jupQuote(inputMint, outputMint, amount, slippageBps) {
  const url = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&onlyDirectRoutes=false`;
  return await httpJson(url);
}

async function jupSwap(quoteResponse, userPublicKey) {
  const body = JSON.stringify({
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: "auto",
  });
  return await httpJson("https://quote-api.jup.ag/v6/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    body,
  });
}

async function executeSwap(quote) {
  const kp = getKeypair();
  const swapRes = await jupSwap(quote, kp.publicKey.toBase58());
  if (!swapRes?.swapTransaction) throw new Error("No swap transaction returned");
  const txBuf = Buffer.from(swapRes.swapTransaction, "base64");
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([kp]);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  return sig;
}

// ── Token metadata (symbol/decimals) via Helius ────────────────────
const tokenMetaCache = {};
async function getTokenMeta(mint) {
  if (tokenMetaCache[mint]) return tokenMetaCache[mint];
  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "getAsset", params: { id: mint },
  });
  const res = await httpJson(HELIUS_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    body,
  });
  const r = res?.result;
  const meta = {
    symbol: r?.content?.metadata?.symbol || r?.token_info?.symbol || "?",
    name: r?.content?.metadata?.name || "?",
    decimals: r?.token_info?.decimals ?? 9,
  };
  tokenMetaCache[mint] = meta;
  return meta;
}

// ── Balance helpers ────────────────────────────────────────────────
async function getSolBalance() {
  const lamports = await connection.getBalance(new PublicKey(walletState.publicKey));
  return lamports / LAMPORTS_PER_SOL;
}

async function getTokenAccounts() {
  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
    params: [walletState.publicKey, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }],
  });
  const res = await httpJson(HELIUS_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    body,
  });
  const accts = res?.result?.value || [];
  return accts
    .map((a) => {
      const info = a.account.data.parsed.info;
      return {
        mint: info.mint,
        amount: parseFloat(info.tokenAmount.uiAmountString || "0"),
        decimals: info.tokenAmount.decimals,
      };
    })
    .filter((t) => t.amount > 0);
}

// ── Validation ─────────────────────────────────────────────────────
function isValidMint(s) {
  try {
    const k = new PublicKey(s);
    return k.toBase58() === s && s.length >= 32;
  } catch { return false; }
}

// ── Trades store (for PnL) ─────────────────────────────────────────
function recordTrade(t) {
  const trades = loadJson(TRADES_FILE, []);
  trades.push({ ...t, ts: Date.now() });
  saveJson(TRADES_FILE, trades);
}
function avgEntryFor(mint) {
  const trades = loadJson(TRADES_FILE, []).filter((t) => t.mint === mint && t.side === "buy");
  if (!trades.length) return null;
  let totSol = 0, totTok = 0;
  for (const t of trades) { totSol += t.solAmount; totTok += t.tokenAmount; }
  return { solSpent: totSol, tokensBought: totTok, avgPriceSol: totSol / totTok };
}

// ── Format helpers ─────────────────────────────────────────────────
function fmtNum(n, d = 4) {
  if (n === null || n === undefined || isNaN(n)) return "?";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return Number(n).toFixed(d);
}
function shortMint(m) { return m.slice(0, 4) + "..." + m.slice(-4); }
function escapeMd(s) { return String(s).replace(/[_*`\[\]]/g, "\\$&"); }

// ════════════════════════════════════════════════════════════════════
// COMMANDS — WALLET
// ════════════════════════════════════════════════════════════════════

bot.onText(/\/wallet(@\w+)?(\s|$)/, async (msg) => {
  try {
    const sol = await getSolBalance();
    const accts = await getTokenAccounts();
    const usdc = accts.find((a) => a.mint === USDC_MINT);
    const prices = await jupPrice([SOL_MINT]);
    const solPrice = parseFloat(prices[SOL_MINT]?.price || 0);
    const text =
      `💼 *Your Wallet*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `\`${walletState.publicKey}\`\n\n` +
      `*SOL:* ${sol.toFixed(4)}  ($${(sol * solPrice).toFixed(2)})\n` +
      `*USDC:* ${(usdc?.amount || 0).toFixed(2)}\n\n` +
      `Send SOL or USDC to the address above to fund.\n` +
      `Slippage: ${walletState.slippageBps} bps`;
    bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
  } catch (e) {
    bot.sendMessage(msg.chat.id, `Error: ${e.message}`);
  }
});

bot.onText(/\/balance(@\w+)?(\s|$)/, async (msg) => {
  try {
    const sol = await getSolBalance();
    const accts = await getTokenAccounts();
    const mints = [SOL_MINT, ...accts.map((a) => a.mint)];
    const prices = await jupPrice(mints);
    const solPrice = parseFloat(prices[SOL_MINT]?.price || 0);
    let totalUsd = sol * solPrice;
    let lines = [`💰 *Portfolio*`, `━━━━━━━━━━━━━━━━━━━━`, `*SOL* ${sol.toFixed(4)} · $${(sol * solPrice).toFixed(2)}`];
    for (const a of accts) {
      const meta = await getTokenMeta(a.mint);
      const px = parseFloat(prices[a.mint]?.price || 0);
      const usd = a.amount * px;
      totalUsd += usd;
      lines.push(`*${escapeMd(meta.symbol)}* ${fmtNum(a.amount)} · $${usd.toFixed(2)}\n  \`${a.mint}\``);
    }
    lines.push(`━━━━━━━━━━━━━━━━━━━━`, `*Total:* $${totalUsd.toFixed(2)}`);
    bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "Markdown" });
  } catch (e) {
    bot.sendMessage(msg.chat.id, `Error: ${e.message}`);
  }
});

bot.onText(/\/positions(@\w+)?(\s|$)/, async (msg) => {
  try {
    const accts = await getTokenAccounts();
    if (!accts.length) return bot.sendMessage(msg.chat.id, "No positions.");
    const mints = accts.map((a) => a.mint).concat(SOL_MINT);
    const prices = await jupPrice(mints);
    const solPrice = parseFloat(prices[SOL_MINT]?.price || 0);
    let lines = [`📈 *Positions*`, `━━━━━━━━━━━━━━━━━━━━`];
    for (const a of accts) {
      const meta = await getTokenMeta(a.mint);
      const px = parseFloat(prices[a.mint]?.price || 0);
      const entry = avgEntryFor(a.mint);
      const curUsd = a.amount * px;
      let pnlStr = "_no entry_";
      if (entry) {
        const costUsd = entry.solSpent * solPrice;
        const pnlPct = ((curUsd - costUsd) / costUsd) * 100;
        const arrow = pnlPct >= 0 ? "🟢" : "🔴";
        pnlStr = `${arrow} ${pnlPct.toFixed(1)}% (cost $${costUsd.toFixed(2)} → $${curUsd.toFixed(2)})`;
      }
      lines.push(`*${escapeMd(meta.symbol)}* ${fmtNum(a.amount)}\n  \`${a.mint}\`\n  ${pnlStr}`);
    }
    bot.sendMessage(msg.chat.id, lines.join("\n\n"), { parse_mode: "Markdown" });
  } catch (e) {
    bot.sendMessage(msg.chat.id, `Error: ${e.message}`);
  }
});

bot.onText(/\/slippage(?:@\w+)?(?:\s+(\d+))?/, (msg, match) => {
  const bps = match && match[1] ? parseInt(match[1]) : null;
  if (!bps || bps < 1 || bps > 5000) {
    return bot.sendMessage(msg.chat.id, `Current slippage: ${walletState.slippageBps} bps\nUsage: /slippage 500 (= 5%)`);
  }
  walletState.slippageBps = bps;
  saveJson(WALLET_FILE, walletState);
  bot.sendMessage(msg.chat.id, `✅ Slippage set to ${bps} bps (${(bps / 100).toFixed(2)}%)`);
});

bot.onText(/\/export(@\w+)?(\s|$)/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `⚠️ *PRIVATE KEY — DO NOT SHARE*\n\n\`${walletState.secretKey}\`\n\nAnyone with this key controls your funds.`,
    { parse_mode: "Markdown" }
  );
});

// ── Quote / Buy / Sell ─────────────────────────────────────────────

async function doQuote(inputMint, outputMint, amount, slippageBps) {
  const q = await jupQuote(inputMint, outputMint, amount, slippageBps);
  if (!q || q.error) throw new Error(q?.error || "No route");
  return q;
}

bot.onText(/\/quote(?:@\w+)?(?:\s+(\S+)\s+(\S+))?/, async (msg, match) => {
  if (!match || !match[1] || !match[2]) {
    return bot.sendMessage(msg.chat.id, "Usage: `/quote <mint> <sol_amount>`", { parse_mode: "Markdown" });
  }
  const mint = match[1].trim();
  const solAmt = parseFloat(match[2]);
  if (!isValidMint(mint)) return bot.sendMessage(msg.chat.id, "❌ Invalid mint address.");
  if (!solAmt || solAmt <= 0) return bot.sendMessage(msg.chat.id, "❌ Invalid SOL amount.");
  try {
    const lamports = Math.floor(solAmt * LAMPORTS_PER_SOL);
    const q = await doQuote(SOL_MINT, mint, lamports, walletState.slippageBps);
    const meta = await getTokenMeta(mint);
    const out = parseFloat(q.outAmount) / 10 ** meta.decimals;
    const minOut = parseFloat(q.otherAmountThreshold) / 10 ** meta.decimals;
    const impact = parseFloat(q.priceImpactPct || 0) * 100;
    bot.sendMessage(
      msg.chat.id,
      `📋 *Quote*\n━━━━━━━━━━━━━━━━━━━━\n` +
        `*${escapeMd(meta.symbol)}* (${escapeMd(meta.name)})\n` +
        `\`${mint}\`\n\n` +
        `Pay: *${solAmt} SOL*\n` +
        `Receive: *${fmtNum(out)} ${escapeMd(meta.symbol)}*\n` +
        `Min (after slip): ${fmtNum(minOut)}\n` +
        `Price impact: ${impact.toFixed(3)}%\n` +
        `Route: ${q.routePlan?.length || 1} hop(s)`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
  }
});

bot.onText(/\/buy(?:@\w+)?(?:\s+(\S+)\s+(\S+))?/, async (msg, match) => {
  if (!match || !match[1] || !match[2]) {
    return bot.sendMessage(msg.chat.id, "Usage: `/buy <mint> <sol_amount>`", { parse_mode: "Markdown" });
  }
  const mint = match[1].trim();
  const solAmt = parseFloat(match[2]);
  if (!isValidMint(mint)) return bot.sendMessage(msg.chat.id, "❌ Invalid mint address.");
  if (!solAmt || solAmt <= 0) return bot.sendMessage(msg.chat.id, "❌ Invalid SOL amount.");
  try {
    const balSol = await getSolBalance();
    if (balSol < solAmt + 0.005) return bot.sendMessage(msg.chat.id, `❌ Not enough SOL. Have ${balSol.toFixed(4)}`);
    bot.sendMessage(msg.chat.id, `⏳ Buying...`);
    const lamports = Math.floor(solAmt * LAMPORTS_PER_SOL);
    const q = await doQuote(SOL_MINT, mint, lamports, walletState.slippageBps);
    const meta = await getTokenMeta(mint);
    const tokensOut = parseFloat(q.outAmount) / 10 ** meta.decimals;
    const sig = await executeSwap(q);
    recordTrade({ side: "buy", mint, symbol: meta.symbol, solAmount: solAmt, tokenAmount: tokensOut, sig });
    bot.sendMessage(
      msg.chat.id,
      `✅ *Bought* ${fmtNum(tokensOut)} *${escapeMd(meta.symbol)}* for ${solAmt} SOL\n[tx](https://solscan.io/tx/${sig})`,
      { parse_mode: "Markdown", disable_web_page_preview: true }
    );
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ Buy failed: ${e.message}`);
  }
});

bot.onText(/\/sell(?:@\w+)?(?:\s+(\S+)\s+(\S+))?/, async (msg, match) => {
  if (!match || !match[1] || !match[2]) {
    return bot.sendMessage(msg.chat.id, "Usage: `/sell <mint> <percent>`\nExample: `/sell <mint> 100`", { parse_mode: "Markdown" });
  }
  const mint = match[1].trim();
  const pct = parseFloat(match[2]);
  if (!isValidMint(mint)) return bot.sendMessage(msg.chat.id, "❌ Invalid mint address.");
  if (!pct || pct <= 0 || pct > 100) return bot.sendMessage(msg.chat.id, "❌ Percent must be 1–100");
  try {
    const accts = await getTokenAccounts();
    const holding = accts.find((a) => a.mint === mint);
    if (!holding || holding.amount <= 0) return bot.sendMessage(msg.chat.id, "❌ You don't hold this token.");
    const sellAmount = holding.amount * (pct / 100);
    const rawAmount = Math.floor(sellAmount * 10 ** holding.decimals);
    bot.sendMessage(msg.chat.id, `⏳ Selling ${pct}%...`);
    const q = await doQuote(mint, SOL_MINT, rawAmount, walletState.slippageBps);
    const meta = await getTokenMeta(mint);
    const solOut = parseFloat(q.outAmount) / LAMPORTS_PER_SOL;
    const sig = await executeSwap(q);
    recordTrade({ side: "sell", mint, symbol: meta.symbol, solAmount: solOut, tokenAmount: sellAmount, sig });
    bot.sendMessage(
      msg.chat.id,
      `✅ *Sold* ${fmtNum(sellAmount)} *${escapeMd(meta.symbol)}* for ${solOut.toFixed(4)} SOL\n[tx](https://solscan.io/tx/${sig})`,
      { parse_mode: "Markdown", disable_web_page_preview: true }
    );
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ Sell failed: ${e.message}`);
  }
});

// ════════════════════════════════════════════════════════════════════
// PUMP.FUN BONDING SCANNER (Moralis)
// ════════════════════════════════════════════════════════════════════

async function fetchBondingTokens(limit = 100) {
  const url = `https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/bonding?limit=${limit}`;
  return await httpJson(url, {
    method: "GET",
    headers: { "X-API-Key": MORALIS_API_KEY, Accept: "application/json" },
  });
}

function progressBar(pct) {
  const full = Math.round(pct / 10);
  return "▰".repeat(full) + "▱".repeat(10 - full);
}

function ageStr(ts) {
  if (!ts) return "?";
  const ms = Date.now() - new Date(ts).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatBonding(tokens, threshold) {
  if (!tokens.length) return "No tokens above threshold.";
  let txt = `🔥 ABOUT TO BOND — ${threshold}%+\n━━━━━━━━━━━━━━━━━━━━\n`;
  tokens.forEach((t, i) => {
    const pct = parseFloat(t.bondingCurveProgress || 0);
    const sym = (t.symbol || "?").replace(/[\r\n]/g, "");
    const sol = parseFloat(t.liquidity || 0);
    const mc = parseFloat(t.fullyDilutedValuation || t.marketCap || 0);
    txt +=
      `\n${i + 1}. ${sym}  ${progressBar(pct)} ${pct.toFixed(0)}%\n` +
      `  💧 ${fmtNum(sol, 1)} SOL · MC $${fmtNum(mc, 0)} · age ${ageStr(t.createdAt)}\n` +
      `  ${t.tokenAddress}\n`;
  });
  txt += `\n━━━━━━━━━━━━━━━━━━━━\nupdated ${new Date().toISOString().slice(11, 19)} UTC`;
  return txt;
}

bot.onText(/\/bonding(?:@\w+)?(?:\s+(\d+))?$/, async (msg, match) => {
  const threshold = match && match[1] ? parseInt(match[1]) : 80;
  bot.sendMessage(msg.chat.id, `Scanning pump.fun bonding curves >${threshold}%...`);
  try {
    const data = await fetchBondingTokens(100);
    const list = (data?.result || data || []).filter((t) => parseFloat(t.bondingCurveProgress || 0) >= threshold);
    list.sort((a, b) => parseFloat(b.bondingCurveProgress || 0) - parseFloat(a.bondingCurveProgress || 0));
    const top = list.slice(0, threshold >= 80 ? 20 : 30);
    bot.sendMessage(msg.chat.id, formatBonding(top, threshold));
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
  }
});

// ── Bonding watcher ────────────────────────────────────────────────
let watchState = loadJson(WATCH_FILE, { chats: [], crossed: {} });

bot.onText(/\/bonding_watch(@\w+)?(\s|$)/, (msg) => {
  if (!watchState.chats.includes(msg.chat.id)) {
    watchState.chats.push(msg.chat.id);
    saveJson(WATCH_FILE, watchState);
  }
  bot.sendMessage(msg.chat.id, "👀 Watching pump.fun. You'll be alerted when any token crosses 80%.");
});

bot.onText(/\/bonding_stop(@\w+)?(\s|$)/, (msg) => {
  watchState.chats = watchState.chats.filter((c) => c !== msg.chat.id);
  saveJson(WATCH_FILE, watchState);
  bot.sendMessage(msg.chat.id, "🛑 Bonding watch stopped.");
});

async function bondingWatchTick() {
  if (!watchState.chats.length) return;
  try {
    const data = await fetchBondingTokens(100);
    const list = (data?.result || data || []);
    for (const t of list) {
      const pct = parseFloat(t.bondingCurveProgress || 0);
      if (pct >= 80 && !watchState.crossed[t.tokenAddress]) {
        watchState.crossed[t.tokenAddress] = Date.now();
        const txt =
          `🚨 *Crossing bond:* *${escapeMd(t.symbol || "?")}*  ${pct.toFixed(0)}%\n` +
          `\`${t.tokenAddress}\`\n` +
          `💧 ${fmtNum(parseFloat(t.liquidity || 0), 1)} SOL · age ${ageStr(t.createdAt)}`;
        for (const cid of watchState.chats) {
          bot.sendMessage(cid, txt, { parse_mode: "Markdown" });
        }
      }
    }
    // GC: forget after 24h
    const cutoff = Date.now() - 86400000;
    for (const k of Object.keys(watchState.crossed)) {
      if (watchState.crossed[k] < cutoff) delete watchState.crossed[k];
    }
    saveJson(WATCH_FILE, watchState);
  } catch (e) {
    console.error("watch tick err:", e.message);
  }
}
setInterval(bondingWatchTick, 60_000);

// ── Start ──────────────────────────────────────────────────────────

console.log("🐸 Meme Intelligence Bot is running...");
console.log(`💼 Wallet: ${walletState.publicKey}`);

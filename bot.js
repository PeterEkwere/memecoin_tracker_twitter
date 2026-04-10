/**
 * Meme Intelligence Telegram Bot (Node.js)
 *
 * Commands:
 *   /start              - Welcome message
 *   /market <token>      - Live market data
 *   /scan <token>        - Volume surge + buy pressure momentum scan
 *   /alert <token>       - Breakout probability
 *   /rug <token>         - Quick rug-pull risk check
 *   /trending            - DexScreener boosted/trending tokens
 *   /newpairs            - Freshly launched tokens (< 24h)
 *   /social <token>      - Twitter social buzz via TwitterAPI.io
 *   /sniper <token>      - Sniper bot detection (EVM)
 *   /holders <token>     - Holder distribution analysis
 *   /wallet              - Show wallet address + balance (owner only)
 *   /balance             - Full portfolio (owner only)
 *   /positions           - Holdings with PnL (owner only)
 *   /quote <mint> <sol>  - Dry-run buy (owner only)
 *   /buy <mint> <sol>    - Buy token (owner only)
 *   /sell <mint> <pct>   - Sell token (owner only)
 *   /slippage <bps>      - Set slippage (owner only)
 *   /export              - Export private key (owner only, DM only)
 *   /bonding [pct]       - Pump.fun bonding scanner
 *   /bonding_watch       - Auto-alert on 80%+ bonds
 *   /bonding_stop        - Stop bonding alerts
 *   /help                - List commands
 */

const TelegramBot = require("node-telegram-bot-api");
const https = require("https");

// ── Hardcoded keys ────────────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = "8761931814:AAGH6N9Kw7F4HoOcL2UAxxRd9LkrqQ_FQyI";
const HELIUS_API_KEY = "9e4131db-46f0-44b0-9823-34a95674fb59";
const MORALIS_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IjAxODZjZGZhLTgwMzYtNGQ1OS1iMDBjLTY3MDc4N2RlNzMwYyIsIm9yZ0lkIjoiNTA1ODI0IiwidXNlcklkIjoiNTIwNDYyIiwidHlwZUlkIjoiMDQzNGJlOGItYjdkOC00OTBhLWJhYmMtNzliNzZmNjczNTZhIiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NzM3NjQ4MzAsImV4cCI6NDkyOTUyNDgzMH0.k1DDMBzzEexgFVKKQo52q-H4Kz-L0Fnu9Byam2uY8mk";
const TWITTERAPI_IO_KEY = "new1_59d515e22d1347f69ec4e0b5ae9c57ae";

// ── Owner allowlist (Telegram user IDs) ───────────────────────────
// Add your Telegram user ID here. Send /start and check console for your ID.
const OWNER_IDS = [7059352737];

function isOwner(msg) {
  if (OWNER_IDS.length === 0) return true; // no owners set = allow all (initial setup)
  return OWNER_IDS.includes(msg.from.id);
}

function ownerGuard(msg) {
  if (isOwner(msg)) return true;
  bot.sendMessage(msg.chat.id, "🔒 Not authorized. This command is owner-only.");
  return false;
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// ── HTML escaping (safe for all dynamic values) ───────────────────
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Explorer URLs per chain ───────────────────────────────────────
function explorerUrl(chain, address, type = "token") {
  const base = {
    ethereum: "https://etherscan.io",
    bsc: "https://bscscan.com",
    arbitrum: "https://arbiscan.io",
    polygon: "https://polygonscan.com",
    base: "https://basescan.org",
    optimism: "https://optimistic.etherscan.io",
    avalanche: "https://snowtrace.io",
    solana: "https://solscan.io",
  }[chain] || "https://etherscan.io";

  if (chain === "solana") {
    return type === "tx" ? `${base}/tx/${address}` : `${base}/account/${address}`;
  }
  return type === "tx" ? `${base}/tx/${address}` : `${base}/token/${address}`;
}

// ── Inline keyboard helpers ───────────────────────────────────────
function addressButtons(address, chain) {
  return {
    reply_markup: {
      inline_keyboard: [[
        { text: "📋 Copy Address", copy_text: { text: address } },
        { text: "🔗 Explorer", url: explorerUrl(chain, address) },
      ]],
    },
  };
}

function walletButtons(address) {
  return {
    reply_markup: {
      inline_keyboard: [[
        { text: "📋 Copy Address", copy_text: { text: address } },
        { text: "🔗 Solscan", url: `https://solscan.io/account/${address}` },
      ]],
    },
  };
}

function txButton(sig) {
  return {
    reply_markup: {
      inline_keyboard: [[
        { text: "📋 Copy Tx", copy_text: { text: sig } },
        { text: "🔗 View Tx", url: `https://solscan.io/tx/${sig}` },
      ]],
    },
  };
}

// ── Generic HTTPS helpers with timeout + status check ─────────────

function httpGet(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return resolve(null);
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function httpPost(url, body, headers = {}, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return resolve(null);
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

function httpGetWithHeaders(url, headers, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "GET",
      headers,
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return resolve(null);
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end();
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

async function resolveToken(query) {
  if (!query) return null;
  if (query.startsWith("0x") || query.length > 30) {
    return await fetchFullPairData(query);
  }
  const results = await searchToken(query);
  if (!results.length) return null;
  results.sort((a, b) => b.liquidity - a.liquidity);
  return results[0];
}

async function fetchFullPairData(address) {
  const json = await httpGet(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
  if (!json || !json.pairs || !json.pairs.length) return null;
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

function heliusRpcCall(method, params) {
  const postData = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  return httpPost(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, postData);
}

function fetchHeliusTopHolders(mintAddress) {
  return heliusRpcCall("getTokenLargestAccounts", [mintAddress]);
}

function fetchHeliusTokenSupply(mintAddress) {
  return heliusRpcCall("getTokenSupply", [mintAddress]);
}

// ── Moralis API helpers ────────────────────────────────────────────

function moralisGet(path) {
  return httpGetWithHeaders(`https://deep-index.moralis.io${path}`, {
    "X-API-Key": MORALIS_API_KEY,
    Accept: "application/json",
  });
}

async function fetchSnipers(tokenAddress, chain) {
  const chainMap = {
    ethereum: "eth", eth: "eth",
    bsc: "bsc", arbitrum: "arbitrum",
    polygon: "polygon", base: "base",
    optimism: "optimism", avalanche: "avalanche",
  };
  const moralisChain = chainMap[chain] || "eth";

  const pairsData = await moralisGet(
    `/api/v2.2/erc20/${tokenAddress}/pairs?chain=${moralisChain}`
  );

  const pairs = pairsData?.pairs || [];
  if (!pairs.length) return { error: "No pairs found on Moralis" };

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

  return {
    pairAddress: sortedPairs[0]?.pair_address || "",
    pairLabel: sortedPairs[0]?.pair_label || "?",
    exchange: sortedPairs[0]?.exchange_name || "?",
    blockNumber: 0,
    blockTimestamp: "",
    snipers: [],
  };
}

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

function fetchSolanaHolders(tokenAddress) {
  return httpGetWithHeaders(`https://solana-gateway.moralis.io/token/mainnet/holders/${tokenAddress}`, {
    "X-API-Key": MORALIS_API_KEY,
    Accept: "application/json",
  });
}

// ── TwitterAPI.io helpers ─────────────────────────────────────────

async function twitterSearch(query, count = 20) {
  const url = `https://api.twitterapi.io/twitter/tweet/advanced_search?queryType=Latest&query=${encodeURIComponent(query)}&count=${count}`;
  return httpGetWithHeaders(url, { "x-api-key": TWITTERAPI_IO_KEY });
}

// ── Breakout calculation ───────────────────────────────────────────

function calculateBreakout(t, socialData) {
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

  // Social score from Twitter data
  let socialScore = 0;
  if (socialData && socialData.tweetCount > 0) {
    socialScore += Math.min(socialData.tweetCount * 2, 30);
    socialScore += Math.min(socialData.totalEngagement * 0.1, 30);
    socialScore += Math.min(socialData.uniqueAuthors * 3, 20);
    if (socialData.avgFollowers > 10000) socialScore += 20;
    else if (socialData.avgFollowers > 1000) socialScore += 10;
    socialScore = Math.min(socialScore, 100);
  }

  const combined = socialData
    ? marketScore * 0.6 + socialScore * 0.4
    : marketScore;

  let status, emoji;
  if (combined >= 60 && t.priceChange1h > 5) {
    status = "MARKET CONFIRMING"; emoji = "🟢";
  } else if (combined >= 40) {
    status = "ACTIVE"; emoji = "🟡";
  } else if (t.priceChange1h < -5) {
    status = "COOLING"; emoji = "🔴";
  } else {
    status = "STABLE"; emoji = "⚪";
  }

  return {
    marketScore: marketScore.toFixed(1),
    socialScore: socialData ? socialScore.toFixed(1) : "N/A",
    breakoutProbability: `${combined.toFixed(1)}%`,
    status,
    emoji,
  };
}

// ── Format helpers ─────────────────────────────────────────────────

function fmtPrice(n) {
  if (n === 0) return "$0";
  if (n < 0.00001) return `$${n.toExponential(2)}`;
  if (n < 0.001) return `$${n.toFixed(8)}`;
  if (n < 1) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(2)}`;
}

function fmtUsd(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(n) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function pctEmoji(n) {
  if (n > 5) return "🟢";
  if (n > 0) return "🟡";
  if (n > -5) return "🟠";
  return "🔴";
}

function utcNow() {
  return new Date().toISOString().slice(11, 16) + " UTC";
}

function shortAddr(addr) {
  if (!addr || addr.length < 12) return addr || "?";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function chainBadge(chain) {
  const badges = {
    solana: "[SOL]", ethereum: "[ETH]", bsc: "[BSC]",
    arbitrum: "[ARB]", polygon: "[POLY]", base: "[BASE]",
    optimism: "[OP]", avalanche: "[AVAX]",
  };
  return badges[chain] || `[${chain}]`;
}

// ── Send with safe HTML ───────────────────────────────────────────
function sendHtml(chatId, text, extra = {}) {
  return bot.sendMessage(chatId, text, { parse_mode: "HTML", disable_web_page_preview: true, ...extra });
}

// ── Command handlers ───────────────────────────────────────────────

bot.onText(/\/start(@\w+)?(\s|$)/, (msg) => {
  // Log user ID for owner setup
  console.log(`/start from user ID: ${msg.from.id} (${msg.from.username || msg.from.first_name})`);
  sendHtml(msg.chat.id,
    `🐸 <b>Meme Intelligence Bot</b>\n\n` +
    `Real-time token intelligence powered by DexScreener, Moralis, Helius &amp; Twitter.\n` +
    `Use /help for the full command list.`
  );
});

bot.onText(/\/help(@\w+)?(\s|$)/, (msg) => {
  sendHtml(msg.chat.id,
    `🐸 <b>Meme Intelligence Bot</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +

    `📊 <b>MARKET INTEL</b>\n` +
    `/market &lt;token&gt; — Live price, volume, liquidity\n` +
    `/scan &lt;token&gt; — Volume surge + buy pressure scan\n` +
    `/alert &lt;token&gt; — Breakout probability score\n` +
    `/rug &lt;token&gt; — Rug-pull risk check\n` +
    `/trending — DexScreener boosted tokens\n` +
    `/newpairs — Freshly launched tokens (&lt;24h)\n\n` +

    `🔍 <b>ON-CHAIN</b>\n` +
    `/sniper &lt;token&gt; — Detect launch snipers (EVM)\n` +
    `/holders &lt;token&gt; — Holder distribution analysis\n\n` +

    `🐦 <b>SOCIAL</b>\n` +
    `/social &lt;token&gt; — Twitter buzz, top tweets, sentiment\n\n` +

    `💼 <b>WALLET &amp; TRADING</b> (owner only)\n` +
    `/wallet — Your Solana address + balance\n` +
    `/balance — All SPL tokens with $ values\n` +
    `/positions — Holdings with PnL\n` +
    `/quote &lt;mint&gt; &lt;sol&gt; — Preview a buy\n` +
    `/buy &lt;mint&gt; &lt;sol&gt; — Buy token via Jupiter\n` +
    `/sell &lt;mint&gt; &lt;pct&gt; — Sell % of token\n` +
    `/slippage &lt;bps&gt; — Set slippage (default 500)\n` +
    `/export — Export private key (DM only)\n\n` +

    `🚀 <b>PUMP.FUN</b>\n` +
    `/bonding — Tokens &gt;80% bonded\n` +
    `/bonding &lt;pct&gt; — Custom threshold\n` +
    `/bonding_watch — Auto-alert 80%+ crossings\n` +
    `/bonding_stop — Stop alerts\n\n` +

    `<b>Token lookup:</b> name, symbol, or contract address.\n` +
    `Bot picks the highest-liquidity match.`
  );
});

// ── /market ────────────────────────────────────────────────────────

bot.onText(/\/market(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
  const query = (match && match[1]) ? match[1].trim() : "";
  if (!query) return sendHtml(msg.chat.id, "Usage: <code>/market &lt;token&gt;</code>\nExample: <code>/market PEPE</code>");

  sendHtml(msg.chat.id, `Fetching market data for: ${esc(query)}...`);

  try {
    const t = await resolveToken(query);
    if (!t) return sendHtml(msg.chat.id, `Could not find token: ${esc(query)}`);

    const total = t.buys24h + t.sells24h;
    const buyPct = total > 0 ? `${((t.buys24h / total) * 100).toFixed(0)}%` : "N/A";

    sendHtml(msg.chat.id,
      `📊 <b>${esc(t.symbol)} Market Data</b> ${chainBadge(t.chain)}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `💰 Price: <code>${fmtPrice(t.price)}</code>\n` +
      `${pctEmoji(t.priceChange5m)} 5m: ${fmtPct(t.priceChange5m)}\n` +
      `${pctEmoji(t.priceChange1h)} 1h: ${fmtPct(t.priceChange1h)}\n` +
      `${pctEmoji(t.priceChange6h)} 6h: ${fmtPct(t.priceChange6h)}\n` +
      `${pctEmoji(t.priceChange24h)} 24h: ${fmtPct(t.priceChange24h)}\n\n` +
      `📊 Volume 24h: ${fmtUsd(t.volume24h)}\n` +
      `💧 Liquidity: ${fmtUsd(t.liquidity)}\n` +
      `🏛 Market Cap: ${fmtUsd(t.marketCap)}\n\n` +
      `🟢 Buys 24h: ${t.buys24h.toLocaleString()} (${buyPct})\n` +
      `🔴 Sells 24h: ${t.sells24h.toLocaleString()}\n` +
      `🔄 DEX: ${esc(t.dex)}\n\n` +
      `📍 <code>${shortAddr(t.address)}</code>\n` +
      `🕐 ${utcNow()}`,
      addressButtons(t.address, t.chain)
    );
  } catch (e) {
    sendHtml(msg.chat.id, `❌ Error: ${esc(e.message)}`);
  }
});

// ── /social — Twitter buzz via TwitterAPI.io ───────────────────────

bot.onText(/\/social(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
  const query = (match && match[1]) ? match[1].trim() : "";
  if (!query) return sendHtml(msg.chat.id, "Usage: <code>/social &lt;token&gt;</code>\nExample: <code>/social PEPE</code>");

  sendHtml(msg.chat.id, `🐦 Scanning Twitter for: ${esc(query)}...`);

  try {
    // Build search query — use cashtag for short symbols, plain text for addresses
    const isAddress = query.startsWith("0x") || query.length > 30;
    const searchQuery = isAddress ? query.slice(0, 20) : `$${query}`;

    const data = await twitterSearch(searchQuery, 20);
    const tweets = data?.tweets || [];

    if (!tweets.length) {
      return sendHtml(msg.chat.id,
        `🐦 <b>Social: ${esc(query)}</b>\n\n` +
        `No recent tweets found for <code>${esc(searchQuery)}</code>.`
      );
    }

    // Analyze tweets
    const totalEngagement = tweets.reduce((sum, tw) => {
      return sum + (tw.likeCount || 0) + (tw.retweetCount || 0) + (tw.replyCount || 0);
    }, 0);
    const totalViews = tweets.reduce((sum, tw) => sum + (tw.viewCount || 0), 0);
    const uniqueAuthors = new Set(tweets.map((tw) => tw.author?.userName)).size;
    const avgFollowers = tweets.reduce((sum, tw) => sum + (tw.author?.followers || 0), 0) / tweets.length;
    const verifiedCount = tweets.filter((tw) => tw.author?.isBlueVerified).length;

    // Sentiment keywords
    const bullish = ["buy", "bullish", "moon", "pump", "gem", "alpha", "breakout", "ape", "send", "load", "long"];
    const bearish = ["sell", "dump", "rug", "scam", "short", "dead", "avoid", "crash", "bear"];
    let bullCount = 0, bearCount = 0;
    for (const tw of tweets) {
      const text = (tw.text || "").toLowerCase();
      if (bullish.some((w) => text.includes(w))) bullCount++;
      if (bearish.some((w) => text.includes(w))) bearCount++;
    }
    const sentimentTotal = bullCount + bearCount;
    const sentimentPct = sentimentTotal > 0 ? ((bullCount / sentimentTotal) * 100).toFixed(0) : "50";
    const sentimentEmoji = sentimentPct > 60 ? "🟢" : sentimentPct > 40 ? "🟡" : "🔴";
    const sentimentLabel = sentimentPct > 60 ? "BULLISH" : sentimentPct > 40 ? "MIXED" : "BEARISH";

    // Social buzz score (0-100)
    let buzzScore = 0;
    buzzScore += Math.min(tweets.length * 3, 25);
    buzzScore += Math.min(uniqueAuthors * 4, 25);
    buzzScore += Math.min(Math.log10(totalEngagement + 1) * 8, 25);
    buzzScore += Math.min(Math.log10(avgFollowers + 1) * 5, 25);
    buzzScore = Math.min(Math.round(buzzScore), 100);

    let buzzLabel, buzzEmoji;
    if (buzzScore >= 70) { buzzLabel = "VIRAL"; buzzEmoji = "🔥"; }
    else if (buzzScore >= 40) { buzzLabel = "ACTIVE"; buzzEmoji = "📈"; }
    else if (buzzScore >= 20) { buzzLabel = "QUIET"; buzzEmoji = "📉"; }
    else { buzzLabel = "DEAD"; buzzEmoji = "💀"; }

    // Top 3 tweets by engagement
    const topTweets = [...tweets]
      .sort((a, b) => ((b.likeCount || 0) + (b.retweetCount || 0)) - ((a.likeCount || 0) + (a.retweetCount || 0)))
      .slice(0, 3);

    let text =
      `🐦 <b>Social: ${esc(query)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `${buzzEmoji} <b>Buzz Score: ${buzzScore}/100 — ${buzzLabel}</b>\n\n` +
      `<b>Overview:</b>\n` +
      `├ Tweets sampled: ${tweets.length}\n` +
      `├ Unique authors: ${uniqueAuthors}\n` +
      `├ Verified authors: ${verifiedCount}\n` +
      `├ Total engagement: ${totalEngagement.toLocaleString()}\n` +
      `├ Total views: ${totalViews.toLocaleString()}\n` +
      `├ Avg followers: ${fmtUsd(avgFollowers).replace("$", "")}\n` +
      `└ ${sentimentEmoji} Sentiment: ${sentimentPct}% bullish — ${sentimentLabel}\n`;

    if (topTweets.length) {
      text += `\n<b>Top Tweets:</b>\n`;
      for (let i = 0; i < topTweets.length; i++) {
        const tw = topTweets[i];
        const author = tw.author?.userName || "?";
        const followers = tw.author?.followers || 0;
        const verified = tw.author?.isBlueVerified ? " ✓" : "";
        const likes = tw.likeCount || 0;
        const rts = tw.retweetCount || 0;
        const snippet = (tw.text || "").slice(0, 100).replace(/\n/g, " ");

        text +=
          `\n${i + 1}. <b>@${esc(author)}</b>${verified} (${fmtUsd(followers).replace("$", "")} followers)\n` +
          `   ❤️ ${likes} · 🔄 ${rts}\n` +
          `   <i>${esc(snippet)}${tw.text?.length > 100 ? "..." : ""}</i>\n`;
      }
    }

    text +=
      `\n<b>Source:</b> ${tweets.length} tweets, ${uniqueAuthors} authors, last hour\n` +
      `🕐 ${utcNow()}`;

    sendHtml(msg.chat.id, text);
  } catch (e) {
    sendHtml(msg.chat.id, `❌ Social scan failed: ${esc(e.message)}`);
  }
});

// ── /alert — Breakout probability ──────────────────────────────────

bot.onText(/\/alert(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
  const query = (match && match[1]) ? match[1].trim() : "";
  if (!query) return sendHtml(msg.chat.id, "Usage: <code>/alert &lt;token&gt;</code>\nExample: <code>/alert PEPE</code>");

  sendHtml(msg.chat.id, `Calculating breakout probability for: ${esc(query)}...`);

  try {
    const t = await resolveToken(query);
    if (!t) return sendHtml(msg.chat.id, `Could not find token: ${esc(query)}`);

    // Fetch social data for combined score
    let socialData = null;
    try {
      const searchQ = `$${t.symbol}`;
      const data = await twitterSearch(searchQ, 20);
      const tweets = data?.tweets || [];
      if (tweets.length) {
        const uniqueAuthors = new Set(tweets.map((tw) => tw.author?.userName)).size;
        const totalEngagement = tweets.reduce((sum, tw) =>
          sum + (tw.likeCount || 0) + (tw.retweetCount || 0) + (tw.replyCount || 0), 0);
        const avgFollowers = tweets.reduce((sum, tw) => sum + (tw.author?.followers || 0), 0) / tweets.length;
        socialData = { tweetCount: tweets.length, uniqueAuthors, totalEngagement, avgFollowers };
      }
    } catch { /* social is optional */ }

    const b = calculateBreakout(t, socialData);

    sendHtml(msg.chat.id,
      `🎯 <b>${esc(t.symbol)} Breakout Alert</b> ${b.emoji} ${chainBadge(t.chain)}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<b>Scores:</b>\n` +
      `├ Market: ${b.marketScore}/100\n` +
      `├ Social: ${b.socialScore}${b.socialScore !== "N/A" ? "/100" : ""}\n` +
      `└ <b>Breakout: ${b.breakoutProbability}</b>\n\n` +
      `<b>Why:</b>\n` +
      `├ 1h price: ${fmtPct(t.priceChange1h)}\n` +
      `├ Volume 24h: ${fmtUsd(t.volume24h)}\n` +
      `├ Liquidity: ${fmtUsd(t.liquidity)}\n` +
      `└ Buy ratio: ${((t.buys24h / Math.max(t.buys24h + t.sells24h, 1)) * 100).toFixed(0)}%\n\n` +
      `<b>Status:</b> ${b.status}\n` +
      `📍 <code>${shortAddr(t.address)}</code>\n` +
      `🕐 ${utcNow()}`,
      addressButtons(t.address, t.chain)
    );
  } catch (e) {
    sendHtml(msg.chat.id, `❌ Error: ${esc(e.message)}`);
  }
});

// ── /scan — Momentum scan ──────────────────────────────────────────

bot.onText(/\/scan(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
  const query = (match && match[1]) ? match[1].trim() : "";
  if (!query) return sendHtml(msg.chat.id, "Usage: <code>/scan &lt;token&gt;</code>\nExample: <code>/scan PEPE</code>");

  sendHtml(msg.chat.id, `Scanning momentum for: ${esc(query)}...`);

  try {
    const t = await resolveToken(query);
    if (!t) return sendHtml(msg.chat.id, `Could not find token: ${esc(query)}`);

    // Volume surge detection — guarded division
    const avgVolPerHour = t.volume24h / 24;
    const volumeSurge1h = avgVolPerHour > 0 ? (t.volume1h / avgVolPerHour) : 0;
    const volumeSurge5m = avgVolPerHour > 0 ? ((t.volume5m * 12) / avgVolPerHour) : 0;

    let surgeEmoji = "⚪";
    let surgeLabel = "Normal";
    if (volumeSurge5m >= 5) { surgeEmoji = "🔴"; surgeLabel = "EXTREME SURGE"; }
    else if (volumeSurge5m >= 3) { surgeEmoji = "🟠"; surgeLabel = "HIGH SURGE"; }
    else if (volumeSurge5m >= 1.5) { surgeEmoji = "🟡"; surgeLabel = "ELEVATED"; }

    // Buy pressure
    const bp5m = (t.buys5m + t.sells5m) > 0 ? (t.buys5m / (t.buys5m + t.sells5m) * 100) : 50;
    const bp1h = (t.buys1h + t.sells1h) > 0 ? (t.buys1h / (t.buys1h + t.sells1h) * 100) : 50;
    const bp24h = (t.buys24h + t.sells24h) > 0 ? (t.buys24h / (t.buys24h + t.sells24h) * 100) : 50;

    const bpEmoji = (bp) => bp >= 60 ? "🟢" : bp >= 50 ? "🟡" : "🔴";
    const momEmoji = (pc) => pc > 5 ? "🚀" : pc > 0 ? "📈" : pc > -5 ? "📉" : "💥";

    sendHtml(msg.chat.id,
      `⚡ <b>${esc(t.symbol)} Momentum Scan</b> ${chainBadge(t.chain)}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<b>Price Action:</b>\n` +
      `├ ${momEmoji(t.priceChange5m)} 5m: ${fmtPct(t.priceChange5m)}\n` +
      `├ ${momEmoji(t.priceChange1h)} 1h: ${fmtPct(t.priceChange1h)}\n` +
      `├ ${momEmoji(t.priceChange6h)} 6h: ${fmtPct(t.priceChange6h)}\n` +
      `└ ${momEmoji(t.priceChange24h)} 24h: ${fmtPct(t.priceChange24h)}\n\n` +
      `<b>Volume Surge:</b> ${surgeEmoji} ${surgeLabel}\n` +
      `├ 5m: ${fmtUsd(t.volume5m)} (${volumeSurge5m.toFixed(1)}x avg)\n` +
      `├ 1h: ${fmtUsd(t.volume1h)} (${volumeSurge1h.toFixed(1)}x avg)\n` +
      `└ 24h: ${fmtUsd(t.volume24h)}\n\n` +
      `<b>Buy Pressure:</b>\n` +
      `├ ${bpEmoji(bp5m)} 5m: ${bp5m.toFixed(0)}% buys (${t.buys5m}B/${t.sells5m}S)\n` +
      `├ ${bpEmoji(bp1h)} 1h: ${bp1h.toFixed(0)}% buys (${t.buys1h}B/${t.sells1h}S)\n` +
      `└ ${bpEmoji(bp24h)} 24h: ${bp24h.toFixed(0)}% buys (${t.buys24h}B/${t.sells24h}S)\n\n` +
      `💧 Liquidity: ${fmtUsd(t.liquidity)}\n` +
      `📍 <code>${shortAddr(t.address)}</code>\n` +
      `🕐 ${utcNow()}`,
      addressButtons(t.address, t.chain)
    );
  } catch (e) {
    sendHtml(msg.chat.id, `❌ Error: ${esc(e.message)}`);
  }
});

// ── /trending — Boosted tokens ─────────────────────────────────────

bot.onText(/\/trending(?:@\w+)?(\s|$)/, async (msg) => {
  sendHtml(msg.chat.id, "Fetching trending tokens...");

  try {
    const boosted = await fetchBoostedTokens();
    if (!boosted.length) return sendHtml(msg.chat.id, "No trending tokens found right now.");

    const seen = {};
    for (const item of boosted) {
      const key = `${item.chainId}:${item.tokenAddress}`;
      if (!seen[key]) {
        seen[key] = {
          chain: item.chainId || "?",
          address: item.tokenAddress || "",
          totalBoosts: item.amount || 1,
        };
      } else {
        seen[key].totalBoosts += item.amount || 1;
      }
    }

    const sorted = Object.values(seen)
      .sort((a, b) => b.totalBoosts - a.totalBoosts)
      .slice(0, 8);

    let text = `🔥 <b>Trending / Boosted Tokens</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];
      const token = await fetchFullPairData(item.address);

      if (token) {
        text +=
          `<b>${i + 1}. ${esc(token.symbol)}</b> ${chainBadge(token.chain)}\n` +
          `├ Price: <code>${fmtPrice(token.price)}</code> | 1h: ${fmtPct(token.priceChange1h)} | 24h: ${fmtPct(token.priceChange24h)}\n` +
          `├ Vol: ${fmtUsd(token.volume24h)} | Liq: ${fmtUsd(token.liquidity)}\n` +
          `├ 🚀 Boosts: ${item.totalBoosts}\n` +
          `└ <code>${shortAddr(token.address)}</code>\n\n`;
      } else {
        text +=
          `<b>${i + 1}.</b> ${esc(item.chain)} | <code>${shortAddr(item.address)}</code>\n` +
          `└ 🚀 Boosts: ${item.totalBoosts} (no pair data)\n\n`;
      }
    }

    text += `🕐 ${utcNow()}`;
    sendHtml(msg.chat.id, text);
  } catch (e) {
    sendHtml(msg.chat.id, `❌ Error: ${esc(e.message)}`);
  }
});

// ── /newpairs — Fresh launches ─────────────────────────────────────

bot.onText(/\/newpairs(?:@\w+)?(\s|$)/, async (msg) => {
  sendHtml(msg.chat.id, "Scanning for new pairs (&lt;24h old)...");

  try {
    const profiles = await fetchTokenProfiles();
    if (!profiles.length) return sendHtml(msg.chat.id, "Could not fetch new token data.");

    const now = Date.now();
    const results = [];

    for (let i = 0; i < Math.min(profiles.length, 20); i++) {
      const p = profiles[i];
      if (!p.tokenAddress) continue;

      const token = await fetchFullPairData(p.tokenAddress);
      if (!token || !token.pairCreatedAt) continue;

      const ageMs = now - token.pairCreatedAt.getTime();
      const ageHours = ageMs / (1000 * 60 * 60);

      if (ageHours <= 24 && token.liquidity >= 1000) {
        results.push({ ...token, ageHours });
      }
      if (results.length >= 8) break;
    }

    if (!results.length) return sendHtml(msg.chat.id, "No new pairs found with &gt;$1K liquidity in the last 24h.");

    results.sort((a, b) => b.liquidity - a.liquidity);

    let text = `🆕 <b>New Pairs (&lt;24h old)</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (let i = 0; i < results.length; i++) {
      const t = results[i];
      const ageLabel = t.ageHours < 1
        ? `${Math.round(t.ageHours * 60)}m ago`
        : `${t.ageHours.toFixed(1)}h ago`;

      const total5m = t.buys5m + t.sells5m;
      const bp5m = total5m > 0 ? (t.buys5m / total5m * 100).toFixed(0) : "50";

      text +=
        `<b>${i + 1}. ${esc(t.symbol)}</b> ${chainBadge(t.chain)}\n` +
        `├ 🕐 Launched: ${ageLabel}\n` +
        `├ 💰 Price: <code>${fmtPrice(t.price)}</code> | 5m: ${fmtPct(t.priceChange5m)}\n` +
        `├ 💧 Liq: ${fmtUsd(t.liquidity)} | Vol: ${fmtUsd(t.volume24h)}\n` +
        `├ 📊 Buy pressure 5m: ${bp5m}%\n` +
        `└ <code>${shortAddr(t.address)}</code>\n\n`;
    }

    text += `⚠️ <i>New tokens are extremely high risk. DYOR.</i>\n🕐 ${utcNow()}`;
    sendHtml(msg.chat.id, text);
  } catch (e) {
    sendHtml(msg.chat.id, `❌ Error: ${esc(e.message)}`);
  }
});

// ── /rug — Rug-pull risk check ─────────────────────────────────────

bot.onText(/\/rug(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
  const query = (match && match[1]) ? match[1].trim() : "";
  if (!query) return sendHtml(msg.chat.id, "Usage: <code>/rug &lt;token&gt;</code>\nExample: <code>/rug PEPE</code>");

  sendHtml(msg.chat.id, `Checking rug risk for: ${esc(query)}...`);

  try {
    const token = await resolveToken(query);
    if (!token) return sendHtml(msg.chat.id, `Could not find token: ${esc(query)}`);

    const risks = [];
    const warnings = [];
    let riskScore = 0;

    // Liquidity
    if (token.liquidity < 1000) { risks.push("🚨 Extremely low liquidity (&lt;$1K)"); riskScore += 35; }
    else if (token.liquidity < 5000) { risks.push("🚨 Very low liquidity (&lt;$5K)"); riskScore += 25; }
    else if (token.liquidity < 10000) { warnings.push("⚠️ Low liquidity (&lt;$10K)"); riskScore += 15; }
    else if (token.liquidity < 50000) { warnings.push("⚠️ Moderate liquidity (&lt;$50K)"); riskScore += 5; }

    // Age
    if (token.pairCreatedAt) {
      const ageH = (Date.now() - token.pairCreatedAt.getTime()) / 3600000;
      if (ageH < 1) { risks.push("🚨 Token less than 1 hour old"); riskScore += 25; }
      else if (ageH < 6) { risks.push("🚨 Token less than 6 hours old"); riskScore += 20; }
      else if (ageH < 24) { warnings.push("⚠️ Token less than 24 hours old"); riskScore += 10; }
      else if (ageH < 72) { warnings.push("⚠️ Token less than 3 days old"); riskScore += 5; }
    } else {
      warnings.push("⚠️ Unknown pair creation date"); riskScore += 10;
    }

    // Vol/liq ratio
    if (token.liquidity > 0 && token.volume24h > token.liquidity * 10) {
      warnings.push("⚠️ Volume/liquidity ratio very high (possible wash trading)"); riskScore += 15;
    }

    // Sell pressure
    const total24h = token.buys24h + token.sells24h;
    const sellPct = total24h > 0 ? (token.sells24h / total24h * 100) : 50;
    if (sellPct > 65) { risks.push(`🚨 Heavy sell pressure: ${sellPct.toFixed(0)}% sells in 24h`); riskScore += 15; }
    else if (sellPct > 55) { warnings.push(`⚠️ Sell-side dominant: ${sellPct.toFixed(0)}% sells in 24h`); riskScore += 5; }

    // Price dump
    if (token.priceChange24h < -50) { risks.push(`🚨 Price crashed ${fmtPct(token.priceChange24h)} in 24h`); riskScore += 20; }
    else if (token.priceChange24h < -30) { warnings.push(`⚠️ Major price drop ${fmtPct(token.priceChange24h)} in 24h`); riskScore += 10; }

    // Mcap/liq ratio
    if (token.marketCap > 0 && token.liquidity > 0) {
      const ratio = token.liquidity / token.marketCap;
      if (ratio < 0.02) { risks.push("🚨 Liquidity &lt;2% of market cap — easy to rug"); riskScore += 20; }
      else if (ratio < 0.05) { warnings.push("⚠️ Liquidity &lt;5% of market cap"); riskScore += 10; }
    }

    riskScore = Math.min(riskScore, 100);

    let riskLevel, riskEmoji;
    if (riskScore >= 60) { riskLevel = "EXTREME"; riskEmoji = "🔴"; }
    else if (riskScore >= 40) { riskLevel = "HIGH"; riskEmoji = "🟠"; }
    else if (riskScore >= 20) { riskLevel = "MODERATE"; riskEmoji = "🟡"; }
    else { riskLevel = "LOW"; riskEmoji = "🟢"; }

    let ageLabel = "Unknown";
    if (token.pairCreatedAt) {
      const ageH = (Date.now() - token.pairCreatedAt.getTime()) / 3600000;
      if (ageH < 1) ageLabel = `${Math.round(ageH * 60)} minutes`;
      else if (ageH < 24) ageLabel = `${ageH.toFixed(1)} hours`;
      else ageLabel = `${(ageH / 24).toFixed(1)} days`;
    }

    let text =
      `🔍 <b>Rug Check: ${esc(token.symbol)}</b> ${riskEmoji} ${chainBadge(token.chain)}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<b>Risk Score: ${riskScore}/100 — ${riskLevel}</b>\n\n` +
      `<b>Token Info:</b>\n` +
      `├ Name: ${esc(token.name)}\n` +
      `├ Chain: ${esc(token.chain)}\n` +
      `├ DEX: ${esc(token.dex)}\n` +
      `├ Age: ${ageLabel}\n` +
      `├ Price: <code>${fmtPrice(token.price)}</code>\n` +
      `├ Liq: ${fmtUsd(token.liquidity)}\n` +
      `├ MCap: ${fmtUsd(token.marketCap)}\n` +
      `├ Vol 24h: ${fmtUsd(token.volume24h)}\n` +
      `└ 24h: ${fmtPct(token.priceChange24h)}\n`;

    if (risks.length) {
      text += `\n<b>Red Flags:</b>\n`;
      for (const r of risks) text += `${r}\n`;
    }
    if (warnings.length) {
      text += `\n<b>Warnings:</b>\n`;
      for (const w of warnings) text += `${w}\n`;
    }
    if (!risks.length && !warnings.length) {
      text += `\n✅ No major red flags detected\n`;
    }

    text += `\n⚠️ <i>Automated analysis only. Always DYOR.</i>\n📍 <code>${shortAddr(token.address)}</code>\n🕐 ${utcNow()}`;
    sendHtml(msg.chat.id, text, addressButtons(token.address, token.chain));
  } catch (e) {
    sendHtml(msg.chat.id, `❌ Error: ${esc(e.message)}`);
  }
});

// ── /sniper — Sniper bot detection ─────────────────────────────────

bot.onText(/\/sniper(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
  const query = (match && match[1]) ? match[1].trim() : "";
  if (!query) {
    return sendHtml(msg.chat.id,
      "Usage: <code>/sniper &lt;token&gt;</code>\n" +
      "Example: <code>/sniper 0xf4BC00...</code>\n\n" +
      "<i>Detects wallets that bought in the first blocks after liquidity was added. EVM chains only.</i>"
    );
  }

  sendHtml(msg.chat.id, `🔫 Scanning for snipers on: ${esc(query)}...`);

  try {
    const token = await resolveToken(query);
    if (!token) return sendHtml(msg.chat.id, `Could not find token: ${esc(query)}`);

    const evmChains = ["ethereum", "bsc", "arbitrum", "polygon", "base", "optimism", "avalanche"];
    if (!evmChains.includes(token.chain)) {
      return sendHtml(msg.chat.id,
        `Sniper detection supports EVM chains only.\n${esc(token.symbol)} is on ${esc(token.chain)}.`
      );
    }

    const data = await fetchSnipers(token.address, token.chain);

    if (data.error) return sendHtml(msg.chat.id, `Error: ${esc(data.error)}`);

    if (!data.snipers.length) {
      return sendHtml(msg.chat.id,
        `🔫 <b>Sniper Check: ${esc(token.symbol)}</b>\n\n` +
        `Pair: ${esc(data.pairLabel)} (${esc(data.exchange)})\n\n` +
        `✅ No snipers detected on this pair.`
      );
    }

    const snipers = data.snipers;
    const totalSnipers = snipers.length;

    const stillHolding = snipers.filter((s) => s.currentBalance > 0);
    const soldAll = snipers.filter((s) => s.currentBalance === 0);
    const profitable = snipers.filter((s) => s.realizedProfitUsd > 0);
    const totalSnipedUsd = snipers.reduce((sum, s) => sum + (s.totalSnipedUsd || 0), 0);
    const totalSoldUsd = snipers.reduce((sum, s) => sum + (s.totalSoldUsd || 0), 0);
    const totalRealizedProfit = snipers.reduce((sum, s) => sum + (s.realizedProfitUsd || 0), 0);
    const totalUnrealizedProfit = snipers.reduce((sum, s) => sum + (s.unrealizedProfitUsd || 0), 0);

    const block0 = snipers.filter((s) =>
      s.snipedTransactions?.some((tx) => tx.blocksAfterCreation === 0)
    );
    const block1 = snipers.filter((s) =>
      s.snipedTransactions?.some((tx) => tx.blocksAfterCreation === 1)
    );

    let creationInfo = "";
    if (data.blockTimestamp) {
      const created = new Date(data.blockTimestamp);
      const ageH = (Date.now() - created.getTime()) / 3600000;
      const ageLabel = ageH < 1 ? `${Math.round(ageH * 60)}m ago` : ageH < 24 ? `${ageH.toFixed(1)}h ago` : `${(ageH / 24).toFixed(1)}d ago`;
      creationInfo = `Pair created: ${created.toISOString().slice(0, 16)} UTC (${ageLabel})`;
    }

    let text =
      `🔫 <b>Sniper Analysis: ${esc(token.symbol)}</b> ${chainBadge(token.chain)}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<b>Pair:</b> ${esc(data.pairLabel)} (${esc(data.exchange)})\n` +
      (creationInfo ? `<b>${creationInfo}</b>\n` : "") +
      `\n<b>Overview:</b>\n` +
      `├ Total snipers: ${totalSnipers}\n` +
      `├ Same-block (block 0): ${block0.length} 🚨\n` +
      `├ Block 1: ${block1.length}\n` +
      `├ Still holding: ${stillHolding.length}\n` +
      `├ Sold everything: ${soldAll.length}\n` +
      `└ Profitable: ${profitable.length}/${totalSnipers}\n\n` +
      `<b>Money Flow:</b>\n` +
      `├ Total sniped: ${fmtUsd(totalSnipedUsd)}\n` +
      `├ Total sold: ${fmtUsd(totalSoldUsd)}\n` +
      `├ Realized P/L: ${totalRealizedProfit >= 0 ? "+" : ""}${fmtUsd(totalRealizedProfit)}\n` +
      `└ Unrealized P/L: ${totalUnrealizedProfit >= 0 ? "+" : ""}${fmtUsd(totalUnrealizedProfit)}\n`;

    const topSnipers = [...snipers]
      .sort((a, b) => (b.totalSnipedUsd || 0) - (a.totalSnipedUsd || 0))
      .slice(0, 5);

    text += `\n<b>Top Snipers:</b>\n`;

    for (let i = 0; i < topSnipers.length; i++) {
      const s = topSnipers[i];
      const addr = s.walletAddress;

      const earliestBlock = (s.snipedTransactions && s.snipedTransactions.length > 0)
        ? Math.min(...s.snipedTransactions.map((tx) => tx.blocksAfterCreation))
        : "?";

      const holdingStatus = s.currentBalance > 0
        ? `holding ${fmtUsd(s.currentBalanceUsdValue || 0)}`
        : "SOLD ALL";

      const pnl = s.realizedProfitUsd !== 0
        ? `P/L: ${s.realizedProfitUsd >= 0 ? "+" : ""}${fmtUsd(s.realizedProfitUsd)} (${(s.realizedProfitPercentage || 0) >= 0 ? "+" : ""}${(s.realizedProfitPercentage || 0).toFixed(0)}%)`
        : s.unrealizedProfitUsd !== 0
          ? `Unrealized: ${s.unrealizedProfitUsd >= 0 ? "+" : ""}${fmtUsd(s.unrealizedProfitUsd)}`
          : "No P/L yet";

      const blockEmoji = earliestBlock === 0 ? "🚨" : earliestBlock <= 2 ? "⚠️" : "📍";

      text +=
        `\n${blockEmoji} <b>${i + 1}. ${shortAddr(addr)}</b>\n` +
        `├ Entry: block +${earliestBlock} | Sniped: ${fmtUsd(s.totalSnipedUsd || 0)}\n` +
        `├ ${holdingStatus}\n` +
        `└ ${pnl}\n`;
    }

    // Risk assessment
    const soldAllPct = totalSnipers > 0 ? (soldAll.length / totalSnipers * 100) : 0;
    let riskLevel, riskEmoji;
    if (block0.length >= 3 && soldAllPct > 60) { riskLevel = "HIGH — Multiple same-block snipers + most dumped"; riskEmoji = "🔴"; }
    else if (block0.length >= 2 || (totalSnipers >= 5 && soldAllPct > 50)) { riskLevel = "MODERATE — Sniper activity detected"; riskEmoji = "🟠"; }
    else if (totalSnipers >= 1) { riskLevel = "LOW — Minor sniper activity"; riskEmoji = "🟡"; }
    else { riskLevel = "NONE"; riskEmoji = "🟢"; }

    text +=
      `\n${riskEmoji} <b>Sniper Risk: ${riskLevel}</b>\n\n` +
      `⚠️ <i>Same-block buyers (block 0) are most likely bots or insiders.</i>\n` +
      `📍 <code>${shortAddr(token.address)}</code>\n` +
      `🕐 ${utcNow()}`;

    sendHtml(msg.chat.id, text, addressButtons(token.address, token.chain));
  } catch (e) {
    sendHtml(msg.chat.id, `❌ Error: ${esc(e.message)}`);
  }
});

// ── /holders — Holder distribution analysis ────────────────────────

bot.onText(/\/holders(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
  const query = (match && match[1]) ? match[1].trim() : "";
  if (!query) {
    return sendHtml(msg.chat.id,
      "Usage: <code>/holders &lt;token&gt;</code>\n" +
      "Example: <code>/holders PEPE</code>\n\n" +
      "<i>Top holders, concentration risk, whale vs retail breakdown. EVM &amp; Solana.</i>"
    );
  }

  sendHtml(msg.chat.id, `📊 Analyzing holders for: ${esc(query)}...`);

  try {
    const token = await resolveToken(query);
    if (!token) return sendHtml(msg.chat.id, `Could not find token: ${esc(query)}`);

    const evmChains = ["ethereum", "bsc", "arbitrum", "polygon", "base", "optimism", "avalanche"];
    const isSolana = token.chain === "solana";

    if (!isSolana && !evmChains.includes(token.chain)) {
      return sendHtml(msg.chat.id,
        `Holder analysis supports EVM &amp; Solana only.\n${esc(token.symbol)} is on ${esc(token.chain)}.`
      );
    }

    // ── Solana path ──
    if (isSolana) {
      const [heliusRes, supplyRes, sol] = await Promise.all([
        fetchHeliusTopHolders(token.address),
        fetchHeliusTokenSupply(token.address),
        fetchSolanaHolders(token.address),
      ]);

      const wallets = heliusRes?.result?.value || [];
      const totalSupplyRaw = parseFloat(supplyRes?.result?.value?.uiAmountString) || 0;

      if (!wallets.length) return sendHtml(msg.chat.id, `No holder data found for ${esc(token.symbol)} on Solana.`);

      const total = sol?.totalHolders || 0;
      const dist = sol?.holderDistribution || {};
      const acq = sol?.holdersByAcquisition || {};
      const change = sol?.holderChange || {};

      const holdersWithPct = wallets.map((w) => {
        const amount = parseFloat(w.uiAmountString || "0") || 0;
        const pct = totalSupplyRaw > 0 ? (amount / totalSupplyRaw) * 100 : 0;
        return { address: w.address, amount, pct };
      }).sort((a, b) => b.pct - a.pct);

      function tierEmoji(pct) {
        if (pct >= 10) return "🐋";
        if (pct >= 5) return "🦈";
        if (pct >= 1) return "🐬";
        if (pct >= 0.1) return "🐠";
        return "🦐";
      }

      let riskScore = 0;
      const risks = [];
      const positives = [];

      const top1pct = holdersWithPct[0]?.pct || 0;
      const top5pct = holdersWithPct.slice(0, 5).reduce((s, h) => s + h.pct, 0);
      const top10pct = holdersWithPct.slice(0, 10).reduce((s, h) => s + h.pct, 0);

      if (top1pct > 50) { risks.push(`🚨 #1 wallet holds ${top1pct.toFixed(1)}% — extreme dominance`); riskScore += 35; }
      else if (top1pct > 20) { risks.push(`⚠️ #1 wallet holds ${top1pct.toFixed(1)}%`); riskScore += 20; }
      else if (top1pct > 10) { risks.push(`⚠️ #1 wallet holds ${top1pct.toFixed(1)}%`); riskScore += 10; }

      if (top5pct > 50) { risks.push(`🚨 Top 5 hold ${top5pct.toFixed(1)}% — heavy concentration`); riskScore += 25; }
      else if (top5pct > 30) { risks.push(`⚠️ Top 5 hold ${top5pct.toFixed(1)}%`); riskScore += 10; }
      else { positives.push(`✅ Top 5 hold only ${top5pct.toFixed(1)}% — well distributed`); }

      const whaleWallets = holdersWithPct.filter((h) => h.pct >= 5);
      if (whaleWallets.length >= 3 && top10pct > 40) {
        risks.push(`⚠️ ${whaleWallets.length} whale wallets (&gt;5% each) — dump risk`); riskScore += 15;
      }

      if (total > 0 && total < 100) { risks.push(`🚨 Only ${total} total holders — very thin`); riskScore += 20; }
      else if (total > 10000) { positives.push(`✅ ${total.toLocaleString()} total holders — strong community`); }
      else if (total > 1000) { positives.push(`✅ ${total.toLocaleString()} holders`); }

      const h24 = change["24h"] || {};
      if (h24.change && h24.change < 0) { risks.push(`⚠️ Lost ${Math.abs(h24.change)} holders in 24h`); riskScore += 10; }
      else if (h24.change && h24.change > 0) { positives.push(`✅ +${h24.change} holders in 24h`); }

      const totalAcq = (acq.swap || 0) + (acq.transfer || 0) + (acq.airdrop || 0);
      if (totalAcq > 0 && acq.airdrop > 0) {
        const airdropPct = (acq.airdrop / totalAcq) * 100;
        if (airdropPct > 30) { risks.push(`⚠️ ${airdropPct.toFixed(0)}% from airdrops — possible wash`); riskScore += 10; }
      }

      riskScore = Math.min(riskScore, 100);

      let riskLevel, riskEmoji;
      if (riskScore >= 50) { riskLevel = "HIGH"; riskEmoji = "🔴"; }
      else if (riskScore >= 25) { riskLevel = "MODERATE"; riskEmoji = "🟠"; }
      else if (riskScore >= 10) { riskLevel = "LOW"; riskEmoji = "🟡"; }
      else { riskLevel = "HEALTHY"; riskEmoji = "🟢"; }

      let text =
        `👥 <b>Top Wallets: ${esc(token.symbol)}</b> ${riskEmoji} ${chainBadge(token.chain)}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      const display = holdersWithPct.slice(0, 10);
      for (let i = 0; i < display.length; i++) {
        const h = display[i];
        text += `<b>#${i + 1}</b> [${h.pct.toFixed(1)}%] ${tierEmoji(h.pct)}\n<code>${h.address}</code>\n`;
      }

      text += `\n<b>Concentration:</b>\n` +
        `├ Top 5: ${top5pct.toFixed(1)}%\n` +
        `├ Top 10: ${top10pct.toFixed(1)}%\n` +
        `└ Top 20: ${holdersWithPct.slice(0, 20).reduce((s, h) => s + h.pct, 0).toFixed(1)}%\n`;

      if (total > 0) {
        text += `\n<b>Total Holders:</b> ${total.toLocaleString()}\n`;

        const tierList = [
          ["🐋", dist.whales], ["🦈", dist.sharks], ["🐬", dist.dolphins],
          ["🐠", dist.fish], ["🐙", dist.octopus], ["🦀", dist.crabs], ["🦐", dist.shrimps],
        ].filter(([, c]) => c > 0);
        if (tierList.length) {
          text += tierList.map(([e, c]) => `${e}${c}`).join(" · ") + "\n";
        }

        if (totalAcq > 0) {
          text += `\n<b>Acquired via:</b> 🔄 ${(acq.swap || 0).toLocaleString()} swap · 📤 ${(acq.transfer || 0).toLocaleString()} transfer · 🎁 ${(acq.airdrop || 0).toLocaleString()} airdrop\n`;
        }

        const intervals = ["1h", "6h", "24h", "7d", "30d"];
        const trendParts = [];
        for (const iv of intervals) {
          const c = change[iv];
          if (c && c.change !== undefined && c.change !== null) {
            trendParts.push(`${iv}: ${c.change >= 0 ? "+" : ""}${c.change}`);
          }
        }
        if (trendParts.length) text += `\n<b>Trend:</b> ${trendParts.join(" | ")}\n`;
      }

      if (risks.length || positives.length) {
        text += `\n<b>Signals:</b>\n`;
        for (const r of risks) text += `${r}\n`;
        for (const p of positives) text += `${p}\n`;
      }

      text += `\n${riskEmoji} <b>Holder Risk: ${riskLevel}</b> (${riskScore}/100)\n🕐 ${utcNow()}`;
      return sendHtml(msg.chat.id, text, addressButtons(token.address, token.chain));
    }

    // ── EVM path ──
    const data = await fetchHolders(token.address, token.chain);

    if (data.error) return sendHtml(msg.chat.id, `Error: ${esc(data.error)}`);
    if (!data.holders.length) return sendHtml(msg.chat.id, `No holder data found for ${esc(token.symbol)}.`);

    const holders = data.holders;

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

    const top5pct = realHolders.slice(0, 5).reduce((s, h) => s + (h.percentage_relative_to_total_supply || 0), 0);
    const top10pct = realHolders.slice(0, 10).reduce((s, h) => s + (h.percentage_relative_to_total_supply || 0), 0);
    const top20pct = realHolders.slice(0, 20).reduce((s, h) => s + (h.percentage_relative_to_total_supply || 0), 0);
    const infraPct = infraHolders.reduce((s, h) => s + (h.percentage_relative_to_total_supply || 0), 0);

    const whales = realHolders.filter((h) => (h.percentage_relative_to_total_supply || 0) >= 1);
    const midBags = realHolders.filter((h) => {
      const pct = h.percentage_relative_to_total_supply || 0;
      return pct >= 0.1 && pct < 1;
    });
    const smallBags = realHolders.filter((h) => (h.percentage_relative_to_total_supply || 0) < 0.1);

    let riskScore = 0;
    const risks = [];
    const positives = [];

    if (realHolders[0] && realHolders[0].percentage_relative_to_total_supply > 10) {
      risks.push(`🚨 Top holder owns ${realHolders[0].percentage_relative_to_total_supply.toFixed(1)}%`); riskScore += 30;
    } else if (realHolders[0] && realHolders[0].percentage_relative_to_total_supply > 5) {
      risks.push(`⚠️ Top holder owns ${realHolders[0].percentage_relative_to_total_supply.toFixed(1)}%`); riskScore += 15;
    }

    if (top5pct > 30) { risks.push(`🚨 Top 5 wallets hold ${top5pct.toFixed(1)}% — heavy concentration`); riskScore += 25; }
    else if (top5pct > 15) { risks.push(`⚠️ Top 5 wallets hold ${top5pct.toFixed(1)}%`); riskScore += 10; }
    else { positives.push(`✅ Top 5 wallets hold only ${top5pct.toFixed(1)}%`); }

    if (whales.length >= 5 && top10pct > 25) {
      risks.push(`⚠️ ${whales.length} whales (&gt;1% each) — coordinated dump risk`); riskScore += 15;
    }

    if (realHolders.length < 10) { risks.push(`🚨 Only ${realHolders.length} non-infra holders in top 50`); riskScore += 20; }
    else if (realHolders.length > 30) { positives.push(`✅ ${realHolders.length} unique wallets in top 50`); }

    const exchanges = infraHolders.filter((h) => {
      const label = (h.owner_address_label || "").toLowerCase();
      return ["binance", "coinbase", "kraken", "okx", "bybit", "kucoin", "bithumb", "upbit", "bitfinex", "gemini"].some((ex) => label.includes(ex));
    });
    if (exchanges.length >= 3) positives.push(`✅ Listed on ${exchanges.length} major exchanges`);
    else if (exchanges.length >= 1) positives.push(`✅ On ${exchanges.length} exchange(s)`);

    riskScore = Math.min(riskScore, 100);

    let riskLevel, riskEmoji;
    if (riskScore >= 50) { riskLevel = "HIGH"; riskEmoji = "🔴"; }
    else if (riskScore >= 25) { riskLevel = "MODERATE"; riskEmoji = "🟠"; }
    else if (riskScore >= 10) { riskLevel = "LOW"; riskEmoji = "🟡"; }
    else { riskLevel = "HEALTHY"; riskEmoji = "🟢"; }

    let text =
      `👥 <b>${esc(token.symbol)} Holder Analysis</b> ${riskEmoji} ${chainBadge(token.chain)}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<b>Concentration:</b>\n` +
      `├ Top 1: ${realHolders[0] ? realHolders[0].percentage_relative_to_total_supply.toFixed(2) + "%" : "N/A"}\n` +
      `├ Top 5: ${top5pct.toFixed(2)}%\n` +
      `├ Top 10: ${top10pct.toFixed(2)}%\n` +
      `└ Top 20: ${top20pct.toFixed(2)}%\n\n` +
      `<b>Distribution:</b>\n` +
      `├ 🐋 Whales (&gt;1%): ${whales.length}\n` +
      `├ 💼 Mid bags (0.1-1%): ${midBags.length}\n` +
      `├ 🐟 Small bags (&lt;0.1%): ${smallBags.length}\n` +
      `└ 🏛 Infrastructure: ${infraHolders.length} (${infraPct.toFixed(1)}%)\n\n` +
      `<b>Top 10 Holders:</b>\n`;

    const displayHolders = holders.slice(0, 10);
    for (let i = 0; i < displayHolders.length; i++) {
      const h = displayHolders[i];
      const pct = (h.percentage_relative_to_total_supply || 0).toFixed(2);
      const usd = parseFloat(h.usd_value) || 0;
      const label = h.owner_address_label || "";
      const tag = h.is_contract ? " [contract]" : label ? ` [${esc(label)}]` : "";

      text += `<b>${i + 1}.</b> ${pct}% — ${fmtUsd(usd)}${tag}\n<code>${h.owner_address}</code>\n`;
    }

    if (exchanges.length > 0) {
      text += `\n<b>Exchange Presence:</b>\n`;
      for (const ex of exchanges.slice(0, 5)) {
        const pct = (ex.percentage_relative_to_total_supply || 0).toFixed(2);
        text += `├ ${esc(ex.owner_address_label)}: ${pct}%\n`;
      }
    }

    if (risks.length || positives.length) {
      text += `\n<b>Signals:</b>\n`;
      for (const r of risks) text += `${r}\n`;
      for (const p of positives) text += `${p}\n`;
    }

    text += `\n${riskEmoji} <b>Holder Risk: ${riskLevel}</b> (${riskScore}/100)\n🕐 ${utcNow()}`;
    sendHtml(msg.chat.id, text, addressButtons(token.address, token.chain));
  } catch (e) {
    sendHtml(msg.chat.id, `❌ Error: ${esc(e.message)}`);
  }
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
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed === null || parsed === undefined) return fallback;
    return parsed;
  } catch { return fallback; }
}
function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Wallet (owner-only access) ────────────────────────────────────
let walletState = loadJson(WALLET_FILE, null);
if (!walletState || !walletState.publicKey || !walletState.secretKey) {
  const kp = Keypair.generate();
  walletState = {
    publicKey: kp.publicKey.toBase58(),
    secretKey: bs58.encode(kp.secretKey),
    slippageBps: 500,
  };
  saveJson(WALLET_FILE, walletState);
  console.log(`New wallet generated: ${walletState.publicKey}`);
}
function getKeypair() {
  return Keypair.fromSecretKey(bs58.decode(walletState.secretKey));
}

// ── Jupiter price + quote + swap ──────────────────────────────────
async function jupPrice(mints) {
  const ids = Array.isArray(mints) ? mints.join(",") : mints;
  const r = await httpGet(`https://lite-api.jup.ag/price/v2?ids=${ids}`);
  return r?.data || {};
}

async function jupQuote(inputMint, outputMint, amount, slippageBps) {
  const url = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&onlyDirectRoutes=false`;
  return await httpGet(url);
}

async function jupSwap(quoteResponse, userPublicKey) {
  const body = JSON.stringify({
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: "auto",
  });
  return await httpPost("https://quote-api.jup.ag/v6/swap", body);
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
  // Confirm transaction actually landed
  const confirmation = await connection.confirmTransaction(sig, "confirmed");
  if (confirmation.value?.err) {
    throw new Error(`Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
  }
  return sig;
}

// ── Token metadata via Helius ─────────────────────────────────────
const tokenMetaCache = {};
const TOKEN_META_CACHE_TTL = 3600000; // 1 hour

async function getTokenMeta(mint) {
  const cached = tokenMetaCache[mint];
  if (cached && Date.now() - cached.ts < TOKEN_META_CACHE_TTL) return cached.data;

  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "getAsset", params: { id: mint },
  });
  const res = await httpPost(HELIUS_RPC, body);
  const r = res?.result;
  const meta = {
    symbol: r?.content?.metadata?.symbol || r?.token_info?.symbol || "?",
    name: r?.content?.metadata?.name || "?",
    decimals: r?.token_info?.decimals,
  };
  // Only cache if we got real decimals back
  if (meta.decimals !== undefined && meta.decimals !== null) {
    tokenMetaCache[mint] = { data: meta, ts: Date.now() };
  } else {
    meta.decimals = 9; // fallback but don't cache it
  }
  return meta;
}

// ── Balance helpers ───────────────────────────────────────────────
async function getSolBalance() {
  const lamports = await connection.getBalance(new PublicKey(walletState.publicKey));
  return lamports / LAMPORTS_PER_SOL;
}

async function getTokenAccounts() {
  // Check both classic SPL Token and Token-2022 programs
  const programs = [
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  ];

  let allAccts = [];
  for (const programId of programs) {
    const body = JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
      params: [walletState.publicKey, { programId }, { encoding: "jsonParsed" }],
    });
    const res = await httpPost(HELIUS_RPC, body);
    const accts = res?.result?.value || [];
    allAccts = allAccts.concat(accts);
  }

  return allAccts
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

// ── Validation ────────────────────────────────────────────────────
function isValidMint(s) {
  try {
    const k = new PublicKey(s);
    return k.toBase58() === s && s.length >= 32;
  } catch { return false; }
}

// ── Trades store ──────────────────────────────────────────────────
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

// ── Format helpers (wallet section) ───────────────────────────────
function fmtNum(n, d = 4) {
  if (n === null || n === undefined || isNaN(n)) return "?";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return Number(n).toFixed(d);
}

// ════════════════════════════════════════════════════════════════════
// COMMANDS — WALLET (owner only)
// ════════════════════════════════════════════════════════════════════

bot.onText(/\/wallet(@\w+)?(\s|$)/, async (msg) => {
  if (!ownerGuard(msg)) return;
  try {
    const sol = await getSolBalance();
    const accts = await getTokenAccounts();
    const usdc = accts.find((a) => a.mint === USDC_MINT);
    const prices = await jupPrice([SOL_MINT]);
    const solPrice = parseFloat(prices[SOL_MINT]?.price || 0);
    sendHtml(msg.chat.id,
      `💼 <b>Your Wallet</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<code>${walletState.publicKey}</code>\n\n` +
      `<b>SOL:</b> ${sol.toFixed(4)}  ($${(sol * solPrice).toFixed(2)})\n` +
      `<b>USDC:</b> ${(usdc?.amount || 0).toFixed(2)}\n\n` +
      `Send SOL or USDC to the address above to fund.\n` +
      `Slippage: ${walletState.slippageBps} bps`,
      walletButtons(walletState.publicKey)
    );
  } catch (e) {
    sendHtml(msg.chat.id, `❌ Error: ${esc(e.message)}`);
  }
});

bot.onText(/\/balance(@\w+)?(\s|$)/, async (msg) => {
  if (!ownerGuard(msg)) return;
  try {
    const sol = await getSolBalance();
    const accts = await getTokenAccounts();
    const mints = [SOL_MINT, ...accts.map((a) => a.mint)];
    const prices = await jupPrice(mints);
    const solPrice = parseFloat(prices[SOL_MINT]?.price || 0);
    let totalUsd = sol * solPrice;
    let lines = [`💰 <b>Portfolio</b>`, `━━━━━━━━━━━━━━━━━━━━`, `<b>SOL</b> ${sol.toFixed(4)} · $${(sol * solPrice).toFixed(2)}`];
    for (const a of accts) {
      const meta = await getTokenMeta(a.mint);
      const px = parseFloat(prices[a.mint]?.price || 0);
      const usd = a.amount * px;
      totalUsd += usd;
      lines.push(`<b>${esc(meta.symbol)}</b> ${fmtNum(a.amount)} · $${usd.toFixed(2)}\n  <code>${a.mint}</code>`);
    }
    lines.push(`━━━━━━━━━━━━━━━━━━━━`, `<b>Total:</b> $${totalUsd.toFixed(2)}`);
    sendHtml(msg.chat.id, lines.join("\n"));
  } catch (e) {
    sendHtml(msg.chat.id, `❌ Error: ${esc(e.message)}`);
  }
});

bot.onText(/\/positions(@\w+)?(\s|$)/, async (msg) => {
  if (!ownerGuard(msg)) return;
  try {
    const accts = await getTokenAccounts();
    if (!accts.length) return sendHtml(msg.chat.id, "No positions.");
    const mints = accts.map((a) => a.mint).concat(SOL_MINT);
    const prices = await jupPrice(mints);
    const solPrice = parseFloat(prices[SOL_MINT]?.price || 0);
    let lines = [`📈 <b>Positions</b>`, `━━━━━━━━━━━━━━━━━━━━`];
    for (const a of accts) {
      const meta = await getTokenMeta(a.mint);
      const px = parseFloat(prices[a.mint]?.price || 0);
      const entry = avgEntryFor(a.mint);
      const curUsd = a.amount * px;
      let pnlStr = "<i>no entry data</i>";
      if (entry) {
        const costUsd = entry.solSpent * solPrice;
        if (costUsd > 0) {
          const pnlPct = ((curUsd - costUsd) / costUsd) * 100;
          const arrow = pnlPct >= 0 ? "🟢" : "🔴";
          pnlStr = `${arrow} ${pnlPct.toFixed(1)}% (cost $${costUsd.toFixed(2)} → $${curUsd.toFixed(2)})`;
        }
      }
      lines.push(`<b>${esc(meta.symbol)}</b> ${fmtNum(a.amount)}\n  <code>${a.mint}</code>\n  ${pnlStr}`);
    }
    sendHtml(msg.chat.id, lines.join("\n\n"));
  } catch (e) {
    sendHtml(msg.chat.id, `❌ Error: ${esc(e.message)}`);
  }
});

bot.onText(/\/slippage(?:@\w+)?(?:\s+(\d+))?/, (msg, match) => {
  if (!ownerGuard(msg)) return;
  const bps = match && match[1] ? parseInt(match[1]) : null;
  if (bps === null || bps < 1 || bps > 5000) {
    return sendHtml(msg.chat.id, `Current slippage: ${walletState.slippageBps} bps\nUsage: /slippage 500 (= 5%)`);
  }
  walletState.slippageBps = bps;
  saveJson(WALLET_FILE, walletState);
  sendHtml(msg.chat.id, `✅ Slippage set to ${bps} bps (${(bps / 100).toFixed(2)}%)`);
});

bot.onText(/\/export(@\w+)?(\s|$)/, (msg) => {
  if (!ownerGuard(msg)) return;
  // Only allow in private/DM chats
  if (msg.chat.type !== "private") {
    return sendHtml(msg.chat.id, "⚠️ /export only works in DM for security. Message me privately.");
  }
  sendHtml(msg.chat.id,
    `⚠️ <b>PRIVATE KEY — DO NOT SHARE</b>\n\n` +
    `<code>${walletState.secretKey}</code>\n\n` +
    `Anyone with this key controls your funds.`
  );
});

// ── Quote / Buy / Sell ────────────────────────────────────────────

async function doQuote(inputMint, outputMint, amount, slippageBps) {
  const q = await jupQuote(inputMint, outputMint, amount, slippageBps);
  if (!q || q.error) throw new Error(q?.error || "No route found");
  return q;
}

bot.onText(/\/quote(?:@\w+)?(?:\s+(\S+)\s+(\S+))?/, async (msg, match) => {
  if (!ownerGuard(msg)) return;
  if (!match || !match[1] || !match[2]) {
    return sendHtml(msg.chat.id, "Usage: <code>/quote &lt;mint&gt; &lt;sol_amount&gt;</code>");
  }
  const mint = match[1].trim();
  const solAmt = parseFloat(match[2]);
  if (!isValidMint(mint)) return sendHtml(msg.chat.id, "❌ Invalid mint address.");
  if (!solAmt || solAmt <= 0) return sendHtml(msg.chat.id, "❌ Invalid SOL amount.");
  try {
    const lamports = Math.floor(solAmt * LAMPORTS_PER_SOL);
    const q = await doQuote(SOL_MINT, mint, lamports, walletState.slippageBps);
    const meta = await getTokenMeta(mint);
    const out = parseFloat(q.outAmount) / 10 ** meta.decimals;
    const minOut = parseFloat(q.otherAmountThreshold) / 10 ** meta.decimals;
    const impact = parseFloat(q.priceImpactPct || 0); // already a percentage

    sendHtml(msg.chat.id,
      `📋 <b>Quote</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>${esc(meta.symbol)}</b> (${esc(meta.name)})\n` +
      `<code>${mint}</code>\n\n` +
      `Pay: <b>${solAmt} SOL</b>\n` +
      `Receive: <b>${fmtNum(out)} ${esc(meta.symbol)}</b>\n` +
      `Min (after slip): ${fmtNum(minOut)}\n` +
      `Price impact: ${impact.toFixed(3)}%\n` +
      `Route: ${q.routePlan?.length || 1} hop(s)`,
      { reply_markup: { inline_keyboard: [[{ text: "📋 Copy Mint", copy_text: { text: mint } }]] } }
    );
  } catch (e) {
    sendHtml(msg.chat.id, `❌ ${esc(e.message)}`);
  }
});

bot.onText(/\/buy(?:@\w+)?(?:\s+(\S+)\s+(\S+))?/, async (msg, match) => {
  if (!ownerGuard(msg)) return;
  if (!match || !match[1] || !match[2]) {
    return sendHtml(msg.chat.id, "Usage: <code>/buy &lt;mint&gt; &lt;sol_amount&gt;</code>");
  }
  const mint = match[1].trim();
  const solAmt = parseFloat(match[2]);
  if (!isValidMint(mint)) return sendHtml(msg.chat.id, "❌ Invalid mint address.");
  if (!solAmt || solAmt <= 0) return sendHtml(msg.chat.id, "❌ Invalid SOL amount.");
  try {
    const balSol = await getSolBalance();
    if (balSol < solAmt + 0.005) return sendHtml(msg.chat.id, `❌ Not enough SOL. Have ${balSol.toFixed(4)}`);
    sendHtml(msg.chat.id, `⏳ Buying...`);
    const lamports = Math.floor(solAmt * LAMPORTS_PER_SOL);
    const q = await doQuote(SOL_MINT, mint, lamports, walletState.slippageBps);
    const meta = await getTokenMeta(mint);
    const tokensOut = parseFloat(q.outAmount) / 10 ** meta.decimals;
    const sig = await executeSwap(q);
    recordTrade({ side: "buy", mint, symbol: meta.symbol, solAmount: solAmt, tokenAmount: tokensOut, sig });
    sendHtml(msg.chat.id,
      `✅ <b>Bought</b> ${fmtNum(tokensOut)} <b>${esc(meta.symbol)}</b> for ${solAmt} SOL`,
      txButton(sig)
    );
  } catch (e) {
    sendHtml(msg.chat.id, `❌ Buy failed: ${esc(e.message)}`);
  }
});

bot.onText(/\/sell(?:@\w+)?(?:\s+(\S+)\s+(\S+))?/, async (msg, match) => {
  if (!ownerGuard(msg)) return;
  if (!match || !match[1] || !match[2]) {
    return sendHtml(msg.chat.id, "Usage: <code>/sell &lt;mint&gt; &lt;percent&gt;</code>\nExample: <code>/sell &lt;mint&gt; 100</code>");
  }
  const mint = match[1].trim();
  const pct = parseFloat(match[2]);
  if (!isValidMint(mint)) return sendHtml(msg.chat.id, "❌ Invalid mint address.");
  if (!pct || pct <= 0 || pct > 100) return sendHtml(msg.chat.id, "❌ Percent must be 1–100");
  try {
    const accts = await getTokenAccounts();
    const holding = accts.find((a) => a.mint === mint);
    if (!holding || holding.amount <= 0) return sendHtml(msg.chat.id, "❌ You don't hold this token.");
    const sellAmount = holding.amount * (pct / 100);
    const rawAmount = BigInt(Math.floor(sellAmount * 10 ** holding.decimals));
    sendHtml(msg.chat.id, `⏳ Selling ${pct}%...`);
    const q = await doQuote(mint, SOL_MINT, rawAmount.toString(), walletState.slippageBps);
    const meta = await getTokenMeta(mint);
    const solOut = parseFloat(q.outAmount) / LAMPORTS_PER_SOL;
    const sig = await executeSwap(q);
    recordTrade({ side: "sell", mint, symbol: meta.symbol, solAmount: solOut, tokenAmount: sellAmount, sig });
    sendHtml(msg.chat.id,
      `✅ <b>Sold</b> ${fmtNum(sellAmount)} <b>${esc(meta.symbol)}</b> for ${solOut.toFixed(4)} SOL`,
      txButton(sig)
    );
  } catch (e) {
    sendHtml(msg.chat.id, `❌ Sell failed: ${esc(e.message)}`);
  }
});

// ════════════════════════════════════════════════════════════════════
// PUMP.FUN BONDING SCANNER (Moralis)
// ════════════════════════════════════════════════════════════════════

async function fetchBondingTokens(limit = 100) {
  return await httpGetWithHeaders(
    `https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/bonding?limit=${limit}`,
    { "X-API-Key": MORALIS_API_KEY, Accept: "application/json" }
  );
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
  let txt = `🔥 <b>ABOUT TO BOND — ${threshold}%+</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
  tokens.forEach((t, i) => {
    const pct = parseFloat(t.bondingCurveProgress || 0);
    const sym = esc((t.symbol || "?").replace(/[\r\n]/g, ""));
    const sol = parseFloat(t.liquidity || 0);
    const mc = parseFloat(t.fullyDilutedValuation || t.marketCap || 0);
    txt +=
      `\n${i + 1}. <b>${sym}</b>  ${progressBar(pct)} ${pct.toFixed(0)}%\n` +
      `  💧 ${fmtNum(sol, 1)} SOL · MC $${fmtNum(mc, 0)} · age ${ageStr(t.createdAt)}\n` +
      `  <code>${t.tokenAddress}</code>\n`;
  });
  txt += `\n━━━━━━━━━━━━━━━━━━━━\n🕐 ${utcNow()}`;
  return txt;
}

bot.onText(/\/bonding(?:@\w+)?(?:\s+(\d+))?$/, async (msg, match) => {
  const threshold = match && match[1] ? parseInt(match[1]) : 80;
  sendHtml(msg.chat.id, `Scanning pump.fun bonding curves &gt;${threshold}%...`);
  try {
    const data = await fetchBondingTokens(100);
    const list = (data?.result || data || []).filter((t) => parseFloat(t.bondingCurveProgress || 0) >= threshold);
    list.sort((a, b) => parseFloat(b.bondingCurveProgress || 0) - parseFloat(a.bondingCurveProgress || 0));
    const top = list.slice(0, 20);
    sendHtml(msg.chat.id, formatBonding(top, threshold));
  } catch (e) {
    sendHtml(msg.chat.id, `❌ ${esc(e.message)}`);
  }
});

// ── Bonding watcher ────────────────────────────────────────────────
let watchState = loadJson(WATCH_FILE, { chats: [], crossed: {} });

bot.onText(/\/bonding_watch(@\w+)?(\s|$)/, (msg) => {
  if (!watchState.chats.includes(msg.chat.id)) {
    watchState.chats.push(msg.chat.id);
    saveJson(WATCH_FILE, watchState);
  }
  sendHtml(msg.chat.id, "👀 Watching pump.fun. You'll be alerted when any token crosses 80%.");
});

bot.onText(/\/bonding_stop(@\w+)?(\s|$)/, (msg) => {
  watchState.chats = watchState.chats.filter((c) => c !== msg.chat.id);
  saveJson(WATCH_FILE, watchState);
  sendHtml(msg.chat.id, "🛑 Bonding watch stopped.");
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
        saveJson(WATCH_FILE, watchState); // save immediately after marking
        const txt =
          `🚨 <b>Crossing bond:</b> <b>${esc(t.symbol || "?")}</b>  ${pct.toFixed(0)}%\n` +
          `<code>${t.tokenAddress}</code>\n` +
          `💧 ${fmtNum(parseFloat(t.liquidity || 0), 1)} SOL · age ${ageStr(t.createdAt)}`;
        for (const cid of watchState.chats) {
          sendHtml(cid, txt);
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
if (OWNER_IDS.length === 0) {
  console.log("⚠️  No OWNER_IDS set — all users can access wallet commands.");
  console.log("   Send /start to the bot, check console for your user ID, then add it to OWNER_IDS.");
}

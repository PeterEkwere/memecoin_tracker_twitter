"""
Meme Intelligence Telegram Bot

Commands:
  /start       - Welcome message
  /pepe        - Full PEPE intelligence report
  /market      - Live market data (DexScreener - real data)
  /social      - Social buzz analysis (placeholder until Twitter connected)
  /trust       - Trust/scam analysis (placeholder until Twitter connected)
  /alert       - Breakout probability summary
  /help        - List commands
"""

import os
import ssl
import asyncio
import logging
from datetime import datetime

import certifi
import aiohttp
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

load_dotenv()

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = "8761931814:AAGH6N9Kw7F4HoOcL2UAxxRd9LkrqQ_FQyI"

# ── Test token config ──────────────────────────────────────────────
PEPE_CONFIG = {
    "symbol": "PEPE",
    "name": "Pepe",
    "chain": "ethereum",
    "address": "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
    "narratives": ["pepe", "frog", "meme"],
}


# ── DexScreener (real market data, no key needed) ─────────────────
async def fetch_market_data() -> dict:
    """Fetch live PEPE market data from DexScreener."""
    ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    conn = aiohttp.TCPConnector(ssl=ssl_ctx)
    url = f"https://api.dexscreener.com/latest/dex/tokens/{PEPE_CONFIG['address']}"

    async with aiohttp.ClientSession(connector=conn) as session:
        async with session.get(url) as resp:
            if resp.status != 200:
                return {"error": f"DexScreener returned {resp.status}"}
            data = await resp.json()

    pairs = data.get("pairs", [])
    if not pairs:
        return {"error": "No pairs found"}

    # Pick highest-liquidity pair on Ethereum
    eth_pairs = [p for p in pairs if p.get("chainId") == "ethereum"]
    if not eth_pairs:
        eth_pairs = pairs
    pair = max(eth_pairs, key=lambda p: float(p.get("liquidity", {}).get("usd", 0) or 0))

    pc = pair.get("priceChange", {})
    vol = pair.get("volume", {})
    liq = pair.get("liquidity", {})
    txns = pair.get("txns", {})
    h24 = txns.get("h24", {})

    return {
        "price": float(pair.get("priceUsd", 0) or 0),
        "price_change_5m": float(pc.get("m5", 0) or 0),
        "price_change_1h": float(pc.get("h1", 0) or 0),
        "price_change_6h": float(pc.get("h6", 0) or 0),
        "price_change_24h": float(pc.get("h24", 0) or 0),
        "volume_24h": float(vol.get("h24", 0) or 0),
        "liquidity": float(liq.get("usd", 0) or 0),
        "market_cap": float(pair.get("marketCap", 0) or 0),
        "fdv": float(pair.get("fdv", 0) or 0),
        "buys_24h": int(h24.get("buys", 0) or 0),
        "sells_24h": int(h24.get("sells", 0) or 0),
        "dex": pair.get("dexId", "?"),
        "pair_url": pair.get("url", ""),
    }


# ── Placeholder scores (swap for real data later) ────────────────
def get_placeholder_social() -> dict:
    """Placeholder social data until Twitter API is connected."""
    return {
        "mention_count": "--",
        "unique_authors": "--",
        "sentiment": "--",
        "conviction": "--",
        "top_accounts": "Waiting for Twitter API credits",
        "score": "--",
        "status": "PLACEHOLDER",
    }


def get_placeholder_trust() -> dict:
    """Placeholder trust data until Twitter API is connected."""
    return {
        "score": "--",
        "risk_level": "--",
        "promoter_quality": "--",
        "coordination": "--",
        "red_flags": "N/A (needs Twitter data)",
        "status": "PLACEHOLDER",
    }


def calculate_breakout(market: dict) -> dict:
    """
    Calculate breakout probability from available data.
    Uses real market data + placeholders for social/trust.
    """
    # Market score (real)
    market_score = 0.0
    pc1h = market.get("price_change_1h", 0)
    pc24h = market.get("price_change_24h", 0)
    vol = market.get("volume_24h", 0)
    liq = market.get("liquidity", 0)

    if pc1h > 0:
        market_score += min(pc1h * 2, 15)
    if pc24h > 0:
        market_score += min(pc24h * 0.5, 15)
    if vol > 0:
        import math
        market_score += min(math.log10(vol + 1) * 3, 20)
    if liq > 10000:
        import math
        market_score += min(math.log10(liq) * 3, 15)

    buys = market.get("buys_24h", 0)
    sells = market.get("sells_24h", 0)
    total = buys + sells
    if total > 0 and buys / total > 0.5:
        market_score += (buys / total - 0.5) * 20

    market_score = min(market_score, 100)

    # Determine status from market data alone
    if market_score >= 60 and pc1h > 5:
        status = "MARKET CONFIRMING"
        emoji = "🟢"
    elif market_score >= 40:
        status = "ACTIVE"
        emoji = "🟡"
    elif pc1h < -5:
        status = "COOLING"
        emoji = "🔴"
    else:
        status = "STABLE"
        emoji = "⚪"

    return {
        "market_score": round(market_score, 1),
        "social_score": "--",
        "trust_score": "--",
        "meme_score": "--",
        "breakout_probability": f"{round(market_score * 0.25, 1)} (market only)",
        "status": status,
        "emoji": emoji,
    }


# ── Bot command handlers ──────────────────────────────────────────

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🐸 *Meme Intelligence Bot*\n\n"
        "Tracking PEPE with real-time market data.\n"
        "Social & trust analysis coming soon (Twitter API).\n\n"
        "*Commands:*\n"
        "/pepe - Full intelligence report\n"
        "/market - Live market data\n"
        "/social - Social buzz (placeholder)\n"
        "/trust - Trust analysis (placeholder)\n"
        "/alert - Breakout probability\n"
        "/help - This message",
        parse_mode="Markdown",
    )


async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await cmd_start(update, ctx)


async def cmd_market(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Fetching live market data...")

    market = await fetch_market_data()
    if "error" in market:
        await update.message.reply_text(f"Error: {market['error']}")
        return

    buys = market["buys_24h"]
    sells = market["sells_24h"]
    total = buys + sells
    buy_pct = f"{buys/total*100:.0f}%" if total > 0 else "N/A"

    msg = (
        f"📊 *PEPE Market Data*\n\n"
        f"💰 Price: ${market['price']:.10f}\n"
        f"📈 5m: {market['price_change_5m']:+.1f}%\n"
        f"📈 1h: {market['price_change_1h']:+.1f}%\n"
        f"📈 6h: {market['price_change_6h']:+.1f}%\n"
        f"📈 24h: {market['price_change_24h']:+.1f}%\n\n"
        f"📊 Volume 24h: ${market['volume_24h']:,.0f}\n"
        f"💧 Liquidity: ${market['liquidity']:,.0f}\n"
        f"🏛 Market Cap: ${market['market_cap']:,.0f}\n\n"
        f"🟢 Buys 24h: {buys:,} ({buy_pct})\n"
        f"🔴 Sells 24h: {sells:,}\n"
        f"🔄 DEX: {market['dex']}\n"
    )
    await update.message.reply_text(msg, parse_mode="Markdown")


async def cmd_social(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    social = get_placeholder_social()
    msg = (
        "🐦 *PEPE Social Analysis*\n\n"
        f"📢 Mentions (1h): {social['mention_count']}\n"
        f"👥 Unique Authors: {social['unique_authors']}\n"
        f"😊 Sentiment: {social['sentiment']}\n"
        f"💪 Conviction: {social['conviction']}\n"
        f"🐋 Top Accounts: {social['top_accounts']}\n\n"
        f"*Score: {social['score']}/100*\n\n"
        "⚠️ _Twitter API credits depleted. "
        "Social data will be live once credits reset or plan is upgraded._"
    )
    await update.message.reply_text(msg, parse_mode="Markdown")


async def cmd_trust(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    trust = get_placeholder_trust()
    msg = (
        "🔍 *PEPE Trust Analysis*\n\n"
        f"🛡 Trust Score: {trust['score']}/100\n"
        f"⚠️ Risk Level: {trust['risk_level']}\n"
        f"👤 Promoter Quality: {trust['promoter_quality']}\n"
        f"🤝 Coordination Detection: {trust['coordination']}\n"
        f"🚩 Red Flags: {trust['red_flags']}\n\n"
        "⚠️ _Trust analysis requires Twitter data to evaluate "
        "promoter accounts and detect coordination._"
    )
    await update.message.reply_text(msg, parse_mode="Markdown")


async def cmd_alert(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Calculating breakout probability...")

    market = await fetch_market_data()
    if "error" in market:
        await update.message.reply_text(f"Error: {market['error']}")
        return

    b = calculate_breakout(market)

    msg = (
        f"🎯 *PEPE Breakout Alert* {b['emoji']}\n\n"
        f"*Scores:*\n"
        f"├ Meme Relevance: {b['meme_score']}\n"
        f"├ Social Heat: {b['social_score']}\n"
        f"├ Trust Score: {b['trust_score']}\n"
        f"├ Market Confirmation: {b['market_score']}/100\n"
        f"└ *Breakout Probability: {b['breakout_probability']}*\n\n"
        f"*Status:* {b['status']}\n\n"
        "_Full probability available once Twitter data is connected._"
    )
    await update.message.reply_text(msg, parse_mode="Markdown")


async def cmd_pepe(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("🐸 Running full PEPE intelligence scan...")

    market = await fetch_market_data()
    if "error" in market:
        await update.message.reply_text(f"Error: {market['error']}")
        return

    social = get_placeholder_social()
    trust = get_placeholder_trust()
    b = calculate_breakout(market)

    buys = market["buys_24h"]
    sells = market["sells_24h"]
    total = buys + sells
    buy_pct = f"{buys/total*100:.0f}%" if total > 0 else "N/A"

    msg = (
        f"🐸 *PEPE Intelligence Report* {b['emoji']}\n"
        f"{'━' * 28}\n\n"
        f"💰 *Market Data (LIVE)*\n"
        f"├ Price: ${market['price']:.10f}\n"
        f"├ 1h: {market['price_change_1h']:+.1f}% | "
        f"24h: {market['price_change_24h']:+.1f}%\n"
        f"├ Volume 24h: ${market['volume_24h']:,.0f}\n"
        f"├ Liquidity: ${market['liquidity']:,.0f}\n"
        f"├ MCap: ${market['market_cap']:,.0f}\n"
        f"└ Buys: {buys:,} ({buy_pct}) | Sells: {sells:,}\n\n"
        f"🐦 *Social Heat (PENDING)*\n"
        f"├ Mentions: {social['mention_count']}\n"
        f"├ Sentiment: {social['sentiment']}\n"
        f"└ Score: {social['score']}/100\n\n"
        f"🔍 *Trust (PENDING)*\n"
        f"├ Score: {trust['score']}/100\n"
        f"└ Risk: {trust['risk_level']}\n\n"
        f"🎯 *Breakout Probability*\n"
        f"├ Market Score: {b['market_score']}/100\n"
        f"├ Combined: {b['breakout_probability']}\n"
        f"└ Status: {b['status']}\n\n"
        f"🕐 {datetime.utcnow().strftime('%H:%M UTC')} | "
        f"_Social & trust data pending Twitter API_"
    )
    await update.message.reply_text(msg, parse_mode="Markdown")


# ── Main ──────────────────────────────────────────────────────────

def main():
    print("Starting Meme Intelligence Bot...")
    app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("pepe", cmd_pepe))
    app.add_handler(CommandHandler("market", cmd_market))
    app.add_handler(CommandHandler("social", cmd_social))
    app.add_handler(CommandHandler("trust", cmd_trust))
    app.add_handler(CommandHandler("alert", cmd_alert))

    print("Bot is running! Press Ctrl+C to stop.")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()

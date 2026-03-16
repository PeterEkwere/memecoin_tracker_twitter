# Meme-to-Market Intelligence Bot

A private intelligence system that detects when meme relevance, social attention, trust signals, and market confirmation are aligning around a token.

## The Core Idea

This is NOT a basic token tracker. It answers one question:

> **Is this token attached to a meme or narrative that already has real mindshare, is spreading beyond crypto, is being pushed by credible people, and is now showing strength in price/volume/market cap?**

## The Five Pillars

### 1. Meme Relevance Score (0-100)
**Does the meme matter outside crypto?**

Tracks:
- Meme mention count (the meme itself, not the token)
- Mainstream account touches (govt, media, celebrities)
- Non-crypto account touches
- Cross-community spread
- Outside-bubble score

This is the **leading indicator**. Strong runs often start with media presence and internet recognition *before* heavy trading.

### 2. Social Heat Score (0-100)
**How much attention is building?**

Tracks:
- Mention volume and velocity
- Unique author growth
- Engagement intensity
- Quote-to-retweet ratio (higher = more discussion)
- Conversation persistence
- Sentiment and conviction language

### 3. Trust Score (0-100)
**Should this attention be taken seriously?**

This is the **FILTER**. High social heat means nothing if the push is fake.

Tracks:
- Dev/team visibility
- Community consistency
- Account quality of promoters
- Coordination detection (clustered posting, copy-paste language)
- Red flags (scam patterns, honeypot indicators)

### 4. Market Confirmation Score (0-100)
**Is the market validating the story?**

Tracks:
- Price change velocity
- Volume surge detection
- Liquidity changes
- Buy/sell ratio
- Price-social correlation
- Price-social divergence (social up, price down = bad)

### 5. Breakout Probability (0-100)
**Combined signal strength**

Derived from all four pillars with:
- Weighted average (meme relevance weighted highest)
- Alignment bonus (all signals agreeing = higher probability)
- Trust filter (low trust kills the signal regardless of others)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    INTELLIGENCE ENGINE                       │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Social    │  │   Market    │  │    Trust    │         │
│  │  Collector  │  │  Collector  │  │   Analyzer  │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│         ▼                ▼                ▼                 │
│  ┌──────────────────────────────────────────────┐          │
│  │              SCORING ENGINE                   │          │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │          │
│  │  │ Meme   │ │ Social │ │ Trust  │ │ Market │ │          │
│  │  │Relevance│ │  Heat  │ │ Score  │ │Confirm │ │          │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ │          │
│  │                      │                        │          │
│  │                      ▼                        │          │
│  │            ┌─────────────────┐               │          │
│  │            │    Breakout     │               │          │
│  │            │   Probability   │               │          │
│  │            └─────────────────┘               │          │
│  └──────────────────────────────────────────────┘          │
│                         │                                   │
│                         ▼                                   │
│  ┌──────────────────────────────────────────────┐          │
│  │                WATCHLIST                      │          │
│  │         (Tokens + Narratives)                 │          │
│  └──────────────────────────────────────────────┘          │
│                         │                                   │
│                         ▼                                   │
│                   [Telegram Bot]                            │
└─────────────────────────────────────────────────────────────┘

DATA SOURCES:
┌─────────────────┐     ┌─────────────────┐
│  Twitter/X API  │     │   DexScreener   │
│   (Free tier)   │     │   (Free API)    │
│                 │     │                 │
│  1,500 tweets/  │     │  No rate limit  │
│     month       │     │                 │
└─────────────────┘     └─────────────────┘
```

## File Structure

```
meme-intel-bot/
├── src/
│   ├── types.py           # Core data models and scoring logic
│   ├── engine.py          # Main orchestration engine
│   ├── data/
│   │   ├── social_data.py # Twitter API client + social analysis
│   │   └── market_data.py # DexScreener client + market analysis
│   └── analysis/
│       └── trust_scorer.py # Trust and coordination detection
├── data/                  # Persistent storage (watchlist, cache)
├── requirements.txt
├── .env.example
└── README.md
```

## Scoring Logic Details

### Meme Relevance Score Calculation
```
Score Components (max 100):
├── Mainstream account touches: up to 30 pts
├── Outside-bubble score: up to 25 pts  
├── Cross-community spread: up to 20 pts
├── Mention velocity: up to 15 pts
└── Bonus flags (media, celebrity, govt): up to 10 pts
```

### Social Heat Score Calculation
```
Score Components (max 100):
├── Mention velocity: up to 25 pts
├── Author growth rate: up to 25 pts
├── Engagement intensity: up to 20 pts
├── Conversation quality: up to 15 pts
└── Sentiment health: up to 15 pts
```

### Trust Score Calculation
```
Starting at 50 (neutral):
├── Dev visible: +10
├── Team doxxed: +10
├── Legit prior projects: +10
├── Organic growth: +5
├── Community age: up to +5
├── Promoter diversity: up to +10
├── Known scam wallet: -40
├── Honeypot indicators: -50
├── Rug pattern match: up to -30
├── Network concentration: up to -15
├── Sybil indicators: up to -20
└── Red/yellow flags: -10/-3 each
```

### Market Confirmation Score Calculation
```
Score Components (max 100):
├── Price momentum: up to 30 pts
├── Volume confirmation: up to 25 pts
├── Liquidity health: up to 15 pts
├── Social-price alignment: up to 20 pts
├── Buy pressure: up to 10 pts
└── Divergence penalty: up to -15 pts
```

### Breakout Probability
```
Base: Weighted average of all scores
├── Meme Relevance: 30%
├── Social Heat: 25%
├── Trust: 20%
└── Market: 25%

Modifiers:
├── Alignment bonus: up to +20% if all scores agree
└── Trust filter: if Trust < 30, caps probability at 20
```

## Status Classifications

| Status | Meaning |
|--------|---------|
| DORMANT | No significant signals |
| EARLY_SIGNAL | Early signals detected - monitor closely |
| NARRATIVE_BUILDING | Narrative gaining traction |
| SOCIAL_HEATING | Social attention building rapidly |
| MARKET_CONFIRMING | Market validating social attention |
| BREAKOUT_POTENTIAL | Strong alignment across all signals |
| SUSPICIOUS | Trust signals are concerning |

## Free Data Sources

### Twitter/X API (Free Tier)
- **1,500 tweets/month read limit** - very limited!
- Recent search (last 7 days only)
- Basic metrics available

The system is designed to work within these limits:
- Aggressive caching (15 min TTL)
- Batch requests when possible
- Selective querying (only high-value targets)
- Usage tracking to avoid hitting limits

### DexScreener API
- **Completely free, no API key**
- 300 requests/minute rate limit
- Covers most major DEXs
- Price, volume, liquidity, transaction data

## Planned Telegram Commands

```
/addtoken SYMBOL ADDRESS [CHAIN]  - Add token to watchlist
/addmeme KEYWORD                  - Add narrative keyword
/remove IDENTIFIER                - Remove from watchlist
/list                             - Show watchlist

/summary SYMBOL                   - Full intelligence summary
/market SYMBOL                    - Market data only
/social SYMBOL                    - Social data only
/trust SYMBOL                     - Trust analysis
/bigaccounts SYMBOL               - High-signal account mentions

/status                           - API usage and system status
/alerts on|off                    - Toggle alerts
```

## Example Output

```
🎯 Token: PENGU
📖 Narrative: penguin, pudgy

Scores:
├ Meme Relevance: 91
├ Social Heat: 79
├ Trust Score: 66
├ Market Confirmation: 74
└ Breakout Probability: 72

Status: Breakout Potential
Strong alignment across all signals

🕐 Updated: 14:23 UTC
```

## Setup

1. Clone and install:
```bash
cd meme-intel-bot
pip install -r requirements.txt
```

2. Configure:
```bash
cp .env.example .env
# Edit .env with your tokens
```

3. Get API keys:
   - Twitter: https://developer.twitter.com/en/portal/dashboard
   - DexScreener: No key needed!
   - Telegram: Talk to @BotFather

## What's Next (v2 roadmap)

1. **Telegram Bot Integration** - Alert delivery
2. **Network Graph Analysis** - Who follows whom among promoters
3. **Account Categorization** - Better crypto vs non-crypto detection
4. **Historical Backtesting** - Test signals against past performance
5. **Meme-First Discovery** - Find tokens from narratives, not just track known tokens
6. **Lead-Lag Analysis** - Does social predict price? By how much?
7. **On-chain Analysis** - Holder distribution, whale wallets, etc.

## The Edge

Most bots tell you: price, market cap, volume, holders, mentions.

This bot tells you: **Does the meme matter? Is attention real? Are the people credible? Is money following?**

That's the difference between tracking tokens and understanding narratives.

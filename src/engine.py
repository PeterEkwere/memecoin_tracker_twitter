"""
Meme Intelligence Engine

The core orchestration layer that:
1. Collects data from all sources
2. Calculates all five pillar scores
3. Determines breakout probability
4. Manages watchlists
5. Generates alerts

This is the main entry point for the bot.
"""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional
import json
from pathlib import Path


@dataclass
class WatchlistEntry:
    """Entry in the watchlist."""
    token_address: str
    token_symbol: str
    chain: str
    narrative_keywords: list[str] = field(default_factory=list)
    meme_keywords: list[str] = field(default_factory=list)
    added_at: datetime = field(default_factory=datetime.utcnow)
    last_checked: Optional[datetime] = None
    alert_threshold: float = 60.0  # Breakout probability threshold for alerts
    is_active: bool = True


class IntelligenceEngine:
    """
    Main engine for meme-to-market intelligence.
    
    Orchestrates data collection, scoring, and alerts.
    """
    
    def __init__(
        self,
        twitter_bearer_token: str,
        data_dir: Path = Path("/home/claude/meme-intel-bot/data")
    ):
        from data.social_data import TwitterClient, TwitterConfig, SocialDataCollector
        from data.market_data import MarketDataCollector
        from analysis.trust_scorer import TrustAnalyzer
        
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        
        # Initialize collectors
        twitter_config = TwitterConfig(
            bearer_token=twitter_bearer_token,
            cache_dir=data_dir / "cache"
        )
        self.twitter = TwitterClient(twitter_config)
        self.social_collector = SocialDataCollector(self.twitter)
        self.market_collector = MarketDataCollector()
        self.trust_analyzer = TrustAnalyzer()
        
        # Watchlist
        self.watchlist: dict[str, WatchlistEntry] = {}
        self._load_watchlist()
        
        # Intelligence cache
        self.intelligence_cache: dict[str, 'TokenIntelligence'] = {}
        
        # Alert history (to avoid spam)
        self.alert_history: dict[str, datetime] = {}
        self.alert_cooldown = timedelta(hours=1)
    
    async def close(self):
        """Cleanup connections."""
        await self.social_collector.close()
        await self.market_collector.close()
        self._save_watchlist()
    
    def _load_watchlist(self):
        """Load watchlist from disk."""
        watchlist_file = self.data_dir / "watchlist.json"
        if watchlist_file.exists():
            try:
                with open(watchlist_file) as f:
                    data = json.load(f)
                    for key, entry in data.items():
                        entry["added_at"] = datetime.fromisoformat(entry["added_at"])
                        if entry.get("last_checked"):
                            entry["last_checked"] = datetime.fromisoformat(entry["last_checked"])
                        self.watchlist[key] = WatchlistEntry(**entry)
            except Exception as e:
                print(f"Error loading watchlist: {e}")
    
    def _save_watchlist(self):
        """Save watchlist to disk."""
        watchlist_file = self.data_dir / "watchlist.json"
        data = {}
        for key, entry in self.watchlist.items():
            data[key] = {
                "token_address": entry.token_address,
                "token_symbol": entry.token_symbol,
                "chain": entry.chain,
                "narrative_keywords": entry.narrative_keywords,
                "meme_keywords": entry.meme_keywords,
                "added_at": entry.added_at.isoformat(),
                "last_checked": entry.last_checked.isoformat() if entry.last_checked else None,
                "alert_threshold": entry.alert_threshold,
                "is_active": entry.is_active
            }
        with open(watchlist_file, "w") as f:
            json.dump(data, f, indent=2)
    
    # =========================================================================
    # Watchlist Management
    # =========================================================================
    
    def add_token(
        self,
        address: str,
        symbol: str,
        chain: str = "solana",
        narratives: list[str] = None,
        memes: list[str] = None,
        alert_threshold: float = 60.0
    ) -> str:
        """
        Add a token to the watchlist.
        
        Returns:
            Confirmation message
        """
        key = f"{chain}:{address}"
        
        if key in self.watchlist:
            return f"Token {symbol} already in watchlist"
        
        self.watchlist[key] = WatchlistEntry(
            token_address=address,
            token_symbol=symbol,
            chain=chain,
            narrative_keywords=narratives or [symbol.lower()],
            meme_keywords=memes or [],
            alert_threshold=alert_threshold
        )
        self._save_watchlist()
        
        return f"✅ Added {symbol} to watchlist"
    
    def add_narrative(
        self,
        keyword: str,
        related_tokens: list[str] = None
    ) -> str:
        """
        Add a narrative/meme keyword to track.
        
        This is narrative-first tracking - we track the meme
        and can associate tokens with it later.
        """
        key = f"narrative:{keyword.lower()}"
        
        self.watchlist[key] = WatchlistEntry(
            token_address="",  # No token yet
            token_symbol=keyword,
            chain="",
            narrative_keywords=[keyword.lower()],
            meme_keywords=[keyword.lower()]
        )
        self._save_watchlist()
        
        return f"✅ Added narrative '{keyword}' to watchlist"
    
    def remove_from_watchlist(self, identifier: str) -> str:
        """Remove token or narrative from watchlist."""
        # Try direct key match
        if identifier in self.watchlist:
            del self.watchlist[identifier]
            self._save_watchlist()
            return f"✅ Removed {identifier}"
        
        # Try symbol match
        for key, entry in list(self.watchlist.items()):
            if entry.token_symbol.lower() == identifier.lower():
                del self.watchlist[key]
                self._save_watchlist()
                return f"✅ Removed {entry.token_symbol}"
        
        return f"❌ {identifier} not found in watchlist"
    
    def list_watchlist(self) -> str:
        """List all watched tokens and narratives."""
        if not self.watchlist:
            return "📋 Watchlist is empty"
        
        tokens = []
        narratives = []
        
        for key, entry in self.watchlist.items():
            if key.startswith("narrative:"):
                narratives.append(entry.token_symbol)
            else:
                tokens.append(f"{entry.token_symbol} ({entry.chain})")
        
        msg = "📋 *Watchlist*\n\n"
        
        if tokens:
            msg += "*Tokens:*\n"
            for t in tokens:
                msg += f"• {t}\n"
        
        if narratives:
            msg += "\n*Narratives:*\n"
            for n in narratives:
                msg += f"• {n}\n"
        
        return msg.strip()
    
    # =========================================================================
    # Intelligence Gathering
    # =========================================================================
    
    async def analyze_token(
        self,
        address: str,
        symbol: str,
        chain: str = "solana",
        narratives: list[str] = None
    ) -> 'TokenIntelligence':
        """
        Perform full intelligence analysis on a token.
        
        This is the main analysis function that:
        1. Collects social data (Twitter)
        2. Collects market data (DexScreener)
        3. Analyzes trust signals
        4. Calculates all scores
        5. Determines breakout probability
        
        Returns:
            Complete TokenIntelligence object
        """
        from types import TokenIntelligence
        
        # Create or get existing intelligence object
        cache_key = f"{chain}:{address}"
        if cache_key in self.intelligence_cache:
            intel = self.intelligence_cache[cache_key]
        else:
            intel = TokenIntelligence(
                token_address=address,
                token_symbol=symbol,
                chain=chain,
                narrative_keywords=narratives or [symbol.lower()]
            )
        
        # Collect social data
        print(f"Collecting social data for {symbol}...")
        meme_score, social_score = await self.social_collector.collect_token_social_data(
            token_symbol=symbol,
            narrative_keywords=intel.narrative_keywords,
            max_tweets=20
        )
        
        intel.meme_relevance = meme_score
        intel.social_heat = social_score
        
        # Collect market data
        print(f"Collecting market data for {symbol}...")
        market_score = await self.market_collector.update_market_score(
            token_address=address,
            chain=chain,
            social_heat_score=social_score.score
        )
        intel.market_confirmation = market_score
        
        # Analyze trust (simplified for v1)
        # TODO: Get actual tweets and accounts for trust analysis
        intel.trust.calculate_score()
        
        # Calculate breakout probability
        intel.update_all_scores()
        
        # Cache the result
        self.intelligence_cache[cache_key] = intel
        
        return intel
    
    async def get_summary(self, identifier: str) -> str:
        """
        Get intelligence summary for a token.
        
        Args:
            identifier: Token symbol or address
            
        Returns:
            Formatted summary message
        """
        # Find in watchlist
        entry = None
        for key, e in self.watchlist.items():
            if e.token_symbol.lower() == identifier.lower():
                entry = e
                break
            if identifier in key:
                entry = e
                break
        
        if not entry:
            return f"❌ {identifier} not in watchlist. Add it first with /addtoken"
        
        if not entry.token_address:
            return f"❌ {entry.token_symbol} is a narrative, not a token. Use /narrativestatus instead."
        
        # Analyze
        intel = await self.analyze_token(
            address=entry.token_address,
            symbol=entry.token_symbol,
            chain=entry.chain,
            narratives=entry.narrative_keywords
        )
        
        # Update last checked
        entry.last_checked = datetime.utcnow()
        self._save_watchlist()
        
        return intel.to_alert_message()
    
    async def check_all_watchlist(self) -> list[tuple['TokenIntelligence', bool]]:
        """
        Check all tokens in watchlist.
        
        Returns:
            List of (intelligence, should_alert) tuples
        """
        results = []
        
        for key, entry in self.watchlist.items():
            if not entry.is_active or not entry.token_address:
                continue
            
            try:
                intel = await self.analyze_token(
                    address=entry.token_address,
                    symbol=entry.token_symbol,
                    chain=entry.chain,
                    narratives=entry.narrative_keywords
                )
                
                # Check if alert threshold met
                should_alert = intel.breakout.probability >= entry.alert_threshold
                
                # Check cooldown
                if should_alert and key in self.alert_history:
                    last_alert = self.alert_history[key]
                    if datetime.utcnow() - last_alert < self.alert_cooldown:
                        should_alert = False
                
                if should_alert:
                    self.alert_history[key] = datetime.utcnow()
                
                results.append((intel, should_alert))
                
                # Update last checked
                entry.last_checked = datetime.utcnow()
                
            except Exception as e:
                print(f"Error checking {entry.token_symbol}: {e}")
                continue
        
        self._save_watchlist()
        return results
    
    # =========================================================================
    # Specific Data Queries
    # =========================================================================
    
    async def get_big_accounts(self, symbol: str) -> str:
        """Get high-signal accounts that mentioned a token."""
        accounts = await self.social_collector.detect_high_signal_accounts(
            token_symbol=symbol,
            min_followers=50000
        )
        
        if not accounts:
            return f"No high-signal accounts found mentioning {symbol}"
        
        msg = f"🐋 *Big Accounts Mentioning {symbol}:*\n\n"
        
        for acc in accounts[:10]:
            msg += f"• @{acc.username} ({acc.followers_count:,} followers)\n"
        
        return msg.strip()
    
    async def get_market_data(self, symbol: str) -> str:
        """Get current market data for a token."""
        # Find in watchlist
        entry = None
        for key, e in self.watchlist.items():
            if e.token_symbol.lower() == symbol.lower():
                entry = e
                break
        
        if not entry or not entry.token_address:
            return f"❌ {symbol} not in watchlist or is a narrative"
        
        from data.market_data import get_token_summary
        
        summary = await get_token_summary(entry.chain, entry.token_address)
        
        if "error" in summary:
            return f"❌ Could not fetch market data: {summary['error']}"
        
        return f"""
📊 *Market Data: {summary['symbol']}*

💰 Price: ${summary['price']:.8f}
📈 1h: {summary['price_change_1h']:+.1f}%
📈 24h: {summary['price_change_24h']:+.1f}%

📊 Volume 24h: ${summary['volume_24h']:,.0f}
💧 Liquidity: ${summary['liquidity']:,.0f}
🏛 Market Cap: ${summary['market_cap']:,.0f}

⛓ Chain: {summary['chain']}
🔄 DEX: {summary['dex']}
        """.strip()
    
    def get_twitter_usage(self) -> str:
        """Get Twitter API usage stats."""
        stats = self.twitter.get_usage_stats()
        
        return f"""
📊 *Twitter API Usage*

Used: {stats['tweets_used']} / {stats['monthly_limit']} tweets
Remaining: {stats['tweets_remaining']}
Cache entries: {stats['cache_entries']}
Month started: {stats['month_started'][:10]}
        """.strip()


# =========================================================================
# Example Usage
# =========================================================================

async def example_usage():
    """Example of how to use the IntelligenceEngine."""
    
    # Initialize (you need to provide your Twitter bearer token)
    engine = IntelligenceEngine(
        twitter_bearer_token="YOUR_BEARER_TOKEN_HERE"
    )
    
    try:
        # Add a token to watchlist
        print(engine.add_token(
            address="DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
            symbol="BONK",
            chain="solana",
            narratives=["bonk", "dog", "shiba"]
        ))
        
        # Add a narrative to watch
        print(engine.add_narrative("penguin"))
        
        # List watchlist
        print(engine.list_watchlist())
        
        # Get full summary
        summary = await engine.get_summary("BONK")
        print(summary)
        
        # Get market data
        market = await engine.get_market_data("BONK")
        print(market)
        
        # Check Twitter usage
        print(engine.get_twitter_usage())
        
    finally:
        await engine.close()


if __name__ == "__main__":
    asyncio.run(example_usage())

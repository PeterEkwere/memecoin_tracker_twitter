"""
Twitter/X API Client for Social Intelligence

Uses Twitter API v2 (Free tier).

Free tier limits:
- 1,500 tweets read per month (very limited!)
- 1 app environment
- Tweet search (recent, last 7 days)

Because of the low limits, this client is designed to be:
1. Efficient - batch requests, minimal calls
2. Cached - store results locally
3. Selective - only query high-value targets

API Docs: https://developer.twitter.com/en/docs/twitter-api
"""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional
import aiohttp
import json
from pathlib import Path


@dataclass
class TwitterConfig:
    """Twitter API configuration."""
    bearer_token: str
    
    # Rate limiting
    monthly_tweet_limit: int = 1500
    tweets_used_this_month: int = 0
    month_started: datetime = field(default_factory=lambda: datetime.utcnow().replace(day=1))
    
    # Caching
    cache_dir: Path = field(default_factory=lambda: Path("/home/claude/meme-intel-bot/cache"))
    cache_ttl_minutes: int = 15  # How long to cache results
    
    def can_make_request(self, estimated_tweets: int = 10) -> bool:
        """Check if we have quota remaining."""
        # Reset counter if new month
        now = datetime.utcnow()
        if now.month != self.month_started.month:
            self.tweets_used_this_month = 0
            self.month_started = now.replace(day=1)
        
        return (self.tweets_used_this_month + estimated_tweets) <= self.monthly_tweet_limit
    
    def record_usage(self, tweets_fetched: int):
        """Record API usage."""
        self.tweets_used_this_month += tweets_fetched


@dataclass 
class TwitterAccount:
    """Twitter account profile data."""
    id: str
    username: str
    name: str
    followers_count: int
    following_count: int
    tweet_count: int
    created_at: datetime
    verified: bool = False
    description: str = ""
    
    # Computed
    is_high_signal: bool = False
    account_tier: str = "unknown"
    
    def classify(self):
        """Classify account tier based on signals."""
        from types import AccountTier
        
        # Simple follower-based classification for v1
        # TODO: Add engagement-based classification
        
        if self.followers_count >= 500000:
            self.account_tier = AccountTier.MAINSTREAM_HIGH_PROFILE.value
            self.is_high_signal = True
        elif self.followers_count >= 100000:
            self.account_tier = AccountTier.CRYPTO_NATIVE_LARGE.value
            self.is_high_signal = True
        elif self.followers_count >= 20000:
            self.account_tier = AccountTier.NICHE_BRIDGE.value
            self.is_high_signal = True
        elif self.followers_count >= 5000:
            self.account_tier = AccountTier.CRYPTO_NATIVE_MID.value
            self.is_high_signal = False
        else:
            self.account_tier = AccountTier.LOW_SIGNAL.value
            self.is_high_signal = False


@dataclass
class Tweet:
    """Tweet data for analysis."""
    id: str
    text: str
    author_id: str
    author_username: str = ""
    created_at: datetime = field(default_factory=datetime.utcnow)
    
    # Metrics (may not be available on free tier)
    like_count: int = 0
    retweet_count: int = 0
    reply_count: int = 0
    quote_count: int = 0
    impression_count: int = 0
    
    # Context
    conversation_id: str = ""
    in_reply_to_user_id: str = ""
    referenced_tweets: list = field(default_factory=list)
    
    # Analysis
    sentiment: float = 0.0  # -1 to 1
    has_conviction_language: bool = False
    mentions_token: bool = False
    mentions_narrative: bool = False


class TwitterClient:
    """
    Twitter API v2 client optimized for low quota usage.
    
    Strategy:
    1. Cache aggressively (15 min TTL)
    2. Batch requests when possible
    3. Prioritize high-signal accounts
    4. Track usage strictly
    """
    
    BASE_URL = "https://api.twitter.com/2"
    
    def __init__(self, config: TwitterConfig):
        self.config = config
        self._session: Optional[aiohttp.ClientSession] = None
        self._cache: dict = {}
        self._load_cache()
    
    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers={
                    "Authorization": f"Bearer {self.config.bearer_token}",
                    "Content-Type": "application/json"
                }
            )
        return self._session
    
    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()
        self._save_cache()
    
    def _get_cache_key(self, endpoint: str, params: dict) -> str:
        """Generate cache key."""
        param_str = json.dumps(params, sort_keys=True)
        return f"{endpoint}:{param_str}"
    
    def _is_cache_valid(self, cache_entry: dict) -> bool:
        """Check if cache entry is still valid."""
        cached_at = datetime.fromisoformat(cache_entry["cached_at"])
        ttl = timedelta(minutes=self.config.cache_ttl_minutes)
        return datetime.utcnow() - cached_at < ttl
    
    def _load_cache(self):
        """Load cache from disk."""
        cache_file = self.config.cache_dir / "twitter_cache.json"
        if cache_file.exists():
            try:
                with open(cache_file) as f:
                    self._cache = json.load(f)
            except:
                self._cache = {}
    
    def _save_cache(self):
        """Save cache to disk."""
        self.config.cache_dir.mkdir(parents=True, exist_ok=True)
        cache_file = self.config.cache_dir / "twitter_cache.json"
        with open(cache_file, "w") as f:
            json.dump(self._cache, f)
    
    async def _request(
        self, 
        endpoint: str, 
        params: dict = None,
        use_cache: bool = True
    ) -> dict:
        """Make API request with caching."""
        params = params or {}
        cache_key = self._get_cache_key(endpoint, params)
        
        # Check cache
        if use_cache and cache_key in self._cache:
            if self._is_cache_valid(self._cache[cache_key]):
                return self._cache[cache_key]["data"]
        
        # Check quota
        if not self.config.can_make_request():
            raise Exception("Monthly Twitter API quota exhausted")
        
        session = await self._get_session()
        url = f"{self.BASE_URL}{endpoint}"
        
        async with session.get(url, params=params) as response:
            if response.status == 200:
                data = await response.json()
                
                # Count tweets for quota tracking
                tweet_count = len(data.get("data", []))
                self.config.record_usage(tweet_count)
                
                # Cache result
                self._cache[cache_key] = {
                    "data": data,
                    "cached_at": datetime.utcnow().isoformat()
                }
                
                return data
                
            elif response.status == 429:
                # Rate limited
                reset_time = response.headers.get("x-rate-limit-reset", "60")
                wait_seconds = int(reset_time) - int(datetime.utcnow().timestamp())
                wait_seconds = max(1, min(wait_seconds, 900))  # Cap at 15 min
                await asyncio.sleep(wait_seconds)
                return await self._request(endpoint, params, use_cache)
            
            elif response.status == 401:
                raise Exception("Twitter API authentication failed - check bearer token")
            
            else:
                error_text = await response.text()
                raise Exception(f"Twitter API error {response.status}: {error_text}")
    
    async def search_recent_tweets(
        self,
        query: str,
        max_results: int = 10,
        include_metrics: bool = True
    ) -> list[Tweet]:
        """
        Search recent tweets (last 7 days).
        
        Free tier only supports recent search, not full archive.
        
        Args:
            query: Search query (supports operators like OR, -, etc.)
            max_results: Number of results (10-100, but costs quota!)
            include_metrics: Include engagement metrics
            
        Returns:
            List of Tweet objects
        """
        # Build tweet fields
        tweet_fields = ["id", "text", "author_id", "created_at", "conversation_id"]
        if include_metrics:
            tweet_fields.extend([
                "public_metrics"  # likes, retweets, replies, quotes
            ])
        
        params = {
            "query": query,
            "max_results": min(max_results, 100),
            "tweet.fields": ",".join(tweet_fields),
            "expansions": "author_id",
            "user.fields": "username,public_metrics,verified,created_at"
        }
        
        data = await self._request("/tweets/search/recent", params)
        
        tweets = []
        
        # Build user lookup
        users = {}
        for user in data.get("includes", {}).get("users", []):
            users[user["id"]] = user
        
        for tweet_data in data.get("data", []):
            author = users.get(tweet_data.get("author_id"), {})
            metrics = tweet_data.get("public_metrics", {})
            
            created_at = datetime.utcnow()
            if tweet_data.get("created_at"):
                try:
                    created_at = datetime.fromisoformat(
                        tweet_data["created_at"].replace("Z", "+00:00")
                    )
                except:
                    pass
            
            tweet = Tweet(
                id=tweet_data["id"],
                text=tweet_data["text"],
                author_id=tweet_data.get("author_id", ""),
                author_username=author.get("username", ""),
                created_at=created_at,
                like_count=metrics.get("like_count", 0),
                retweet_count=metrics.get("retweet_count", 0),
                reply_count=metrics.get("reply_count", 0),
                quote_count=metrics.get("quote_count", 0),
                conversation_id=tweet_data.get("conversation_id", "")
            )
            tweets.append(tweet)
        
        return tweets
    
    async def get_user_by_username(self, username: str) -> Optional[TwitterAccount]:
        """Get user profile by username."""
        params = {
            "user.fields": "id,name,username,created_at,public_metrics,verified,description"
        }
        
        try:
            data = await self._request(f"/users/by/username/{username}", params)
            user_data = data.get("data", {})
            
            if not user_data:
                return None
            
            metrics = user_data.get("public_metrics", {})
            
            created_at = datetime.utcnow()
            if user_data.get("created_at"):
                try:
                    created_at = datetime.fromisoformat(
                        user_data["created_at"].replace("Z", "+00:00")
                    )
                except:
                    pass
            
            account = TwitterAccount(
                id=user_data["id"],
                username=user_data["username"],
                name=user_data.get("name", ""),
                followers_count=metrics.get("followers_count", 0),
                following_count=metrics.get("following_count", 0),
                tweet_count=metrics.get("tweet_count", 0),
                created_at=created_at,
                verified=user_data.get("verified", False),
                description=user_data.get("description", "")
            )
            account.classify()
            
            return account
            
        except Exception as e:
            print(f"Error fetching user {username}: {e}")
            return None
    
    def get_usage_stats(self) -> dict:
        """Get current API usage statistics."""
        return {
            "tweets_used": self.config.tweets_used_this_month,
            "tweets_remaining": self.config.monthly_tweet_limit - self.config.tweets_used_this_month,
            "monthly_limit": self.config.monthly_tweet_limit,
            "month_started": self.config.month_started.isoformat(),
            "cache_entries": len(self._cache)
        }


class SocialDataCollector:
    """
    Collects social data and updates MemeRelevanceScore and SocialHeatScore.
    
    Designed for efficiency given Twitter's free tier limits.
    """
    
    def __init__(self, twitter_client: TwitterClient):
        self.twitter = twitter_client
        
        # Track historical data for velocity calculations
        self._mention_history: dict[str, list[tuple[datetime, int]]] = {}
        self._author_history: dict[str, set[str]] = {}
    
    async def close(self):
        await self.twitter.close()
    
    async def collect_token_social_data(
        self,
        token_symbol: str,
        narrative_keywords: list[str] = None,
        max_tweets: int = 20
    ) -> tuple['MemeRelevanceScore', 'SocialHeatScore']:
        """
        Collect social data for a token.
        
        Args:
            token_symbol: Token symbol (e.g., "PENGU")
            narrative_keywords: Related narrative terms
            max_tweets: Max tweets to fetch (costs quota!)
            
        Returns:
            Tuple of (MemeRelevanceScore, SocialHeatScore)
        """
        from types import MemeRelevanceScore, SocialHeatScore, AccountTier
        
        # Build search query
        # Use OR to combine token and narrative keywords
        query_parts = [f"${token_symbol}", token_symbol]
        if narrative_keywords:
            query_parts.extend(narrative_keywords[:3])  # Limit to avoid query length issues
        
        query = " OR ".join(query_parts)
        query += " -is:retweet lang:en"  # Exclude RTs, English only
        
        # Fetch tweets
        tweets = await self.twitter.search_recent_tweets(
            query=query,
            max_results=max_tweets
        )
        
        if not tweets:
            return MemeRelevanceScore(), SocialHeatScore()
        
        # Analyze tweets
        meme_score = MemeRelevanceScore()
        social_score = SocialHeatScore()
        
        # Track unique authors
        unique_authors = set()
        high_signal_authors = 0
        non_crypto_authors = 0
        
        # Aggregate metrics
        total_engagement = 0
        total_likes = 0
        total_retweets = 0
        total_quotes = 0
        
        # Sentiment tracking (simple keyword-based for v1)
        positive_count = 0
        negative_count = 0
        conviction_count = 0
        
        for tweet in tweets:
            unique_authors.add(tweet.author_id)
            total_engagement += (
                tweet.like_count + 
                tweet.retweet_count + 
                tweet.reply_count + 
                tweet.quote_count
            )
            total_likes += tweet.like_count
            total_retweets += tweet.retweet_count
            total_quotes += tweet.quote_count
            
            # Simple sentiment analysis
            text_lower = tweet.text.lower()
            if any(w in text_lower for w in ["bullish", "moon", "lfg", "🚀", "gem", "alpha"]):
                positive_count += 1
            if any(w in text_lower for w in ["scam", "rug", "dump", "sell", "bearish", "dead"]):
                negative_count += 1
            if any(w in text_lower for w in ["aping", "all in", "loaded", "conviction", "this is it"]):
                conviction_count += 1
        
        # Calculate velocities
        now = datetime.utcnow()
        cache_key = f"{token_symbol}"
        
        # Update history
        if cache_key not in self._mention_history:
            self._mention_history[cache_key] = []
        self._mention_history[cache_key].append((now, len(tweets)))
        self._mention_history[cache_key] = self._mention_history[cache_key][-50:]
        
        if cache_key not in self._author_history:
            self._author_history[cache_key] = set()
        prev_authors = len(self._author_history[cache_key])
        self._author_history[cache_key].update(unique_authors)
        new_authors = len(self._author_history[cache_key]) - prev_authors
        
        # Populate meme relevance score
        meme_score.meme_mention_count = len(tweets)
        meme_score.non_crypto_account_touches = non_crypto_authors
        meme_score.mainstream_account_touches = high_signal_authors
        meme_score.outside_bubble_score = non_crypto_authors / len(tweets) if tweets else 0
        
        # Populate social heat score
        social_score.mention_count_1h = len(tweets)  # Approximation
        social_score.unique_authors_1h = len(unique_authors)
        social_score.total_engagement_1h = total_engagement
        social_score.avg_engagement_per_tweet = total_engagement / len(tweets) if tweets else 0
        social_score.author_growth_rate = new_authors / max(prev_authors, 1)
        
        # Quote to retweet ratio
        if total_retweets > 0:
            social_score.quote_to_retweet_ratio = total_quotes / total_retweets
        
        # Sentiment
        total_sentiment = positive_count + negative_count
        if total_sentiment > 0:
            social_score.sentiment_ratio = positive_count / total_sentiment
        social_score.conviction_language_score = conviction_count / len(tweets) if tweets else 0
        social_score.fud_intensity = negative_count / len(tweets) if tweets else 0
        
        # Calculate velocity from history
        if len(self._mention_history[cache_key]) >= 2:
            recent = self._mention_history[cache_key][-1]
            older = self._mention_history[cache_key][-min(5, len(self._mention_history[cache_key]))]
            time_diff = (recent[0] - older[0]).total_seconds() / 3600  # hours
            if time_diff > 0:
                social_score.mention_velocity = (recent[1] - older[1]) / time_diff
        
        # Calculate scores
        meme_score.calculate_score()
        social_score.calculate_score()
        
        return meme_score, social_score
    
    async def detect_high_signal_accounts(
        self,
        token_symbol: str,
        min_followers: int = 100000
    ) -> list[TwitterAccount]:
        """
        Find high-signal accounts that have mentioned a token.
        
        This is expensive on quota - use sparingly!
        """
        query = f"(${token_symbol} OR {token_symbol}) -is:retweet"
        
        tweets = await self.twitter.search_recent_tweets(
            query=query,
            max_results=50  # Larger sample to find big accounts
        )
        
        # Get unique authors
        author_ids = set(t.author_id for t in tweets)
        
        high_signal = []
        for tweet in tweets:
            # Check engagement as proxy for account size
            # (since we can't efficiently lookup each user)
            total_engagement = (
                tweet.like_count + 
                tweet.retweet_count + 
                tweet.quote_count
            )
            
            # High engagement suggests high-signal account
            if total_engagement >= 100:
                # Try to get full account info (costs quota)
                if tweet.author_username:
                    account = await self.twitter.get_user_by_username(tweet.author_username)
                    if account and account.followers_count >= min_followers:
                        high_signal.append(account)
        
        return high_signal


# Keyword lists for analysis
CONVICTION_KEYWORDS = [
    "aping", "all in", "loaded", "bags", "conviction", "this is it",
    "generational", "inevitable", "lfg", "let's go", "mooning",
    "accumulating", "dca", "buying more", "can't stop", "obsessed"
]

FUD_KEYWORDS = [
    "scam", "rug", "rugpull", "honeypot", "dump", "dumping", "sell",
    "exit scam", "ponzi", "dead", "dying", "bearish", "avoid",
    "warning", "careful", "sus", "suspicious", "fake"
]

POSITIVE_KEYWORDS = [
    "bullish", "moon", "gem", "alpha", "based", "fire", "insane",
    "massive", "huge", "exploding", "pumping", "flying", "ripping"
]

NEGATIVE_KEYWORDS = [
    "bearish", "crash", "crashing", "tanking", "bleeding", "rekt",
    "down bad", "loss", "losing", "failed", "dead", "over"
]


def analyze_sentiment(text: str) -> tuple[float, bool, float]:
    """
    Simple keyword-based sentiment analysis.
    
    Returns:
        Tuple of (sentiment -1 to 1, has_conviction, fud_level 0 to 1)
    """
    text_lower = text.lower()
    
    positive = sum(1 for w in POSITIVE_KEYWORDS if w in text_lower)
    negative = sum(1 for w in NEGATIVE_KEYWORDS if w in text_lower)
    conviction = sum(1 for w in CONVICTION_KEYWORDS if w in text_lower)
    fud = sum(1 for w in FUD_KEYWORDS if w in text_lower)
    
    total = positive + negative
    sentiment = (positive - negative) / max(total, 1)
    has_conviction = conviction > 0
    fud_level = min(fud / 3, 1.0)  # Normalize
    
    return sentiment, has_conviction, fud_level

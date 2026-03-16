"""
Meme-to-Market Intelligence Bot - Core Types and Data Models

This module defines the data structures for tracking:
- Meme/narrative relevance
- Social attention signals
- Trust and actor quality
- Market confirmation
- Breakout probability
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


class AccountTier(Enum):
    """Classification of X/Twitter accounts by signal quality."""
    MAINSTREAM_HIGH_PROFILE = "mainstream_high_profile"  # govt, media, celebrities, brands
    CRYPTO_NATIVE_LARGE = "crypto_native_large"          # traders, influencers, founders
    NICHE_BRIDGE = "niche_bridge"                        # cross-community reach
    CRYPTO_NATIVE_MID = "crypto_native_mid"              # smaller but engaged
    LOW_SIGNAL = "low_signal"                            # anon, low engagement
    SUSPICIOUS = "suspicious"                            # bot-like, coordinated


class TokenStatus(Enum):
    """Current assessment status of a token."""
    DORMANT = "dormant"
    EARLY_SIGNAL = "early_signal"
    NARRATIVE_BUILDING = "narrative_building"
    SOCIAL_HEATING = "social_heating"
    MARKET_CONFIRMING = "market_confirming"
    BREAKOUT_POTENTIAL = "breakout_potential"
    PEAKED = "peaked"
    SUSPICIOUS = "suspicious"
    DUMP_RISK = "dump_risk"


@dataclass
class AccountProfile:
    """Profile of an X/Twitter account for signal quality assessment."""
    account_id: str
    username: str
    display_name: str
    followers: int
    following: int
    tweet_count: int
    created_at: datetime
    verified: bool
    
    # Derived quality signals
    tier: AccountTier = AccountTier.LOW_SIGNAL
    avg_engagement: float = 0.0
    engagement_rate: float = 0.0
    is_crypto_native: bool = False
    influence_score: float = 0.0
    
    # Trust signals
    account_age_days: int = 0
    follower_following_ratio: float = 0.0
    
    def calculate_influence_score(self) -> float:
        """
        Calculate influence score based on multiple factors.
        Not just follower count - engagement matters more.
        """
        base_score = 0.0
        
        # Follower component (logarithmic to prevent huge accounts dominating)
        import math
        if self.followers > 0:
            base_score += min(math.log10(self.followers) * 10, 70)  # max 70 points
        
        # Engagement rate component
        base_score += min(self.engagement_rate * 100, 20)  # max 20 points
        
        # Account age component (older = more trust, up to a point)
        age_factor = min(self.account_age_days / 365, 1.0)  # max 1 year credit
        base_score += age_factor * 10  # max 10 points
        
        self.influence_score = min(base_score, 100)
        return self.influence_score


@dataclass
class Tweet:
    """Individual tweet data for analysis."""
    tweet_id: str
    author_id: str
    author_username: str
    text: str
    created_at: datetime
    
    # Engagement metrics
    likes: int = 0
    retweets: int = 0
    replies: int = 0
    quotes: int = 0
    impressions: int = 0
    
    # Derived signals
    engagement_total: int = 0
    quote_to_retweet_ratio: float = 0.0
    
    # Classification
    mentions_token: bool = False
    mentions_narrative: bool = False
    is_original: bool = True  # vs retweet
    sentiment: float = 0.0  # -1 to 1
    conviction_level: float = 0.0  # 0 to 1
    
    def calculate_engagement(self):
        """Calculate total engagement and ratios."""
        self.engagement_total = self.likes + self.retweets + self.replies + self.quotes
        if self.retweets > 0:
            self.quote_to_retweet_ratio = self.quotes / self.retweets
        return self.engagement_total


@dataclass
class MemeRelevanceScore:
    """
    Layer 1: Meme and Narrative Relevance
    
    Measures whether the underlying meme/narrative has life OUTSIDE the token.
    This is the key differentiator - we care about cultural relevance first.
    """
    score: float = 0.0  # 0-100
    
    # Component metrics
    meme_mention_count: int = 0           # mentions of meme itself (not token)
    meme_mention_velocity: float = 0.0    # mentions per hour, rate of change
    mainstream_account_touches: int = 0    # high-profile non-crypto accounts
    non_crypto_account_touches: int = 0    # any non-crypto accounts
    cross_community_spread: float = 0.0    # diversity of communities touching it
    narrative_concentration: float = 0.0   # how focused vs scattered the narrative is
    outside_bubble_score: float = 0.0      # % of attention from outside crypto
    
    # Qualitative flags
    has_mainstream_media_mention: bool = False
    has_celebrity_mention: bool = False
    has_government_mention: bool = False
    has_viral_non_crypto_post: bool = False
    
    last_updated: datetime = field(default_factory=datetime.utcnow)
    
    def calculate_score(self) -> float:
        """
        Calculate meme relevance score.
        
        Higher weight on outside-crypto signals because that's the edge.
        """
        score = 0.0
        
        # Mainstream touches are gold (0-30 points)
        mainstream_points = min(self.mainstream_account_touches * 10, 30)
        score += mainstream_points
        
        # Non-crypto spread (0-25 points)
        score += min(self.outside_bubble_score * 25, 25)
        
        # Cross-community diversity (0-20 points)
        score += min(self.cross_community_spread * 20, 20)
        
        # Velocity matters - growing attention (0-15 points)
        import math
        if self.meme_mention_velocity > 0:
            velocity_score = min(math.log10(self.meme_mention_velocity + 1) * 5, 15)
            score += velocity_score
        
        # Bonus flags (0-10 points)
        if self.has_mainstream_media_mention:
            score += 3
        if self.has_celebrity_mention:
            score += 3
        if self.has_government_mention:
            score += 4
        
        self.score = min(score, 100)
        return self.score


@dataclass
class SocialHeatScore:
    """
    Layer 2: Token Social Attention
    
    Measures live social behavior around the TOKEN specifically.
    """
    score: float = 0.0  # 0-100
    
    # Volume metrics
    mention_count_1h: int = 0
    mention_count_24h: int = 0
    mention_velocity: float = 0.0         # rate of change in mentions
    mention_acceleration: float = 0.0     # acceleration of velocity
    
    # Author metrics
    unique_authors_1h: int = 0
    unique_authors_24h: int = 0
    author_growth_rate: float = 0.0       # new authors joining conversation
    
    # Engagement metrics
    total_engagement_1h: int = 0
    engagement_velocity: float = 0.0
    avg_engagement_per_tweet: float = 0.0
    quote_to_retweet_ratio: float = 0.0   # higher = more discussion
    
    # Persistence metrics
    conversation_persistence: float = 0.0  # how long threads stay active
    reply_chain_depth: float = 0.0         # avg depth of reply chains
    
    # Sentiment
    sentiment_ratio: float = 0.5          # 0 = all negative, 1 = all positive
    sentiment_momentum: float = 0.0       # change in sentiment
    conviction_language_score: float = 0.0  # "this is it", "aping", etc.
    fud_intensity: float = 0.0            # fear/uncertainty/doubt level
    
    last_updated: datetime = field(default_factory=datetime.utcnow)
    
    def calculate_score(self) -> float:
        """
        Calculate social heat score.
        
        Balance between volume and quality of attention.
        """
        import math
        score = 0.0
        
        # Mention velocity (0-25 points) - how fast is it growing
        if self.mention_velocity > 0:
            score += min(math.log10(self.mention_velocity + 1) * 10, 25)
        
        # Unique author growth (0-25 points) - new people joining
        if self.author_growth_rate > 0:
            score += min(self.author_growth_rate * 25, 25)
        
        # Engagement intensity (0-20 points)
        if self.avg_engagement_per_tweet > 0:
            score += min(math.log10(self.avg_engagement_per_tweet + 1) * 8, 20)
        
        # Conversation quality (0-15 points)
        score += self.quote_to_retweet_ratio * 5  # more quotes = more discussion
        score += min(self.conversation_persistence * 10, 10)
        
        # Sentiment health (0-15 points) - positive but not suspiciously so
        if 0.5 <= self.sentiment_ratio <= 0.85:  # healthy range
            score += 10
        elif self.sentiment_ratio > 0.85:  # too positive = suspicious
            score += 5
        
        # Conviction language bonus
        score += min(self.conviction_language_score * 5, 5)
        
        self.score = min(score, 100)
        return self.score


@dataclass
class TrustScore:
    """
    Layer 3: Trust and Actor Quality
    
    This is the FILTER. High social heat means nothing if the push is fake.
    """
    score: float = 0.0  # 0-100
    
    # Dev/Team signals
    dev_visible: bool = False
    team_doxxed: bool = False
    has_prior_projects: bool = False
    prior_projects_legit: bool = False
    
    # Community signals
    community_age_days: int = 0
    community_consistency: float = 0.0    # same people over time vs churn
    organic_growth_pattern: bool = True
    
    # Account quality of promoters
    avg_promoter_account_age: float = 0.0
    avg_promoter_followers: float = 0.0
    promoter_diversity: float = 0.0       # how spread out vs concentrated
    
    # Coordination detection
    network_concentration: float = 0.0    # do promoters all follow each other?
    posting_time_clustering: float = 0.0  # do posts happen in suspicious bursts?
    same_language_patterns: float = 0.0   # copy-paste detection
    
    # Red flags
    known_scam_wallets_connected: bool = False
    honeypot_indicators: bool = False
    rug_pattern_match: float = 0.0
    sybil_attack_indicators: float = 0.0
    
    # Warning counts
    red_flag_count: int = 0
    yellow_flag_count: int = 0
    
    last_updated: datetime = field(default_factory=datetime.utcnow)
    
    def calculate_score(self) -> float:
        """
        Calculate trust score.
        
        Start at 50 (neutral) and add/subtract based on signals.
        """
        score = 50.0  # baseline neutral
        
        # Positive signals
        if self.dev_visible:
            score += 10
        if self.team_doxxed:
            score += 10
        if self.has_prior_projects and self.prior_projects_legit:
            score += 10
        if self.organic_growth_pattern:
            score += 5
        if self.community_age_days > 7:
            score += min(self.community_age_days / 30 * 5, 5)
        
        # Promoter quality
        score += min(self.promoter_diversity * 10, 10)
        
        # Negative signals - these hit hard
        if self.known_scam_wallets_connected:
            score -= 40
        if self.honeypot_indicators:
            score -= 50
        
        score -= self.rug_pattern_match * 30
        score -= self.network_concentration * 15  # too concentrated = sus
        score -= self.posting_time_clustering * 10
        score -= self.sybil_attack_indicators * 20
        
        # Red/yellow flags
        score -= self.red_flag_count * 10
        score -= self.yellow_flag_count * 3
        
        self.score = max(0, min(score, 100))
        return self.score


@dataclass
class MarketConfirmationScore:
    """
    Layer 4: Market Validation
    
    Is the attention translating into actual money flow?
    """
    score: float = 0.0  # 0-100
    
    # Price metrics
    price_usd: float = 0.0
    price_change_1h: float = 0.0          # percentage
    price_change_24h: float = 0.0
    price_velocity: float = 0.0           # rate of change
    price_acceleration: float = 0.0
    
    # Volume metrics
    volume_24h: float = 0.0
    volume_change_1h: float = 0.0
    volume_change_24h: float = 0.0
    volume_surge_detected: bool = False
    
    # Liquidity
    liquidity_usd: float = 0.0
    liquidity_change_24h: float = 0.0
    
    # Market cap
    market_cap: float = 0.0
    market_cap_velocity: float = 0.0
    fdv: float = 0.0
    
    # Volatility
    volatility_1h: float = 0.0
    volatility_24h: float = 0.0
    
    # Social-price correlation
    price_social_correlation: float = 0.0   # are they moving together?
    price_social_divergence: float = 0.0    # social up but price down = bad
    social_leads_price: bool = False        # does social predict price?
    
    # Trade activity
    buy_sell_ratio: float = 0.5            # >0.5 = more buys
    unique_buyers_24h: int = 0
    whale_activity_detected: bool = False
    
    last_updated: datetime = field(default_factory=datetime.utcnow)
    
    def calculate_score(self) -> float:
        """
        Calculate market confirmation score.
        
        Looking for: price responding to attention, healthy volume, good liquidity.
        """
        import math
        score = 0.0
        
        # Price momentum (0-30 points)
        if self.price_change_1h > 0:
            score += min(self.price_change_1h * 2, 15)
        if self.price_change_24h > 0:
            score += min(self.price_change_24h * 0.5, 15)
        
        # Volume confirmation (0-25 points)
        if self.volume_surge_detected:
            score += 10
        if self.volume_change_24h > 0:
            score += min(math.log10(self.volume_change_24h + 1) * 5, 15)
        
        # Liquidity health (0-15 points)
        if self.liquidity_usd > 10000:
            score += min(math.log10(self.liquidity_usd) * 3, 15)
        
        # Social-price alignment (0-20 points)
        if self.price_social_correlation > 0.5:
            score += self.price_social_correlation * 15
        if self.social_leads_price:
            score += 5
        
        # Buy pressure (0-10 points)
        if self.buy_sell_ratio > 0.5:
            score += (self.buy_sell_ratio - 0.5) * 20  # max 10 at 1.0 ratio
        
        # Penalize divergence
        score -= self.price_social_divergence * 15
        
        self.score = max(0, min(score, 100))
        return self.score


@dataclass
class BreakoutProbability:
    """
    Layer 5: Combined Prediction
    
    The final signal combining all layers.
    """
    probability: float = 0.0  # 0-100
    
    # Component scores (references)
    meme_relevance: float = 0.0
    social_heat: float = 0.0
    trust: float = 0.0
    market_confirmation: float = 0.0
    
    # Derived signals
    attention_acceleration: float = 0.0
    momentum_strength: float = 0.0
    durability_score: float = 0.0         # will this last or flash in pan?
    
    # Phase detection
    current_phase: str = "unknown"
    phase_confidence: float = 0.0
    
    # Risk assessment
    downside_risk: float = 0.0
    rug_risk: float = 0.0
    
    status: TokenStatus = TokenStatus.DORMANT
    status_message: str = ""
    
    last_updated: datetime = field(default_factory=datetime.utcnow)
    
    def calculate_probability(
        self,
        meme: MemeRelevanceScore,
        social: SocialHeatScore,
        trust: TrustScore,
        market: MarketConfirmationScore
    ) -> float:
        """
        Calculate breakout probability from component scores.
        
        The key insight: all four must align for real breakout potential.
        """
        self.meme_relevance = meme.score
        self.social_heat = social.score
        self.trust = trust.score
        self.market_confirmation = market.score
        
        # Trust is a hard filter - low trust kills the signal
        if trust.score < 30:
            self.probability = min(20, (meme.score + social.score + market.score) / 10)
            self.status = TokenStatus.SUSPICIOUS
            self.status_message = "Low trust - approach with extreme caution"
            return self.probability
        
        # Base probability from weighted average
        # Meme relevance is most important - it's the leading indicator
        weights = {
            'meme': 0.30,
            'social': 0.25,
            'trust': 0.20,
            'market': 0.25
        }
        
        base_prob = (
            meme.score * weights['meme'] +
            social.score * weights['social'] +
            trust.score * weights['trust'] +
            market.score * weights['market']
        )
        
        # Alignment bonus: if all signals agree, probability goes up
        scores = [meme.score, social.score, trust.score, market.score]
        min_score = min(scores)
        max_score = max(scores)
        alignment = 1 - (max_score - min_score) / 100  # 1 = perfect alignment
        
        aligned_prob = base_prob * (1 + alignment * 0.2)  # up to 20% bonus
        
        # Determine status
        self._determine_status(meme, social, trust, market, aligned_prob)
        
        self.probability = min(aligned_prob, 100)
        return self.probability
    
    def _determine_status(
        self,
        meme: MemeRelevanceScore,
        social: SocialHeatScore,
        trust: TrustScore,
        market: MarketConfirmationScore,
        prob: float
    ):
        """Determine current token status based on signals."""
        
        if trust.score < 30:
            self.status = TokenStatus.SUSPICIOUS
            self.status_message = "Trust signals are concerning"
        elif prob >= 70 and market.score >= 60:
            self.status = TokenStatus.BREAKOUT_POTENTIAL
            self.status_message = "Strong alignment across all signals"
        elif market.score >= 60 and social.score >= 50:
            self.status = TokenStatus.MARKET_CONFIRMING
            self.status_message = "Market is validating social attention"
        elif social.score >= 60:
            self.status = TokenStatus.SOCIAL_HEATING
            self.status_message = "Social attention building rapidly"
        elif meme.score >= 50:
            self.status = TokenStatus.NARRATIVE_BUILDING
            self.status_message = "Narrative gaining traction"
        elif meme.score >= 30 or social.score >= 30:
            self.status = TokenStatus.EARLY_SIGNAL
            self.status_message = "Early signals detected - monitor closely"
        else:
            self.status = TokenStatus.DORMANT
            self.status_message = "No significant signals"


@dataclass
class TokenIntelligence:
    """
    Complete intelligence profile for a token.
    
    This is the main object that gets updated and queried.
    """
    # Token identifiers
    token_address: str
    token_symbol: str
    token_name: str
    chain: str = "solana"  # solana, ethereum, base, etc.
    
    # Associated narratives/keywords
    narrative_keywords: list = field(default_factory=list)
    meme_keywords: list = field(default_factory=list)
    
    # The five pillar scores
    meme_relevance: MemeRelevanceScore = field(default_factory=MemeRelevanceScore)
    social_heat: SocialHeatScore = field(default_factory=SocialHeatScore)
    trust: TrustScore = field(default_factory=TrustScore)
    market_confirmation: MarketConfirmationScore = field(default_factory=MarketConfirmationScore)
    breakout: BreakoutProbability = field(default_factory=BreakoutProbability)
    
    # Tracking
    watchlist_added: datetime = field(default_factory=datetime.utcnow)
    last_updated: datetime = field(default_factory=datetime.utcnow)
    update_count: int = 0
    
    # Alert state
    last_alert_sent: Optional[datetime] = None
    alert_threshold_met: bool = False
    
    def update_all_scores(self):
        """Recalculate all scores and breakout probability."""
        self.meme_relevance.calculate_score()
        self.social_heat.calculate_score()
        self.trust.calculate_score()
        self.market_confirmation.calculate_score()
        self.breakout.calculate_probability(
            self.meme_relevance,
            self.social_heat,
            self.trust,
            self.market_confirmation
        )
        self.last_updated = datetime.utcnow()
        self.update_count += 1
    
    def to_alert_message(self) -> str:
        """Generate Telegram-ready alert message."""
        return f"""
🎯 *Token: {self.token_symbol}*
📖 Narrative: {', '.join(self.narrative_keywords[:3]) if self.narrative_keywords else 'N/A'}

*Scores:*
├ Meme Relevance: {self.meme_relevance.score:.0f}
├ Social Heat: {self.social_heat.score:.0f}
├ Trust Score: {self.trust.score:.0f}
├ Market Confirmation: {self.market_confirmation.score:.0f}
└ *Breakout Probability: {self.breakout.probability:.0f}*

*Status:* {self.breakout.status.value.replace('_', ' ').title()}
{self.breakout.status_message}

🕐 Updated: {self.last_updated.strftime('%H:%M UTC')}
        """.strip()
    
    def to_summary_dict(self) -> dict:
        """Export as dictionary for storage/API."""
        return {
            'token_address': self.token_address,
            'token_symbol': self.token_symbol,
            'chain': self.chain,
            'narratives': self.narrative_keywords,
            'scores': {
                'meme_relevance': self.meme_relevance.score,
                'social_heat': self.social_heat.score,
                'trust': self.trust.score,
                'market_confirmation': self.market_confirmation.score,
                'breakout_probability': self.breakout.probability
            },
            'status': self.breakout.status.value,
            'status_message': self.breakout.status_message,
            'last_updated': self.last_updated.isoformat()
        }

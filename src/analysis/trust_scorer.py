"""
Trust Score Analysis System

This module implements the "Trust and Actor Quality" layer.
It's the FILTER - high social heat means nothing if the push is fake.

Key questions:
- Are the people pushing this credible?
- Is the growth organic or coordinated?
- Are there scam signals?
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional
from collections import defaultdict
import re


@dataclass
class TrustAnalysis:
    """
    Complete trust analysis for a token.
    """
    token_symbol: str
    
    # Dev/Team signals
    dev_wallet_known: bool = False
    dev_doxxed: bool = False
    team_visible: bool = False
    has_website: bool = False
    has_whitepaper: bool = False
    has_github: bool = False
    prior_projects: list = field(default_factory=list)
    prior_projects_clean: bool = True
    
    # Community signals
    telegram_exists: bool = False
    telegram_members: int = 0
    discord_exists: bool = False
    discord_members: int = 0
    community_age_days: int = 0
    
    # Account quality analysis
    promoter_accounts: list = field(default_factory=list)
    avg_promoter_age_days: float = 0.0
    avg_promoter_followers: float = 0.0
    promoter_diversity_score: float = 0.0  # 0-1, higher = more diverse
    
    # Coordination detection
    posting_time_variance: float = 0.0  # Higher = more natural
    language_similarity: float = 0.0  # Higher = more copy-paste (bad)
    network_density: float = 0.0  # How interconnected promoters are (high = sus)
    amplification_ratio: float = 0.0  # Retweets to originals (high = bot-like)
    
    # Red flags
    red_flags: list = field(default_factory=list)
    yellow_flags: list = field(default_factory=list)
    
    # Known bad actor detection
    connected_to_known_scam: bool = False
    honeypot_check_failed: bool = False
    
    # Final score
    trust_score: float = 50.0
    risk_level: str = "medium"
    
    analysis_timestamp: datetime = field(default_factory=datetime.utcnow)


class TrustScorer:
    """
    Calculates trust scores based on multiple signals.
    """
    
    # Known scam patterns
    SCAM_PATTERNS = [
        r"100x guaranteed",
        r"get rich quick",
        r"guaranteed returns",
        r"dev wallet locked",  # Often false claims
        r"next .{3,10} killer",
        r"stealth launch|fair launch|no presale",  # Sometimes legit, often not
    ]
    
    # Known bad wallet patterns (example - in production this would be a database)
    KNOWN_SCAM_WALLETS = set([
        # Add known scam wallet addresses here
    ])
    
    # Coordinated posting time threshold (in minutes)
    COORDINATION_TIME_THRESHOLD = 5
    
    def __init__(self):
        self._account_cache: dict[str, dict] = {}
    
    def analyze_promoter_coordination(
        self,
        tweets: list['Tweet'],
        accounts: list['TwitterAccount']
    ) -> dict:
        """
        Analyze whether promoters appear to be coordinated.
        
        Looks for:
        - Clustered posting times
        - Similar language/copy-paste
        - Same hashtags
        - Cross-following patterns
        
        Returns dict with coordination signals.
        """
        if not tweets:
            return {
                "coordination_score": 0.0,
                "posting_time_variance": 1.0,
                "language_similarity": 0.0,
                "suspicious_patterns": []
            }
        
        # Analyze posting time distribution
        times = sorted([t.created_at for t in tweets])
        time_gaps = []
        for i in range(1, len(times)):
            gap = (times[i] - times[i-1]).total_seconds() / 60  # minutes
            time_gaps.append(gap)
        
        # Calculate variance - low variance = suspicious clustering
        if time_gaps:
            avg_gap = sum(time_gaps) / len(time_gaps)
            variance = sum((g - avg_gap) ** 2 for g in time_gaps) / len(time_gaps)
            # Normalize: higher = more natural spread
            time_variance = min(variance / 100, 1.0)
        else:
            time_variance = 1.0
        
        # Detect clustered bursts
        suspicious_bursts = 0
        for i, gap in enumerate(time_gaps):
            if gap < self.COORDINATION_TIME_THRESHOLD:
                suspicious_bursts += 1
        
        burst_ratio = suspicious_bursts / max(len(time_gaps), 1)
        
        # Analyze language similarity
        texts = [t.text.lower() for t in tweets]
        similarity = self._calculate_text_similarity(texts)
        
        # Detect copy-paste patterns
        copy_paste_detected = similarity > 0.5
        
        # Build coordination score
        coordination_score = 0.0
        patterns = []
        
        if burst_ratio > 0.3:
            coordination_score += 0.3
            patterns.append(f"Clustered posting detected ({burst_ratio:.0%} within 5min)")
        
        if similarity > 0.5:
            coordination_score += 0.3
            patterns.append(f"Similar language patterns ({similarity:.0%} similarity)")
        
        if similarity > 0.7:
            coordination_score += 0.2
            patterns.append("Likely copy-paste content")
        
        return {
            "coordination_score": min(coordination_score, 1.0),
            "posting_time_variance": time_variance,
            "language_similarity": similarity,
            "burst_ratio": burst_ratio,
            "suspicious_patterns": patterns
        }
    
    def _calculate_text_similarity(self, texts: list[str]) -> float:
        """
        Calculate average pairwise similarity of texts.
        Uses simple Jaccard similarity on words.
        """
        if len(texts) < 2:
            return 0.0
        
        # Tokenize
        word_sets = []
        for text in texts:
            # Remove URLs and @mentions
            clean = re.sub(r'https?://\S+', '', text)
            clean = re.sub(r'@\w+', '', clean)
            words = set(clean.split())
            word_sets.append(words)
        
        # Calculate pairwise Jaccard similarity
        similarities = []
        for i in range(len(word_sets)):
            for j in range(i + 1, len(word_sets)):
                if word_sets[i] and word_sets[j]:
                    intersection = len(word_sets[i] & word_sets[j])
                    union = len(word_sets[i] | word_sets[j])
                    sim = intersection / union if union > 0 else 0
                    similarities.append(sim)
        
        return sum(similarities) / len(similarities) if similarities else 0.0
    
    def analyze_account_quality(
        self,
        accounts: list['TwitterAccount']
    ) -> dict:
        """
        Analyze the quality of accounts promoting the token.
        
        High-quality promoters = more trust
        Bot-like or new accounts = less trust
        """
        if not accounts:
            return {
                "quality_score": 0.5,
                "avg_age_days": 0,
                "avg_followers": 0,
                "diversity_score": 0.0,
                "suspicious_accounts": []
            }
        
        ages = []
        followers = []
        suspicious = []
        
        now = datetime.utcnow()
        
        for account in accounts:
            # Account age
            age_days = (now - account.created_at).days
            ages.append(age_days)
            
            # Followers
            followers.append(account.followers_count)
            
            # Check for suspicious patterns
            issues = []
            
            # New account
            if age_days < 30:
                issues.append("Account less than 30 days old")
            
            # Unusual follower/following ratio
            if account.following_count > 0:
                ratio = account.followers_count / account.following_count
                if ratio < 0.1:  # Following way more than followers
                    issues.append("Low follower/following ratio")
            
            # Very low tweet count for age
            if age_days > 90 and account.tweet_count < 10:
                issues.append("Very few tweets for account age")
            
            # High tweet count but low followers (bot pattern)
            if account.tweet_count > 10000 and account.followers_count < 100:
                issues.append("High tweet volume, low followers")
            
            if issues:
                suspicious.append({
                    "username": account.username,
                    "issues": issues
                })
        
        # Calculate averages
        avg_age = sum(ages) / len(ages) if ages else 0
        avg_followers = sum(followers) / len(followers) if followers else 0
        
        # Diversity score - are promoters diverse or concentrated?
        # High diversity = many different types of accounts
        follower_variance = 0
        if len(followers) > 1:
            mean = sum(followers) / len(followers)
            follower_variance = sum((f - mean) ** 2 for f in followers) / len(followers)
            # Normalize
            diversity = min(follower_variance / (mean ** 2 + 1), 1.0)
        else:
            diversity = 0.0
        
        # Quality score
        quality = 0.5  # baseline
        
        # Boost for established accounts
        if avg_age > 365:
            quality += 0.15
        elif avg_age > 90:
            quality += 0.1
        elif avg_age < 30:
            quality -= 0.2
        
        # Boost for followed accounts
        if avg_followers > 10000:
            quality += 0.15
        elif avg_followers > 1000:
            quality += 0.1
        elif avg_followers < 100:
            quality -= 0.15
        
        # Penalty for suspicious accounts
        suspicious_ratio = len(suspicious) / len(accounts)
        quality -= suspicious_ratio * 0.3
        
        return {
            "quality_score": max(0, min(quality, 1.0)),
            "avg_age_days": avg_age,
            "avg_followers": avg_followers,
            "diversity_score": diversity,
            "suspicious_accounts": suspicious,
            "suspicious_ratio": suspicious_ratio
        }
    
    def detect_red_flags(
        self,
        tweets: list['Tweet'],
        token_info: dict = None
    ) -> tuple[list[str], list[str]]:
        """
        Detect red and yellow flags based on content and patterns.
        
        Returns:
            Tuple of (red_flags, yellow_flags)
        """
        red_flags = []
        yellow_flags = []
        
        all_text = " ".join(t.text.lower() for t in tweets)
        
        # Check for scam language patterns
        for pattern in self.SCAM_PATTERNS:
            if re.search(pattern, all_text, re.IGNORECASE):
                yellow_flags.append(f"Suspicious language pattern: '{pattern}'")
        
        # Check for excessive emojis (bot pattern)
        emoji_count = len(re.findall(r'[\U0001F600-\U0001F64F\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF]', all_text))
        if emoji_count > len(tweets) * 5:
            yellow_flags.append("Excessive emoji usage (possible bot activity)")
        
        # Check for price promises
        if re.search(r'\d+x|\d+\s*percent|guaranteed', all_text, re.IGNORECASE):
            yellow_flags.append("Contains price/return promises")
        
        # Check token info if available
        if token_info:
            # Very low liquidity
            if token_info.get("liquidity_usd", 0) < 1000:
                red_flags.append("Extremely low liquidity (< $1K)")
            elif token_info.get("liquidity_usd", 0) < 5000:
                yellow_flags.append("Low liquidity (< $5K)")
            
            # Very new token
            created = token_info.get("pair_created_at")
            if created:
                age_hours = (datetime.utcnow() - created).total_seconds() / 3600
                if age_hours < 1:
                    yellow_flags.append("Token less than 1 hour old")
                elif age_hours < 24:
                    yellow_flags.append("Token less than 24 hours old")
            
            # Concentrated holders (if available)
            top_holder_pct = token_info.get("top_holder_percentage", 0)
            if top_holder_pct > 50:
                red_flags.append(f"Top holder owns {top_holder_pct}% of supply")
            elif top_holder_pct > 20:
                yellow_flags.append(f"Top holder owns {top_holder_pct}% of supply")
        
        return red_flags, yellow_flags
    
    def calculate_trust_score(
        self,
        coordination_analysis: dict,
        account_quality: dict,
        red_flags: list[str],
        yellow_flags: list[str],
        token_info: dict = None
    ) -> 'TrustScore':
        """
        Calculate final trust score from all signals.
        """
        from types import TrustScore
        
        score = TrustScore()
        
        # Start at neutral
        base_score = 50.0
        
        # Account quality component (±25 points)
        quality = account_quality.get("quality_score", 0.5)
        base_score += (quality - 0.5) * 50  # -25 to +25
        
        # Coordination penalty (up to -30 points)
        coord = coordination_analysis.get("coordination_score", 0)
        base_score -= coord * 30
        
        # Red flags are severe (-15 each)
        base_score -= len(red_flags) * 15
        
        # Yellow flags are warnings (-5 each)
        base_score -= len(yellow_flags) * 5
        
        # Promoter diversity bonus (up to +10)
        diversity = account_quality.get("diversity_score", 0)
        base_score += diversity * 10
        
        # Populate score object
        score.score = max(0, min(base_score, 100))
        
        score.promoter_diversity = diversity
        score.network_concentration = coordination_analysis.get("coordination_score", 0)
        score.posting_time_clustering = 1 - coordination_analysis.get("posting_time_variance", 1)
        score.same_language_patterns = coordination_analysis.get("language_similarity", 0)
        
        score.red_flag_count = len(red_flags)
        score.yellow_flag_count = len(yellow_flags)
        
        # Token-specific signals if available
        if token_info:
            score.community_age_days = 0  # Would need community data
            if token_info.get("liquidity_usd", 0) > 50000:
                score.score += 5  # Liquidity bonus
        
        score.calculate_score()
        
        return score


class TrustAnalyzer:
    """
    High-level trust analysis combining all components.
    """
    
    def __init__(self):
        self.scorer = TrustScorer()
    
    async def analyze_token_trust(
        self,
        token_symbol: str,
        tweets: list['Tweet'],
        accounts: list['TwitterAccount'],
        token_info: dict = None
    ) -> TrustAnalysis:
        """
        Perform complete trust analysis for a token.
        
        Args:
            token_symbol: Token symbol
            tweets: Recent tweets about the token
            accounts: Accounts that posted about it
            token_info: Market data (optional)
            
        Returns:
            TrustAnalysis with full breakdown
        """
        analysis = TrustAnalysis(token_symbol=token_symbol)
        
        # Coordination analysis
        coord = self.scorer.analyze_promoter_coordination(tweets, accounts)
        analysis.posting_time_variance = coord["posting_time_variance"]
        analysis.language_similarity = coord["language_similarity"]
        analysis.network_density = coord["coordination_score"]
        
        # Account quality
        quality = self.scorer.analyze_account_quality(accounts)
        analysis.avg_promoter_age_days = quality["avg_age_days"]
        analysis.avg_promoter_followers = quality["avg_followers"]
        analysis.promoter_diversity_score = quality["diversity_score"]
        
        # Red flags
        red_flags, yellow_flags = self.scorer.detect_red_flags(tweets, token_info)
        analysis.red_flags = red_flags
        analysis.yellow_flags = yellow_flags
        
        # Add coordination warnings to flags
        for pattern in coord["suspicious_patterns"]:
            analysis.yellow_flags.append(pattern)
        
        for suspicious in quality["suspicious_accounts"]:
            analysis.yellow_flags.append(
                f"Suspicious account @{suspicious['username']}: {', '.join(suspicious['issues'])}"
            )
        
        # Calculate final score
        trust_score = self.scorer.calculate_trust_score(
            coord, quality, red_flags, yellow_flags, token_info
        )
        analysis.trust_score = trust_score.score
        
        # Set risk level
        if analysis.trust_score >= 70:
            analysis.risk_level = "low"
        elif analysis.trust_score >= 40:
            analysis.risk_level = "medium"
        else:
            analysis.risk_level = "high"
        
        return analysis
    
    def generate_trust_report(self, analysis: TrustAnalysis) -> str:
        """
        Generate human-readable trust report.
        """
        emoji = {
            "low": "🟢",
            "medium": "🟡", 
            "high": "🔴"
        }
        
        report = f"""
🔍 *Trust Analysis: {analysis.token_symbol}*

*Overall Score:* {analysis.trust_score:.0f}/100 {emoji.get(analysis.risk_level, "⚪")}
*Risk Level:* {analysis.risk_level.upper()}

*Promoter Quality:*
├ Avg Account Age: {analysis.avg_promoter_age_days:.0f} days
├ Avg Followers: {analysis.avg_promoter_followers:.0f}
└ Diversity Score: {analysis.promoter_diversity_score:.2f}

*Coordination Signals:*
├ Time Clustering: {(1 - analysis.posting_time_variance) * 100:.0f}%
├ Language Similarity: {analysis.language_similarity * 100:.0f}%
└ Network Density: {analysis.network_density * 100:.0f}%
"""
        
        if analysis.red_flags:
            report += "\n*🚨 Red Flags:*\n"
            for flag in analysis.red_flags[:5]:
                report += f"• {flag}\n"
        
        if analysis.yellow_flags:
            report += "\n*⚠️ Yellow Flags:*\n"
            for flag in analysis.yellow_flags[:5]:
                report += f"• {flag}\n"
        
        if not analysis.red_flags and not analysis.yellow_flags:
            report += "\n✅ No major warning signs detected\n"
        
        return report.strip()

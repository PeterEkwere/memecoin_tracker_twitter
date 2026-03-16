"""
DexScreener API Client - FREE market data

DexScreener provides completely free API access with no key required.
Covers most major DEXs across chains.

API Docs: https://docs.dexscreener.com/api/reference
"""

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
import aiohttp


@dataclass
class DexScreenerToken:
    """Token data from DexScreener."""
    address: str
    name: str
    symbol: str
    chain: str
    
    # Price data
    price_usd: float
    price_change_5m: float
    price_change_1h: float
    price_change_6h: float
    price_change_24h: float
    
    # Volume
    volume_5m: float
    volume_1h: float
    volume_6h: float
    volume_24h: float
    
    # Liquidity
    liquidity_usd: float
    
    # Market cap
    market_cap: float
    fdv: float
    
    # Transaction counts
    txns_5m_buys: int
    txns_5m_sells: int
    txns_1h_buys: int
    txns_1h_sells: int
    txns_24h_buys: int
    txns_24h_sells: int
    
    # Pair info
    pair_address: str
    dex_id: str
    
    # Timestamps
    pair_created_at: Optional[datetime]
    fetched_at: datetime


class DexScreenerClient:
    """
    Client for DexScreener's free API.
    
    Rate limits: 300 requests per minute (very generous)
    No API key needed.
    """
    
    BASE_URL = "https://api.dexscreener.com"
    
    def __init__(self):
        self._session: Optional[aiohttp.ClientSession] = None
    
    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers={"Accept": "application/json"}
            )
        return self._session
    
    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()
    
    async def _request(self, endpoint: str) -> dict:
        """Make API request."""
        session = await self._get_session()
        url = f"{self.BASE_URL}{endpoint}"
        
        async with session.get(url) as response:
            if response.status == 200:
                return await response.json()
            elif response.status == 429:
                # Rate limited - wait and retry
                await asyncio.sleep(2)
                return await self._request(endpoint)
            else:
                raise Exception(f"DexScreener API error: {response.status}")
    
    async def get_token_by_address(
        self, 
        chain: str, 
        address: str
    ) -> Optional[DexScreenerToken]:
        """
        Get token data by contract address.
        
        Args:
            chain: Chain ID (solana, ethereum, base, bsc, etc.)
            address: Token contract address
            
        Returns:
            DexScreenerToken or None if not found
        """
        endpoint = f"/latest/dex/tokens/{address}"
        
        try:
            data = await self._request(endpoint)
            pairs = data.get("pairs", [])
            
            if not pairs:
                return None
            
            # Get the pair with highest liquidity on the target chain
            chain_pairs = [p for p in pairs if p.get("chainId") == chain]
            if not chain_pairs:
                chain_pairs = pairs  # fallback to any chain
            
            # Sort by liquidity
            sorted_pairs = sorted(
                chain_pairs,
                key=lambda x: x.get("liquidity", {}).get("usd", 0) or 0,
                reverse=True
            )
            
            pair = sorted_pairs[0]
            return self._parse_pair(pair)
            
        except Exception as e:
            print(f"Error fetching token {address}: {e}")
            return None
    
    async def search_tokens(self, query: str) -> list[DexScreenerToken]:
        """
        Search for tokens by name or symbol.
        
        Args:
            query: Search term
            
        Returns:
            List of matching tokens
        """
        endpoint = f"/latest/dex/search?q={query}"
        
        try:
            data = await self._request(endpoint)
            pairs = data.get("pairs", [])
            
            # Dedupe by token address, keeping highest liquidity
            seen = {}
            for pair in pairs:
                base_token = pair.get("baseToken", {})
                address = base_token.get("address")
                if not address:
                    continue
                    
                liquidity = pair.get("liquidity", {}).get("usd", 0) or 0
                
                if address not in seen or liquidity > seen[address]["liquidity"]:
                    seen[address] = {"pair": pair, "liquidity": liquidity}
            
            return [
                self._parse_pair(item["pair"]) 
                for item in seen.values()
            ]
            
        except Exception as e:
            print(f"Error searching tokens: {e}")
            return []
    
    async def get_trending_tokens(self, chain: str = None) -> list[DexScreenerToken]:
        """
        Get trending tokens (tokens with high activity).
        
        Note: DexScreener doesn't have a direct "trending" endpoint,
        so we use the boosted tokens endpoint as a proxy.
        """
        endpoint = "/token-boosts/latest/v1"
        
        try:
            data = await self._request(endpoint)
            
            tokens = []
            for item in data[:20]:  # top 20
                token_address = item.get("tokenAddress")
                chain_id = item.get("chainId")
                
                if chain and chain_id != chain:
                    continue
                
                if token_address:
                    token = await self.get_token_by_address(chain_id, token_address)
                    if token:
                        tokens.append(token)
            
            return tokens
            
        except Exception as e:
            print(f"Error fetching trending: {e}")
            return []
    
    def _parse_pair(self, pair: dict) -> DexScreenerToken:
        """Parse a pair response into DexScreenerToken."""
        base_token = pair.get("baseToken", {})
        price_change = pair.get("priceChange", {})
        volume = pair.get("volume", {})
        txns = pair.get("txns", {})
        liquidity = pair.get("liquidity", {})
        
        # Parse transaction counts
        def get_txns(period: str) -> tuple[int, int]:
            period_data = txns.get(period, {})
            return (
                period_data.get("buys", 0) or 0,
                period_data.get("sells", 0) or 0
            )
        
        txns_5m = get_txns("m5")
        txns_1h = get_txns("h1")
        txns_24h = get_txns("h24")
        
        # Parse creation timestamp
        created_at = None
        if pair.get("pairCreatedAt"):
            try:
                created_at = datetime.fromtimestamp(pair["pairCreatedAt"] / 1000)
            except:
                pass
        
        return DexScreenerToken(
            address=base_token.get("address", ""),
            name=base_token.get("name", ""),
            symbol=base_token.get("symbol", ""),
            chain=pair.get("chainId", ""),
            
            price_usd=float(pair.get("priceUsd", 0) or 0),
            price_change_5m=float(price_change.get("m5", 0) or 0),
            price_change_1h=float(price_change.get("h1", 0) or 0),
            price_change_6h=float(price_change.get("h6", 0) or 0),
            price_change_24h=float(price_change.get("h24", 0) or 0),
            
            volume_5m=float(volume.get("m5", 0) or 0),
            volume_1h=float(volume.get("h1", 0) or 0),
            volume_6h=float(volume.get("h6", 0) or 0),
            volume_24h=float(volume.get("h24", 0) or 0),
            
            liquidity_usd=float(liquidity.get("usd", 0) or 0),
            
            market_cap=float(pair.get("marketCap", 0) or 0),
            fdv=float(pair.get("fdv", 0) or 0),
            
            txns_5m_buys=txns_5m[0],
            txns_5m_sells=txns_5m[1],
            txns_1h_buys=txns_1h[0],
            txns_1h_sells=txns_1h[1],
            txns_24h_buys=txns_24h[0],
            txns_24h_sells=txns_24h[1],
            
            pair_address=pair.get("pairAddress", ""),
            dex_id=pair.get("dexId", ""),
            
            pair_created_at=created_at,
            fetched_at=datetime.utcnow()
        )


class MarketDataCollector:
    """
    Collects market data and updates MarketConfirmationScore.
    """
    
    def __init__(self):
        self.dex_client = DexScreenerClient()
        self._price_history: dict[str, list[tuple[datetime, float]]] = {}
        self._volume_history: dict[str, list[tuple[datetime, float]]] = {}
    
    async def close(self):
        await self.dex_client.close()
    
    async def update_market_score(
        self, 
        token_address: str,
        chain: str,
        social_heat_score: float
    ) -> 'MarketConfirmationScore':
        """
        Fetch market data and calculate MarketConfirmationScore.
        
        Args:
            token_address: Contract address
            chain: Chain ID
            social_heat_score: Current social heat for correlation calc
            
        Returns:
            Updated MarketConfirmationScore
        """
        from types import MarketConfirmationScore
        
        token = await self.dex_client.get_token_by_address(chain, token_address)
        
        if not token:
            # Return empty score if token not found
            return MarketConfirmationScore()
        
        # Track price history for velocity calculations
        self._update_history(token_address, token)
        
        # Calculate derived metrics
        price_velocity = self._calculate_velocity(
            self._price_history.get(token_address, [])
        )
        volume_velocity = self._calculate_velocity(
            self._volume_history.get(token_address, [])
        )
        
        # Detect volume surge (volume 2x+ normal)
        avg_volume = self._get_average_volume(token_address)
        volume_surge = token.volume_1h > (avg_volume * 2) if avg_volume > 0 else False
        
        # Calculate buy/sell ratio
        total_buys = token.txns_1h_buys + token.txns_24h_buys
        total_sells = token.txns_1h_sells + token.txns_24h_sells
        total_txns = total_buys + total_sells
        buy_sell_ratio = total_buys / total_txns if total_txns > 0 else 0.5
        
        # Calculate price-social correlation (simplified)
        # Positive correlation = both moving same direction
        price_direction = 1 if token.price_change_1h > 0 else -1
        social_direction = 1 if social_heat_score > 50 else -1
        price_social_corr = 0.5 + (0.5 if price_direction == social_direction else -0.25)
        
        # Detect divergence (social up, price down)
        divergence = 0.0
        if social_heat_score > 60 and token.price_change_1h < -5:
            divergence = min(abs(token.price_change_1h) / 20, 1.0)
        
        score = MarketConfirmationScore(
            price_usd=token.price_usd,
            price_change_1h=token.price_change_1h,
            price_change_24h=token.price_change_24h,
            price_velocity=price_velocity,
            price_acceleration=0.0,  # TODO: need more history
            
            volume_24h=token.volume_24h,
            volume_change_1h=(token.volume_1h / avg_volume * 100 - 100) if avg_volume > 0 else 0,
            volume_change_24h=volume_velocity,
            volume_surge_detected=volume_surge,
            
            liquidity_usd=token.liquidity_usd,
            liquidity_change_24h=0.0,  # TODO: track over time
            
            market_cap=token.market_cap,
            market_cap_velocity=0.0,  # TODO
            fdv=token.fdv,
            
            volatility_1h=abs(token.price_change_1h),
            volatility_24h=abs(token.price_change_24h),
            
            price_social_correlation=price_social_corr,
            price_social_divergence=divergence,
            social_leads_price=False,  # TODO: lag analysis
            
            buy_sell_ratio=buy_sell_ratio,
            unique_buyers_24h=token.txns_24h_buys,  # proxy
            whale_activity_detected=False  # TODO: on-chain analysis
        )
        
        score.calculate_score()
        return score
    
    def _update_history(self, address: str, token: DexScreenerToken):
        """Track price/volume history for velocity calculations."""
        now = datetime.utcnow()
        
        if address not in self._price_history:
            self._price_history[address] = []
        if address not in self._volume_history:
            self._volume_history[address] = []
        
        self._price_history[address].append((now, token.price_usd))
        self._volume_history[address].append((now, token.volume_1h))
        
        # Keep last 100 data points
        self._price_history[address] = self._price_history[address][-100:]
        self._volume_history[address] = self._volume_history[address][-100:]
    
    def _calculate_velocity(
        self, 
        history: list[tuple[datetime, float]]
    ) -> float:
        """Calculate rate of change from history."""
        if len(history) < 2:
            return 0.0
        
        recent = history[-1]
        older = history[-min(10, len(history))]
        
        time_diff = (recent[0] - older[0]).total_seconds()
        if time_diff <= 0:
            return 0.0
        
        value_diff = recent[1] - older[1]
        
        # Return percentage change per hour
        hourly_velocity = (value_diff / older[1] * 100) if older[1] != 0 else 0
        return hourly_velocity
    
    def _get_average_volume(self, address: str) -> float:
        """Get average volume from history."""
        history = self._volume_history.get(address, [])
        if not history:
            return 0.0
        
        volumes = [v[1] for v in history]
        return sum(volumes) / len(volumes)


# Convenience function for quick token lookup
async def get_token_summary(chain: str, address: str) -> dict:
    """
    Quick lookup of token market data.
    
    Usage:
        summary = await get_token_summary("solana", "So11111111111111111111111111111111111111112")
    """
    client = DexScreenerClient()
    try:
        token = await client.get_token_by_address(chain, address)
        if not token:
            return {"error": "Token not found"}
        
        return {
            "symbol": token.symbol,
            "name": token.name,
            "price": token.price_usd,
            "price_change_1h": token.price_change_1h,
            "price_change_24h": token.price_change_24h,
            "volume_24h": token.volume_24h,
            "liquidity": token.liquidity_usd,
            "market_cap": token.market_cap,
            "chain": token.chain,
            "dex": token.dex_id
        }
    finally:
        await client.close()

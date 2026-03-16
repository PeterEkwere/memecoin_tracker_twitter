"""Quick test to verify Twitter API Bearer Token works."""

import asyncio
import ssl
import certifi
import aiohttp

BEARER_TOKEN = "AAAAAAAAAAAAAAAAAAAAALKs7AEAAAAAGQ%2FFJMhqyhIPX6tK9br%2B2CxulJs%3Du6NVNqoljKc9C1iVrXDaQI66XrTal1vwKRs36uAJsSxtyVGUat"

async def test_twitter_api():
    headers = {
        "Authorization": f"Bearer {BEARER_TOKEN}",
        "Content-Type": "application/json"
    }

    ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    conn = aiohttp.TCPConnector(ssl=ssl_ctx)
    async with aiohttp.ClientSession(headers=headers, connector=conn) as session:
        # Test 1: Search recent tweets for a popular memecoin term
        print("Test 1: Searching recent tweets for '$PEPE'...")
        params = {
            "query": "$PEPE -is:retweet lang:en",
            "max_results": 10,
            "tweet.fields": "created_at,public_metrics,author_id",
            "expansions": "author_id",
            "user.fields": "username,public_metrics"
        }

        async with session.get(
            "https://api.twitter.com/2/tweets/search/recent",
            params=params
        ) as resp:
            print(f"Status: {resp.status}")
            data = await resp.json()

            if resp.status == 200:
                tweets = data.get("data", [])
                users = {u["id"]: u for u in data.get("includes", {}).get("users", [])}
                print(f"Got {len(tweets)} tweets!\n")

                for tweet in tweets[:3]:
                    author = users.get(tweet.get("author_id"), {})
                    metrics = tweet.get("public_metrics", {})
                    print(f"@{author.get('username', '?')}: {tweet['text'][:100]}...")
                    print(f"  Likes: {metrics.get('like_count', 0)} | "
                          f"RTs: {metrics.get('retweet_count', 0)} | "
                          f"Replies: {metrics.get('reply_count', 0)}")
                    print()
            else:
                print(f"Error: {data}")
                if resp.status == 401:
                    print("-> Bearer token is invalid or expired")
                elif resp.status == 403:
                    print("-> Access forbidden - check your API access level")

if __name__ == "__main__":
    asyncio.run(test_twitter_api())

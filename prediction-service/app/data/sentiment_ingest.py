import os
import sys
import requests
from dotenv import load_dotenv

# Add root folder to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

load_dotenv()

FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY")

def fetch_company_news(symbol: str, start_date: str, end_date: str):
    """
    Fetch news from Finnhub company-news endpoint.
    Dates should be in format 'YYYY-MM-DD'.
    """
    if not FINNHUB_API_KEY or FINNHUB_API_KEY == "your_finnhub_api_key_here":
        print(f"No FINNHUB_API_KEY found. Using fallback mock headlines for {symbol}.")
        return get_mock_headlines(symbol, start_date, end_date)

    url = f"https://finnhub.io/api/v1/company-news"
    params = {
        "symbol": symbol,
        "from": start_date,
        "to": end_date,
        "token": FINNHUB_API_KEY
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        if response.status_code == 200:
            news = response.json()
            print(f"Successfully fetched {len(news)} news articles for {symbol} from Finnhub.")
            return [{"headline": item.get("headline", ""), "datetime": item.get("datetime", 0)} for item in news]
        else:
            print(f"Warning: Finnhub API returned status {response.status_code}. Using mock fallbacks.")
            return get_mock_headlines(symbol, start_date, end_date)
    except Exception as e:
        print(f"Error fetching news for {symbol} from Finnhub: {e}. Using mock fallbacks.")
        return get_mock_headlines(symbol, start_date, end_date)

def get_mock_headlines(symbol: str, start_date: str, end_date: str):
    """
    Fallback news generator containing a mix of positive, neutral, and negative market phrases
    to ensure the pipeline runs cleanly without an API key.
    """
    import pandas as pd
    import random
    
    # Generate business days range
    dates = pd.bdate_range(start=start_date, end=end_date)
    
    templates = [
        ("report positive quarterly earnings surpassing expectations", 0.8),
        ("unveils new product features targeting global markets", 0.6),
        ("faces supply chain challenges amid rising component costs", -0.4),
        ("secures major strategic partnership with industry leaders", 0.7),
        ("undergoes management restructure to streamline operations", 0.1),
        ("shares trade flat ahead of upcoming analyst meeting", 0.0),
        ("receives target price upgrade from top Wall Street brokerage", 0.5),
        ("investigates minor regulatory compliance query", -0.2),
        ("launches new cost-cutting initiatives to improve margin", 0.3),
        ("competitors capture market share in latest quarterly results", -0.5)
    ]
    
    mock_articles = []
    # Seed random with ticker name for reproducibility
    random.seed(hash(symbol))
    
    for d in dates:
        # 30% chance of news on any given day
        if random.random() < 0.3:
            num_articles = random.randint(1, 3)
            for _ in range(num_articles):
                phrase, score = random.choice(templates)
                headline = f"{symbol} to {phrase}."
                # Convert date to unix timestamp
                ts = int(d.timestamp())
                mock_articles.append({
                    "headline": headline,
                    "datetime": ts,
                    "mock_score": score # store mock score for faster mock scoring
                })
                
    return mock_articles

if __name__ == "__main__":
    articles = fetch_company_news("AAPL", "2026-07-01", "2026-07-20")
    print(f"Ingested {len(articles)} articles.")
    if articles:
        print("Example article:", articles[0])

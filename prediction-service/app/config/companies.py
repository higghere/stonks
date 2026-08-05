# Configuration maps for locked tickers, commodities, and competitors

TICKERS = [
    "AAPL",
    "MSFT",
    "TSLA",
    "NVDA",
    "JPM",
    "AMZN",
    "BARC",
    "RELIANCE.NS"
]

TICKER_TO_YAHOO = {
    "AAPL": "AAPL",
    "MSFT": "MSFT",
    "TSLA": "TSLA",
    "NVDA": "NVDA",
    "JPM": "JPM",
    "AMZN": "AMZN",
    "BARC": "BARC.L",
    "RELIANCE.NS": "RELIANCE.NS"
}

COMMODITY_MAP = {
    "AAPL": ["ALI=F"],
    "MSFT": [],
    "TSLA": ["HG=F", "CL=F"],
    "NVDA": [],
    "JPM": ["^TNX"],
    "AMZN": ["CL=F"],
    "BARC": [],
    "RELIANCE.NS": ["CL=F"]
}

COMPETITOR_MAP = {
    "AAPL": ["005930.KS", "SONY", "MSFT"],
    "MSFT": ["AAPL", "GOOGL", "AMZN"],
    "TSLA": ["TM", "GM", "F"],
    "NVDA": ["AMD", "INTC"],
    "JPM": ["BAC", "GS", "C"],
    "AMZN": ["MSFT", "GOOGL", "WMT"],
    "BARC": ["HSBA.L", "LLOY.L"],
    "RELIANCE.NS": ["TATASTEEL.NS", "ONGC.NS"]
}

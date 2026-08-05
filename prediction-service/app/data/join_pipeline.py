import os
import sys
import pandas as pd
import numpy as np

# Add root folder to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from app.config.companies import COMMODITY_MAP, COMPETITOR_MAP
from app.data.features import compute_technical_indicators
from app.data.competitor_features import compute_competitor_relative_features
from app.data.event_features import compute_event_decay_features
from app.data.sentiment_ingest import fetch_company_news
from app.data.finbert_scorer import FinBERTScorer

CACHE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../data_cache"))
OHLC_DIR = os.path.join(CACHE_DIR, "ohlc")
SENTIMENT_DIR = os.path.join(CACHE_DIR, "sentiment")

def ensure_sentiment_dir():
    os.makedirs(SENTIMENT_DIR, exist_ok=True)

def get_sentiment_features(symbol: str, dates_index: pd.DatetimeIndex) -> pd.DataFrame:
    """
    Get daily sentiment features (mean score + mention volume) aligned to dates_index.
    Loads from cache if exists, otherwise ingests and scores, then saves to cache.
    """
    ensure_sentiment_dir()
    cache_path = os.path.join(SENTIMENT_DIR, f"{symbol}.parquet")
    
    if os.path.exists(cache_path):
        try:
            df = pd.read_parquet(cache_path)
            df["Date"] = pd.to_datetime(df["Date"]).dt.tz_localize(None)
            return df.set_index("Date").reindex(dates_index).fillna(0.0)
        except Exception as e:
            print(f"Warning: Failed to load cached sentiment for {symbol}: {e}")
            
    # If not cached, fetch and score
    print(f"Ingesting and scoring sentiment news for {symbol}...")
    min_date = dates_index.min().strftime("%Y-%m-%d")
    max_date = dates_index.max().strftime("%Y-%m-%d")
    
    articles = fetch_company_news(symbol, min_date, max_date)
    scorer = FinBERTScorer()
    scored = scorer.score_batch(articles)
    
    # Aggregate by date
    daily_scores = {}
    daily_volumes = {}
    
    for item in scored:
        d = pd.to_datetime(item["datetime"], unit="s").date()
        score = item["sentiment_score"]
        
        if d not in daily_scores:
            daily_scores[d] = []
            daily_volumes[d] = 0
            
        daily_scores[d].append(score)
        daily_volumes[d] += 1
        
    # Map to DataFrame
    sent_scores = []
    sent_vols = []
    
    for d in dates_index.date:
        scores = daily_scores.get(d, [])
        vol = daily_volumes.get(d, 0)
        
        avg_score = np.mean(scores) if scores else 0.0
        sent_scores.append(avg_score)
        sent_vols.append(vol)
        
    df = pd.DataFrame(index=dates_index)
    df.index.name = "Date"
    df["sentiment_score"] = sent_scores
    df["mention_volume"] = sent_vols
    
    # Calculate mention_volume_zscore (20-day rolling z-score)
    vols = df["mention_volume"]
    mean_20 = vols.rolling(20).mean()
    std_20 = vols.rolling(20).std().replace(0, np.nan)
    df["mention_volume_zscore"] = ((vols - mean_20) / std_20).fillna(0.0)
    
    # Save cache
    try:
        df.reset_index().to_parquet(cache_path, index=False)
    except Exception as e:
        print(f"Warning: Failed to save sentiment cache for {symbol}: {e}")
        
    return df

def build_features_for_ticker(symbol: str) -> pd.DataFrame:
    """
    Consolidates all 5 feature branches for a given ticker into a single DataFrame.
    """
    stock_file = os.path.join(OHLC_DIR, f"{symbol}.parquet")
    if not os.path.exists(stock_file):
        raise FileNotFoundError(f"OHLC data file not found for {symbol} at {stock_file}")
        
    stock_df = pd.read_parquet(stock_file)
    stock_df["Date"] = pd.to_datetime(stock_df["Date"]).dt.tz_localize(None)
    stock_df = stock_df.sort_values("Date").reset_index(drop=True)
    
    dates_index = pd.DatetimeIndex(stock_df["Date"])
    
    # 1. Technical indicators
    tech_df = compute_technical_indicators(stock_df)
    
    # 2. Competitor relative strength
    comp_df = compute_competitor_relative_features(symbol, dates_index, stock_df)
    
    # 3. Decay-based corporate events
    event_df = compute_event_decay_features(symbol, dates_index)
    
    # 4. Sentiment scoring
    sent_df = get_sentiment_features(symbol, dates_index)
    
    # 5. Commodities (aligned and zero-filled if none mapped)
    comm_df = pd.DataFrame(index=dates_index)
    comm_df.index.name = "Date"
    
    mapped_comms = COMMODITY_MAP.get(symbol, [])
    
    # We want a fixed number of commodity inputs for model architecture uniformity.
    # Maximum mapped commodities is 2 (e.g. for TSLA: CL=F, HG=F).
    # So we always create comm_1_close, comm_1_ret_5d, comm_2_close, comm_2_ret_5d.
    for i in range(2):
        comm_df[f"commodity_{i+1}_close"] = 0.0
        comm_df[f"commodity_{i+1}_ret_5d"] = 0.0
        
    for idx, comm in enumerate(mapped_comms[:2]):
        comm_file = os.path.join(OHLC_DIR, f"{comm}.parquet")
        if os.path.exists(comm_file):
            try:
                c_df = pd.read_parquet(comm_file)
                c_df["Date"] = pd.to_datetime(c_df["Date"]).dt.tz_localize(None)
                c_close = c_df.set_index("Date")["Close"].reindex(dates_index).ffill()
                
                comm_df[f"commodity_{idx+1}_close"] = c_close.fillna(0.0)
                comm_df[f"commodity_{idx+1}_ret_5d"] = c_close.pct_change(5).fillna(0.0)
            except Exception as e:
                print(f"Warning: Failed to load commodity {comm} for {symbol}: {e}")
                
    # Merge all DataFrames
    merged = pd.concat([stock_df.set_index("Date"), tech_df, comp_df, event_df, sent_df, comm_df], axis=1)
    
    # Ensure there are no NaNs left (forward fill first, then backward fill)
    merged = merged.ffill().bfill().fillna(0.0)
    
    return merged.reset_index()

if __name__ == "__main__":
    # Test joining AAPL features
    try:
        features = build_features_for_ticker("AAPL")
        print(f"Built AAPL feature table: {features.shape[0]} rows, {features.shape[1]} columns")
        print("Columns list:", list(features.columns))
    except Exception as e:
        print(f"Error testing join pipeline: {e}")

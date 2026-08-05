import os
import sys
import pandas as pd
import numpy as np

# Add root folder to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from app.config.companies import COMPETITOR_MAP

CACHE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../data_cache/ohlc"))

def compute_competitor_relative_features(symbol: str, dates_index: pd.DatetimeIndex, ticker_df: pd.DataFrame) -> pd.DataFrame:
    """
    Given a ticker symbol, DatetimeIndex, and ticker's own price history,
    calculate relative performance indicators against the competitor basket.
    """
    # Create baseline empty DataFrame
    df = pd.DataFrame(index=dates_index)
    df.index.name = "Date"
    df["competitor_avg_return_5d"] = 0.0
    df["competitor_avg_return_30d"] = 0.0
    df["relative_strength_5d"] = 0.0
    df["relative_strength_30d"] = 0.0
    
    competitors = COMPETITOR_MAP.get(symbol, [])
    if not competitors:
        return df

    # Ticker's own returns
    ticker_close = ticker_df.set_index("Date")["Close"].reindex(dates_index).ffill()
    ticker_ret_5d = ticker_close.pct_change(5)
    ticker_ret_30d = ticker_close.pct_change(30)
    
    competitor_5d_returns = []
    competitor_30d_returns = []
    
    for comp in competitors:
        comp_file = os.path.join(CACHE_DIR, f"{comp}.parquet")
        if os.path.exists(comp_file):
            try:
                comp_df = pd.read_parquet(comp_file)
                comp_df["Date"] = pd.to_datetime(comp_df["Date"]).dt.tz_localize(None)
                comp_close = comp_df.set_index("Date")["Close"].reindex(dates_index).ffill()
                
                # Percent changes
                comp_5d = comp_close.pct_change(5)
                comp_30d = comp_close.pct_change(30)
                
                competitor_5d_returns.append(comp_5d)
                competitor_30d_returns.append(comp_30d)
            except Exception as e:
                print(f"Warning: Failed to load competitor {comp} for {symbol}: {e}")
                
    if competitor_5d_returns:
        # Compute mean across all competitors for each date
        avg_comp_5d = pd.concat(competitor_5d_returns, axis=1).mean(axis=1)
        avg_comp_30d = pd.concat(competitor_30d_returns, axis=1).mean(axis=1)
        
        df["competitor_avg_return_5d"] = avg_comp_5d.fillna(0.0)
        df["competitor_avg_return_30d"] = avg_comp_30d.fillna(0.0)
        
        # Relative strength = ticker return - competitor average return
        df["relative_strength_5d"] = (ticker_ret_5d - avg_comp_5d).fillna(0.0)
        df["relative_strength_30d"] = (ticker_ret_30d - avg_comp_30d).fillna(0.0)
        
    return df

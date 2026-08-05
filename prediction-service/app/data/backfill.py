import os
import sys
import pandas as pd
import yfinance as yf

# Add root folder to sys.path so we can import app
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from app.config.companies import TICKERS, COMMODITY_MAP, COMPETITOR_MAP, TICKER_TO_YAHOO

CACHE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../data_cache/ohlc"))

def ensure_cache_dir():
    os.makedirs(CACHE_DIR, exist_ok=True)

def download_and_save(symbol: str):
    yahoo_symbol = TICKER_TO_YAHOO.get(symbol, symbol)
    print(f"Downloading history for {symbol} (using Yahoo symbol {yahoo_symbol})...")
    try:
        ticker = yf.Ticker(yahoo_symbol)
        df = ticker.history(period="5y", interval="1d")
        if df.empty:
            print(f"Warning: No data returned for {symbol}")
            return False
        
        # Reset index to make Date a column
        df = df.reset_index()
        
        # Keep only standard columns and ensure Date is datetime type
        cols_to_keep = ["Date", "Open", "High", "Low", "Close", "Volume"]
        # Some tickers might have slightly different casing depending on pandas/yfinance version
        df.columns = [c.capitalize() if c.capitalize() in cols_to_keep else c for c in df.columns]
        
        # Filter columns
        existing_cols = [c for c in cols_to_keep if c in df.columns]
        df = df[existing_cols]
        
        # Save to parquet
        dest_path = os.path.join(CACHE_DIR, f"{symbol}.parquet")
        df.to_parquet(dest_path, index=False)
        print(f"Successfully saved {symbol} to {dest_path} ({len(df)} rows)")
        return True
    except Exception as e:
        print(f"Error downloading {symbol}: {e}")
        return False

def run_backfill():
    ensure_cache_dir()
    
    # Collect all unique symbols to download
    symbols = set(TICKERS)
    for comms in COMMODITY_MAP.values():
        symbols.update(comms)
    for comps in COMPETITOR_MAP.values():
        symbols.update(comps)
        
    print(f"Starting backfill for {len(symbols)} unique tickers...")
    success_count = 0
    for sym in sorted(symbols):
        if download_and_save(sym):
            success_count += 0.5 # count parts
            success_count += 0.5
            
    print(f"Backfill finished. Successfully downloaded {int(success_count)}/{len(symbols)} tickers.")

if __name__ == "__main__":
    run_backfill()

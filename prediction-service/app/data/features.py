import pandas as pd
import numpy as np

def compute_technical_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Given a DataFrame with Date, Open, High, Low, Close, Volume:
    Calculate technical indicators and return a DataFrame with Date as index.
    """
    df = df.copy()
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.sort_values("Date").set_index("Date")
    
    out = pd.DataFrame(index=df.index)
    out.index.name = "Date"
    
    close = df["Close"]
    volume = df["Volume"]
    
    # 1. SMAs
    out["sma_20"] = close.rolling(20).mean()
    out["sma_50"] = close.rolling(50).mean()
    out["sma_200"] = close.rolling(200).mean()
    
    # 2. EMA
    out["ema_20"] = close.ewm(span=20, adjust=False).mean()
    
    # 3. Rolling Volatility (20-day of log returns)
    log_returns = np.log(close / close.shift(1))
    out["volatility_20"] = log_returns.rolling(20).std()
    
    # 4. RSI (14-day)
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    
    avg_gain = gain.rolling(14).mean()
    avg_loss = loss.rolling(14).mean()
    
    # Avoid division by zero
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    out["rsi_14"] = rsi.fillna(50.0)
    
    # 5. MACD (12, 26, 9)
    ema_12 = close.ewm(span=12, adjust=False).mean()
    ema_26 = close.ewm(span=26, adjust=False).mean()
    macd_line = ema_12 - ema_26
    signal_line = macd_line.ewm(span=9, adjust=False).mean()
    
    out["macd"] = macd_line
    out["macd_signal"] = signal_line
    out["macd_diff"] = macd_line - signal_line
    
    # 6. Volume change (relative to 5-day average volume)
    vol_sma5 = volume.rolling(5).mean()
    out["volume_change"] = ((volume - vol_sma5) / vol_sma5.replace(0, np.nan)).fillna(0.0)
    
    # Fill remaining NaNs from rolling indicators with backward-fill
    out = out.bfill().fillna(0.0)
    
    return out

if __name__ == "__main__":
    # Test indicators
    dates = pd.date_range("2024-01-01", periods=250)
    prices = np.sin(np.linspace(0, 10, 250)) * 10 + 100
    volumes = np.random.randint(1000, 5000, 250)
    test_df = pd.DataFrame({"Date": dates, "Open": prices, "High": prices, "Low": prices, "Close": prices, "Volume": volumes})
    inds = compute_technical_indicators(test_df)
    print(inds.tail())

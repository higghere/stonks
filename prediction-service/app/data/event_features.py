import os
import sys
import numpy as np
import pandas as pd

# Add root folder to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from app.data.company_events import COMPANY_EVENTS

def compute_event_decay_features(symbol: str, dates_index: pd.DatetimeIndex) -> pd.DataFrame:
    """
    For a given symbol and DatetimeIndex, calculate decay-based recency features
    for the different event types (OWN_LAUNCH, COMPETITOR_LAUNCH, EARNINGS).
    Decay formula: exp(-days / 14)
    """
    # Create output DataFrame
    df = pd.DataFrame(index=dates_index)
    df.index.name = "Date"
    
    # Filter events for this symbol
    ticker_events = [e for e in COMPANY_EVENTS if e["ticker"] == symbol]
    
    event_types = ["OWN_LAUNCH", "COMPETITOR_LAUNCH", "EARNINGS"]
    
    for etype in event_types:
        # Get dates for this event type
        event_dates = sorted([pd.to_datetime(e["date"]) for e in ticker_events if e["type"] == etype])
        
        # Calculate days since event for each date in index
        days_since = []
        decay_vals = []
        
        for d in dates_index:
            # Find the most recent event date before or on 'd'
            past_events = [ed for ed in event_dates if ed <= d]
            if past_events:
                most_recent = past_events[-1]
                delta_days = (d - most_recent).days
                decay = np.exp(-delta_days / 14.0)
            else:
                # No event occurred before this date (large initial value)
                delta_days = 9999.0
                decay = 0.0
                
            days_since.append(delta_days)
            decay_vals.append(decay)
            
        df[f"days_since_{etype.lower()}"] = days_since
        df[f"decay_{etype.lower()}"] = decay_vals
        
    return df

if __name__ == "__main__":
    dates = pd.bdate_range("2024-01-01", "2024-12-31")
    features_df = compute_event_decay_features("AAPL", dates)
    print(features_df.head(20))

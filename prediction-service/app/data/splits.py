import pandas as pd
import numpy as np

def generate_chronological_splits(df: pd.DataFrame, train_ratio: float = 0.7, val_ratio: float = 0.15):
    """
    Split the ticker features DataFrame chronologically into train, validation, and test sets.
    Applies a 90-day boundary buffer between sets to prevent target label leakage.
    """
    df = df.copy()
    df["Date"] = pd.to_datetime(df["Date"]).dt.tz_localize(None)
    df = df.sort_values("Date").reset_index(drop=True)
    
    total_days = len(df)
    train_end_idx = int(total_days * train_ratio)
    val_end_idx = int(total_days * (train_ratio + val_ratio))
    
    train_df = df.iloc[:train_end_idx].reset_index(drop=True)
    
    # 90 trading days buffer to prevent leakage into validation
    val_start_idx = train_end_idx + 90
    if val_start_idx >= val_end_idx:
        val_start_idx = train_end_idx + 30 # absolute minimal buffer if range is small
        
    val_df = df.iloc[val_start_idx:val_end_idx].reset_index(drop=True)
    
    # 90 trading days buffer to prevent leakage into test
    test_start_idx = val_end_idx + 90
    if test_start_idx >= total_days:
        test_start_idx = val_end_idx + 30 # absolute minimal buffer
        
    test_df = df.iloc[test_start_idx:].reset_index(drop=True)
    
    print(f"Split Summary: Train={len(train_df)} rows, Val={len(val_df)} rows, Test={len(test_df)} rows")
    return train_df, val_df, test_df

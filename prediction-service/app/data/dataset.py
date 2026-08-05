import os
import sys
import numpy as np
import pandas as pd
import torch
from torch.utils.data import Dataset
from sklearn.preprocessing import StandardScaler

# Add root folder to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from app.data.company_metadata import COMPANY_METADATA

class StockSequenceDataset(Dataset):
    def __init__(self, ticker_features_df: pd.DataFrame, ticker: str, sequence_length: int = 60, scaler_dict=None):
        self.ticker = ticker
        self.sequence_length = sequence_length
        df = ticker_features_df.copy()
        
        # Ensure target columns are present (either pre-calculated or dummy)
        if "target_5d" not in df.columns:
            df["target_5d"] = 0.0
        if "target_30d" not in df.columns:
            df["target_30d"] = 0.0
        if "target_90d" not in df.columns:
            df["target_90d"] = 0.0
            
        self.raw_df = df
        
        # 2. Group features by branch
        # Technical/Price Features
        self.price_cols = [
            "Open", "High", "Low", "Close", "Volume",
            "sma_20", "sma_50", "sma_200", "ema_20",
            "volatility_20", "rsi_14", "macd", "macd_signal",
            "macd_diff", "volume_change"
        ]
        
        # Commodity Features
        self.comm_cols = [
            "commodity_1_close", "commodity_1_ret_5d",
            "commodity_2_close", "commodity_2_ret_5d"
        ]
        
        # Competitor Features
        self.comp_cols = [
            "competitor_avg_return_5d", "competitor_avg_return_30d",
            "relative_strength_5d", "relative_strength_30d"
        ]
        
        # Event & Sentiment Features
        self.event_sent_cols = [
            "days_since_own_launch", "decay_own_launch",
            "days_since_competitor_launch", "decay_competitor_launch",
            "days_since_earnings", "decay_earnings",
            "sentiment_score", "mention_volume", "mention_volume_zscore"
        ]
        
        # 3. Fit/Transform Scaling
        self.scaler_dict = scaler_dict if scaler_dict is not None else {}
        
        self.price_data = self._scale_feature_group("price", self.price_cols)
        self.comm_data = self._scale_feature_group("comm", self.comm_cols)
        self.comp_data = self._scale_feature_group("comp", self.comp_cols)
        self.event_sent_data = self._scale_feature_group("event_sent", self.event_sent_cols)
        
        # 4. Static company metadata branch (single vector)
        meta = COMPANY_METADATA.get(ticker, {"ceo_age": 50, "founding_year": 2000, "employees": 50000})
        # sector is categorical - we can map sectors to static indices
        sectors = ["Technology", "Automotive", "Financial Services", "Consumer Cyclical", "Energy / Conglomerate"]
        sector_idx = sectors.index(meta.get("sector", "Technology")) if meta.get("sector") in sectors else 0
        
        self.static_features = np.array([
            float(meta.get("ceo_age", 50)),
            float(meta.get("founding_year", 2000)),
            float(meta.get("employees", 50000)),
            float(sector_idx)
        ], dtype=np.float32)
        
        # Scale static features
        if "static" not in self.scaler_dict:
            scaler = StandardScaler()
            self.static_features = scaler.fit_transform(self.static_features.reshape(1, -1))[0]
            self.scaler_dict["static"] = scaler
        else:
            self.static_features = self.scaler_dict["static"].transform(self.static_features.reshape(1, -1))[0]
            
        # Target returns
        self.targets = df[["target_5d", "target_30d", "target_90d"]].values.astype(np.float32)
        
    def _scale_feature_group(self, name: str, cols: list) -> np.ndarray:
        data = self.raw_df[cols].values.astype(np.float32)
        if name not in self.scaler_dict:
            scaler = StandardScaler()
            scaled_data = scaler.fit_transform(data)
            self.scaler_dict[name] = scaler
            return scaled_data
        else:
            return self.scaler_dict[name].transform(data)

    def __len__(self):
        return len(self.raw_df) - self.sequence_length + 1

    def __getitem__(self, idx):
        # Sliding window range
        start = idx
        end = idx + self.sequence_length
        
        price_seq = self.price_data[start:end]
        comm_seq = self.comm_data[start:end]
        comp_seq = self.comp_data[start:end]
        event_sent_seq = self.event_sent_data[start:end]
        
        # Target return is the return AT the end of the sequence
        target = self.targets[end - 1]
        
        return {
            "price_seq": torch.tensor(price_seq, dtype=torch.float32),
            "comm_seq": torch.tensor(comm_seq, dtype=torch.float32),
            "comp_seq": torch.tensor(comp_seq, dtype=torch.float32),
            "event_sent_seq": torch.tensor(event_sent_seq, dtype=torch.float32),
            "static_meta": torch.tensor(self.static_features, dtype=torch.float32),
            "target": torch.tensor(target, dtype=torch.float32)
        }

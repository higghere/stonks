import os
import sys
import torch
import numpy as np
import pandas as pd
import json
import pickle
from datetime import datetime

# Add root folder to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.config.companies import TICKERS
from app.data.join_pipeline import build_features_for_ticker
from app.data.dataset import StockSequenceDataset
from app.models.fusion_model import MultiModalPricePredictor
from app.models.baseline import BaselinePredictor

CHECKPOINT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../checkpoints"))
PREDICTIONS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../data_cache/predictions"))

def ensure_predictions_dir():
    os.makedirs(PREDICTIONS_DIR, exist_ok=True)

def generate_predictions_for_ticker(ticker: str) -> dict:
    ensure_predictions_dir()
    
    checkpoint_path = os.path.join(CHECKPOINT_DIR, f"{ticker}_best.pt")
    scaler_path = os.path.join(CHECKPOINT_DIR, f"{ticker}_scalers.pkl")
    
    if not os.path.exists(checkpoint_path) or not os.path.exists(scaler_path):
        print(f"Skipping {ticker}: Missing trained model checkpoint or scaler cache.")
        return None
        
    try:
        # 1. Load full feature pipeline
        features_df = build_features_for_ticker(ticker)
        
        # Take the most recent 60 rows for sequence inference
        if len(features_df) < 60:
            print(f"Skipping {ticker}: Not enough data (less than 60 rows).")
            return None
            
        current_close = float(features_df["Close"].iloc[-1])
        latest_window_df = features_df.iloc[-60:].reset_index(drop=True)
        
        # 2. Load scalers and build PyTorch input
        with open(scaler_path, "rb") as f:
            scaler_dict = pickle.load(f)
            
        # We temporarily append 90 dummy rows to latest_window_df so StockSequenceDataset 
        # doesn't trim the latest row (since it trims the last 90 rows expecting targets)
        dummy_rows = pd.DataFrame([latest_window_df.iloc[-1]] * 90).reset_index(drop=True)
        # Shift dates of dummy rows forward to avoid index conflicts
        for i in range(90):
            dummy_rows.loc[i, "Date"] = dummy_rows.loc[i, "Date"] + pd.Timedelta(days=i+1)
            
        inference_df = pd.concat([latest_window_df, dummy_rows]).reset_index(drop=True)
        
        dataset = StockSequenceDataset(inference_df, ticker, scaler_dict=scaler_dict)
        # getitem(0) is the first window of 60 days
        batch = dataset[0]
        
        # 3. Load model and run inference
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model = MultiModalPricePredictor(price_dim=15, event_sent_dim=9)
        model.load_state_dict(torch.load(checkpoint_path, map_location=device))
        model.to(device)
        model.eval()
        
        with torch.no_grad():
            price_seq = batch["price_seq"].unsqueeze(0).to(device)
            comm_seq = batch["comm_seq"].unsqueeze(0).to(device)
            comp_seq = batch["comp_seq"].unsqueeze(0).to(device)
            event_sent_seq = batch["event_sent_seq"].unsqueeze(0).to(device)
            static_meta = batch["static_meta"].unsqueeze(0).to(device)
            
            output = model(price_seq, comm_seq, comp_seq, event_sent_seq, static_meta)
            pred_returns = output.squeeze(0).cpu().numpy()
            
        # 4. Generate baselines
        flat_returns = np.zeros(3, dtype=np.float32)
        
        # Trend baseline uses raw unscaled close price sequence of shape (60,)
        unscaled_close = latest_window_df["Close"].values
        trend_returns = np.array([
            BaselinePredictor.predict_trend(unscaled_close, 5),
            BaselinePredictor.predict_trend(unscaled_close, 30),
            BaselinePredictor.predict_trend(unscaled_close, 90)
        ], dtype=np.float32)
        
        # 5. Build results structure
        pred_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        results = {
            "ticker": ticker,
            "prediction_timestamp": pred_date,
            "current_close": current_close,
            "predictions": {
                "5d": {
                    "model_return": float(pred_returns[0]),
                    "model_price": float(current_close * (1 + pred_returns[0])),
                    "flat_return": float(flat_returns[0]),
                    "flat_price": float(current_close * (1 + flat_returns[0])),
                    "trend_return": float(trend_returns[0]),
                    "trend_price": float(current_close * (1 + trend_returns[0]))
                },
                "30d": {
                    "model_return": float(pred_returns[1]),
                    "model_price": float(current_close * (1 + pred_returns[1])),
                    "flat_return": float(flat_returns[1]),
                    "flat_price": float(current_close * (1 + flat_returns[1])),
                    "trend_return": float(trend_returns[1]),
                    "trend_price": float(current_close * (1 + trend_returns[1]))
                },
                "90d": {
                    "model_return": float(pred_returns[2]),
                    "model_price": float(current_close * (1 + pred_returns[2])),
                    "flat_return": float(flat_returns[2]),
                    "flat_price": float(current_close * (1 + flat_returns[2])),
                    "trend_return": float(trend_returns[2]),
                    "trend_price": float(current_close * (1 + trend_returns[2]))
                }
            }
        }
        
        # Write local JSON output
        dest_file = os.path.join(PREDICTIONS_DIR, f"{ticker}_predictions.json")
        with open(dest_file, "w") as f:
            json.dump(results, f, indent=2)
            
        print(f"Successfully generated predictions for {ticker} at {dest_file}")
        return results
    except Exception as e:
        print(f"Error generating predictions for {ticker}: {e}")
        return None

def run_predictions():
    print("Generating predictions for all trained models...")
    for ticker in TICKERS:
        generate_predictions_for_ticker(ticker)

if __name__ == "__main__":
    run_predictions()

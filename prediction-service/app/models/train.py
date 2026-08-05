import os
import sys
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
import numpy as np
import pickle

# Add root folder to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from app.config.companies import TICKERS
from app.data.join_pipeline import build_features_for_ticker
from app.data.dataset import StockSequenceDataset
from app.data.splits import generate_chronological_splits
from app.models.fusion_model import MultiModalPricePredictor
from app.models.baseline import BaselinePredictor

CHECKPOINT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../checkpoints"))

def ensure_checkpoint_dir():
    os.makedirs(CHECKPOINT_DIR, exist_ok=True)

def train_model_for_ticker(ticker: str, epochs: int = 15, batch_size: int = 32):
    ensure_checkpoint_dir()
    print(f"\n========================================\nTraining Multi-Modal Model for {ticker}\n========================================")
    
    # 1. Load and build features
    try:
        features_df = build_features_for_ticker(ticker)
        
        # Calculate forward return targets on the full consolidated dataset
        close = features_df["Close"]
        features_df["target_5d"] = (close.shift(-5) / close) - 1.0
        features_df["target_30d"] = (close.shift(-30) / close) - 1.0
        features_df["target_90d"] = (close.shift(-90) / close) - 1.0
        
        # Drop the last 90 rows since they lack valid 90d target returns
        features_df = features_df.dropna(subset=["target_5d", "target_30d", "target_90d"]).reset_index(drop=True)
    except Exception as e:
        print(f"Aborting training for {ticker}: Failed to build features. {e}")
        return False
        
    # 2. Chronological Split
    train_df, val_df, test_df = generate_chronological_splits(features_df)
    
    if len(train_df) < 100 or len(val_df) < 20 or len(test_df) < 20:
        print(f"Aborting: Not enough historical data rows for splits in {ticker}.")
        return False
        
    # 3. Create Datasets & DataLoaders
    train_dataset = StockSequenceDataset(train_df, ticker)
    # Use scaler fitted on training data to scale val and test datasets
    scaler_dict = train_dataset.scaler_dict
    
    val_dataset = StockSequenceDataset(val_df, ticker, scaler_dict=scaler_dict)
    test_dataset = StockSequenceDataset(test_df, ticker, scaler_dict=scaler_dict)
    
    # Save scalers for inference
    scaler_path = os.path.join(CHECKPOINT_DIR, f"{ticker}_scalers.pkl")
    with open(scaler_path, "wb") as f:
        pickle.dump(scaler_dict, f)
        
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False)
    test_loader = DataLoader(test_dataset, batch_size=batch_size, shuffle=False)
    
    # 4. Initialize model
    # Price cols: 15, Event/sent cols: 9
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = MultiModalPricePredictor(price_dim=15, event_sent_dim=9)
    model.to(device)
    
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)
    
    # 5. Training Loop
    best_val_loss = float("inf")
    best_weights_path = os.path.join(CHECKPOINT_DIR, f"{ticker}_best.pt")
    
    for epoch in range(epochs):
        model.train()
        train_loss = 0.0
        
        for batch in train_loader:
            price_seq = batch["price_seq"].to(device)
            comm_seq = batch["comm_seq"].to(device)
            comp_seq = batch["comp_seq"].to(device)
            event_sent_seq = batch["event_sent_seq"].to(device)
            static_meta = batch["static_meta"].to(device)
            targets = batch["target"].to(device)
            
            optimizer.zero_grad()
            outputs = model(price_seq, comm_seq, comp_seq, event_sent_seq, static_meta)
            loss = criterion(outputs, targets)
            loss.backward()
            optimizer.step()
            
            train_loss += loss.item() * len(targets)
            
        train_loss /= len(train_dataset)
        
        # Validation evaluation
        model.eval()
        val_loss = 0.0
        with torch.no_grad():
            for batch in val_loader:
                price_seq = batch["price_seq"].to(device)
                comm_seq = batch["comm_seq"].to(device)
                comp_seq = batch["comp_seq"].to(device)
                event_sent_seq = batch["event_sent_seq"].to(device)
                static_meta = batch["static_meta"].to(device)
                targets = batch["target"].to(device)
                
                outputs = model(price_seq, comm_seq, comp_seq, event_sent_seq, static_meta)
                loss = criterion(outputs, targets)
                val_loss += loss.item() * len(targets)
                
        val_loss /= len(val_dataset)
        
        print(f"Epoch {epoch+1}/{epochs} | Train Loss: {train_loss:.6f} | Val Loss: {val_loss:.6f}")
        
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save(model.state_dict(), best_weights_path)
            
    print(f"Saved best model checkpoint to {best_weights_path}")
    
    # 6. Evaluation against Baselines
    # Load best model weights for evaluation
    model.load_state_dict(torch.load(best_weights_path))
    model.eval()
    
    model_preds = []
    actuals = []
    
    # We need raw close prices to calculate trend baseline
    close_prices = []
    
    with torch.no_grad():
        for batch in test_loader:
            price_seq = batch["price_seq"].to(device)
            comm_seq = batch["comm_seq"].to(device)
            comp_seq = batch["comp_seq"].to(device)
            event_sent_seq = batch["event_sent_seq"].to(device)
            static_meta = batch["static_meta"].to(device)
            targets = batch["target"].to(device)
            
            outputs = model(price_seq, comm_seq, comp_seq, event_sent_seq, static_meta)
            model_preds.append(outputs.cpu().numpy())
            actuals.append(targets.cpu().numpy())
            
            # Reconstruct close prices from scaled data to feed trend baseline
            # index 3 is Close in price_cols
            scaled_close = batch["price_seq"][:, :, 3].numpy()
            close_prices.append(scaled_close)
            
    model_preds = np.concatenate(model_preds, axis=0)
    actuals = np.concatenate(actuals, axis=0)
    close_prices = np.concatenate(close_prices, axis=0)
    
    # Naive baseline predictions
    flat_preds = BaselinePredictor.predict_flat(len(actuals))
    trend_preds = BaselinePredictor.predict_trend_batch(close_prices)
    
    # Compute MAE for model, flat, and trend baselines
    horizons = ["5-day", "30-day", "90-day"]
    for idx, name in enumerate(horizons):
        model_mae = np.mean(np.abs(model_preds[:, idx] - actuals[:, idx]))
        flat_mae = np.mean(np.abs(flat_preds[:, idx] - actuals[:, idx]))
        trend_mae = np.mean(np.abs(trend_preds[:, idx] - actuals[:, idx]))
        
        print(f"\n--- Test Set Performance for {name} horizon ---")
        print(f"LSTM Model MAE:      {model_mae:.6f}")
        print(f"Flat Baseline MAE:   {flat_mae:.6f} (No-change prediction)")
        print(f"Trend Baseline MAE:  {trend_mae:.6f} (Linear regression prediction)")
        
    return True

def train_all_models():
    for ticker in TICKERS:
        train_model_for_ticker(ticker)

if __name__ == "__main__":
    train_all_models()

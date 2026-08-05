import os
import torch
from typing import Tuple, Dict, Any

CHECKPOINT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../checkpoints"))

SECTOR_MODEL_MAP = {
    "Technology": "sector_technology.pt",
    "Financial Services": "sector_financials.pt",
    "Consumer Cyclical": "sector_consumer.pt",
    "Healthcare": "sector_healthcare.pt",
    "Energy": "sector_energy.pt",
}

class ModelRegistry:
    """
    Model Registry Subsystem managing versioned model artifacts and dynamic fallback resolution.
    Hierarchy: Exact Ticker Model -> Sector Model -> Global Model Fallback.
    """

    @staticmethod
    def resolve_model_checkpoint(ticker: str, sector: str = "Equity") -> Tuple[str, str, bool]:
        ticker = ticker.upper()
        ticker_checkpoint = os.path.join(CHECKPOINT_DIR, f"{ticker}_best.pt")
        scaler_path = os.path.join(CHECKPOINT_DIR, f"{ticker}_scalers.pkl")

        # 1. Exact Ticker Checkpoint
        if os.path.exists(ticker_checkpoint) and os.path.exists(scaler_path):
            return ticker_checkpoint, scaler_path, False

        # 2. Sector Specific Model Checkpoint
        sector_file = SECTOR_MODEL_MAP.get(sector)
        if sector_file:
            sector_checkpoint = os.path.join(CHECKPOINT_DIR, sector_file)
            if os.path.exists(sector_checkpoint) and os.path.exists(scaler_path):
                return sector_checkpoint, scaler_path, False

        # 3. Global Model Fallback Checkpoint
        global_checkpoint = os.path.join(CHECKPOINT_DIR, "AAPL_best.pt")
        global_scaler = os.path.join(CHECKPOINT_DIR, "AAPL_scalers.pkl")
        
        if os.path.exists(global_checkpoint) and os.path.exists(global_scaler):
            return global_checkpoint, global_scaler, True

        raise FileNotFoundError(f"No trained model checkpoints or fallback weights available in {CHECKPOINT_DIR}")

    @staticmethod
    def get_model_metadata(modelVersion: str = "v1.2.0") -> Dict[str, Any]:
        return {
            "registryVersion": modelVersion,
            "availableSectors": list(SECTOR_MODEL_MAP.keys()),
            "globalModelFallback": "AAPL_best.pt",
            "checkpointPath": CHECKPOINT_DIR
        }

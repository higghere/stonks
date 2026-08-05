import numpy as np

class BaselinePredictor:
    """
    Naive baseline comparison models:
    1. Flat baseline (zero predicted change)
    2. Trend momentum baseline (rolling historic trend projected forward)
    """
    
    @staticmethod
    def predict_flat(num_samples: int) -> np.ndarray:
        # Returns 0.0 return for all 3 horizons (5d, 30d, 90d)
        return np.zeros((num_samples, 3), dtype=np.float32)

    @staticmethod
    def predict_trend(price_history: np.ndarray, horizon: int) -> float:
        """
        Given a historical price series (trailing 60 days), calculate the 
        simple linear trend coefficient and project it forward to the horizon.
        """
        if len(price_history) < 2:
            return 0.0
            
        x = np.arange(len(price_history))
        y = price_history
        
        # Linear regression slope
        slope, _ = np.polyfit(x, y, 1)
        
        # Project slope forward as a percentage of current price
        current_price = y[-1]
        if current_price == 0:
            return 0.0
            
        projected_change = slope * horizon
        predicted_return = projected_change / current_price
        
        return float(predicted_return)

    @classmethod
    def predict_trend_batch(cls, prices_seq_batch: np.ndarray) -> np.ndarray:
        """
        prices_seq_batch shape: (batch_size, sequence_length)
        returns prediction array of shape (batch_size, 3) for [5d, 30d, 90d] horizons
        """
        batch_size = len(prices_seq_batch)
        preds = np.zeros((batch_size, 3), dtype=np.float32)
        
        for i in range(batch_size):
            history = prices_seq_batch[i]
            preds[i, 0] = cls.predict_trend(history, 5)
            preds[i, 1] = cls.predict_trend(history, 30)
            preds[i, 2] = cls.predict_trend(history, 90)
            
        return preds

import os
import sys

# Add root folder to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

class FinBERTScorer:
    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.use_fallback = True
        
        # Try loading Hugging Face transformers/FinBERT
        try:
            from transformers import AutoTokenizer, AutoModelForSequenceClassification
            import torch
            
            print("Attempting to load FinBERT model (ProsusAI/finbert)...")
            self.tokenizer = AutoTokenizer.from_pretrained("ProsusAI/finbert")
            self.model = AutoModelForSequenceClassification.from_pretrained("ProsusAI/finbert")
            self.use_fallback = False
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            self.model.to(self.device)
            self.model.eval()
            print(f"FinBERT loaded successfully on {self.device}.")
        except Exception as e:
            print(f"Could not load Hugging Face FinBERT: {e}. Falling back to Keyword Lexicon Scorer.")
            self.use_fallback = True

        # Initialize financial lexicon keywords for fallback
        self.lexicon = {
            "surpassing": 0.8, "upgrade": 0.7, "partnership": 0.7, "positive": 0.6,
            "beat": 0.6, "exceed": 0.6, "growth": 0.5, "gain": 0.4, "launch": 0.3,
            "flat": 0.0, "restructure": 0.1, "neutral": 0.0,
            "supply": -0.1, "compliance": -0.2, "investigates": -0.2, "decline": -0.4,
            "drop": -0.4, "loss": -0.5, "fall": -0.4, "challenge": -0.3,
            "competitor": -0.3, "down": -0.3, "worry": -0.4, "negative": -0.5
        }

    def score_text(self, text: str, mock_score=None) -> float:
        """
        Score a single headline/text and return polarity in range [-1.0, 1.0].
        """
        if mock_score is not None:
            # If we pre-calculated a mock score, reuse it directly for performance
            return mock_score
            
        if self.use_fallback:
            return self._lexicon_score(text)
            
        try:
            import torch
            inputs = self.tokenizer(text, padding=True, truncation=True, return_tensors="pt").to(self.device)
            with torch.no_grad():
                outputs = self.model(**inputs)
                probs = torch.nn.functional.softmax(outputs.logits, dim=-1)[0]
                
            # FinBERT labels: 0=positive, 1=negative, 2=neutral
            pos = probs[0].item()
            neg = probs[1].item()
            return pos - neg
        except Exception as e:
            # Fall back to lexicon if inference fails
            return self._lexicon_score(text)

    def _lexicon_score(self, text: str) -> float:
        words = text.lower().split()
        score = 0.0
        match_count = 0
        for w in words:
            # Clean punctuation
            w_clean = w.strip(".,;:?!'\"()")
            if w_clean in self.lexicon:
                score += self.lexicon[w_clean]
                match_count += 1
        
        return score / match_count if match_count > 0 else 0.0

    def score_batch(self, articles: list) -> list:
        """
        Takes list of dicts with 'headline' and returns them with 'sentiment_score'.
        """
        scored_articles = []
        for art in articles:
            score = self.score_text(art["headline"], art.get("mock_score"))
            scored_articles.append({
                "headline": art["headline"],
                "datetime": art["datetime"],
                "sentiment_score": score
            })
        return scored_articles

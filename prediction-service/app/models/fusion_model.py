import torch
import torch.nn as nn

class MultiModalPricePredictor(nn.Module):
    def __init__(self, price_dim: int, event_sent_dim: int, static_dim: int = 4):
        super(MultiModalPricePredictor, self).__init__()
        
        # 1. Price/Technical Branch LSTM
        self.price_lstm = nn.LSTM(input_size=price_dim, hidden_size=64, num_layers=2, batch_first=True, dropout=0.1)
        
        # 2. Commodity Branch LSTM
        self.comm_lstm = nn.LSTM(input_size=4, hidden_size=32, num_layers=1, batch_first=True)
        
        # 3. Competitor Branch LSTM
        self.comp_lstm = nn.LSTM(input_size=4, hidden_size=32, num_layers=1, batch_first=True)
        
        # 4. Event/Sentiment Branch LSTM
        self.event_sent_lstm = nn.LSTM(input_size=event_sent_dim, hidden_size=32, num_layers=1, batch_first=True)
        
        # 5. Static Metadata Branch MLP
        self.static_mlp = nn.Sequential(
            nn.Linear(static_dim, 16),
            nn.ReLU(),
            nn.Dropout(0.1)
        )
        
        # 6. Fused Head
        # Concatenated size: 64 (price) + 32 (comm) + 32 (comp) + 32 (event_sent) + 16 (static) = 176
        self.fc_head = nn.Sequential(
            nn.Linear(176, 64),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(64, 3) # 3 outputs: 5d, 30d, 90d return predictions
        )
        
    def forward(self, price_seq, comm_seq, comp_seq, event_sent_seq, static_meta):
        # Pass sequences through respective LSTMs
        # LSTM outputs: (output, (hn, cn))
        # We take the last hidden state hn[-1] for the sequence
        _, (hn_price, _) = self.price_lstm(price_seq)
        price_out = hn_price[-1]
        
        _, (hn_comm, _) = self.comm_lstm(comm_seq)
        comm_out = hn_comm[-1]
        
        _, (hn_comp, _) = self.comp_lstm(comp_seq)
        comp_out = hn_comp[-1]
        
        _, (hn_event, _) = self.event_sent_lstm(event_sent_seq)
        event_out = hn_event[-1]
        
        # MLP for static features
        static_out = self.static_mlp(static_meta)
        
        # Concatenate branches
        fused = torch.cat([price_out, comm_out, comp_out, event_out, static_out], dim=-1)
        
        # Final head prediction
        out = self.fc_head(fused)
        return out

if __name__ == "__main__":
    # Test model shape with mock tensors
    # Batch size = 8, Seq len = 60
    price_seq = torch.randn(8, 60, 15)
    comm_seq = torch.randn(8, 60, 4)
    comp_seq = torch.randn(8, 60, 4)
    event_sent_seq = torch.randn(8, 60, 9)
    static_meta = torch.randn(8, 4)
    
    model = MultiModalPricePredictor(price_dim=15, event_sent_dim=9)
    out = model(price_seq, comm_seq, comp_seq, event_sent_seq, static_meta)
    print("Output shape (should be [8, 3]):", list(out.shape))

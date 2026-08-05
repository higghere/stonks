import os
import sys
import pandas as pd

# Add root folder to sys.path so we can import app
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from app.config.companies import TICKERS, COMMODITY_MAP, COMPETITOR_MAP

CACHE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../data_cache/ohlc"))

def check_file(symbol: str):
    file_path = os.path.join(CACHE_DIR, f"{symbol}.parquet")
    if not os.path.exists(file_path):
        return {"exists": False, "rows": 0, "gaps": [], "min_date": None, "max_date": None}
    
    try:
        df = pd.read_parquet(file_path)
        if df.empty or "Date" not in df.columns:
            return {"exists": True, "rows": 0, "gaps": [], "min_date": None, "max_date": None}
        
        # Convert Date to datetime and sort
        df["Date"] = pd.to_datetime(df["Date"])
        df = df.sort_values("Date")
        
        min_date = df["Date"].min()
        max_date = df["Date"].max()
        
        # Check for consecutive day gaps (excluding weekends)
        # Create a complete business day range between min and max
        bdate_range = pd.bdate_range(start=min_date, end=max_date)
        
        # Calculate percentage of missing business days
        existing_dates = set(df["Date"].dt.date)
        missing_bdays = [d.date() for d in bdate_range if d.date() not in existing_dates]
        
        # Find consecutive missing business days
        consecutive_gaps = []
        if missing_bdays:
            missing_bdays_sorted = sorted(missing_bdays)
            current_gap = [missing_bdays_sorted[0]]
            for d in missing_bdays_sorted[1:]:
                # If next date is within 3 calendar days (handling weekends)
                if (d - current_gap[-1]).days <= 3:
                    current_gap.append(d)
                else:
                    if len(current_gap) >= 5:
                        consecutive_gaps.append(f"{current_gap[0]} to {current_gap[-1]} ({len(current_gap)} days)")
                    current_gap = [d]
            if len(current_gap) >= 5:
                consecutive_gaps.append(f"{current_gap[0]} to {current_gap[-1]} ({len(current_gap)} days)")

        missing_pct = (len(missing_bdays) / len(bdate_range)) * 100 if len(bdate_range) > 0 else 0
        
        return {
            "exists": True,
            "rows": len(df),
            "missing_pct": missing_pct,
            "consecutive_gaps": consecutive_gaps,
            "min_date": min_date.strftime("%Y-%m-%d"),
            "max_date": max_date.strftime("%Y-%m-%d")
        }
    except Exception as e:
        print(f"Error checking {symbol}: {e}")
        return {"exists": True, "rows": 0, "gaps": [], "min_date": None, "max_date": None, "error": str(e)}

def run_validation():
    symbols = set(TICKERS)
    for comms in COMMODITY_MAP.values():
        symbols.update(comms)
    for comps in COMPETITOR_MAP.values():
        symbols.update(comps)
        
    print(f"Validating completeness for {len(symbols)} tickers...")
    
    issues_found = False
    for sym in sorted(symbols):
        res = check_file(sym)
        if not res["exists"]:
            print(f"[ERROR] {sym}: PARQUET FILE MISSING!")
            issues_found = True
        elif "error" in res:
            print(f"[ERROR] {sym}: Error reading file: {res['error']}")
            issues_found = True
        else:
            status = "[OK]"
            details = f"{res['rows']} rows, {res['min_date']} to {res['max_date']}"
            if res["missing_pct"] > 5.0:
                status = "[WARN]"
                details += f" (High missing business days: {res['missing_pct']:.1f}%)"
                issues_found = True
            if res["consecutive_gaps"]:
                status = "[ERROR]"
                details += f" (Large consecutive gaps found: {', '.join(res['consecutive_gaps'])})"
                issues_found = True
            print(f"{status} {sym}: {details}")
            
    if issues_found:
        print("\nValidation completed with warnings or errors. Check missing/thin data files above.")
    else:
        print("\nAll data files are validated and complete!")

if __name__ == "__main__":
    run_validation()

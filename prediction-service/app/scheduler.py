import os
import sys
import time
from apscheduler.schedulers.blocking import BlockingScheduler

# Add root folder to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.data.backfill import run_backfill
from app.models.train import train_all_models
from app.predict import run_predictions

def job_weekly_retrain():
    print("--- [SCHEDULER] Starting weekly model retrain and backfill job ---")
    try:
        # 1. Backfill new historical data
        run_backfill()
        # 2. Retrain all models
        train_all_models()
        # 3. Refresh predictions
        run_predictions()
        print("--- [SCHEDULER] Weekly retrain completed successfully ---")
    except Exception as e:
        print(f"Error during scheduled retrain job: {e}")

def job_prediction_refresh():
    print("--- [SCHEDULER] Starting daily prediction refresh job ---")
    try:
        # Refresh predictions using latest data
        run_predictions()
        print("--- [SCHEDULER] Prediction refresh completed successfully ---")
    except Exception as e:
        print(f"Error during prediction refresh job: {e}")

def start_scheduler():
    scheduler = BlockingScheduler()
    
    # Run weekly model retrain every Sunday at 00:00
    scheduler.add_job(job_weekly_retrain, 'cron', day_of_week='sun', hour=0, minute=0)
    
    # Run prediction refresh every Friday at 18:00 (after weekly close)
    scheduler.add_job(job_prediction_refresh, 'cron', day_of_week='fri', hour=18, minute=0)
    
    print("APScheduler initialized for Prediction Service.")
    print("Jobs scheduled: Retrain (Weekly on Sunday), Refresh (Weekly on Friday after close).")
    
    # Immediate test run of predict.py to verify scheduler loop is clean
    print("Running initial predictions refresh smoke-test...")
    job_prediction_refresh()
    
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        print("Scheduler stopped.")

if __name__ == "__main__":
    start_scheduler()

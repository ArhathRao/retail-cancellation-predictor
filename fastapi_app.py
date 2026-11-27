from pathlib import Path
import os
import json
import joblib
import logging
import pandas as pd

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import create_client

# ==========================================
# 1. INITIALIZE FASTAPI
# ==========================================

app = FastAPI(title='Retail Cancellation Risk API')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
    allow_methods=['GET', 'POST'],
    allow_headers=['*']
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ==========================================
# 2. CONNECT TO SUPABASE
# ==========================================

print('Initializing Supabase connection...')

supabase_url = os.getenv('SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_KEY')

supabase = None

if supabase_url and supabase_key:
    try:
        supabase = create_client(
            supabase_url,
            supabase_key
        )
        print('Supabase client initialized.')
    except Exception:
        logger.error('Supabase initialization failed.')
else:
    print('Supabase environment variables missing.')

# ==========================================
# 3. LOAD EXISTING XGBOOST MODEL
# ==========================================

base = Path(__file__).resolve().parent

print('Loading final XGBoost model...')

model = joblib.load(
    base / 'retail_xgboost_4features.joblib'
)

with (base / 'retail_xgboost_config.json').open() as f:
    config = json.load(f)

features = config['features']
threshold = float(config['threshold'])

expected = [
    'HistoricalPurchaseAmount',
    'HistoricalCancellations',
    'RecencyDays',
    'HistoricalInvoices'
]

if (
    len(features) != 4
    or set(features) != set(expected)
    or abs(threshold - 0.275) > 1e-9
):
    raise ValueError('Unexpected model configuration')

print('Model loaded.')
print('Features:', features)
print('Threshold:', threshold)

# ==========================================
# 4. CUSTOMER INPUT VALIDATION
# ==========================================

class CustomerInput(BaseModel):

    HistoricalPurchaseAmount: float = Field(
        ge=0,
        allow_inf_nan=False
    )

    HistoricalCancellations: int = Field(ge=0)

    RecencyDays: int = Field(ge=0)

    HistoricalInvoices: int = Field(ge=0)

# ==========================================
# 5. HOME ENDPOINT
# ==========================================

@app.get('/')
def home():

    return {
        'status': 'running',
        'model': 'XGBoost',
        'threshold': threshold,
        'prediction_horizon_days': 30
    }

# ==========================================
# 6. DATABASE CONNECTION CHECK
# ==========================================

@app.get('/database-status')
def database_status():

    if supabase is None:
        raise HTTPException(
            status_code=503,
            detail='Database not configured'
        )

    try:
        supabase.table('predictions') \
            .select('id') \
            .limit(1) \
            .execute()

        return {
            'status': 'connected',
            'database': 'Supabase PostgreSQL'
        }

    except Exception:
        logger.exception('Database connection check failed.')

        raise HTTPException(
            status_code=503,
            detail='Database connection failed'
        )

# ==========================================
# 7. PREDICT CUSTOMER CANCELLATION RISK
# ==========================================

@app.post('/predict')
def predict(data: CustomerInput):

    # Preserve original feature order

    frame = pd.DataFrame(
        [data.model_dump()],
        columns=features
    )

    probability = float(
        model.predict_proba(frame)[0][1]
    )

    prediction = int(probability >= threshold)

    # Preserve existing risk categories

    risk = (
        'Low' if probability < 0.10
        else 'Moderate' if probability < threshold
        else 'High' if probability < 0.50
        else 'Very High'
    )

    result = {
        'prediction': prediction,
        'cancellation_probability': round(probability, 4),
        'risk_level': risk
    }

    # ======================================
    # 8. SAVE PREDICTION TO CLOUD DATABASE
    # ======================================

    record = {
        'historical_purchase_amount':
            data.HistoricalPurchaseAmount,

        'historical_cancellations':
            data.HistoricalCancellations,

        'recency_days':
            data.RecencyDays,

        'historical_invoices':
            data.HistoricalInvoices,

        'prediction': prediction,

        'cancellation_probability':
            round(probability, 4),

        'risk_level': risk
    }

    saved = False

    if supabase is not None:
        try:
            supabase.table('predictions') \
                .insert(record) \
                .execute()

            saved = True

            print('Prediction saved to Supabase.')

        except Exception:
            logger.error('Failed to save prediction.')

    # Prediction still works if database fails

    result['saved_to_database'] = saved

    return result

# ==========================================
# 9. RETRIEVE SHARED PREDICTION HISTORY
# ==========================================

@app.get('/history')
def get_history(
    limit: int = Query(default=100, ge=1, le=100),
    offset: int = Query(default=0, ge=0)
):

    if supabase is None:
        raise HTTPException(
            status_code=503,
            detail='Database not configured'
        )

    try:
        response = supabase.table('predictions') \
            .select('*', count='exact') \
            .order('created_at', desc=True) \
            .order('id', desc=True) \
            .range(offset, offset + limit - 1) \
            .execute()

        return {
            'status': 'success',
            'total_predictions': response.count,
            'predictions': response.data
        }

    except Exception:
        logger.error('Failed to retrieve history.')

        raise HTTPException(
            status_code=503,
            detail='Unable to retrieve prediction history'
        )

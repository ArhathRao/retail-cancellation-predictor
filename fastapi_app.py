from pathlib import Path
import json
import joblib
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title='Retail Cancellation Risk API')
# Public demo API; no credentials are accepted by CORS.
app.add_middleware(CORSMiddleware, allow_origins=['*'],
                   allow_credentials=False, allow_methods=['GET', 'POST'],
                   allow_headers=['*'])

base = Path(__file__).resolve().parent
print('Loading final XGBoost model...')
model = joblib.load(base / 'retail_xgboost_4features.joblib')
with (base / 'retail_xgboost_config.json').open() as f:
    config = json.load(f)
features = config['features']
threshold = float(config['threshold'])
expected = ['HistoricalPurchaseAmount', 'HistoricalCancellations', 'RecencyDays', 'HistoricalInvoices']
if len(features) != 4 or set(features) != set(expected) or abs(threshold - 0.275) > 1e-9:
    raise ValueError('Unexpected model configuration')
print('Model loaded. Features:', features, 'Threshold:', threshold)

class CustomerInput(BaseModel):
    HistoricalPurchaseAmount: float = Field(ge=0, allow_inf_nan=False)
    HistoricalCancellations: int = Field(ge=0)
    RecencyDays: int = Field(ge=0)
    HistoricalInvoices: int = Field(ge=0)

@app.get('/')
def home():
    return {'status': 'running', 'model': 'XGBoost', 'threshold': threshold,
            'prediction_horizon_days': 30}

@app.post('/predict')
def predict(data: CustomerInput):
    # Preserve the feature order from the training configuration.
    frame = pd.DataFrame([data.model_dump()], columns=features)
    probability = float(model.predict_proba(frame)[0][1])
    prediction = int(probability >= threshold)
    # Provisional display categories, separate from the classification threshold.
    risk = ('Low' if probability < 0.10 else 'Moderate' if probability < threshold
            else 'High' if probability < 0.50 else 'Very High')
    return {'prediction': prediction, 'cancellation_probability': round(probability, 4),
            'risk_level': risk}

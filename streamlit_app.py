
import json
from pathlib import Path

import joblib
import pandas as pd
import streamlit as st

# --------------------------------------------------
# 1. Page configuration
# --------------------------------------------------
st.set_page_config(
    page_title="Retail Cancellation Risk Predictor",
    page_icon="🛒",
    layout="centered"
)

st.title("🛒 Retail Cancellation Risk Predictor")
st.write(
    "Predict a customer's cancellation risk using "
    "historical purchasing behaviour."
)

# --------------------------------------------------
# 2. Load trained XGBoost model and configuration
# --------------------------------------------------
@st.cache_resource
def load_model():
    folder = Path(__file__).resolve().parent

    model = joblib.load(
        folder / "retail_xgboost_4features.joblib"
    )

    with open(
        folder / "retail_xgboost_config.json",
        "r",
        encoding="utf-8"
    ) as file:
        config = json.load(file)

    print("XGBoost model and configuration loaded successfully!")
    return model, config


try:
    model, config = load_model()
except Exception as error:
    st.error(f"Unable to load model: {error}")
    st.stop()

features = config["features"]
threshold = float(config["threshold"])

st.success("Prediction model is ready!")

# --------------------------------------------------
# 3. Customer information form
# --------------------------------------------------
st.subheader("Customer Purchase History")

with st.form("prediction_form"):

    purchase_amount = st.number_input(
        "Historical Purchase Amount (£)",
        min_value=0.0,
        value=1500.0,
        step=100.0
    )

    cancellations = st.number_input(
        "Historical Cancellations",
        min_value=0,
        value=2,
        step=1
    )

    recency = st.number_input(
        "Days Since Last Purchase",
        min_value=0,
        value=30,
        step=1
    )

    invoices = st.number_input(
        "Historical Invoices",
        min_value=0,
        value=12,
        step=1
    )

    predict_button = st.form_submit_button(
        "Predict Cancellation Risk",
        use_container_width=True
    )

# --------------------------------------------------
# 4. Generate prediction
# --------------------------------------------------
if predict_button:

    customer = pd.DataFrame([{
        "HistoricalPurchaseAmount": purchase_amount,
        "HistoricalCancellations": cancellations,
        "RecencyDays": recency,
        "HistoricalInvoices": invoices
    }])

    # Ensure feature order matches model training
    customer = customer[features]

    print("Customer details received:", customer.to_dict("records"))

    try:
        probability = float(
            model.predict_proba(customer)[0][1]
        )

        st.subheader("Prediction Result")

        st.metric(
            "Predicted Cancellation Risk",
            f"{probability * 100:.2f}%"
        )

        st.progress(min(max(probability, 0.0), 1.0))

        if probability >= threshold:
            st.warning(
                "High Cancellation Risk — customer is "
                "predicted to be at risk of cancellation."
            )
        else:
            st.success(
                "Low Cancellation Risk — customer is "
                "predicted to have lower cancellation risk."
            )

        st.caption(
            f"Decision threshold: {threshold:.3f} | "
            f"Prediction horizon: "
            f"{config.get('prediction_horizon_days', 30)} days"
        )

        st.info(
            "This is a statistical risk estimate, "
            "not a guaranteed customer outcome."
        )

        print("Prediction generated successfully!")
        print(f"Cancellation probability: {probability:.4f}")

    except Exception as error:
        st.error(f"Prediction failed: {error}")
        print(f"Prediction error: {error}")


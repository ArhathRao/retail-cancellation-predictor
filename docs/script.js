
// ==========================================
// RETAILIQ 2.0 - XGBOOST CANCELLATION RISK
// ==========================================

// Default public FastAPI endpoint
const DEFAULT_API =
    "https://retail-cancellation-predictor.onrender.com/predict";

let API_URL = localStorage.getItem("retailIQEndpoint")
    || DEFAULT_API;

// Replace previously saved localhost endpoint
if (
    API_URL.includes("127.0.0.1") ||
    API_URL.includes("localhost")
) {
    API_URL = DEFAULT_API;

    localStorage.setItem(
        "retailIQEndpoint",
        API_URL
    );
}

// Render free server startup timeout
const REQUEST_TIMEOUT = 120000;

// Load previous prediction history
let history = [];

try {
    history = JSON.parse(
        localStorage.getItem("retailIQHistory") || "[]"
    );

    if (!Array.isArray(history)) history = [];

} catch {
    history = [];
}

const $ = id => document.getElementById(id);

const riskColors = {
    "Low": "#22c55e",
    "Moderate": "#eab308",
    "High": "#f97316",
    "Very High": "#ef4444"
};

const pageNames = {
    dashboard: "Dashboard",
    prediction: "Risk Prediction",
    analytics: "Analytics",
    history: "Prediction History",
    settings: "API Settings"
};


// ==========================================
// 1. NAVIGATION
// ==========================================

function showPage(page) {

    document.querySelectorAll(".page").forEach(section => {
        section.classList.remove("active");
    });

    document.querySelectorAll(".nav-btn").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.page === page
        );
    });

    $(page).classList.add("active");

    $("pageTitle").textContent = pageNames[page];

    updateDashboard();
    updateHistory();
    updateAnalytics();
}

document.querySelectorAll(".nav-btn").forEach(button => {

    button.addEventListener("click", () => {
        showPage(button.dataset.page);
    });

});


// ==========================================
// 2. LOAD SAMPLE INPUT
// ==========================================

function loadSample() {

    $("purchase").value = 2500;
    $("cancellations").value = 2;
    $("recency").value = 15;
    $("invoices").value = 10;

    console.log("Sample customer details loaded.");

}


// ==========================================
// 3. SUBMIT CUSTOMER DETAILS
// ==========================================

$("predictionForm").addEventListener("submit", async event => {

    event.preventDefault();

    $("errorMessage").textContent = "";

    const rawValues = [
        $("purchase").value,
        $("cancellations").value,
        $("recency").value,
        $("invoices").value
    ];

    // Validate input values
    if (rawValues.some(value =>
        value.trim() === "" ||
        !Number.isFinite(Number(value)) ||
        Number(value) < 0
    )) {
        $("errorMessage").textContent =
            "Please enter valid non-negative values.";

        return;
    }

    if (!rawValues.slice(1).every(value =>
        Number.isInteger(Number(value))
    )) {
        $("errorMessage").textContent =
            "Cancellations, recency and invoices must be whole numbers.";

        return;
    }

    // Prepare four XGBoost input features
    const data = {
        HistoricalPurchaseAmount: Number($("purchase").value),
        HistoricalCancellations: Number($("cancellations").value),
        RecencyDays: Number($("recency").value),
        HistoricalInvoices: Number($("invoices").value)
    };

    console.log("Sending customer data:", data);

    $("predictBtn").disabled = true;

    $("predictBtn").textContent =
        "Analyzing Customer Risk...";

    resetResult();

    $("recommendation").textContent =
        "Connecting to the server. The first request may take up to two minutes.";

    const controller = new AbortController();

    const timeout = setTimeout(() => {
        controller.abort();
    }, REQUEST_TIMEOUT);

    try {

        // Send customer details to Render FastAPI
        const response = await fetch(API_URL, {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(data),

            signal: controller.signal

        });

        if (!response.ok) {
            throw new Error(
                "API returned HTTP " + response.status
            );
        }

        const result = await response.json();

        console.log("XGBoost response received:", result);

        validateResult(result);

        displayResult(result);

        savePrediction(data, result);

        setConnectionStatus(true);

    } catch (error) {

        console.error("Prediction failed:", error);

        $("errorMessage").textContent =
            error.name === "AbortError"
                ? "Server request timed out. Please try again."
                : "Prediction failed: " + error.message
                  + ". Check your API connection.";

        $("recommendation").textContent =
            "Prediction unavailable. Please try again.";

        setConnectionStatus(false);

    } finally {

        clearTimeout(timeout);

        $("predictBtn").disabled = false;

        $("predictBtn").textContent =
            "Analyze Cancellation Risk";

    }

});


// ==========================================
// 4. VALIDATE BACKEND RESPONSE
// ==========================================

function validateResult(result) {

    const probability = result.cancellation_probability;

    if (
        typeof probability !== "number" ||
        !Number.isFinite(probability) ||
        probability < 0 ||
        probability > 1
    ) {
        throw new Error("Invalid cancellation probability");
    }

    if (![0, 1].includes(result.prediction)) {
        throw new Error("Invalid prediction label");
    }

    if (!Object.hasOwn(riskColors, result.risk_level)) {
        throw new Error("Invalid risk category");
    }

}


// ==========================================
// 5. RESET PREVIOUS PREDICTION
// ==========================================

function resetResult() {

    $("probability").textContent = "—";

    $("gauge").style.setProperty("--progress", "0deg");

    $("riskBadge").textContent = "Awaiting Prediction";

    $("riskBadge").style.color = "";

    $("riskBadge").style.background = "#252e45";

    $("predictionLabel").textContent = "No prediction yet";

    $("recommendation").textContent =
        "Waiting for the model response.";

}


// ==========================================
// 6. DISPLAY XGBOOST PREDICTION
// ==========================================

function displayResult(result) {

    const probability = result.cancellation_probability;

    const percentage = probability * 100;

    const risk = result.risk_level;

    const color = riskColors[risk];

    $("probability").textContent =
        percentage.toFixed(2) + "%";

    $("gauge").style.setProperty(
        "--progress",
        probability * 360 + "deg"
    );

    $("gauge").style.setProperty(
        "--risk-color",
        color
    );

    $("riskBadge").textContent = risk + " Risk";

    $("riskBadge").style.color = color;

    $("riskBadge").style.background = color + "20";

    $("predictionLabel").textContent =
        result.prediction === 1
            ? "Cancellation Predicted"
            : "Cancellation Not Predicted";

    const recommendations = {

        "Low":
            "Continue normal customer engagement.",

        "Moderate":
            "Monitor customer activity and offer assistance.",

        "High":
            "Review previous cancellations and customer concerns.",

        "Very High":
            "Prioritize customer support and investigate cancellation patterns."

    };

    $("recommendation").textContent =
        recommendations[risk];

    console.log("Prediction displayed successfully.");

}


// ==========================================
// 7. SAVE PREDICTION HISTORY
// ==========================================

function savePrediction(input, result) {

    history.unshift({

        date: new Date().toLocaleString(),

        ...input,

        ...result

    });

    localStorage.setItem(
        "retailIQHistory",
        JSON.stringify(history)
    );

    updateDashboard();
    updateHistory();
    updateAnalytics();

    console.log("Prediction saved successfully.");

}


// ==========================================
// 8. UPDATE DASHBOARD STATISTICS
// ==========================================

function updateDashboard() {

    $("totalPredictions").textContent = history.length;

    const average = history.length
        ? history.reduce(
            (sum, item) =>
                sum + item.cancellation_probability, 0
          ) / history.length
        : null;

    $("averageRisk").textContent =
        average === null
            ? "—"
            : (average * 100).toFixed(1) + "%";

    $("highRiskCount").textContent = history.filter(
        item => item.prediction === 1
    ).length;

}


// ==========================================
// 9. UPDATE PREDICTION HISTORY TABLE
// ==========================================

function updateHistory() {

    const tbody = $("historyBody");

    tbody.replaceChildren();

    if (history.length === 0) {

        const row = tbody.insertRow();

        const cell = row.insertCell();

        cell.colSpan = 7;

        cell.textContent = "No predictions recorded yet.";

        return;

    }

    history.forEach(item => {

        const row = tbody.insertRow();

        const values = [

            item.date,

            item.HistoricalPurchaseAmount,

            item.HistoricalCancellations,

            item.RecencyDays,

            item.HistoricalInvoices,

            (item.cancellation_probability * 100)
                .toFixed(2) + "%",

            item.risk_level

        ];

        values.forEach(value => {

            const cell = row.insertCell();

            cell.textContent = value;

        });

        row.lastElementChild.style.color =
            riskColors[item.risk_level];

    });

}


// ==========================================
// 10. GENERATE ANALYTICS CHART
// ==========================================

function updateAnalytics() {

    const chart = $("riskChart");

    chart.replaceChildren();

    Object.keys(riskColors).forEach(risk => {

        const count = history.filter(
            item => item.risk_level === risk
        ).length;

        const percentage = history.length
            ? count / history.length * 100
            : 0;

        const row = document.createElement("div");

        row.className = "chart-row";

        const label = document.createElement("div");

        label.className = "chart-label";

        label.textContent =
            risk + " Risk — " + count + " predictions";

        const track = document.createElement("div");

        track.className = "chart-track";

        const fill = document.createElement("div");

        fill.className = "chart-fill";

        fill.style.width = percentage + "%";

        fill.style.background = riskColors[risk];

        track.appendChild(fill);

        row.append(label, track);

        chart.appendChild(row);

    });

}


// ==========================================
// 11. SAVE API ENDPOINT
// ==========================================

function saveEndpoint() {

    const value = $("apiEndpoint").value.trim();

    try {

        const url = new URL(value);

        if (!["http:", "https:"].includes(url.protocol)) {
            throw new Error("Invalid protocol");
        }

        // Automatically append /predict if missing
        if (!url.pathname.endsWith("/predict")) {

            url.pathname =
                url.pathname.replace(/\/+$/, "") + "/predict";

        }

        url.search = "";
        url.hash = "";

        API_URL = url.href;

        $("apiEndpoint").value = API_URL;

        localStorage.setItem(
            "retailIQEndpoint",
            API_URL
        );

        $("connectionMessage").textContent =
            "Endpoint saved. Test the connection.";

        setConnectionStatus(false);

        console.log("API endpoint saved:", API_URL);

    } catch {

        $("connectionMessage").textContent =
            "Enter a valid HTTP or HTTPS API URL.";

    }

}


// ==========================================
// 12. TEST RENDER FASTAPI CONNECTION
// ==========================================

async function checkConnection() {

    $("connectionMessage").textContent =
        "Connecting to Render. Please wait...";

    const controller = new AbortController();

    const timeout = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT
    );

    try {

        const url = new URL(API_URL);

        // New backend uses GET / instead of /health
        url.pathname = "/";

        url.search = "";
        url.hash = "";

        console.log("Checking backend:", url.href);

        const response = await fetch(url.href, {

            method: "GET",

            signal: controller.signal

        });

        if (!response.ok) {
            throw new Error("Backend unavailable");
        }

        const result = await response.json();

        console.log("Backend status:", result);

        // Validate new XGBoost backend
        if (result.status !== "running") {
            throw new Error("Unexpected backend response");
        }

        setConnectionStatus(true);

        $("connectionMessage").textContent =
            "XGBoost backend connected successfully!";

    } catch (error) {

        setConnectionStatus(false);

        $("connectionMessage").textContent =
            error.name === "AbortError"
                ? "Connection timed out. Please try again."
                : "Connection failed. Check your Render API URL.";

        console.error(error);

    } finally {

        clearTimeout(timeout);

    }

}


// ==========================================
// 13. UPDATE API CONNECTION INDICATOR
// ==========================================

function setConnectionStatus(connected) {

    $("statusDot").style.background =
        connected ? "#22c55e" : "#ef4444";

    $("apiStatus").textContent =
        connected ? "API connected" : "API not connected";

}


// ==========================================
// 14. EXPORT HISTORY AS CSV
// ==========================================

function exportCSV() {

    if (history.length === 0) {
        alert("No predictions available to export.");
        return;
    }

    const columns = [

        "date",
        "HistoricalPurchaseAmount",
        "HistoricalCancellations",
        "RecencyDays",
        "HistoricalInvoices",
        "prediction",
        "cancellation_probability",
        "risk_level"

    ];

    const escapeCSV = value =>
        '"' + String(value ?? "").replace(/"/g, '""') + '"';

    const csv = [

        columns.join(","),

        ...history.map(item =>
            columns.map(key => escapeCSV(item[key])).join(",")
        )

    ].join("\n");

    const blob = new Blob([csv], {
        type: "text/csv;charset=utf-8;"
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;

    link.download = "RetailIQ_Predictions.csv";

    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    console.log("CSV exported successfully.");

}


// ==========================================
// 15. CLEAR PREDICTION HISTORY
// ==========================================

function clearHistory() {

    if (!confirm("Delete all saved predictions?")) {
        return;
    }

    history = [];

    localStorage.removeItem("retailIQHistory");

    updateDashboard();
    updateHistory();
    updateAnalytics();

    console.log("Prediction history cleared.");

}


// ==========================================
// 16. INITIALIZE APPLICATION
// ==========================================

$("apiEndpoint").value = API_URL;

updateDashboard();
updateHistory();
updateAnalytics();

console.log("RetailIQ 2.0 initialized successfully.");
console.log("Model: XGBoost Classifier");
console.log("Features: 4");
console.log("Classification threshold: 0.275");
console.log("Prediction horizon: 30 days");
console.log("Current API endpoint:", API_URL);

// Automatically check public backend connection
checkConnection();

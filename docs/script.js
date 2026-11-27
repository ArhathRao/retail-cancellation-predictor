// ==========================================
// CANCELLATION PREDICTOR - CLOUD EDITION
// ==========================================

// 1. API configuration

const DEFAULT_API =
    "https://retail-cancellation-predictor.onrender.com/predict";

let API_URL = DEFAULT_API;

let history = [];
let predictionInProgress = false;
let sessionResultDisplayed = false;
let historyLoaded = false;
let historyError = "";
let refreshPromise = null;
let connectionState = "loading";
let connectionCheck = null;

const $ = id => document.getElementById(id);

const riskColors = {
    "Low": "#A0A2A6",
    "Moderate": "#E8A33D",
    "High": "#E8A33D",
    "Very High": "#E8A33D"
};

const pageNames = {
    dashboard: "Dashboard",
    prediction: "Risk Prediction",
    analytics: "Analytics",
    history: "Prediction History",
    settings: "API Settings"
};

// ==========================================
// 2. API REQUEST HELPER
// ==========================================

function getEndpoint(path) {

    return new URL(path, API_URL).href;

}

async function apiRequest(url, options = {}) {

    const controller = new AbortController();

    const timeout = setTimeout(
        () => controller.abort(),
        120000
    );

    try {

        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(
                "API returned HTTP " + response.status
            );
        }

        return await response.json();

    } finally {

        clearTimeout(timeout);

    }

}

// ==========================================
// 3. NAVIGATION
// ==========================================

function showPage(page) {

    document.querySelectorAll(".page")
        .forEach(section => {
            section.classList.remove("active");
        });

    document.querySelectorAll(".nav-btn")
        .forEach(button => {

            button.classList.toggle(
                "active",
                button.dataset.page === page
            );

        });

    $(page).classList.add("active");
    $("predictionWorkspace").hidden = !["dashboard", "prediction"].includes(page);

    $("pageTitle").textContent = pageNames[page];

    updateDashboard();
    updateHistory();
    updateAnalytics();

    // Retrieve latest cloud records

    if (["dashboard", "history", "analytics"].includes(page)) {
        loadCloudHistory();
    }

}

document.querySelectorAll(".nav-btn")
    .forEach(button => {

        button.addEventListener("click", () => {

            showPage(button.dataset.page);

        });

    });

// ==========================================
// 4. LOAD SAMPLE CUSTOMER
// ==========================================

function loadSample() {

    $("purchase").value = 2500;
    $("cancellations").value = 2;
    $("recency").value = 15;
    $("invoices").value = 10;

    console.log("Sample customer details loaded.");

}

// ==========================================
// 5. LOAD HISTORY FROM SUPABASE VIA FASTAPI
// ==========================================

async function loadCloudHistory() {

    // Prevent overlapping history requests

    if (refreshPromise) {
        return refreshPromise;
    }

    if (connectionState !== "connected") setConnectionStatus("loading");

    refreshPromise = (async () => {

        console.log("Loading cloud prediction history...");

        try {

            let records = [];
            let offset = 0;
            let total = null;

            const limit = 100;

            // Retrieve all pages of database records

            while (total === null || offset < total) {

                const url = getEndpoint(
                    `/history?limit=${limit}&offset=${offset}`
                );

                const response = await apiRequest(url);

                if (
                    response.status !== "success" ||
                    !Array.isArray(response.predictions)
                ) {
                    throw new Error("Invalid history response");
                }

                if (total === null) {
                    total = Number(response.total_predictions);

                    if (!Number.isInteger(total) || total < 0) {
                        throw new Error("Invalid record count");
                    }
                }

                const batch = response.predictions;

                records.push(...batch);

                offset += batch.length;

                if (batch.length < limit) {
                    break;
                }

            }

            // Remove duplicate IDs during pagination

            const uniqueRecords = [
                ...new Map(
                    records.map(item => [item.id, item])
                ).values()
            ];

            // Convert database columns to frontend format

            const mappedHistory = uniqueRecords.map(item => ({

                id: item.id,

                date: new Date(
                    item.created_at
                ).toLocaleString(),

                HistoricalPurchaseAmount:
                    Number(item.historical_purchase_amount),

                HistoricalCancellations:
                    Number(item.historical_cancellations),

                RecencyDays:
                    Number(item.recency_days),

                HistoricalInvoices:
                    Number(item.historical_invoices),

                prediction:
                    Number(item.prediction),

                cancellation_probability:
                    Number(item.cancellation_probability),

                risk_level:
                    item.risk_level

            }));

            mappedHistory.forEach(validateResult);

            history = mappedHistory;

            // Show the latest stored result until this session makes a prediction.
            if (!predictionInProgress && !sessionResultDisplayed && history.length) {
                displayResult(history[0]);
            }
            historyLoaded = true;
            historyError = "";

            updateDashboard();
            updateHistory();
            updateAnalytics();

            setConnectionStatus(true);

            $("connectionMessage").textContent =
                "Cloud history synchronized successfully.";

            console.log(
                "Cloud records loaded:",
                history.length
            );

            return true;

        } catch (error) {

            historyError =
                "Unable to synchronize cloud history.";

            console.error(
                "Cloud history loading failed:",
                error
            );

            $("connectionMessage").textContent =
                historyError + " Please try again.";

            updateDashboard();
            updateHistory();
            updateAnalytics();

            setConnectionStatus(false);

            return false;

        }

    })();

    try {

        return await refreshPromise;

    } finally {

        refreshPromise = null;

    }

}

// ==========================================
// 6. SUBMIT CUSTOMER PREDICTION
// ==========================================

$("predictionForm").addEventListener(
    "submit",
    async event => {

        event.preventDefault();
        if (predictionInProgress) return;

        $("errorMessage").textContent = "";

        const fields = [
            "purchase",
            "cancellations",
            "recency",
            "invoices"
        ];

        if (fields.some(id => $(id).value.trim() === "")) {

            $("errorMessage").textContent =
                "Please enter all customer details.";

            return;

        }

        const data = {

            HistoricalPurchaseAmount:
                Number($("purchase").value),

            HistoricalCancellations:
                Number($("cancellations").value),

            RecencyDays:
                Number($("recency").value),

            HistoricalInvoices:
                Number($("invoices").value)

        };

        // Validate customer inputs

        if (
            Object.values(data).some(
                value => !Number.isFinite(value) || value < 0
            )
        ) {

            $("errorMessage").textContent =
                "Enter valid non-negative values.";

            return;

        }

        if (
            !Number.isInteger(data.HistoricalCancellations) ||
            !Number.isInteger(data.RecencyDays) ||
            !Number.isInteger(data.HistoricalInvoices)
        ) {

            $("errorMessage").textContent =
                "Cancellations, recency and invoices must be whole numbers.";

            return;

        }

        $("predictBtn").disabled = true;

        $("predictBtn").textContent =
            "Predicting...";

        predictionInProgress = true;
        if (connectionState !== "connected") setConnectionStatus("loading");
        $("predictionForm").setAttribute("aria-busy", "true");
        resetResult();
        $("predictionLabel").textContent = "Calculating cancellation probability...";

        console.log("Sending customer data:", data);

        try {

            const result = await apiRequest(API_URL, {

                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify(data)

            });

            console.log("Model response:", result);

            validateResult(result);

            displayResult(result);
            sessionResultDisplayed = true;

            setConnectionStatus(true);

            // Backend automatically saves to Supabase

            if (result.saved_to_database === true) {

                console.log(
                    "Prediction saved to cloud database."
                );

                // Wait for any previous refresh to finish

                if (refreshPromise) {
                    await refreshPromise;
                }

                // Retrieve updated shared history

                const synced = await loadCloudHistory();

                if (!synced) {
                    $("errorMessage").textContent =
                        "Prediction saved, but history refresh failed.";
                }

            } else {

                $("errorMessage").textContent =
                    "Prediction generated, but cloud storage was not confirmed.";

                console.warn(
                    "Database storage was not confirmed."
                );

            }

        } catch (error) {

            console.error("Prediction failed:", error);

            $("errorMessage").textContent =
                error.name === "AbortError"
                    ? "Request timed out. Check history before retrying."
                    : "Prediction failed: " + error.message;

            setConnectionStatus(false);

        } finally {

            predictionInProgress = false;
            $("predictionForm").removeAttribute("aria-busy");
            $("predictBtn").disabled = false;

            $("predictBtn").textContent =
                "Predict cancellation";

        }

    }
);

// ==========================================
// 7. VALIDATE MODEL RESPONSE
// ==========================================

function validateResult(result) {

    const probability =
        result.cancellation_probability;

    if (
        typeof probability !== "number" ||
        !Number.isFinite(probability) ||
        probability < 0 ||
        probability > 1
    ) {

        throw new Error(
            "Invalid cancellation probability"
        );

    }

    if (![0, 1].includes(result.prediction)) {

        throw new Error("Invalid prediction label");

    }

    if (!Object.hasOwn(riskColors, result.risk_level)) {

        throw new Error("Invalid risk category");

    }

}

// ==========================================
// 8. RESET PREVIOUS PREDICTION
// ==========================================

function resetResult() {

    $("probability").textContent = "Not calculated";
    $("gauge").dataset.empty = "true";

    $("gauge").style.setProperty(
        "--progress",
        "0"
    );

    $("riskBadge").textContent =
        "No risk classification";

    $("riskBadge").style.color = "";


    $("predictionLabel").textContent =
        "No prediction yet";

    $("recommendation").textContent =
        "Waiting for the model response.";

}

// ==========================================
// 9. DISPLAY PREDICTION RESULT
// ==========================================

function displayResult(result) {

    const probability =
        result.cancellation_probability;

    const percentage = probability * 100;
    $("gauge").dataset.empty = "false";

    const risk = result.risk_level;

    const color = riskColors[risk];

    $("probability").textContent =
        percentage.toFixed(2) + "%";

    $("gauge").style.setProperty(
        "--progress",
        String(percentage)
    );

    $("gauge").style.setProperty(
        "--risk-color",
        color
    );

    $("riskBadge").textContent = risk + " Risk";

    $("riskBadge").style.color = color;


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
// 10. UPDATE DASHBOARD
// ==========================================

function updateDashboard() {

    const hasData = historyLoaded && history.length > 0;
    $("statsRow").hidden = !hasData;
    $("statsMessage").hidden = hasData && !historyError;

    $("statsMessage").textContent = historyError
        ? historyError + (hasData ? " Showing last synchronized records." : " Please try again.")
        : !historyLoaded
            ? "Loading prediction statistics…"
            : "No predictions yet. Run one to see results here.";

    if (!hasData) return;

    $("totalPredictions").textContent =
        history.length;

    const average = history.length
        ? history.reduce(
            (sum, item) =>
                sum + item.cancellation_probability,
            0
        ) / history.length
        : null;

    $("averageRisk").textContent =
        average === null
            ? "—"
            : (average * 100).toFixed(2) + "%";

    $("highRiskCount").textContent =
        history.filter(
            item => item.prediction === 1
        ).length;

}

// ==========================================
// 11. UPDATE SHARED HISTORY TABLE
// ==========================================

function updateHistory() {

    const tbody = $("historyBody");

    tbody.replaceChildren();

    if (historyError) {

        const row = tbody.insertRow();
        const cell = row.insertCell();

        cell.colSpan = 7;

        cell.textContent =
            historyError +
            (historyLoaded
                ? " Showing last synchronized records."
                : "");

    }

    if (!historyLoaded || history.length === 0) {

        if (historyError) return;

        const row = tbody.insertRow();

        const cell = row.insertCell();

        cell.colSpan = 7;

        cell.textContent = historyLoaded
            ? "No cloud predictions recorded yet."
            : "Loading cloud prediction history...";

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
// 12. UPDATE CLOUD ANALYTICS
// ==========================================

function updateAnalytics() {

    const chart = $("riskChart");

    chart.replaceChildren();

    if (!historyLoaded || historyError) {

        const message = document.createElement("div");

        message.textContent = historyError
            ? historyError
            : "Loading cloud analytics...";

        chart.appendChild(message);

        if (!historyLoaded) return;

    }

    if (history.length === 0) {
        if (!historyError) chart.textContent = "No predictions yet. Run one to see the risk distribution.";
        return;
    }

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
// 13. API SETTINGS
// ==========================================

function saveEndpoint() {

    // Use only the official Cancellation Predictor backend

    API_URL = DEFAULT_API;

    $("apiEndpoint").value = DEFAULT_API;

    $("connectionMessage").textContent =
        "Official cloud API endpoint selected.";

    checkConnection();

}

// ==========================================
// 14. CHECK BACKEND AND DATABASE
// ==========================================

async function checkConnection() {
    if (connectionCheck) return connectionCheck;
    connectionCheck = (async () => {
    if (connectionState !== "connected") setConnectionStatus("loading");
    $("connectionMessage").textContent =
        "Checking connection. Free hosting may take a minute or two to wake up.";

    try {

        const backend = await apiRequest(
            getEndpoint("/")
        );

        if (backend.status !== "running") {

            throw new Error("Backend unavailable");

        }

        const database = await apiRequest(
            getEndpoint("/database-status")
        );

        if (database.status !== "connected") {

            throw new Error("Database unavailable");

        }

        setConnectionStatus(true);

        $("connectionMessage").textContent =
            "FastAPI and Supabase connected successfully!";

        console.log("Cloud connection successful.");

        await loadCloudHistory();

    } catch (error) {

        setConnectionStatus(false);

        $("connectionMessage").textContent =
            "Cloud connection failed. Please try again.";

        console.error("Connection failed:", error);

    }
    })();
    try { return await connectionCheck; }
    finally { connectionCheck = null; }
}

// ==========================================
// 15. CONNECTION INDICATOR
// ==========================================

function setConnectionStatus(connected) {
    connectionState = connected === "loading" ? "loading" : connected ? "connected" : "offline";
    $("statusDot").dataset.state = connectionState;
    $("apiStatus").textContent = {
        loading: "Waking server...",
        connected: "API connected",
        offline: "Cloud sync unavailable"
    }[connectionState];
    $("serverLoading").hidden = connectionState !== "loading";
}

// ==========================================
// 16. EXPORT CLOUD HISTORY AS CSV
// ==========================================

async function exportCSV() {

    // Refresh records before exporting

    const synced = await loadCloudHistory();

    if (!synced) {

        alert("Unable to retrieve current cloud records.");

        return;

    }

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
        '"' + String(value ?? "")
            .replace(/"/g, '""') + '"';

    const csv = [

        columns.join(","),

        ...history.map(item =>

            columns.map(
                key => escapeCSV(item[key])
            ).join(",")

        )

    ].join("\n");

    const blob = new Blob([csv], {

        type: "text/csv;charset=utf-8;"

    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;

    link.download =
        "Cancellation_Predictor_Cloud_Predictions.csv";

    document.body.appendChild(link);

    link.click();

    link.remove();

    setTimeout(
        () => URL.revokeObjectURL(url),
        1000
    );

    console.log("Cloud CSV exported successfully.");

}

// ==========================================
// 17. PROTECT SHARED DATABASE RECORDS
// ==========================================

function clearHistory() {

    alert(
        "Cloud prediction history is shared by all users. " +
        "Only the database administrator can delete records."
    );

}

// ==========================================
// 18. INITIALIZE APPLICATION
// ==========================================

$("apiEndpoint").value = API_URL;

$("apiEndpoint").readOnly = true;

updateDashboard();
updateHistory();
updateAnalytics();

setConnectionStatus("loading");

console.log(
    "Cancellation Predictor initialized."
);

console.log("API endpoint:", API_URL);

// Connect and load database history

checkConnection();

// Automatically refresh shared history every 30 seconds

setInterval(() => {

    if (document.visibilityState === "visible" && !connectionCheck) {

        loadCloudHistory();

    }

}, 30000);

// Refresh when user returns to the website

document.addEventListener(
    "visibilitychange",
    () => {

        if (document.visibilityState === "visible" && !connectionCheck) {

            loadCloudHistory();

        }

    }
);

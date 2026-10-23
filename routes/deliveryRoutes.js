
const express = require("express");

const router = express.Router();

const PINCODE_API_URL = "https://api.postalpincode.in/pincode";

const pincodeCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000;

const INDIA_TIME_ZONE = "Asia/Kolkata";
const DISPATCH_CUTOFF_HOUR = 16; // 4 PM IST

// Get the current date and time in India.
function getIndiaDateTime() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  return Object.fromEntries(
    parts.map(({ type, value }) => [type, value])
  );
}

// Convert YYYY-MM-DD into a UTC date for safe date arithmetic.
function toUTCDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day, 12));
}

function toDateString(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

// Sunday is a non-working day.
function isSunday(date) {
  return date.getUTCDay() === 0;
}

// Add working days after the starting date, skipping Sundays.
function addWorkingDays(startDate, days) {
  const date = toUTCDate(startDate);
  let addedDays = 0;

  while (addedDays < days) {
    date.setUTCDate(date.getUTCDate() + 1);

    if (!isSunday(date)) {
      addedDays++;
    }
  }

  return toDateString(date);
}

// Find the order-processing start date.
// Before 4 PM on a working day: start today.
// At/after 4 PM: start next working day.
// Sunday: start Monday.
function getNextDispatchDate() {
  const india = getIndiaDateTime();

  const today = `${india.year}-${india.month}-${india.day}`;
  const date = toUTCDate(today);

  const hour = Number(india.hour);
  const minute = Number(india.minute);

  const cutoffPassed = hour >= DISPATCH_CUTOFF_HOUR;

  if (isSunday(date) || cutoffPassed) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  while (isSunday(date)) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return toDateString(date);
}

// Format a date-only value without shifting its calendar day.
function formatDate(dateString, includeWeekday = true) {
  const date = toUTCDate(dateString);

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    ...(includeWeekday ? { weekday: "short" } : {}),
    month: "short",
    day: "numeric",
  }).format(date);
}

// GET /api/delivery/check/613001
router.get("/check/:pincode", async (req, res) => {
  const pincode = String(req.params.pincode || "").trim();

  if (!/^[1-9]\d{5}$/.test(pincode)) {
    return res.status(400).json({
      success: false,
      serviceable: false,
      message: "Enter a valid 6-digit Indian pincode.",
    });
  }

  try {
    let postOffices = null;

    // Use cached postal data when available.
    const cached = pincodeCache.get(pincode);

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      postOffices = cached.postOffices;
    } else {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      let response;

      try {
        response = await fetch(
          `${PINCODE_API_URL}/${pincode}`,
          {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          }
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new Error("Pincode lookup service is unavailable.");
      }

      const apiData = await response.json();
      const result = Array.isArray(apiData) ? apiData[0] : null;

      if (
        !result ||
        result.Status !== "Success" ||
        !Array.isArray(result.PostOffice) ||
        result.PostOffice.length === 0
      ) {
        return res.status(404).json({
          success: false,
          serviceable: false,
          message: "This pincode was not found in the postal directory.",
        });
      }

      postOffices = result.PostOffice;

      pincodeCache.set(pincode, {
        postOffices,
        timestamp: Date.now(),
      });
    }

    // Prefer a delivery post office when available.
    const office =
      postOffices.find(
        (item) =>
          String(item.DeliveryStatus || "").toLowerCase() === "delivery"
      ) || postOffices[0];

    const city = String(
      office.District || office.Name || ""
    ).trim();

    const state = String(office.State || "").trim();

    if (!city) {
      return res.status(502).json({
        success: false,
        message: "The postal API did not return a location for this pincode.",
      });
    }

    // Estimates:
    // 1 working day for dispatch + 2–4 working days for delivery.
    // Sunday is excluded from all working-day calculations.
    const dispatchDays = 1;
    const minDays = 2;
    const maxDays = 4;

    // Determine the eligible processing start date using India time.
    const orderProcessingDate = getNextDispatchDate();

    // One working day for dispatch.
    // The processing date itself is day one.
    const dispatchDate = addWorkingDays(
      orderProcessingDate,
      dispatchDays - 1
    );

    // Add 2–4 working days after dispatch.
    const estimatedDeliveryDate = addWorkingDays(
      dispatchDate,
      minDays
    );

    const estimatedDeliveryEndDate = addWorkingDays(
      dispatchDate,
      maxDays
    );

    const estimatedDateText =
      `${formatDate(estimatedDeliveryDate, false)} – ${formatDate(
        estimatedDeliveryEndDate,
        false
      )}`;

    return res.status(200).json({
      success: true,
      serviceable: true,
      pincode,
      city,
      district: office.District || city,
      state,
      postOffice: office.Name || "",

      dispatchDays,
      minDays,
      maxDays,

      orderProcessingDate,
      dispatchDate,
      dispatchDateText: formatDate(dispatchDate),

      estimatedDeliveryDate,
      estimatedDeliveryEndDate,
      estimatedDateText,

      message:
        "Pincode found. Dispatch and delivery dates are demo estimates.",
    });
  } catch (error) {
    console.error("Delivery pincode lookup error:", error.message);

    return res.status(502).json({
      success: false,
      message:
        error.name === "AbortError"
          ? "Pincode lookup timed out. Please try again."
          : "Unable to look up this pincode right now. Please try again.",
    });
  }
});

module.exports = router;
    
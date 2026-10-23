
const express = require("express");

const router = express.Router();

// Free Indian PIN code lookup API.
// No API key required.
const PINCODE_API_URL = "https://api.postalpincode.in/pincode";

// Simple in-memory cache to reduce external API requests.
const pincodeCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000;

// Get the current date in India and add calendar days.
function addDaysInIndia(days) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value])
  );

  const date = new Date(
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day) + days,
      12
    )
  );

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

// Format a date-only value without shifting its calendar day.
function formatDate(dateString, includeWeekday = true) {
  const [year, month, day] = dateString.split("-").map(Number);

  const date = new Date(year, month - 1, day, 12);

  return date.toLocaleDateString("en-IN", {
    ...(includeWeekday ? { weekday: "short" } : {}),
    month: "short",
    day: "numeric",
  });
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

      // PostalPincode.in response format:
      // [{ Status: "Success", PostOffice: [...] }]
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

    // A PIN may contain several post offices.
    // Prefer a delivery office when one is available.
    const office =
      postOffices.find(
        (item) =>
          String(item.DeliveryStatus || "").toLowerCase() ===
          "delivery"
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

    // DEMO estimate only.
    // This does not confirm actual ST Courier serviceability.
    const minDays = 2;
    const maxDays = 3;

    const estimatedDeliveryDate = addDaysInIndia(minDays);
    const estimatedDeliveryEndDate = addDaysInIndia(maxDays);

    return res.status(200).json({
      success: true,
      serviceable: true,
      pincode,
      city,
      district: office.District || city,
      state,
      postOffice: office.Name || "",
      minDays,
      maxDays,
      estimatedDeliveryDate,
      estimatedDeliveryEndDate,
      estimatedDateText: formatDate(estimatedDeliveryDate),
      message: "Pincode found. Delivery dates are demo estimates.",
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

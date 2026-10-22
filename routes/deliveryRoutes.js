
const express = require("express");

const router = express.Router();

// Change these rules to match your actual shipping process.
const DEFAULT_TRANSIT_DAYS = 4;
const DISPATCH_DAYS = 1;

// Weekend handling: Sunday is a non-working day.
// Add Saturday too if your business does not dispatch on Saturdays.
function addBusinessDays(startDate, days) {
  const date = new Date(startDate);
  let addedDays = 0;

  while (addedDays < days) {
    date.setDate(date.getDate() + 1);

    if (date.getDay() !== 0) {
      addedDays++;
    }
  }

  return date;
}

function formatDate(date) {
  return date.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

// GET /api/delivery/check/612001
router.get("/check/:pincode", async (req, res) => {
  try {
    const { pincode } = req.params;

    if (!/^[1-9][0-9]{5}$/.test(pincode)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 6-digit Indian pincode.",
      });
    }

    // Free India Post pincode lookup.
    const response = await fetch(
      `https://api.postalpincode.in/pincode/${pincode}`
    );

    if (!response.ok) {
      throw new Error("Pincode lookup service unavailable");
    }

    const result = await response.json();
    const record = result?.[0];

    if (record?.Status !== "Success" || !record?.PostOffice?.length) {
      return res.status(404).json({
        success: false,
        message: "Pincode not found. Please check and try again.",
      });
    }

    const office = record.PostOffice[0];
    const city =
      office.District || office.Block || office.Name || "Your location";
    const state = office.State;

    // Simple free estimate, NOT a courier serviceability check.
    const dispatchDate = addBusinessDays(new Date(), DISPATCH_DAYS);
    const estimatedDate = addBusinessDays(
      dispatchDate,
      DEFAULT_TRANSIT_DAYS
    );

    return res.json({
      success: true,
      pincode,
      city,
      state,
      country: "India",
      dispatchDays: DISPATCH_DAYS,
      transitDays: DEFAULT_TRANSIT_DAYS,
      estimatedDate: estimatedDate.toISOString(),
      estimatedDateText: formatDate(estimatedDate),
      message: `Estimated delivery to ${city}`,
      estimateType: "approximate",
    });
  } catch (error) {
    console.error("Delivery estimate error:", error.message);

    return res.status(503).json({
      success: false,
      message:
        "Unable to check delivery right now. Please try again later.",
    });
  }
});

module.exports = router;

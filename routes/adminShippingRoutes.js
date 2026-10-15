const express = require("express");
const router = express.Router();

const ShippingSettings = require("../models/ShippingSettings");
const { protect, adminOnly } = require("../middlewares/authMiddleware");

// Public: get current shipping amount
router.get("/", async (req, res) => {
  try {
    let settings = await ShippingSettings.findOne();

    if (!settings) {
      settings = await ShippingSettings.create({
        shippingAmount: 0,
      });
    }

    res.json({
      success: true,
      shippingAmount: settings.shippingAmount,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch shipping amount",
    });
  }
});

// Admin only: update shipping amount
router.put("/", protect, adminOnly, async (req, res) => {
  try {
    const shippingAmount = Number(req.body.shippingAmount);

    if (
      req.body.shippingAmount === undefined ||
      req.body.shippingAmount === null ||
      req.body.shippingAmount === "" ||
      !Number.isFinite(shippingAmount) ||
      shippingAmount < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid shipping amount",
      });
    }

    let settings = await ShippingSettings.findOne();

    if (!settings) {
      settings = new ShippingSettings({ shippingAmount });
    } else {
      settings.shippingAmount = shippingAmount;
    }

    await settings.save();

    res.json({
      success: true,
      message: "Shipping amount updated successfully",
      shippingAmount: settings.shippingAmount,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update shipping amount",
    });
  }
});

module.exports = router;
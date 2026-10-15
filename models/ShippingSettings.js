const mongoose = require("mongoose");

const shippingSettingsSchema = new mongoose.Schema(
  {
    shippingAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "ShippingSettings",
  shippingSettingsSchema
);
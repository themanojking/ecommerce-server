
const express = require("express");
const router = express.Router();

const {
  createOrder,
  getMyOrders,
  getOrderById,
  cancelMyOrder,
  createRazorpayOrder,
  verifyRazorpayPayment
} = require("../controllers/orderController");

const { protect } = require("../middlewares/authMiddleware");

// Existing COD checkout
router.post("/", protect, createOrder);

// Razorpay online payment
router.post("/razorpay/create", protect, createRazorpayOrder);
router.post("/razorpay/verify", protect, verifyRazorpayPayment);

// Existing order management
router.get("/myorders", protect, getMyOrders);
router.get("/:id", protect, getOrderById);
router.put("/:id/cancel", protect, cancelMyOrder);

module.exports = router;


const express = require("express");
const router = express.Router();

const {
  createOrder,
  getMyOrders,
  getOrderById,
  cancelMyOrder,
} = require("../controllers/orderController");

const { protect } = require("../middlewares/authMiddleware");

router.post("/", protect, createOrder);
router.get("/myorders", protect, getMyOrders);
router.get("/:id", protect, getOrderById);
router.put("/:id/canel", protect, cancelMyOrder);

module.exports = router;

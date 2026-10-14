const express = require("express");
const router = express.Router();

const {
  getAllOrders,
  getAdminOrderById,
  updateOrderStatus,
} = require("../controllers/adminOrderController");

const {
  protect,
  adminOnly,
} = require("../middlewares/authMiddleware");

// All routes require admin authentication
router.use(protect, adminOnly);

router.get("/", getAllOrders);
router.get("/:id", getAdminOrderById);
router.put("/:id/status", updateOrderStatus);

module.exports = router;


const express = require("express");
const router = express.Router();

const {
  getDashboardStats,
  getDashboardChart,
} = require("../controllers/adminDashboardController");

const { protect, adminOnly } = require("../middlewares/authMiddleware");

router.get("/stats", protect, adminOnly, getDashboardStats);

// Revenue and orders chart
router.get("/chart", protect, adminOnly, getDashboardChart);

module.exports = router;


const express = require("express");
const router = express.Router();

const {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../controllers/adminNotificationController");

const {
  protect,
  adminOnly,
} = require("../middlewares/authMiddleware");

router.use(protect, adminOnly);

router.get("/", getNotifications);
router.patch("/read-all", markAllNotificationsRead);
router.patch("/:id/read", markNotificationRead);

module.exports = router;


const express = require("express");
const router = express.Router();

const { getAllUsers } = require("../controllers/adminUserController");
const {
  protect,
  adminOnly,
} = require("../middlewares/authMiddleware");

// All routes require admin authentication
router.use(protect, adminOnly);

router.get("/", getAllUsers);

module.exports = router;

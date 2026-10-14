
const express = require("express");
const router = express.Router();

const {
  getAdminProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../controllers/adminProductController");

const {
  protect,
  adminOnly,
} = require("../middlewares/authMiddleware");

// All routes below require an authenticated admin.
router.use(protect, adminOnly);

router.get("/", getAdminProducts);
router.post("/", createProduct);
router.put("/:id", updateProduct);
router.delete("/:id", deleteProduct);

module.exports = router;

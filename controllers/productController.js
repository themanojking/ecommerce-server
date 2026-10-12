
const mongoose = require("mongoose");
const Product = require("../models/Product");

// GET /api/products
const getProducts = async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: products.length,
      products,
    });
  } catch (error) {
    console.error("Get products error:", error.message);

    res.status(500).json({
      success: false,
      message: "Failed to fetch products",
    });
  }
};

// GET /api/products/:id
const getProductById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.status(200).json({
      success: true,
      product,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch product",
    });
  }
};

// POST /api/products (admin only)
const createProduct = async (req, res) => {
  try {
    const {
      productName,
      description,
      price,
      category,
      images,
      stock,
      isAvailable,
    } = req.body;

    if (
      typeof productName !== "string" ||
      !productName.trim() ||
      typeof description !== "string" ||
      !description.trim() ||
      typeof category !== "string" ||
      !category.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Product name, description, and category are required",
      });
    }

    if (
      price === undefined ||
      price === null ||
      price === "" ||
      !Number.isFinite(Number(price)) ||
      Number(price) < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Price must be a valid non-negative number",
      });
    }

    if (
      stock !== undefined &&
      (!Number.isInteger(Number(stock)) || Number(stock) < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Stock must be a non-negative whole number",
      });
    }

    if (
      images !== undefined &&
      (!Array.isArray(images) ||
        !images.every((image) => typeof image === "string"))
    ) {
      return res.status(400).json({
        success: false,
        message: "Images must be an array of strings",
      });
    }

    const product = await Product.create({
      productName: productName.trim(),
      description: description.trim(),
      price: Number(price),
      category: category.trim(),
      images: images || [],
      stock: stock === undefined ? 0 : Number(stock),
      isAvailable:
        typeof isAvailable === "boolean" ? isAvailable : true,
    });

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      product,
    });
  } catch (error) {
    console.error("Create product error:", error.message);

    res.status(500).json({
      success: false,
      message: "Failed to create product",
    });
  }
};

// PUT /api/products/:id (admin only)
const updateProduct = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const allowedFields = [
      "productName",
      "description",
      "price",
      "category",
      "images",
      "stock",
      "isAvailable",
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one valid field to update",
      });
    }

    for (const field of ["productName", "description", "category"]) {
      if (
        field in updates &&
        (typeof updates[field] !== "string" || !updates[field].trim())
      ) {
        return res.status(400).json({
          success: false,
          message: `${field} must be a non-empty string`,
        });
      }

      if (field in updates) {
        updates[field] = updates[field].trim();
      }
    }

    if (
      "price" in updates &&
      (updates.price === "" ||
        updates.price === null ||
        !Number.isFinite(Number(updates.price)) ||
        Number(updates.price) < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Price must be a valid non-negative number",
      });
    }

    if ("price" in updates) {
      updates.price = Number(updates.price);
    }

    if (
      "stock" in updates &&
      (!Number.isInteger(Number(updates.stock)) ||
        Number(updates.stock) < 0 ||
        updates.stock === "" ||
        updates.stock === null)
    ) {
      return res.status(400).json({
        success: false,
        message: "Stock must be a non-negative whole number",
      });
    }

    if ("stock" in updates) {
      updates.stock = Number(updates.stock);
    }

    if (
      "images" in updates &&
      (!Array.isArray(updates.images) ||
        !updates.images.every((image) => typeof image === "string"))
    ) {
      return res.status(400).json({
        success: false,
        message: "Images must be an array of strings",
      });
    }

    if (
      "isAvailable" in updates &&
      typeof updates.isAvailable !== "boolean"
    ) {
      return res.status(400).json({
        success: false,
        message: "isAvailable must be true or false",
      });
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Product updated successfully",
      product,
    });
  } catch (error) {
    console.error("Update product error:", error.message);

    res.status(400).json({
      success: false,
      message: "Failed to update product",
    });
  }
};

// DELETE /api/products/:id (admin only)
const deleteProduct = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    console.error("Delete product error:", error.message);

    res.status(500).json({
      success: false,
      message: "Failed to delete product",
    });
  }
};

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};

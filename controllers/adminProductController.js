
const Product = require("../models/Product");

// GET /api/admin/products
const getAdminProducts = async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: products.length,
      products,
    });
  } catch (error) {
    console.error("Get admin products:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch products",
    });
  }
};

// POST /api/admin/products
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
      !productName?.trim() ||
      !description?.trim() ||
      price === undefined ||
      price === "" ||
      !category?.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Product name, description, price, and category are required",
      });
    }

    if (!Number.isFinite(Number(price)) || Number(price) < 0) {
      return res.status(400).json({
        success: false,
        message: "Price must be a valid non-negative number",
      });
    }

    if (
      stock !== undefined &&
      (!Number.isFinite(Number(stock)) ||
        !Number.isInteger(Number(stock)) ||
        Number(stock) < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Stock must be a non-negative integer",
      });
    }

    const product = await Product.create({
      productName: productName.trim(),
      description: description.trim(),
      price: Number(price),
      category: category.trim(),
      images: Array.isArray(images) ? images : [],
      stock: stock === undefined ? 0 : Number(stock),
      isAvailable:
        isAvailable === undefined ? true : Boolean(isAvailable),
    });

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      product,
    });
  } catch (error) {
    console.error("Create product:", error);

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to create product",
    });
  }
};

// PUT /api/admin/products/:id
const updateProduct = async (req, res) => {
  try {
    const updates = { ...req.body };

    // Only allow these product fields to be updated.
    const allowedFields = [
      "productName",
      "description",
      "price",
      "category",
      "images",
      "stock",
      "isAvailable",
    ];

    Object.keys(updates).forEach((key) => {
      if (!allowedFields.includes(key)) {
        delete updates[key];
      }
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid product fields provided",
      });
    }

    if (
      updates.productName !== undefined &&
      (typeof updates.productName !== "string" ||
        !updates.productName.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Product name cannot be empty",
      });
    }

    if (
      updates.description !== undefined &&
      (typeof updates.description !== "string" ||
        !updates.description.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Description cannot be empty",
      });
    }

    if (
      updates.category !== undefined &&
      (typeof updates.category !== "string" ||
        !updates.category.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Category cannot be empty",
      });
    }

    if (updates.price !== undefined) {
      if (
        updates.price === "" ||
        !Number.isFinite(Number(updates.price)) ||
        Number(updates.price) < 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Price must be a valid non-negative number",
        });
      }

      updates.price = Number(updates.price);
    }

    if (updates.stock !== undefined) {
      if (
        updates.stock === "" ||
        !Number.isFinite(Number(updates.stock)) ||
        !Number.isInteger(Number(updates.stock)) ||
        Number(updates.stock) < 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Stock must be a non-negative integer",
        });
      }

      updates.stock = Number(updates.stock);
    }

    if (
      updates.images !== undefined &&
      (!Array.isArray(updates.images) ||
        !updates.images.every((image) => typeof image === "string"))
    ) {
      return res.status(400).json({
        success: false,
        message: "Images must be an array of strings",
      });
    }

    if (updates.productName !== undefined) {
      updates.productName = updates.productName.trim();
    }

    if (updates.description !== undefined) {
      updates.description = updates.description.trim();
    }

    if (updates.category !== undefined) {
      updates.category = updates.category.trim();
    }

    if (updates.isAvailable !== undefined &&
        typeof updates.isAvailable !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isAvailable must be true or false",
      });
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
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
    console.error("Update product:", error);

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to update product",
    });
  }
};

// DELETE /api/admin/products/:id
const deleteProduct = async (req, res) => {
  try {
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
    console.error("Delete product:", error);

    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to delete product",
    });
  }
};

module.exports = {
  getAdminProducts,
  createProduct,
  updateProduct,
  deleteProduct,
};

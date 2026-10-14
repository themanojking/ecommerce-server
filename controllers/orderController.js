
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");

// Restore reserved stock if order creation fails.
const restoreStock = async (reservedItems) => {
  for (const item of reservedItems) {
    await Product.updateOne(
      { _id: item.product },
      {
        $inc: { stock: item.quantity },
        $set: { isAvailable: true },
      }
    );
  }
};

// POST /api/orders
const createOrder = async (req, res) => {
  const reservedItems = [];

  try {
    const { orderItems, shippingAddress, paymentMethod } = req.body;

    if (!Array.isArray(orderItems) || orderItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No order items provided",
      });
    }

    const requiredFields = [
      "name",
      "useremail",
      "phone",
      "address",
      "city",
      "state",
      "postalCode",
      "country",
    ];

    if (
      !shippingAddress ||
      requiredFields.some(
        (field) => !String(shippingAddress[field] || "").trim()
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a complete shipping address",
      });
    }

    if (paymentMethod && paymentMethod !== "COD") {
      return res.status(400).json({
        success: false,
        message: "Unsupported payment method",
      });
    }

    let itemsPrice = 0;
    const validatedItems = [];

    // Validate products and calculate prices on the server.
    for (const item of orderItems) {
      if (
        !mongoose.isValidObjectId(item.product) ||
        !Number.isInteger(Number(item.quantity)) ||
        Number(item.quantity) < 1
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid product or quantity",
        });
      }

      const product = await Product.findById(item.product);

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "A product in your order was not found",
        });
      }

      if (
        product.isAvailable === false ||
        Number(product.stock) < Number(item.quantity)
      ) {
        return res.status(400).json({
          success: false,
          message: `${product.productName} is unavailable or has insufficient stock`,
        });
      }

      const quantity = Number(item.quantity);
      const price = Number(product.price);

      itemsPrice += price * quantity;

      validatedItems.push({
        product: product._id,
        quantity,
        price,
        productName: product.productName,
      });
    }

    // Reserve stock atomically to prevent overselling.
    for (const item of validatedItems) {
      const updatedProduct = await Product.findOneAndUpdate(
        {
          _id: item.product,
          isAvailable: { $ne: false },
          stock: { $gte: item.quantity },
        },
        [
          {
            $set: {
              stock: { $subtract: ["$stock", item.quantity] },
              isAvailable: {
                $gt: [
                  { $subtract: ["$stock", item.quantity] },
                  0,
                ],
              },
            },
          },
        ],
        { new: true }
      );

      if (!updatedProduct) {
        await restoreStock(reservedItems);
        reservedItems.length = 0;

        return res.status(400).json({
          success: false,
          message: `${item.productName} no longer has enough stock. Please refresh your cart.`,
        });
      }

      reservedItems.push({
        product: item.product,
        quantity: item.quantity,
      });
    }

    const shippingPrice = 0;

    const order = await Order.create({
      user: req.user._id,
      orderItems: validatedItems.map((item) => ({
        product: item.product,
        quantity: item.quantity,
        price: item.price,
      })),
      shippingAddress,
      paymentMethod: "COD",
      itemsPrice,
      shippingPrice,
      totalPrice: itemsPrice + shippingPrice,
    });

    return res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order,
    });
  } catch (error) {
    console.error("Create order error:", error);

    // Restore stock if an error occurs after reserving it.
    try {
      await restoreStock(reservedItems);
    } catch (restoreError) {
      console.error("Stock restoration error:", restoreError);
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create order",
    });
  }
};

// GET /api/orders/myorders
const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id })
      .populate("orderItems.product", "productName images price")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error("Get my orders error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
    });
  }
};

// GET /api/orders/:id
const getOrderById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    const order = await Order.findById(req.params.id)
      .populate("orderItems.product", "productName images price")
      .populate("user", "name useremail email");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const isOwner =
      order.user &&
      order.user._id.toString() === req.user._id.toString();

    if (!isOwner && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this order",
      });
    }

    return res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    console.error("Get order error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch order",
    });
  }
};

module.exports = {
  createOrder,
  getMyOrders,
  getOrderById,
};

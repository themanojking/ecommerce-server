const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Notification = require("../models/Notification");
const ShippingSettings = require("../models/ShippingSettings");

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
  let orderCreated = false;

  try {
    const { orderItems, shippingAddress, paymentMethod } = req.body;

    // Validate order items.
    if (!Array.isArray(orderItems) || orderItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No order items provided",
      });
    }

    // Validate shipping address.
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

    // Only Cash on Delivery is supported.
    if (paymentMethod && paymentMethod !== "COD") {
      return res.status(400).json({
        success: false,
        message: "Unsupported payment method",
      });
    }

    // Fetch shipping settings before reserving stock.
    // Do not silently place an order with zero shipping if
    // the shipping settings cannot be read from the database.
    const shippingSettings = await ShippingSettings.findOne();

    if (
      !shippingSettings ||
      !Number.isFinite(Number(shippingSettings.shippingAmount)) ||
      Number(shippingSettings.shippingAmount) < 0
    ) {
      return res.status(503).json({
        success: false,
        message:
          "Shipping settings are unavailable. Please try again later.",
      });
    }

    const shippingPrice = Number(shippingSettings.shippingAmount);

    let itemsPrice = 0;
    const validatedItems = [];

    // Validate products and calculate prices on the server.
    for (const item of orderItems) {
      if (
        !item ||
        !mongoose.isValidObjectId(item.product) ||
        !Number.isInteger(Number(item.quantity)) ||
        Number(item.quantity) < 1
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid product or quantity",
        });
      }

      const quantity = Number(item.quantity);
      const product = await Product.findById(item.product);

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "A product in your order was not found",
        });
      }

      if (
        product.isAvailable === false ||
        Number(product.stock) < quantity
      ) {
        return res.status(400).json({
          success: false,
          message: `${product.productName} is unavailable or has insufficient stock`,
        });
      }

      const price = Number(product.price);

      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid price for ${product.productName}`,
        });
      }

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
        {
          $inc: { stock: -item.quantity },
        },
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

      // Mark product unavailable when stock reaches zero.
      if (Number(updatedProduct.stock) === 0) {
        await Product.updateOne(
          { _id: item.product },
          { $set: { isAvailable: false } }
        );
      }
    }

    // Calculate the final order total on the server.
    const totalPrice = itemsPrice + shippingPrice;

    // Save the order.
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
      totalPrice,
    });

    orderCreated = true;

    // Create notification after the order is saved.
    // Notification failure must not cancel a successful order.
    try {
      await Notification.create({
        type: "NEW_ORDER",
        title: "New order received",
        message: `${req.user.name} placed a new order. Order ID: ${order._id}`,
        user: req.user._id,
        order: order._id,
      });
    } catch (notificationError) {
      console.error(
        "Notification creation failed:",
        notificationError.message
      );
    }

    return res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order,
    });
  } catch (error) {
    console.error("Create order error:", error);

    // Restore stock only if order creation failed before
    // an order was successfully saved.
    if (!orderCreated && reservedItems.length > 0) {
      try {
        await restoreStock(reservedItems);
      } catch (restoreError) {
        console.error(
          "Stock restoration error:",
          restoreError.message
        );
      }
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

// PUT /api/orders/:id/cancel
const cancelMyOrder = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    const order = await Order.findOne({
      _id: id,
      user: req.user._id,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (order.status === "Cancelled") {
      return res.status(400).json({
        success: false,
        message: "Order is already cancelled",
      });
    }

    // Do not allow cancellation after shipping or delivery.
    if (["Shipped", "Delivered"].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: "This order can no longer be cancelled",
      });
    }

    // Restore stock for each product.
    for (const item of order.orderItems) {
      const product = await Product.findByIdAndUpdate(
        item.product,
        {
          $inc: { stock: item.quantity },
          $set: { isAvailable: true },
        },
        { new: true, runValidators: true }
      );

      if (!product) {
        throw new Error(
          `Product ${item.product} was not found while restoring stock`
        );
      }
    }

    order.status = "Cancelled";
    await order.save();

    return res.status(200).json({
      success: true,
      message: "Order cancelled and stock restored successfully",
      order,
    });
  } catch (error) {
    console.error("Cancel order error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to cancel order",
    });
  }
};

module.exports = {
  createOrder,
  getMyOrders,
  getOrderById,
  cancelMyOrder,
};

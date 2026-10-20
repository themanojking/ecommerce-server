
const mongoose = require("mongoose");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const Order = require("../models/Order");
const Counter = require("../models/Counter");
const Product = require("../models/Product");
const Notification = require("../models/Notification");
const ShippingSettings = require("../models/ShippingSettings");

// --------------------------------------------------
// Generate sequential order number: 1, 2, 3, 4...
// Shared by COD and Razorpay orders.
// --------------------------------------------------

const getNextOrderNumber = async () => {
  const counter = await Counter.findOneAndUpdate(
    { _id: "orderNumber" },
    { $inc: { sequenceValue: 1 } },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );

  return counter.sequenceValue;
};

// --------------------------------------------------
// Restore reserved stock
// --------------------------------------------------

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

// --------------------------------------------------
// POST /api/orders
// Create Cash on Delivery order
// --------------------------------------------------

const createOrder = async (req, res) => {
  const reservedItems = [];
  let orderCreated = false;

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

      if (Number(updatedProduct.stock) === 0) {
        await Product.updateOne(
          { _id: item.product },
          { $set: { isAvailable: false } }
        );
      }
    }

    const totalPrice = itemsPrice + shippingPrice;

    // Generate the next sequential order number.
    const orderNumber = await getNextOrderNumber();

    const order = await Order.create({
      orderNumber,
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

    // Notification failure must not cancel a successful order.
    try {
      await Notification.create({
        type: "NEW_ORDER",
        title: "New order received",
        message: `${req.user.name} placed order #${order.orderNumber}`,
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

// --------------------------------------------------
// GET /api/orders/myorders
// Get logged-in user's orders
// --------------------------------------------------

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

// --------------------------------------------------
// GET /api/orders/:id
// Fetch order using MongoDB ID
// --------------------------------------------------

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

// --------------------------------------------------
// PUT /api/orders/:id/cancel
// Cancel an order and restore stock
// --------------------------------------------------

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

    if (["Shipped", "Delivered"].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: "This order can no longer be cancelled",
      });
    }

    // Do not allow cancelling a paid order through this
    // basic cancellation route without handling its refund.
    if (order.paymentStatus === "Paid") {
      return res.status(400).json({
        success: false,
        message: "Paid orders require a refund-aware cancellation process",
      });
    }

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

// --------------------------------------------------
// POST /api/orders/razorpay
// Create Razorpay payment order
// --------------------------------------------------

const createRazorpayOrder = async (req, res) => {
  const reservedItems = [];
  let savedOrder = null;

  try {
    const { orderItems, shippingAddress } = req.body;

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

    if (
      !process.env.RAZORPAY_KEY_ID ||
      !process.env.RAZORPAY_KEY_SECRET
    ) {
      return res.status(503).json({
        success: false,
        message: "Online payment is not configured",
      });
    }

    const shippingSettings = await ShippingSettings.findOne();

    if (
      !shippingSettings ||
      !Number.isFinite(Number(shippingSettings.shippingAmount)) ||
      Number(shippingSettings.shippingAmount) < 0
    ) {
      return res.status(503).json({
        success: false,
        message: "Shipping settings are unavailable",
      });
    }

    const shippingPrice = Number(shippingSettings.shippingAmount);
    const validatedItems = [];
    let itemsPrice = 0;

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

      if (
        !product ||
        product.isAvailable === false ||
        Number(product.stock) < quantity
      ) {
        return res.status(400).json({
          success: false,
          message: "A product is unavailable or has insufficient stock",
        });
      }

      const price = Number(product.price);

      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid product price",
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

    const totalPrice = itemsPrice + shippingPrice;
    const amountInPaise = Math.round(totalPrice * 100);

    if (!Number.isSafeInteger(amountInPaise) || amountInPaise <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid order total",
      });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const gatewayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `order_${new mongoose.Types.ObjectId()}`,
      notes: {
        userId: req.user._id.toString(),
      },
    });

    // Reserve stock atomically.
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
        throw new Error(
          `${item.productName} no longer has enough stock. Please refresh your cart.`
        );
      }

      reservedItems.push({
        product: item.product,
        quantity: item.quantity,
      });

      if (Number(updatedProduct.stock) === 0) {
        await Product.updateOne(
          { _id: item.product },
          { $set: { isAvailable: false } }
        );
      }
    }

    // Generate from the same counter used by COD.
    const orderNumber = await getNextOrderNumber();

    savedOrder = await Order.create({
      orderNumber,
      user: req.user._id,
      orderItems: validatedItems.map((item) => ({
        product: item.product,
        quantity: item.quantity,
        price: item.price,
      })),
      shippingAddress,
      paymentMethod: "Razorpay",
      paymentStatus: "Pending",
      razorpayOrderId: gatewayOrder.id,
      itemsPrice,
      shippingPrice,
      totalPrice,
    });

    try {
      await Notification.create({
        type: "NEW_ORDER",
        title: "New online order received",
        message: `${req.user.name} started order #${savedOrder.orderNumber}`,
        user: req.user._id,
        order: savedOrder._id,
      });
    } catch (notificationError) {
      console.error(
        "Notification creation failed:",
        notificationError.message
      );
    }

    return res.status(201).json({
      success: true,
      message: "Payment order created",
      orderId: savedOrder._id,
      orderNumber: savedOrder.orderNumber,
      razorpayOrderId: gatewayOrder.id,
      amount: gatewayOrder.amount,
      currency: gatewayOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error("Create Razorpay order error:", error);

    if (!savedOrder && reservedItems.length > 0) {
      try {
        await restoreStock(reservedItems);
      } catch (restoreError) {
        console.error(
          "Stock restoration error:",
          restoreError.message
        );
      }
    }

    return res.status(400).json({
      success: false,
      message: error.message || "Failed to create payment order",
    });
  }
};

// --------------------------------------------------
// POST /api/orders/verify-payment
// Verify Razorpay payment
// --------------------------------------------------

const verifyRazorpayPayment = async (req, res) => {
  try {
    const {
      orderId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (
      !mongoose.isValidObjectId(orderId) ||
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing or invalid payment details",
      });
    }

    const order = await Order.findOne({
      _id: orderId,
      user: req.user._id,
      paymentMethod: "Razorpay",
    }).select("+razorpaySignature");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Online order not found",
      });
    }

    if (order.razorpayOrderId !== razorpay_order_id) {
      return res.status(400).json({
        success: false,
        message: "Payment order does not match",
      });
    }

    if (order.paymentStatus === "Paid") {
      if (order.razorpayPaymentId === razorpay_payment_id) {
        return res.status(200).json({
          success: true,
          message: "Payment already verified",
          order,
        });
      }

      return res.status(409).json({
        success: false,
        message: "This order has already been paid",
      });
    }

    if (order.status === "Cancelled") {
      return res.status(400).json({
        success: false,
        message: "This order has been cancelled",
      });
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    const received = Buffer.from(razorpay_signature, "utf8");
    const expected = Buffer.from(expectedSignature, "utf8");

    if (
      received.length !== expected.length ||
      !crypto.timingSafeEqual(received, expected)
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment signature verification failed",
      });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const payment = await razorpay.payments.fetch(razorpay_payment_id);

    if (
      payment.order_id !== razorpay_order_id ||
      payment.status !== "captured" ||
      Number(payment.amount) !== Math.round(Number(order.totalPrice) * 100) ||
      payment.currency !== "INR"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Payment has not been captured or does not match the order",
      });
    }

    order.paymentStatus = "Paid";
    order.razorpayPaymentId = razorpay_payment_id;
    order.razorpaySignature = razorpay_signature;

    await order.save();

    return res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      order,
    });
  } catch (error) {
    console.error("Verify Razorpay payment error:", error);

    return res.status(500).json({
      success: false,
      message:
        "Unable to verify payment. Please check your order before retrying.",
    });
  }
};

module.exports = {
  createOrder,
  getMyOrders,
  getOrderById,
  cancelMyOrder,
  createRazorpayOrder,
  verifyRazorpayPayment,
};

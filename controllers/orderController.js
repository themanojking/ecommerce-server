const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Notification = require("../models/Notification");
const ShippingSettings = require("../models/ShippingSettings");
const crypto = require("crypto");
const Razorpay = require("razorpay");

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

    // Always use database prices, never frontend prices.
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

    // Razorpay accepts the amount in paise (₹1 = 100 paise).
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

    // Create a gateway order on the server.
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

    savedOrder = await Order.create({
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

    console.log("DEBUG PAYMENT TOTALS:", {
  itemsPrice,
  shippingPrice,
  totalPrice,
  amountInPaise,
  orderItems,
});

    try {
      await Notification.create({
        type: "NEW_ORDER",
        title: "New online order received",
        message: `${req.user.name} started an online order. Order ID: ${savedOrder._id}`,
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
      razorpayOrderId: gatewayOrder.id,
      amount: gatewayOrder.amount,
      currency: gatewayOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error("Create Razorpay order error:", error);

    // Roll back the stock reservation if the order wasn't saved.
    if (!savedOrder && reservedItems.length > 0) {
      try {
        for (const item of reservedItems) {
          await Product.updateOne(
            { _id: item.product },
            {
              $inc: { stock: item.quantity },
              $set: { isAvailable: true },
            }
          );
        }
      } catch (restoreError) {
        console.error("Stock restoration error:", restoreError.message);
      }
    }

    return res.status(400).json({
      success: false,
      message: error.message || "Failed to create payment order",
    });
  }
};

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

    // Idempotency: don't process the same successful payment twice.
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

    // Also confirm the gateway reports this payment as captured.
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
        message: "Payment has not been captured or does not match the order",
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
      message: "Unable to verify payment. Please check your order before retrying.",
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

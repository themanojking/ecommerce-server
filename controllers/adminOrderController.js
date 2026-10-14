
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");

// @desc    Get all orders
// @route   GET /api/admin/orders
// @access  Admin
const getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find()
      .populate("user", "name useremail")
      .populate("orderItems.product", "productName images price")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error("Get all orders error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
    });
  }
};

// @desc    Get single order details
// @route   GET /api/admin/orders/:id
// @access  Admin
const getAdminOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    const order = await Order.findById(id)
      .populate("user", "name useremail")
      .populate("orderItems.product", "productName images price");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    return res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    console.error("Get order details error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch order details",
    });
  }
};

// @desc    Update order status and restore stock on cancellation
// @route   PUT /api/admin/orders/:id/status
// @access  Admin
const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = [
      "Pending",
      "Confirmed",
      "Processing",
      "Shipped",
      "Delivered",
      "Cancelled",
    ];

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order ID",
      });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order status",
        allowedStatuses,
      });
    }

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Prevent duplicate stock restoration.
    if (order.status === "Cancelled" && status === "Cancelled") {
      return res.status(200).json({
        success: true,
        message: "Order is already cancelled",
        order,
      });
    }

    // Do not allow a cancelled order to be reopened here.
    // Its stock has already been returned.
    if (order.status === "Cancelled" && status !== "Cancelled") {
      return res.status(400).json({
        success: false,
        message: "A cancelled order cannot be reopened",
      });
    }

    // Restore product stock before saving the cancellation.
    if (status === "Cancelled") {
      for (const item of order.orderItems) {
        const restoredProduct = await Product.findByIdAndUpdate(
          item.product,
          {
            $inc: { stock: item.quantity },
            $set: { isAvailable: true },
          },
          { new: true, runValidators: true }
        );

        if (!restoredProduct) {
          throw new Error(
            `Product ${item.product} was not found while restoring stock`
          );
        }
      }
    }

    order.status = status;
    await order.save();

    return res.status(200).json({
      success: true,
      message:
        status === "Cancelled"
          ? "Order cancelled and product stock restored successfully"
          : "Order status updated successfully",
      order,
    });
  } catch (error) {
    console.error("Update order status error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update order status",
    });
  }
};

module.exports = {
  getAllOrders,
  getAdminOrderById,
  updateOrderStatus,
};

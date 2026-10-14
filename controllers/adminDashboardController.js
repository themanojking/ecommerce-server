
const Product = require("../models/Product");
const Order = require("../models/Order");

const getDashboardStats = async (req, res) => {
  try {
    const totalProducts = await Product.countDocuments();
    const totalOrders = await Order.countDocuments();

    const pendingOrders = await Order.countDocuments({
      status: { $regex: /^pending$/i },
    });

    // Exclude cancelled orders from revenue.
    const revenueResult = await Order.aggregate([
      {
        $match: {
          $expr: {
            $ne: [
              { $toLower: { $ifNull: ["$status", ""] } },
              "cancelled",
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          revenue: {
            $sum: {
              $ifNull: [
                "$totalAmount",
                { $ifNull: ["$totalPrice", 0] },
              ],
            },
          },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      stats: {
        totalProducts,
        totalOrders,
        pendingOrders,
        revenue: revenueResult[0]?.revenue || 0,
      },
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard statistics",
    });
  }
};

module.exports = { getDashboardStats };

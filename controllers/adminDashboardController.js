
const Product = require("../models/Product");
const Order = require("../models/Order");

const getDashboardStats = async (req, res) => {
  try {
    const [
      totalProducts,
      totalOrders,
      pendingOrders,
      revenueResult,
      lowStockProducts,
      recentOrders,
    ] = await Promise.all([
      Product.countDocuments(),

      Order.countDocuments(),

      Order.countDocuments({ status: "Pending" }),

      Order.aggregate([
        {
          $match: {
            status: { $nin: ["Cancelled", "cancelled", "CANCELLED"] },
          },
        },
        {
          $group: {
            _id: null,
            totalRevenue: {
              $sum: {
                $convert: {
                  input: "$totalPrice",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
          },
        },
      ]),

      Product.find({ stock: { $lte: 5 } })
        .select("productName stock category price images")
        .sort({ stock: 1 })
        .limit(10)
        .lean(),

      Order.find()
        .populate("user", "name useremail")
        .sort({ createdAt: -1 })
        .limit(5)
        .select("user totalPrice status createdAt paymentMethod")
        .lean(),
    ]);

    const totalRevenue = revenueResult[0]?.totalRevenue || 0;

    res.status(200).json({
      success: true,
      stats: {
        totalProducts,
        totalOrders,
        pendingOrders,
        totalRevenue,
        lowStockCount: lowStockProducts.length,
      },
      lowStockProducts,
      recentOrders,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to load dashboard statistics.",
    });
  }
};

module.exports = { getDashboardStats };

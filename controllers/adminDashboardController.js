const Product = require("../models/Product");
const Order = require("../models/Order");

// Dashboard statistics
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

      // Revenue excluding cancelled orders
      Order.aggregate([
        {
          $match: {
            status: {
              $nin: ["Cancelled", "cancelled", "CANCELLED"],
            },
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
        .populate("orderItems.product", "productName")
        .sort({ createdAt: -1 })
        .limit(5)
        .select(
          "user orderItems totalPrice status createdAt paymentMethod"
        )
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

// Revenue and orders chart
const getDashboardChart = async (req, res) => {
  try {
    const period = req.query.period || "daily";

    if (!["daily", "weekly", "monthly"].includes(period)) {
      return res.status(400).json({
        success: false,
        message: "Invalid period. Use daily, weekly, or monthly.",
      });
    }

    const now = new Date();
    const chartData = [];

    let startDate;
    let numberOfPoints;
    let intervalMs;
    let labelFormatter;

    if (period === "daily") {
      // Last 24 hours, grouped into hourly intervals
      numberOfPoints = 24;
      intervalMs = 60 * 60 * 1000;
      startDate = new Date(now.getTime() - numberOfPoints * intervalMs);

      labelFormatter = (date) =>
        date.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
    } else if (period === "weekly") {
      // Last 7 days, grouped into daily intervals
      numberOfPoints = 7;
      intervalMs = 24 * 60 * 60 * 1000;
      startDate = new Date(now.getTime() - numberOfPoints * intervalMs);

      labelFormatter = (date) =>
        date.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
        });
    } else {
      // Last 30 days, grouped into daily intervals
      numberOfPoints = 30;
      intervalMs = 24 * 60 * 60 * 1000;
      startDate = new Date(now.getTime() - numberOfPoints * intervalMs);

      labelFormatter = (date) =>
        date.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
        });
    }

    // Prepare every interval, including intervals with zero orders
    for (let i = 0; i < numberOfPoints; i++) {
      const intervalStart = new Date(
        startDate.getTime() + i * intervalMs
      );

      chartData.push({
        label: labelFormatter(intervalStart),
        start: intervalStart,
        end: new Date(intervalStart.getTime() + intervalMs),
        orders: 0,
        revenue: 0,
      });
    }

    const revenueRows = await Order.aggregate([
      {
        $match: {
          createdAt: {
            $gte: startDate,
            $lt: now,
          },
        },
      },
      {
        $project: {
          createdAt: 1,
          totalPrice: {
            $convert: {
              input: "$totalPrice",
              to: "double",
              onError: 0,
              onNull: 0,
            },
          },
          isCancelled: {
            $in: [
              { $toLower: { $ifNull: ["$status", ""] } },
              ["cancelled"],
            ],
          },
        },
      },
    ]);

    // Place each order into its corresponding time interval.
    // Cancelled orders are excluded from revenue, but still counted
    // in the order count, matching the total-orders statistic.
    for (const order of revenueRows) {
      const orderTime = new Date(order.createdAt).getTime();

      const index = Math.floor(
        (orderTime - startDate.getTime()) / intervalMs
      );

      if (index < 0 || index >= chartData.length) continue;

      chartData[index].orders += 1;

      if (!order.isCancelled) {
        chartData[index].revenue += Number(order.totalPrice) || 0;
      }
    }

    // Remove internal interval boundaries from the response.
    const formattedChartData = chartData.map(
      ({ label, orders, revenue }) => ({
        label,
        orders,
        revenue: Math.round(revenue * 100) / 100,
      })
    );

    res.status(200).json({
      success: true,
      period,
      chartData: formattedChartData,
    });
  } catch (error) {
    console.error("Dashboard chart error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to load dashboard chart data.",
    });
  }
};

module.exports = {
  getDashboardStats,
  getDashboardChart,
};
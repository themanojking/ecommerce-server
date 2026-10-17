
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const productRoutes = require('./routes/productRoutes');
const authRoutes = require('./routes/authRoutes');
const orderRoutes = require('./routes/orderRoutes');
const adminDashboardRoutes = require('./routes/adminDashboardRoutes');
const adminProductRoutes = require('./routes/adminProductRoutes');
const adminOrderRoutes = require('./routes/adminOrderRoutes');
const adminUserRoutes = require('./routes/adminUserRoutes');
const adminCategoryRoutes = require('./routes/adminCategoryRoutes');
const adminNotificationRoutes = require('./routes/adminNotificationRoutes');
const adminShippingRoutes = require('./routes/adminShippingRoutes');

const app = express();


const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://ecommerce-client-sports.vercel.app",
  "https://ecommerce-admin-sports.vercel.app",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.error("Blocked by CORS:", origin);
      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);


app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.get("/api/orders-test", (req, res) => {
  res.json({
    success: true,
    message: "Orders routing is working",
  });
});
app.use("/api/orders", orderRoutes);
app.use("/api/admin/dashboard", adminDashboardRoutes);
app.use("/api/admin/notifications", adminNotificationRoutes);
app.use("/api/admin/products", adminProductRoutes);
app.use("/api/admin/orders", adminOrderRoutes);
app.use("/api/admin/users", adminUserRoutes);
app.use("/api/admin/categories", adminCategoryRoutes);
app.use("/api/admin/shipping", adminShippingRoutes)

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "E-commerce API is running",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Server is healthy",
    database:
      require("mongoose").connection.readyState === 1
        ? "connected"
        : "disconnected",
  });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();


require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User");

const makeAdmin = async () => {
  try {
    const useremail = process.argv[2]?.trim().toLowerCase();

    if (!useremail) {
      throw new Error(
        "Usage: node scripts/makeAdmin.js user@example.com"
      );
    }

    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing from .env");
    }

    await mongoose.connect(process.env.MONGODB_URI);

    const user = await User.findOne({ useremail });

    if (!user) {
      throw new Error(
        "User not found. Register this account first."
      );
    }

    user.role = "admin";
    await user.save();

    console.log(`Admin access granted to ${user.useremail}`);
  } catch (error) {
    console.error("Admin setup failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

makeAdmin();

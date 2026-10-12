
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const createToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

const sendAuthResponse = (res, user, statusCode = 200) => {
  const token = createToken(user._id);

  return res.status(statusCode).json({
    success: true,
    token,
    user: {
      _id: user._id,
      name: user.name,
      useremail: user.useremail,
      role: user.role,
    },
  });
};

// POST /api/auth/register
const register = async (req, res) => {
  try {
    const { name, useremail, password } = req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof useremail !== "string" ||
      !useremail.trim() ||
      typeof password !== "string" ||
      password.length < 8
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter your name, a valid email, and a password of at least 8 characters.",
      });
    }

    const normalizedEmail = useremail.trim().toLowerCase();

    const existingUser = await User.findOne({
      useremail: normalizedEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await User.create({
      name: name.trim(),
      useremail: normalizedEmail,
      password: hashedPassword,
      // Never accept the role from public signup.
      role: "customer",
    });

    return sendAuthResponse(res, user, 201);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    console.error("Registration error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to register right now.",
    });
  }
};

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { useremail, password } = req.body;

    if (
      typeof useremail !== "string" ||
      typeof password !== "string" ||
      !useremail.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const user = await User.findOne({
      useremail: useremail.trim().toLowerCase(),
    }).select("+password");

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    return sendAuthResponse(res, user);
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to log in right now.",
    });
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  return res.status(200).json({
    success: true,
    user: {
      _id: req.user._id,
      name: req.user.name,
      useremail: req.user.useremail,
      role: req.user.role,
    },
  });
};

module.exports = { register, login, getMe };

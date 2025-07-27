const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const nodemailer = require("nodemailer");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;
require("dotenv").config();
const cookieParser = require('cookie-parser');
const { Server } = require("socket.io");
const http = require("http");
const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);



const io = new Server(server, {
  cors: {
    origin: "*", // for testing
    methods: ["GET", "POST"]
  },
  path: "/ws" // if you're using '/ws' in client
});

io.on("connection", (socket) => {
  console.log("🟢 WebSocket client connected");

  socket.on("disconnect", () => {
    console.log("🔴 WebSocket client disconnected");
  });
});
// ===== MongoDB Connection =====
mongoose.connect(
  process.env.MONGO_URI,
  { useNewUrlParser: true, useUnifiedTopology: true }
).then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// ====== Cloudinary Config ======
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "AllInOneCart",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    transformation: [{ width: 500, height: 500, crop: "limit" }],
  },
});
const upload = multer({ storage });

// ====== Mongoose Schemas ======
const productSchema = new mongoose.Schema({
  name: String,
  cost: Number,
  store: String,
  stock: String,
  src: String,
  category: String,
  adminEmail: String,
  adminName: String,
  city: String,
  unit: String, 
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [0, 0]
    }
  }
});
productSchema.index({ location: "2dsphere" });

const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  city: String,
  role: String, // "user" or "admin"
  accountId: String,
});

const orderSchema = new mongoose.Schema({
  name: String,
  phone: String,
  email: String,
  address: String,
  item: Object,
});

const Product = mongoose.model("Product", productSchema);
const User = mongoose.model("User", userSchema);
const Order = mongoose.model("Order", orderSchema);

// ====== Routes ======
const otps = {};

// Register Normal User




app.post("/api/register", async (req, res) => {
  try {
    const { email } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return res.status(409).send({ message: "Email already registered" });

    const user = new User({ ...req.body, role: "user" });
    await user.save();
    res.send({ message: "User registered" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Registration failed" });
  }
});

// ✅ Register Admin
app.post("/api/create-admin", async (req, res) => {
  try {
    const { email } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return res.status(409).send({ success: false, message: "Admin already exists" });

    const admin = new User({ ...req.body, role: "admin" });
    await admin.save();
    res.send({ success: true, message: "Admin created successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ success: false, message: "Failed to create admin" });
  }
});


app.post("/api/create-otp", async (req, res) => {
  try {
    const { email, name, password, city } = req.body;

    // Check if already exists
    const exists = await User.findOne({ email });
    if (exists) return res.status(409).send({ success: false, message: "Admin already exists" });

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otps[email] = otp;

    // Send OTP email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: "sailendrakondapalli@gmail.com",
      to: "sailendrakondapalli@gmail.com",
      subject: "Admin Account OTP Verification",
      text:` A request was made to create an admin account for:\nEmail: ${email}\n\nUse this OTP to approve: ${otp}`,
    };

    await transporter.sendMail(mailOptions);

    return res.send({ success: true, message: "OTP sent to your email. Please verify.", otpSent: true });
  } catch (error) {
    console.error(error);
    res.status(500).send({ success: false, message: "Failed to send OTP" });
  }});



app.post("/api/verify-admin-otp", async (req, res) => {

  
  const { email, name, password, city, otp } = req.body;

  if (otps[email] !== otp) {
    return res.status(401).send({ success: false, message: "Invalid OTP" });
  }

  // Clean up OTP
  delete otps[email];

  const admin = new User({ email, name, password, city, role: "admin" });
  await admin.save();

  res.send({ success: true, message: "Admin created successfully after OTP verification" });
});



// ✅ Unified Login (user or admin)
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(404).send({ success: false, message: "User not found" });
    if (user.password !== password) return res.status(401).send({ success: false, message: "Incorrect password" });

    res.send({ success: true, user });
  } catch (error) {
    console.error(error);
    res.status(500).send({ success: false, message: "Login error" });
  }
});

// Add Product (Cloudinary image upload)
app.post("/api/add-product", upload.single("image"), async (req, res) => {
  try {
    const { name, cost, store, stock, category, adminEmail, adminName ,city,lat, lng } = req.body;
    const { unit } = req.body;
    const image = req.file;

    if (!image) {
      return res.status(400).json({ success: false, message: "Image upload failed" });
    }

    const src = image.path;

    const product = new Product({ name, cost, store, stock, src, category, adminEmail, adminName,city, unit, location: {
    type: "Point",
    coordinates: [parseFloat(lng), parseFloat(lat)]
  }});
    await product.save();

    res.send({ success: true, message: "Product added successfully", product });
  } catch (error) {
    console.error(error);
    res.status(500).send({ success: false, message: "Failed to add product" });
  }
});


app.get("/api/products/nearby", async (req, res) => {
  const { lat, lng, radius = 5 } = req.query; // default to 5km

  if (!lat || !lng) {
    return res.status(400).json({ success: false, message: "Latitude and longitude are required" });
  }

  try {
    const products = await Product.find({
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          $maxDistance: parseFloat(radius) * 1000 // convert km to meters
        }
      }
    });

    res.json(products);
  } catch (error) {
    console.error("❌ Error in nearby search:", error);
    res.status(500).json({ success: false, message: "Failed to fetch nearby products" });
  }
});

// Get Products by City
app.get("/api/products", async (req, res) => {
  const { city } = req.query;
  const products = await Product.find({ city });
  res.send(products);
});

// Book Order + Email Notifications
app.post("/api/book-order", async (req, res) => {
  try {
    const { name, phone, email, address, item } = req.body;

    const order = new Order({ name, phone, email, address, item });
    await order.save();

    const product = await Product.findById(item._id);
    if (!product) {
      return res.status(404).send({ success: false, message: "Product not found" });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "sailendrakondapalli@gmail.com",
        pass: "rhkghjcppsimmdfv",
      },
    });

    const userMail = {
      from: "sailendrakondapalli@gmail.com",
      to: email,
      subject: "✅ Order Confirmation",
      text: `Hi ${name},\n\nYour order for "${item.name}" has been placed.\n\nWe will deliver to:\n${address}\n\nThanks for shopping!`,
    };

    const adminMail = {
      from: "sailendrakondapalli@gmail.com",
      to: product.adminEmail,
      subject: "📦 New Order Received",
      text: `Hi ${product.adminName},\n\nYour product "${item.name}" has been ordered by:\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nAddress: ${address}\n\nPlease fulfill the order.`,
    };

    await transporter.sendMail(userMail);
    await transporter.sendMail(adminMail);

    res.send({ success: true, message: "Order placed and emails sent" });
  } catch (err) {
    console.error("Order Error:", err);
    res.status(500).send({ success: false, message: "Order failed" });
  }
});
app.get("/api/orders", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).send({ message: "Email is required" });

    const orders = await Order.find({ email }).sort({ createdAt: -1 });
    res.send({ orders });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Error fetching orders" });
  }
});
// Search Orders by user name or email
app.get("/api/search-orders", async (req, res) => {
  try {
    const query = req.query.query;
    if (!query) return res.status(400).send({ message: "Search query is required" });

    const users = await User.find({
      $or: [
        { email: { $regex: query, $options: "i" } },
        { name: { $regex: query, $options: "i" } },
      ],
    });

    const emails = users.map((u) => u.email);
    const orders = await Order.find({ email: { $in: emails } }).sort({ createdAt: -1 });

    res.send({ orders });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Search failed" });
  }
});

// ====== Start Server ======
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});

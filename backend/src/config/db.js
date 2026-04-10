import mongoose from "mongoose";

const connectDB = async () => {
  try {
    const rawUri = (process.env.MONGO_URI || "").trim();
    const dbName = (process.env.DB_NAME || "").trim();

    // If a full Mongo URI already includes query params or database segment, use it as-is.
    const hasQuery = rawUri.includes("?");
    const hasDbSegment = /\/[^/?]+$/.test(rawUri);
    const mongoUri = hasQuery || hasDbSegment || !dbName ? rawUri : `${rawUri}/${dbName}`;

    const db = await mongoose.connect(mongoUri);
    console.log(`\n✅ MongoDB Connected to DB host: ${db.connection.host}`);
    return db;
  } catch (err) {
    console.log("❌ MongoDB connection Error:", err);
    process.exit();
  }
};

export default connectDB;

// ✅ ✅ ✅ THIS is the missing piece:
export { mongoose };

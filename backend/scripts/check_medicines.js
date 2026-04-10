import "dotenv/config";
import connectDB from "../src/config/db.js";
import Medicine from "../src/models/medicine.model.js";

try {
  await connectDB();
  const total = await Medicine.countDocuments({});
  const sample = await Medicine.findOne({}, { name: 1, "price(₹)": 1, _id: 0 }).lean();
  console.log(`MEDICINES_TOTAL=${total}`);
  console.log("MEDICINES_SAMPLE=", sample || null);
  process.exit(0);
} catch (error) {
  console.error("MEDICINES_CHECK_ERROR", error.message);
  process.exit(1);
}

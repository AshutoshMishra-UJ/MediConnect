import express from "express";
import Medicine from "../models/medicine.model.js";
const router = express.Router();

// GET /api/medicines/search?name=xyz
router.get("/search", async (req, res) => {
  const { name } = req.query;

  if (!name) {
    return res.status(400).json({ success: false, message: "Medicine name is required" });
  }

  try {
    const medicines = await Medicine.find({
      name: { $regex: name, $options: "i" } // case-insensitive match
    }).lean();

    // Support both legacy CSV-based schema and the newer curated schema.
    const normalized = medicines.map((med) => {
      const legacyPrice = med["price(₹)"];
      const modernPrice = med.price;
      const legacyManufacturer = med.manufacturer_name;
      const modernManufacturer = med.manufacturer;
      const legacyType = med.type;
      const modernType = med.dosageForm;
      const legacyPack = med.pack_size_label;
      const modernPack = med.strength || med.priceUnit;
      const legacyComp1 = med.short_composition1;
      const legacyComp2 = med.short_composition2;
      const modernComp1 = med.indication;
      const modernComp2 = med.classification || med.category;

      return {
        ...med,
        "price(₹)": legacyPrice ?? modernPrice ?? null,
        Is_discontinued: med.Is_discontinued ?? false,
        manufacturer_name: legacyManufacturer ?? modernManufacturer ?? "Unknown",
        type: legacyType ?? modernType ?? "Unknown",
        pack_size_label: legacyPack ?? modernPack ?? "N/A",
        short_composition1: legacyComp1 ?? modernComp1 ?? "N/A",
        short_composition2: legacyComp2 ?? modernComp2 ?? "",
      };
    });

    res.status(200).json({ success: true, data: normalized });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;

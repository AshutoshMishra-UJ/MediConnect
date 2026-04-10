import "dotenv/config";
import mongoose from "mongoose";

const localUri = process.env.LOCAL_MONGO_URI || "mongodb://127.0.0.1:27017/MediConnect";
const atlasUri = process.env.MONGO_URI;

if (!atlasUri) {
  console.error("MONGO_URI is missing in environment.");
  process.exit(1);
}

const run = async () => {
  const localConn = await mongoose.createConnection(localUri).asPromise();
  const atlasConn = await mongoose.createConnection(atlasUri).asPromise();

  try {
    const localCol = localConn.db.collection("medicines");
    const atlasCol = atlasConn.db.collection("medicines");

    const localCount = await localCol.countDocuments({});
    const atlasBefore = await atlasCol.countDocuments({});

    console.log(`LOCAL_MEDICINES=${localCount}`);
    console.log(`ATLAS_BEFORE=${atlasBefore}`);

    if (localCount === 0) {
      console.log("No medicines found in local MongoDB. Migration skipped.");
      return;
    }

    const docs = await localCol.find({}).toArray();

    await atlasCol.deleteMany({});
    await atlasCol.insertMany(docs, { ordered: false });

    const atlasAfter = await atlasCol.countDocuments({});
    console.log(`ATLAS_AFTER=${atlasAfter}`);
    console.log("Medicines migration completed.");
  } finally {
    await localConn.close();
    await atlasConn.close();
  }
};

run().catch((error) => {
  console.error("MIGRATION_ERROR", error.message);
  process.exit(1);
});

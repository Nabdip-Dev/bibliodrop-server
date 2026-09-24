const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db(process.env.MONGODB_DATABASE);

    const userCollection = db.collection("user");
    const bookCollection = db.collection("books");
    const deliveryCollection = db.collection("deliveries");
    const reviewCollection = db.collection("reviews");
    const transactionCollection = db.collection("transactions");

    // =========================
    // Home
    // =========================

    app.get("/", (req, res) => {
      res.send("BiblioDrop Server is running fine!");
    });

    // =========================
    // Books
    // =========================

    app.get("/books", async (req, res) => {
      try {
        const result = await bookCollection.find().toArray();

        res.json(result);
      } catch (error) {
        console.error(error);

        res.status(500).json({
          message: "Failed to fetch books",
        });
      }
    });

    // =========================
    // Users
    // =========================

    app.get("/users", async (req, res) => {
      try {
        const result = await userCollection.find().toArray();

        res.json(result);
      } catch (error) {
        console.error(error);

        res.status(500).json({
          message: "Failed to fetch users",
        });
      }
    });

    // =========================
    // Deliveries
    // =========================

    app.get("/deliveries", async (req, res) => {
      try {
        const result = await deliveryCollection.find().toArray();

        res.json(result);
      } catch (error) {
        console.error(error);

        res.status(500).json({
          message: "Failed to fetch deliveries",
        });
      }
    });

    // =========================
    // Reviews
    // =========================

    app.get("/reviews", async (req, res) => {
      try {
        const result = await reviewCollection.find().toArray();

        res.json(result);
      } catch (error) {
        console.error(error);

        res.status(500).json({
          message: "Failed to fetch reviews",
        });
      }
    });

    // =========================
    // Transactions
    // =========================

    app.get("/transactions", async (req, res) => {
      try {
        const result = await transactionCollection.find().toArray();

        res.json(result);
      } catch (error) {
        console.error(error);

        res.status(500).json({
          message: "Failed to fetch transactions",
        });
      }
    });

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}

run();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
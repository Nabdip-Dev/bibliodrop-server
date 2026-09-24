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
    // BOOKS
    // =========================

    // Get books
    app.get("/books", async (req, res) => {
      try {
        const { librarianId } = req.query;

        let query = {};

        // If librarianId is provided,
        // only show books added by that librarian
        if (librarianId) {
          query.librarianId = librarianId;
        }

        const result = await bookCollection.find(query).sort({
          createdAt: -1,
        }).toArray();

        res.json(result);
      } catch (error) {
        console.error("FETCH BOOKS ERROR:", error);

        res.status(500).json({
          message: "Failed to fetch books",
        });
      }
    });


    // Get single book
    app.get("/books/:id", async (req, res) => {
      try {
        const book = await bookCollection.findOne({
          _id: new ObjectId(req.params.id),
        });

        if (!book) {
          return res.status(404).json({
            message: "Book not found",
          });
        }

        res.json(book);
      } catch (error) {
        console.error("BOOK DETAILS ERROR:", error);

        res.status(500).json({
          message: "Failed to fetch book",
        });
      }
    });


    // Add book
    app.post("/books", async (req, res) => {
      try {
        const book = {
          ...req.body,
          deliveryFee: Number(req.body.deliveryFee),
          status: "available",
          published: true,
          createdAt: new Date(),
        };

        const result = await bookCollection.insertOne(book);

        res.status(201).json({
          message: "Book added successfully",
          book: {
            _id: result.insertedId,
            ...book,
          },
        });
      } catch (error) {
        console.error("ADD BOOK ERROR:", error);

        res.status(500).json({
          message: "Failed to add book",
        });
      }
    });


    app.put("/books/:id", async (req, res) => {
      try {
        const { librarianId } = req.body;

        if (!librarianId) {
          return res.status(400).json({
            message: "Librarian ID is required",
          });
        }

        const { title, author, category, description, deliveryFee, coverImage } =
          req.body;

        const result = await bookCollection.updateOne(
          {
            _id: new ObjectId(req.params.id),
            librarianId: librarianId,
          },
          {
            $set: {
              title,
              author,
              category,
              description,
              deliveryFee: Number(deliveryFee),
              coverImage,
              updatedAt: new Date(),
            },
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({
            message: "Book not found or you do not own this book",
          });
        }

        res.json({
          success: true,
          message: "Book updated successfully",
        });
      } catch (error) {
        console.error("UPDATE BOOK ERROR:", error);

        res.status(500).json({
          message: "Failed to update book",
        });
      }
    });


    // Delete book
    app.delete("/books/:id", async (req, res) => {
      try {
        const { librarianId } = req.query;

        // Make sure librarianId is provided
        if (!librarianId) {
          return res.status(400).json({
            message: "Librarian ID is required",
          });
        }

        const result = await bookCollection.deleteOne({
          _id: new ObjectId(req.params.id),
          librarianId: librarianId,
        });

        if (result.deletedCount === 0) {
          return res.status(404).json({
            message: "Book not found or you do not own this book",
          });
        }

        res.json({
          success: true,
          message: "Book deleted successfully",
        });
      } catch (error) {
        console.error("DELETE BOOK ERROR:", error);

        res.status(500).json({
          message: "Failed to delete book",
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
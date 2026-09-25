const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const Stripe = require("stripe");

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

    // ssss
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const { bookId, quantity, userId } = req.body;

        if (!bookId || !quantity || !userId) {
          return res.status(400).json({
            message: "bookId, quantity and userId are required",
          });
        }

        const book = await bookCollection.findOne({
          _id: new ObjectId(bookId),
        });

        if (!book) {
          return res.status(404).json({
            message: "Book not found",
          });
        }

        if (book.status !== "available") {
          return res.status(400).json({
            message: "This book is not available",
          });
        }

        const safeQuantity = Math.max(1, Math.min(10, Number(quantity)));
        const deliveryFee = Number(book.deliveryFee) || 0;
        const totalAmount = deliveryFee * safeQuantity;

        const session = await stripe.checkout.sessions.create({
          mode: "payment",

          line_items: [
            {
              price_data: {
                currency: "inr",
                product_data: {
                  name: `Delivery: ${book.title}`,
                },
                unit_amount: Math.round(deliveryFee * 100),
              },
              quantity: safeQuantity,
            },
          ],

          success_url: `${process.env.CLIENT_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.CLIENT_URL}/books/${bookId}`,

          metadata: {
            bookId: String(bookId),
            userId: String(userId),
            quantity: String(safeQuantity),
            totalAmount: String(totalAmount),
          },
        });

        res.json({
          url: session.url,
        });
      } catch (error) {
        console.error("STRIPE CHECKOUT ERROR:", error);

        res.status(500).json({
          message: "Failed to create checkout session",
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


    // ================================
    // Get Reviews For A Book
    // ================================
    app.get("/books/:id/reviews", async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({
            message: "Invalid book ID",
          });
        }

        const reviews = await reviewCollection
          .find({
            bookId: id,
          })
          .sort({
            createdAt: -1,
          })
          .toArray();

        const formattedReviews = await Promise.all(
          reviews.map(async (review) => {
            const user = await userCollection.findOne({
              $or: [
                { id: review.userId },
                ...(ObjectId.isValid(review.userId)
                  ? [{ _id: new ObjectId(review.userId) }]
                  : []),
              ],
            });

            return {
              ...review,
              userName:
                user?.name ||
                review.userName ||
                "Anonymous Reader",

              userImage:
                user?.image ||
                review.userImage ||
                "",
            };
          })
        );

        return res.json(formattedReviews);
      } catch (error) {
        console.error("GET BOOK REVIEWS ERROR:", error);

        return res.status(500).json({
          message: "Failed to fetch reviews",
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

    // sssssssssss
    app.get("/verify-payment/:sessionId", async (req, res) => {
      try {
        const session = await stripe.checkout.sessions.retrieve(
          req.params.sessionId
        );

        if (session.payment_status !== "paid") {
          return res.status(400).json({
            message: "Payment has not been completed",
          });
        }

        const {
          bookId,
          userId,
          quantity,
          totalAmount,
        } = session.metadata;

        const existingDelivery = await deliveryCollection.findOne({
          stripeSessionId: session.id,
        });

        if (existingDelivery) {
          return res.json({
            success: true,
            message: "Delivery already created",
            delivery: existingDelivery,
          });
        }

        const book = await bookCollection.findOne({
          _id: new ObjectId(bookId),
        });

        if (!book) {
          return res.status(404).json({
            message: "Book not found",
          });
        }

        const delivery = {
          stripeSessionId: session.id,
          userId,
          bookId,
          bookTitle: book.title,
          quantity: Number(quantity),
          deliveryFee: Number(totalAmount),
          status: "Pending",
          paymentStatus: "Paid",
          createdAt: new Date(),
        };

        const result = await deliveryCollection.insertOne(delivery);

        res.json({
          success: true,
          paymentStatus: session.payment_status,
          delivery: {
            _id: result.insertedId,
            ...delivery,
          },
        });
      } catch (error) {
        console.error("VERIFY PAYMENT ERROR:", error);

        res.status(500).json({
          message: "Failed to verify payment",
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
        const { userId } = req.query;

        const query = {};

        if (userId) {
          query.userId = userId;
        }

        const deliveries = await deliveryCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        const deliveriesWithBooks = await Promise.all(
          deliveries.map(async (delivery) => {
            let book = null;

            if (delivery.bookId && ObjectId.isValid(delivery.bookId)) {
              book = await bookCollection.findOne({
                _id: new ObjectId(delivery.bookId),
              });
            }

            return {
              ...delivery,
              bookTitle: book?.title || "Book Delivery",
            };
          })
        );

        res.json(deliveriesWithBooks);
      } catch (error) {
        console.error("GET DELIVERIES ERROR:", error);

        res.status(500).json({
          message: "Failed to fetch deliveries",
        });
      }
    });


    app.patch("/deliveries/:id/status", async (req, res) => {
      try {
        const { status } = req.body;

        const allowedStatuses = [
          "Pending",
          "Approved",
          "Out for Delivery",
          "Delivered",
        ];

        if (!allowedStatuses.includes(status)) {
          return res.status(400).json({
            message: "Invalid delivery status",
          });
        }

        const result = await deliveryCollection.updateOne(
          {
            _id: new ObjectId(req.params.id),
          },
          {
            $set: {
              status,
              updatedAt: new Date(),
            },
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({
            message: "Delivery not found",
          });
        }

        res.json({
          success: true,
          message: "Delivery status updated successfully",
          status,
        });
      } catch (error) {
        console.error("UPDATE DELIVERY STATUS ERROR:", error);

        res.status(500).json({
          message: "Failed to update delivery status",
        });
      }
    });


    // =========================
    // CREATE REVIEW
    // =========================

    app.post("/reviews", async (req, res) => {
      try {
        const {
          userId,
          deliveryId,
          bookId,
          rating,
          comment,
        } = req.body;

        if (
          !userId ||
          !deliveryId ||
          !bookId ||
          !rating ||
          !comment?.trim()
        ) {
          return res.status(400).json({
            message: "All review fields are required",
          });
        }

        const numericRating = Number(rating);

        if (
          !Number.isInteger(numericRating) ||
          numericRating < 1 ||
          numericRating > 5
        ) {
          return res.status(400).json({
            message: "Rating must be between 1 and 5",
          });
        }

        // Check delivery
        const delivery = await deliveryCollection.findOne({
          _id: new ObjectId(deliveryId),
          userId: userId,
        });

        if (!delivery) {
          return res.status(404).json({
            message: "Delivery not found",
          });
        }

        // Only delivered books can be reviewed
        if (
          delivery.status !== "Delivered" &&
          delivery.status !== "Completed"
        ) {
          return res.status(400).json({
            message: "You can review a book only after delivery",
          });
        }

        // Prevent duplicate review
        const existingReview = await db
          .collection("reviews")
          .findOne({
            userId,
            deliveryId,
          });

        if (existingReview) {
          return res.status(400).json({
            message: "You have already reviewed this delivery",
          });
        }

        // Get user information
        const user = await db.collection("user").findOne({
          id: userId,
        });

        // Create review
        const review = {
          userId,
          deliveryId,
          bookId,
          bookTitle: delivery.bookTitle || "Book",
          rating: numericRating,
          comment: comment.trim(),

          // User information
          userName: user?.name || "Anonymous Reader",
          userImage: user?.image || "",

          createdAt: new Date(),
        };

        const result = await db
          .collection("reviews")
          .insertOne(review);

        res.status(201).json({
          success: true,
          message: "Review submitted successfully",
          review: {
            _id: result.insertedId,
            ...review,
          },
        });
      } catch (error) {
        console.error("CREATE REVIEW ERROR:", error);

        res.status(500).json({
          message: "Failed to submit review",
        });
      }
    });


    // =========================
    // GET USER REVIEWS
    // =========================
    app.get("/reviews", async (req, res) => {
      try {
        const { userId } = req.query;

        if (!userId) {
          return res.status(400).json({
            message: "userId is required",
          });
        }

        const reviews = await db
          .collection("reviews")
          .find({ userId })
          .sort({ createdAt: -1 })
          .toArray();

        res.json(reviews);
      } catch (error) {
        console.error("GET REVIEWS ERROR:", error);

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
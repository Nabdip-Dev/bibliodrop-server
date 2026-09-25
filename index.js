const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
} = require("mongodb");
const Stripe = require("stripe");

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

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

    // =========================================================
    // HELPERS
    // =========================================================

    const isValidId = (id) => ObjectId.isValid(id);

    const getObjectId = (id) => {
      if (!isValidId(id)) return null;
      return new ObjectId(id);
    };

    const getUser = async (userId) => {
      if (!userId) return null;

      const conditions = [{ id: String(userId) }];

      if (isValidId(userId)) {
        conditions.push({
          _id: new ObjectId(userId),
        });
      }

      return userCollection.findOne({
        $or: conditions,
      });
    };

    const getBook = async (bookId) => {
      if (!isValidId(bookId)) return null;

      return bookCollection.findOne({
        _id: new ObjectId(bookId),
      });
    };

    // =========================================================
    // HOME
    // =========================================================

    app.get("/", (req, res) => {
      res.send("BiblioDrop Server is running fine!");
    });

    // =========================================================
    // ADMIN DASHBOARD STATS
    // =========================================================

    app.get("/admin/stats", async (req, res) => {
      try {
        const totalUsers = await userCollection.countDocuments();

        const totalBooks = await bookCollection.countDocuments();

        const pendingApprovals =
          await bookCollection.countDocuments({
            approvalStatus: "pending",
          });

        const totalTransactions =
          await transactionCollection.countDocuments();

        const totalDeliveries =
          await deliveryCollection.countDocuments();

        const deliveredBooks =
          await deliveryCollection.countDocuments({
            status: "Delivered",
          });

        res.json({
          totalUsers,
          totalBooks,
          pendingApprovals,
          totalTransactions,
          totalDeliveries,
          deliveredBooks,
        });
      } catch (error) {
        console.error("ADMIN STATS ERROR:", error);

        res.status(500).json({
          message: "Failed to load admin statistics",
        });
      }
    });

    // =========================================================
    // ADMIN - ALL BOOKS
    // =========================================================

    app.get("/admin/books", async (req, res) => {
      try {
        const {
          search = "",
          status = "All",
          approvalStatus = "All",
          page = 1,
          limit = 12,
        } = req.query;

        const query = {};

        if (search.trim()) {
          const regex = new RegExp(search.trim(), "i");

          query.$or = [
            { title: regex },
            { author: regex },
            { category: regex },
          ];
        }

        if (status !== "All") {
          query.status = status;
        }

        if (approvalStatus !== "All") {
          query.approvalStatus = approvalStatus;
        }

        const safePage = Math.max(
          1,
          Number(page) || 1
        );

        const safeLimit = Math.min(
          50,
          Math.max(1, Number(limit) || 12)
        );

        const skip = (safePage - 1) * safeLimit;

        const total =
          await bookCollection.countDocuments(query);

        const books = await bookCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(safeLimit)
          .toArray();

        const booksWithLibrarian =
          await Promise.all(
            books.map(async (book) => {
              const librarian = await getUser(
                book.librarianId
              );

              return {
                ...book,
                librarianName:
                  librarian?.name ||
                  "Unknown Librarian",
                librarianEmail:
                  librarian?.email || "",
              };
            })
          );

        res.json({
          books: booksWithLibrarian,
          total,
          page: safePage,
          limit: safeLimit,
          totalPages: Math.max(
            1,
            Math.ceil(total / safeLimit)
          ),
        });
      } catch (error) {
        console.error("ADMIN ALL BOOKS ERROR:", error);

        res.status(500).json({
          message: "Failed to fetch all books",
        });
      }
    });

    // =========================================================
    // ADMIN - PENDING BOOKS
    // =========================================================

    app.get("/admin/books/pending", async (req, res) => {
      try {
        const books = await bookCollection
          .find({
            approvalStatus: "pending",
          })
          .sort({ createdAt: -1 })
          .toArray();

        const booksWithLibrarian =
          await Promise.all(
            books.map(async (book) => {
              const librarian = await getUser(
                book.librarianId
              );

              return {
                ...book,
                librarianName:
                  librarian?.name ||
                  "Unknown Librarian",
                librarianEmail:
                  librarian?.email || "",
              };
            })
          );

        res.json(booksWithLibrarian);
      } catch (error) {
        console.error(
          "PENDING BOOKS ERROR:",
          error
        );

        res.status(500).json({
          message: "Failed to fetch pending books",
        });
      }
    });

    // =========================================================
    // ADMIN - APPROVE BOOK
    // =========================================================

    app.patch(
      "/admin/books/:id/approve",
      async (req, res) => {
        try {
          const { id } = req.params;

          const objectId = getObjectId(id);

          if (!objectId) {
            return res.status(400).json({
              message: "Invalid book ID",
            });
          }

          const result =
            await bookCollection.updateOne(
              {
                _id: objectId,
                approvalStatus: "pending",
              },
              {
                $set: {
                  approvalStatus: "approved",
                  published: true,
                  updatedAt: new Date(),
                },
              }
            );

          if (result.matchedCount === 0) {
            return res.status(404).json({
              message:
                "Pending book not found",
            });
          }

          const updatedBook =
            await bookCollection.findOne({
              _id: objectId,
            });

          res.json({
            success: true,
            message:
              "Book approved successfully",
            book: updatedBook,
          });
        } catch (error) {
          console.error(
            "APPROVE BOOK ERROR:",
            error
          );

          res.status(500).json({
            message:
              "Failed to approve book",
          });
        }
      }
    );

    // =========================================================
    // ADMIN - REJECT BOOK
    // =========================================================

    app.patch(
      "/admin/books/:id/reject",
      async (req, res) => {
        try {
          const { id } = req.params;

          const objectId = getObjectId(id);

          if (!objectId) {
            return res.status(400).json({
              message: "Invalid book ID",
            });
          }

          const result =
            await bookCollection.updateOne(
              {
                _id: objectId,
                approvalStatus: "pending",
              },
              {
                $set: {
                  approvalStatus: "rejected",
                  published: false,
                  updatedAt: new Date(),
                },
              }
            );

          if (result.matchedCount === 0) {
            return res.status(404).json({
              message:
                "Pending book not found",
            });
          }

          const updatedBook =
            await bookCollection.findOne({
              _id: objectId,
            });

          res.json({
            success: true,
            message:
              "Book rejected successfully",
            book: updatedBook,
          });
        } catch (error) {
          console.error(
            "REJECT BOOK ERROR:",
            error
          );

          res.status(500).json({
            message:
              "Failed to reject book",
          });
        }
      }
    );

    // =========================================================
    // ADMIN - DELETE BOOK
    // =========================================================

    app.delete(
      "/admin/books/:id",
      async (req, res) => {
        try {
          const objectId = getObjectId(
            req.params.id
          );

          if (!objectId) {
            return res.status(400).json({
              message: "Invalid book ID",
            });
          }

          const book =
            await bookCollection.findOne({
              _id: objectId,
            });

          if (!book) {
            return res.status(404).json({
              message: "Book not found",
            });
          }

          await bookCollection.deleteOne({
            _id: objectId,
          });

          // Delete reviews related to this book
          await reviewCollection.deleteMany({
            bookId: String(req.params.id),
          });

          res.json({
            success: true,
            message:
              "Book deleted successfully",
          });
        } catch (error) {
          console.error(
            "ADMIN DELETE BOOK ERROR:",
            error
          );

          res.status(500).json({
            message:
              "Failed to delete book",
          });
        }
      }
    );

    // =========================================================
    // ADMIN - USERS
    // =========================================================

    app.get("/users", async (req, res) => {
      try {
        const users = await userCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();

        res.json(users);
      } catch (error) {
        console.error(
          "GET USERS ERROR:",
          error
        );

        res.status(500).json({
          message: "Failed to fetch users",
        });
      }
    });

    // =========================================================
    // ADMIN - CHANGE USER ROLE
    // =========================================================

    app.patch(
      "/users/:id/role",
      async (req, res) => {
        try {
          const { role } = req.body;

          if (
            !["user", "librarian", "admin"].includes(
              role
            )
          ) {
            return res.status(400).json({
              message: "Invalid role",
            });
          }

          const conditions = [];

          if (isValidId(req.params.id)) {
            conditions.push({
              _id: new ObjectId(req.params.id),
            });
          }

          conditions.push({
            id: req.params.id,
          });

          const result =
            await userCollection.updateOne(
              {
                $or: conditions,
              },
              {
                $set: {
                  role,
                  updatedAt: new Date(),
                },
              }
            );

          if (result.matchedCount === 0) {
            return res.status(404).json({
              message: "User not found",
            });
          }

          res.json({
            success: true,
            message:
              "User role updated successfully",
            role,
          });
        } catch (error) {
          console.error(
            "UPDATE USER ROLE ERROR:",
            error
          );

          res.status(500).json({
            message:
              "Failed to update user role",
          });
        }
      }
    );

    // =========================================================
    // BOOKS - PUBLIC + LIBRARIAN
    // =========================================================

    app.get("/books", async (req, res) => {
      try {
        const {
          librarianId,
          search,
          category,
          availability,
          minFee,
          maxFee,
          sort,
          page = 1,
          limit = 8,
        } = req.query;

        const query = {};

        // -----------------------------------------------------
        // Librarian sees own books
        // Public sees approved published books
        // -----------------------------------------------------

        if (librarianId) {
          query.librarianId = String(
            librarianId
          );
        } else {
          query.published = true;
          query.approvalStatus = "approved";
        }

        // Search
        if (search?.trim()) {
          const searchRegex = new RegExp(
            search.trim(),
            "i"
          );

          query.$or = [
            { title: searchRegex },
            { author: searchRegex },
            { category: searchRegex },
          ];
        }

        // Category
        if (
          category &&
          category !== "All"
        ) {
          query.category = category;
        }

        // Availability
        if (
          availability &&
          availability !== "All"
        ) {
          if (
            availability === "available"
          ) {
            query.status = "available";
          }

          if (
            availability === "unavailable"
          ) {
            query.status = {
              $ne: "available",
            };
          }
        }

        // Fee
        if (
          minFee !== "" &&
          minFee !== undefined
        ) {
          query.deliveryFee = {
            ...(query.deliveryFee || {}),
            $gte: Number(minFee),
          };
        }

        if (
          maxFee !== "" &&
          maxFee !== undefined
        ) {
          query.deliveryFee = {
            ...(query.deliveryFee || {}),
            $lte: Number(maxFee),
          };
        }

        // Pagination
        const safePage = Math.max(
          1,
          Number(page) || 1
        );

        const safeLimit = Math.min(
          12,
          Math.max(
            6,
            Number(limit) || 8
          )
        );

        const skip =
          (safePage - 1) * safeLimit;

        // Sort
        let sortQuery = {
          createdAt: -1,
        };

        if (sort === "title-asc") {
          sortQuery = {
            title: 1,
          };
        }

        if (sort === "title-desc") {
          sortQuery = {
            title: -1,
          };
        }

        if (sort === "fee-low") {
          sortQuery = {
            deliveryFee: 1,
          };
        }

        if (sort === "fee-high") {
          sortQuery = {
            deliveryFee: -1,
          };
        }

        const total =
          await bookCollection.countDocuments(
            query
          );

        const books =
          await bookCollection
            .find(query)
            .sort(sortQuery)
            .skip(skip)
            .limit(safeLimit)
            .toArray();

        const totalPages = Math.max(
          1,
          Math.ceil(
            total / safeLimit
          )
        );

        // Categories
        const categoryDocs =
          await bookCollection
            .find({
              published: true,
              approvalStatus: "approved",
              category: {
                $exists: true,
                $ne: "",
              },
            })
            .project({
              category: 1,
            })
            .toArray();

        const categories = [
          ...new Set(
            categoryDocs
              .map(
                (book) =>
                  book.category
              )
              .filter(Boolean)
          ),
        ].sort();

        res.json({
          books,
          total,
          page: safePage,
          limit: safeLimit,
          totalPages,
          categories,
        });
      } catch (error) {
        console.error(
          "FETCH BOOKS ERROR:",
          error
        );

        res.status(500).json({
          message:
            "Failed to fetch books",
        });
      }
    });

    // =========================================================
    // GET SINGLE BOOK
    // =========================================================

    app.get("/books/:id", async (req, res) => {
      try {
        const objectId = getObjectId(
          req.params.id
        );

        if (!objectId) {
          return res.status(400).json({
            message: "Invalid book ID",
          });
        }

        const book =
          await bookCollection.findOne({
            _id: objectId,
          });

        if (!book) {
          return res.status(404).json({
            message: "Book not found",
          });
        }

        res.json(book);
      } catch (error) {
        console.error(
          "BOOK DETAILS ERROR:",
          error
        );

        res.status(500).json({
          message:
            "Failed to fetch book",
        });
      }
    });

    // =========================================================
    // ADD BOOK
    // =========================================================

    app.post("/books", async (req, res) => {
      try {
        const {
          title,
          author,
          category,
          description,
          deliveryFee,
          coverImage,
          librarianId,
        } = req.body;

        if (
          !title?.trim() ||
          !author?.trim() ||
          !category?.trim() ||
          !description?.trim() ||
          !librarianId
        ) {
          return res.status(400).json({
            message:
              "Title, author, category, description and librarianId are required",
          });
        }

        const librarian =
          await getUser(librarianId);

        if (!librarian) {
          return res.status(404).json({
            message:
              "Librarian not found",
          });
        }

        const book = {
          title: title.trim(),
          author: author.trim(),
          category: category.trim(),
          description: description.trim(),
          deliveryFee:
            Number(deliveryFee) || 0,
          coverImage:
            coverImage || "",
          librarianId: String(
            librarianId
          ),

          // Important
          status: "available",
          approvalStatus: "pending",
          published: false,

          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result =
          await bookCollection.insertOne(
            book
          );

        res.status(201).json({
          success: true,
          message:
            "Book added successfully and sent for admin approval",
          book: {
            _id: result.insertedId,
            ...book,
          },
        });
      } catch (error) {
        console.error(
          "ADD BOOK ERROR:",
          error
        );

        res.status(500).json({
          message:
            "Failed to add book",
        });
      }
    });

    // =========================================================
    // UPDATE BOOK
    // =========================================================

    app.put("/books/:id", async (req, res) => {
      try {
        const objectId = getObjectId(
          req.params.id
        );

        if (!objectId) {
          return res.status(400).json({
            message: "Invalid book ID",
          });
        }

        const {
          librarianId,
          title,
          author,
          category,
          description,
          deliveryFee,
          coverImage,
        } = req.body;

        if (!librarianId) {
          return res.status(400).json({
            message:
              "Librarian ID is required",
          });
        }

        const result =
          await bookCollection.updateOne(
            {
              _id: objectId,
              librarianId: String(
                librarianId
              ),
            },
            {
              $set: {
                title: title?.trim(),
                author: author?.trim(),
                category: category?.trim(),
                description:
                  description?.trim(),
                deliveryFee:
                  Number(deliveryFee) || 0,
                coverImage:
                  coverImage || "",
                updatedAt: new Date(),
              },
            }
          );

        if (result.matchedCount === 0) {
          return res.status(404).json({
            message:
              "Book not found or you do not own this book",
          });
        }

        const updatedBook =
          await bookCollection.findOne({
            _id: objectId,
          });

        res.json({
          success: true,
          message:
            "Book updated successfully",
          book: updatedBook,
        });
      } catch (error) {
        console.error(
          "UPDATE BOOK ERROR:",
          error
        );

        res.status(500).json({
          message:
            "Failed to update book",
        });
      }
    });

    // =========================================================
    // CHANGE BOOK STATUS
    // =========================================================

    app.patch(
      "/books/:id/status",
      async (req, res) => {
        try {
          const objectId = getObjectId(
            req.params.id
          );

          if (!objectId) {
            return res.status(400).json({
              message: "Invalid book ID",
            });
          }

          const {
            status,
            librarianId,
          } = req.body;

          const allowedStatuses = [
            "available",
            "checked_out",
            "unavailable",
          ];

          if (
            !allowedStatuses.includes(
              status
            )
          ) {
            return res.status(400).json({
              message:
                "Invalid book status",
            });
          }

          if (!librarianId) {
            return res.status(400).json({
              message:
                "Librarian ID is required",
            });
          }

          const result =
            await bookCollection.updateOne(
              {
                _id: objectId,
                librarianId: String(
                  librarianId
                ),
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
              message:
                "Book not found or you do not own this book",
            });
          }

          const updatedBook =
            await bookCollection.findOne({
              _id: objectId,
            });

          res.json({
            success: true,
            message:
              "Book status updated successfully",
            book: updatedBook,
          });
        } catch (error) {
          console.error(
            "BOOK STATUS ERROR:",
            error
          );

          res.status(500).json({
            message:
              "Failed to update book status",
          });
        }
      }
    );

    // =========================================================
    // DELETE BOOK - LIBRARIAN
    // =========================================================

    app.delete(
      "/books/:id",
      async (req, res) => {
        try {
          const objectId = getObjectId(
            req.params.id
          );

          if (!objectId) {
            return res.status(400).json({
              message: "Invalid book ID",
            });
          }

          const {
            librarianId,
          } = req.query;

          if (!librarianId) {
            return res.status(400).json({
              message:
                "Librarian ID is required",
            });
          }

          const result =
            await bookCollection.deleteOne(
              {
                _id: objectId,
                librarianId: String(
                  librarianId
                ),
              }
            );

          if (
            result.deletedCount === 0
          ) {
            return res.status(404).json({
              message:
                "Book not found or you do not own this book",
            });
          }

          await reviewCollection.deleteMany(
            {
              bookId: String(
                req.params.id
              ),
            }
          );

          res.json({
            success: true,
            message:
              "Book deleted successfully",
          });
        } catch (error) {
          console.error(
            "DELETE BOOK ERROR:",
            error
          );

          res.status(500).json({
            message:
              "Failed to delete book",
          });
        }
      }
    );

    // =========================================================
    // CREATE STRIPE CHECKOUT
    // =========================================================

    app.post(
      "/create-checkout-session",
      async (req, res) => {
        try {
          const {
            bookId,
            quantity,
            userId,
          } = req.body;

          if (
            !bookId ||
            !quantity ||
            !userId
          ) {
            return res.status(400).json({
              message:
                "bookId, quantity and userId are required",
            });
          }

          const objectId =
            getObjectId(bookId);

          if (!objectId) {
            return res.status(400).json({
              message:
                "Invalid book ID",
            });
          }

          const book =
            await bookCollection.findOne({
              _id: objectId,
            });

          if (!book) {
            return res.status(404).json({
              message: "Book not found",
            });
          }

          if (
            book.approvalStatus !==
              "approved" ||
            book.published !== true
          ) {
            return res.status(400).json({
              message:
                "This book is not approved yet",
            });
          }

          if (
            book.status !== "available"
          ) {
            return res.status(400).json({
              message:
                "This book is not available",
            });
          }

          const safeQuantity = Math.max(
            1,
            Math.min(
              10,
              Number(quantity) || 1
            )
          );

          const deliveryFee =
            Number(
              book.deliveryFee
            ) || 0;

          const totalAmount =
            deliveryFee *
            safeQuantity;

          const session =
            await stripe.checkout.sessions.create(
              {
                mode: "payment",

                line_items: [
                  {
                    price_data: {
                      currency: "inr",

                      product_data: {
                        name: `Delivery: ${book.title}`,
                      },

                      unit_amount:
                        Math.round(
                          deliveryFee *
                            100
                        ),
                    },

                    quantity:
                      safeQuantity,
                  },
                ],

                success_url:
                  `${process.env.CLIENT_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,

                cancel_url:
                  `${process.env.CLIENT_URL}/books/${bookId}`,

                metadata: {
                  bookId: String(
                    bookId
                  ),

                  userId: String(
                    userId
                  ),

                  quantity: String(
                    safeQuantity
                  ),

                  totalAmount:
                    String(
                      totalAmount
                    ),
                },
              }
            );

          res.json({
            success: true,
            url: session.url,
            sessionId: session.id,
          });
        } catch (error) {
          console.error(
            "STRIPE CHECKOUT ERROR:",
            error
          );

          res.status(500).json({
            message:
              "Failed to create checkout session",
          });
        }
      }
    );

    // =========================================================
    // VERIFY PAYMENT + CREATE DELIVERY + TRANSACTION
    // =========================================================

    app.get(
      "/verify-payment/:sessionId",
      async (req, res) => {
        try {
          const session =
            await stripe.checkout.sessions.retrieve(
              req.params.sessionId
            );

          if (
            session.payment_status !==
            "paid"
          ) {
            return res.status(400).json({
              message:
                "Payment has not been completed",
            });
          }

          const {
            bookId,
            userId,
            quantity,
            totalAmount,
          } = session.metadata || {};

          if (!bookId || !userId) {
            return res.status(400).json({
              message:
                "Payment metadata is incomplete",
            });
          }

          // ---------------------------------------------------
          // Prevent duplicate payment/delivery
          // ---------------------------------------------------

          const existingDelivery =
            await deliveryCollection.findOne(
              {
                stripeSessionId:
                  session.id,
              }
            );

          if (existingDelivery) {
            return res.json({
              success: true,
              message:
                "Delivery already created",
              delivery:
                existingDelivery,
            });
          }

          const objectId =
            getObjectId(bookId);

          if (!objectId) {
            return res.status(400).json({
              message:
                "Invalid book ID",
            });
          }

          const book =
            await bookCollection.findOne({
              _id: objectId,
            });

          if (!book) {
            return res.status(404).json({
              message:
                "Book not found",
            });
          }

          // ---------------------------------------------------
          // Create delivery
          // ---------------------------------------------------

          const delivery = {
            stripeSessionId:
              session.id,

            userId: String(userId),

            librarianId:
              book.librarianId || "",

            bookId: String(bookId),

            bookTitle:
              book.title,

            quantity:
              Number(quantity) || 1,

            deliveryFee:
              Number(totalAmount) || 0,

            status: "Pending",

            paymentStatus: "Paid",

            createdAt: new Date(),

            updatedAt: new Date(),
          };

          const deliveryResult =
            await deliveryCollection.insertOne(
              delivery
            );

          // ---------------------------------------------------
          // Mark book checked out
          // ---------------------------------------------------

          await bookCollection.updateOne(
            {
              _id: objectId,
            },
            {
              $set: {
                status: "checked_out",
                updatedAt: new Date(),
              },
            }
          );

          // ---------------------------------------------------
          // Save transaction
          // ---------------------------------------------------

          const transaction = {
            stripeSessionId:
              session.id,

            userId: String(userId),

            librarianId:
              book.librarianId || "",

            bookId: String(bookId),

            bookTitle:
              book.title,

            deliveryId:
              String(
                deliveryResult.insertedId
              ),

            amount:
              Number(totalAmount) || 0,

            quantity:
              Number(quantity) || 1,

            paymentStatus: "Paid",

            currency: "INR",

            createdAt: new Date(),
          };

          const transactionResult =
            await transactionCollection.insertOne(
              transaction
            );

          res.json({
            success: true,

            paymentStatus:
              session.payment_status,

            delivery: {
              _id:
                deliveryResult.insertedId,
              ...delivery,
            },

            transaction: {
              _id:
                transactionResult.insertedId,
              ...transaction,
            },
          });
        } catch (error) {
          console.error(
            "VERIFY PAYMENT ERROR:",
            error
          );

          res.status(500).json({
            message:
              "Failed to verify payment",
          });
        }
      }
    );

    // =========================================================
    // DELIVERIES
    // =========================================================

    app.get(
      "/deliveries",
      async (req, res) => {
        try {
          const {
            userId,
            librarianId,
          } = req.query;

          const query = {};

          if (userId) {
            query.userId =
              String(userId);
          }

          if (librarianId) {
            query.librarianId =
              String(librarianId);
          }

          const deliveries =
            await deliveryCollection
              .find(query)
              .sort({
                createdAt: -1,
              })
              .toArray();

          const deliveriesWithBooks =
            await Promise.all(
              deliveries.map(
                async (delivery) => {
                  let book = null;

                  if (
                    delivery.bookId &&
                    isValidId(
                      delivery.bookId
                    )
                  ) {
                    book =
                      await bookCollection.findOne(
                        {
                          _id: new ObjectId(
                            delivery.bookId
                          ),
                        }
                      );
                  }

                  const user =
                    await getUser(
                      delivery.userId
                    );

                  return {
                    ...delivery,

                    bookTitle:
                      book?.title ||
                      delivery.bookTitle ||
                      "Book Delivery",

                    coverImage:
                      book?.coverImage ||
                      "",

                    userName:
                      user?.name ||
                      "Unknown User",

                    userEmail:
                      user?.email ||
                      "",
                  };
                }
              )
            );

          res.json(
            deliveriesWithBooks
          );
        } catch (error) {
          console.error(
            "GET DELIVERIES ERROR:",
            error
          );

          res.status(500).json({
            message:
              "Failed to fetch deliveries",
          });
        }
      }
    );

    // =========================================================
    // DELIVERY STATUS UPDATE
    // =========================================================

    app.patch(
      "/deliveries/:id/status",
      async (req, res) => {
        try {
          const objectId =
            getObjectId(
              req.params.id
            );

          if (!objectId) {
            return res.status(400).json({
              message:
                "Invalid delivery ID",
            });
          }

          const {
            status,
          } = req.body;

          const allowedStatuses = [
            "Pending",
            "Approved",
            "Out for Delivery",
            "Delivered",
            "Cancelled",
          ];

          if (
            !allowedStatuses.includes(
              status
            )
          ) {
            return res.status(400).json({
              message:
                "Invalid delivery status",
            });
          }

          const delivery =
            await deliveryCollection.findOne(
              {
                _id: objectId,
              }
            );

          if (!delivery) {
            return res.status(404).json({
              message:
                "Delivery not found",
            });
          }

          const result =
            await deliveryCollection.updateOne(
              {
                _id: objectId,
              },
              {
                $set: {
                  status,
                  updatedAt: new Date(),
                },
              }
            );

          if (
            result.matchedCount === 0
          ) {
            return res.status(404).json({
              message:
                "Delivery not found",
            });
          }

          // When cancelled, book becomes available again
          if (
            status === "Cancelled" &&
            delivery.bookId &&
            isValidId(
              delivery.bookId
            )
          ) {
            await bookCollection.updateOne(
              {
                _id: new ObjectId(
                  delivery.bookId
                ),
              },
              {
                $set: {
                  status: "available",
                  updatedAt:
                    new Date(),
                },
              }
            );
          }

          res.json({
            success: true,
            message:
              "Delivery status updated successfully",
            status,
          });
        } catch (error) {
          console.error(
            "UPDATE DELIVERY STATUS ERROR:",
            error
          );

          res.status(500).json({
            message:
              "Failed to update delivery status",
          });
        }
      }
    );

    // =========================================================
    // BOOK REVIEWS
    // =========================================================

    app.get(
      "/books/:id/reviews",
      async (req, res) => {
        try {
          const { id } = req.params;

          if (!isValidId(id)) {
            return res.status(400).json({
              message:
                "Invalid book ID",
            });
          }

          const reviews =
            await reviewCollection
              .find({
                bookId: id,
              })
              .sort({
                createdAt: -1,
              })
              .toArray();

          const formattedReviews =
            await Promise.all(
              reviews.map(
                async (review) => {
                  const user =
                    await getUser(
                      review.userId
                    );

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
                }
              )
            );

          res.json(
            formattedReviews
          );
        } catch (error) {
          console.error(
            "GET BOOK REVIEWS ERROR:",
            error
          );

          res.status(500).json({
            message:
              "Failed to fetch reviews",
          });
        }
      }
    );

    // =========================================================
    // CREATE REVIEW
    // =========================================================

    app.post(
      "/reviews",
      async (req, res) => {
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
              message:
                "All review fields are required",
            });
          }

          const numericRating =
            Number(rating);

          if (
            !Number.isInteger(
              numericRating
            ) ||
            numericRating < 1 ||
            numericRating > 5
          ) {
            return res.status(400).json({
              message:
                "Rating must be between 1 and 5",
            });
          }

          if (
            !isValidId(deliveryId)
          ) {
            return res.status(400).json({
              message:
                "Invalid delivery ID",
            });
          }

          const delivery =
            await deliveryCollection.findOne(
              {
                _id: new ObjectId(
                  deliveryId
                ),
                userId: String(
                  userId
                ),
              }
            );

          if (!delivery) {
            return res.status(404).json({
              message:
                "Delivery not found",
            });
          }

          if (
            delivery.status !==
              "Delivered" &&
            delivery.status !==
              "Completed"
          ) {
            return res.status(400).json({
              message:
                "You can review a book only after delivery",
            });
          }

          const existingReview =
            await reviewCollection.findOne(
              {
                userId: String(
                  userId
                ),
                deliveryId: String(
                  deliveryId
                ),
              }
            );

          if (existingReview) {
            return res.status(400).json({
              message:
                "You have already reviewed this delivery",
            });
          }

          const user =
            await getUser(userId);

          const review = {
            userId: String(userId),

            deliveryId:
              String(deliveryId),

            bookId:
              String(bookId),

            bookTitle:
              delivery.bookTitle ||
              "Book",

            rating:
              numericRating,

            comment:
              comment.trim(),

            userName:
              user?.name ||
              "Anonymous Reader",

            userImage:
              user?.image || "",

            createdAt:
              new Date(),

            updatedAt:
              new Date(),
          };

          const result =
            await reviewCollection.insertOne(
              review
            );

          res.status(201).json({
            success: true,

            message:
              "Review submitted successfully",

            review: {
              _id:
                result.insertedId,
              ...review,
            },
          });
        } catch (error) {
          console.error(
            "CREATE REVIEW ERROR:",
            error
          );

          res.status(500).json({
            message:
              "Failed to submit review",
          });
        }
      }
    );

    // =========================================================
    // GET USER REVIEWS
    // =========================================================

    app.get(
      "/reviews",
      async (req, res) => {
        try {
          const {
            userId,
          } = req.query;

          if (!userId) {
            return res.status(400).json({
              message:
                "userId is required",
            });
          }

          const reviews =
            await reviewCollection
              .find({
                userId: String(
                  userId
                ),
              })
              .sort({
                createdAt: -1,
              })
              .toArray();

          res.json(reviews);
        } catch (error) {
          console.error(
            "GET REVIEWS ERROR:",
            error
          );

          res.status(500).json({
            message:
              "Failed to fetch reviews",
          });
        }
      }
    );

    // =========================================================
    // EDIT REVIEW
    // =========================================================

    app.put(
      "/reviews/:id",
      async (req, res) => {
        try {
          const objectId =
            getObjectId(
              req.params.id
            );

          if (!objectId) {
            return res.status(400).json({
              message:
                "Invalid review ID",
            });
          }

          const {
            userId,
            rating,
            comment,
          } = req.body;

          if (
            !userId ||
            !rating ||
            !comment?.trim()
          ) {
            return res.status(400).json({
              message:
                "Rating and comment are required",
            });
          }

          const numericRating =
            Number(rating);

          if (
            !Number.isInteger(
              numericRating
            ) ||
            numericRating < 1 ||
            numericRating > 5
          ) {
            return res.status(400).json({
              message:
                "Rating must be between 1 and 5",
            });
          }

          const result =
            await reviewCollection.updateOne(
              {
                _id: objectId,
                userId: String(
                  userId
                ),
              },
              {
                $set: {
                  rating:
                    numericRating,
                  comment:
                    comment.trim(),
                  updatedAt:
                    new Date(),
                },
              }
            );

          if (
            result.matchedCount === 0
          ) {
            return res.status(404).json({
              message:
                "Review not found or you do not own this review",
            });
          }

          const updatedReview =
            await reviewCollection.findOne(
              {
                _id: objectId,
              }
            );

          res.json({
            success: true,
            message:
              "Review updated successfully",
            review:
              updatedReview,
          });
        } catch (error) {
          console.error(
            "UPDATE REVIEW ERROR:",
            error
          );

          res.status(500).json({
            message:
              "Failed to update review",
          });
        }
      }
    );

    // =========================================================
    // DELETE REVIEW
    // =========================================================

    app.delete(
      "/reviews/:id",
      async (req, res) => {
        try {
          const objectId =
            getObjectId(
              req.params.id
            );

          if (!objectId) {
            return res.status(400).json({
              message:
                "Invalid review ID",
            });
          }

          const {
            userId,
          } = req.query;

          if (!userId) {
            return res.status(400).json({
              message:
                "userId is required",
            });
          }

          const result =
            await reviewCollection.deleteOne(
              {
                _id: objectId,
                userId: String(
                  userId
                ),
              }
            );

          if (
            result.deletedCount === 0
          ) {
            return res.status(404).json({
              message:
                "Review not found or you do not own this review",
            });
          }

          res.json({
            success: true,
            message:
              "Review deleted successfully",
          });
        } catch (error) {
          console.error(
            "DELETE REVIEW ERROR:",
            error
          );

          res.status(500).json({
            message:
              "Failed to delete review",
          });
        }
      }
    );

    // =========================================================
    // TRANSACTIONS
    // =========================================================

    app.get(
      "/transactions",
      async (req, res) => {
        try {
          const {
            userId,
            librarianId,
          } = req.query;

          const query = {};

          if (userId) {
            query.userId =
              String(userId);
          }

          if (librarianId) {
            query.librarianId =
              String(librarianId);
          }

          const transactions =
            await transactionCollection
              .find(query)
              .sort({
                createdAt: -1,
              })
              .toArray();

          res.json(
            transactions
          );
        } catch (error) {
          console.error(
            "GET TRANSACTIONS ERROR:",
            error
          );

          res.status(500).json({
            message:
              "Failed to fetch transactions",
          });
        }
      }
    );

    // =========================================================
    // START SERVER
    // =========================================================

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (error) {
    console.error(
      "MongoDB connection error:",
      error
    );
  }
}

run();

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const app = express();

app.use(cors());
app.use(morgan("dev"));

require("dotenv").config();

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Node.js server is running 🚀" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// testing branch switch

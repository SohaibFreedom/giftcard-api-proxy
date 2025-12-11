import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 🔥 ENV variables
const STORE = process.env.SHOP_DOMAIN;
const TOKEN = process.env.SHOP_ACCESS_TOKEN;
const API_VERSION = process.env.API_VERSION;

// 👉 Main API endpoint
app.get("/giftcard", async (req, res) => {
  const email = req.query.email;

  if (!email) {
    return res.status(400).json({ error: "Email missing" });
  }

  const url = `https://${STORE}/admin/api/${API_VERSION}/gift_cards.json?query=email:${email}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      }
    });

    const data = await response.json();

    const totalBalance = data.gift_cards
      ? data.gift_cards.reduce((sum, gc) => sum + parseFloat(gc.balance), 0)
      : 0;

    res.json({
      email,
      total_balance: totalBalance,
      gift_cards: data.gift_cards || []
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("Gift Card API Running ✔");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port " + (process.env.PORT || 3000));
});

import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ENV variables
const STORE = process.env.SHOP_DOMAIN;
const TOKEN = process.env.SHOP_ACCESS_TOKEN;
const API_VERSION = process.env.API_VERSION;

// Helper: Parse Shopify pagination link
function getNextLink(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>; rel="next"/);
  return match ? match[1] : null;
}

// MAIN API
app.get("/giftcard", async (req, res) => {
  const email = req.query.email;

  if (!email) {
    return res.status(400).json({ error: "Email missing" });
  }

  try {
    let allGiftCards = [];
    let url = `https://${STORE}/admin/api/${API_VERSION}/gift_cards.json?query=email:${email}&limit=50`;

    // --- PAGINATION LOOP ---
    while (url) {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json"
        }
      });

      const data = await response.json();

      if (data?.gift_cards?.length) {
        allGiftCards.push(...data.gift_cards);
      }

      // Check pagination
      url = getNextLink(response.headers.get("link"));
    }

    // Find correct customer_id
    const matchedCard = allGiftCards.find(gc => gc.customer_id !== null);
    const customerId = matchedCard ? matchedCard.customer_id : null;

    // SUM balance (only > 0 cards)
    const totalBalance = allGiftCards.reduce((sum, gc) => {
      const bal = parseFloat(gc.balance);
      return bal > 0 ? sum + bal : sum;
    }, 0);

    res.json({
      email,
      customer_id: customerId,
      total_balance: totalBalance,
      gift_cards: allGiftCards
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// HOME ROUTE
app.get("/", (req, res) => {
  res.send("Gift Card API Running ✔");
});

// START SERVER
app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port " + (process.env.PORT || 3000));
});

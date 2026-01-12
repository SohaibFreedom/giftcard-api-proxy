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

// Helper: normalize email
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// HOME ROUTE
app.get("/", (req, res) => {
  res.send("Gift Card API Running ✔");
});

// MAIN API
// Usage: /giftcard?email=atellechea@crimson.ua.edu
app.get("/giftcard", async (req, res) => {
  const email = normalizeEmail(req.query.email);

  if (!email) {
    return res.status(400).json({ error: "Email missing" });
  }

  try {
    let allGiftCards = [];
    let url = `https://${STORE}/admin/api/${API_VERSION}/gift_cards.json?query=email:${encodeURIComponent(
      email
    )}&limit=50`;

    // --- PAGINATION LOOP ---
    while (url) {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({
          error: "Shopify request failed",
          status: response.status,
          details: text,
        });
      }

      const data = await response.json();

      if (data?.gift_cards?.length) {
        allGiftCards.push(...data.gift_cards);
      }

      // Check pagination
      url = getNextLink(response.headers.get("link"));
    }

    // ✅ AUTO-FILTER HERE (no extra params needed)
    // Example rules:
    // - must have balance > 0
    // - not disabled
    // - not expired (if expires_on exists)
    const now = new Date();

    const filteredGiftCards = allGiftCards.filter((gc) => {
      const bal = parseFloat(gc.balance || "0");
      if (!(bal > 0)) return false;

      if (gc.disabled_at) return false;

      if (gc.expires_on) {
        const exp = new Date(gc.expires_on);
        if (exp < now) return false;
      }

      return true;
    });

    // Find customer_id (from filtered first, fallback to all)
    const matchedCard =
      filteredGiftCards.find((gc) => gc.customer_id !== null) ||
      allGiftCards.find((gc) => gc.customer_id !== null);

    const customerId = matchedCard ? matchedCard.customer_id : null;

    // SUM balance
    const totalBalance = filteredGiftCards.reduce((sum, gc) => {
      return sum + parseFloat(gc.balance || "0");
    }, 0);

    // ✅ return ONLY this customer's email data (minimal response)
    const slimCards = filteredGiftCards.map((gc) => ({
      id: gc.id,
      balance: gc.balance,
      initial_value: gc.initial_value,
      currency: gc.currency,
      customer_id: gc.customer_id,
      expires_on: gc.expires_on,
      created_at: gc.created_at,
      updated_at: gc.updated_at,
    }));

    return res.json({
      email,
      customer_id: customerId,
      total_balance: totalBalance,
      active_cards_count: slimCards.length,
      active_cards: slimCards,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// START SERVER
app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port " + (process.env.PORT || 3000));
});

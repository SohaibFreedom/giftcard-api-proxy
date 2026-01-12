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

// Helper: Shopify fetch wrapper
async function shopifyGet(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": TOKEN,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const err = new Error(text || "Shopify request failed");
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  return { data, headers: response.headers };
}

// ✅ Step 1: Get exact customer id by email
async function getCustomerIdByEmail(email) {
  // customers/search supports query=email:someone@domain.com
  const url = `https://${STORE}/admin/api/${API_VERSION}/customers/search.json?query=email:${encodeURIComponent(
    email
  )}&limit=1`;

  const { data } = await shopifyGet(url);
  const customer = data?.customers?.[0];
  return customer?.id || null;
}

// HOME ROUTE
app.get("/", (req, res) => {
  res.send("Gift Card API Running ✔");
});

// MAIN API
// Usage: /giftcard?email=atellechea@crimson.ua.edu
app.get("/giftcard", async (req, res) => {
  const email = normalizeEmail(req.query.email);
  if (!email) return res.status(400).json({ error: "Email missing" });

  try {
    // 1) exact customer id
    const customerId = await getCustomerIdByEmail(email);

    // 2) fetch gift cards (pagination)
    // NOTE: query=email: is not strict, but we still use it to reduce results,
    // then we do strict filtering below.
    let allGiftCards = [];
    let url = `https://${STORE}/admin/api/${API_VERSION}/gift_cards.json?query=${encodeURIComponent(
      email
    )}&limit=50`;

    while (url) {
      const { data, headers } = await shopifyGet(url);

      if (data?.gift_cards?.length) {
        allGiftCards.push(...data.gift_cards);
      }

      url = getNextLink(headers.get("link"));
    }

    // ✅ Step 3: STRICT FILTER (sirf isi email/customer ka)
    const filtered = allGiftCards.filter((gc) => {
      // If we found a customerId, only accept gift cards tied to that customer
      if (customerId && gc.customer_id) {
        return Number(gc.customer_id) === Number(customerId);
      }

      // If no customerId found OR gift card not attached to customer,
      // try matching recipient_email (some stores use recipient gift cards)
      const recEmail = normalizeEmail(gc.recipient_email);
      return recEmail && recEmail === email;
    });

    // OPTIONAL: only balance > 0 + not disabled + not expired
    const now = new Date();
    const activeCards = filtered.filter((gc) => {
      const bal = parseFloat(gc.balance || "0");
      if (!(bal > 0)) return false;
      if (gc.disabled_at) return false;
      if (gc.expires_on && new Date(gc.expires_on) < now) return false;
      return true;
    });

    const totalBalance = activeCards.reduce(
      (sum, gc) => sum + parseFloat(gc.balance || "0"),
      0
    );

    // return small response
    return res.json({
      email,
      customer_id: customerId,
      total_balance: totalBalance,
      active_cards_count: activeCards.length,
      active_cards: activeCards.map((gc) => ({
        id: gc.id,
        balance: gc.balance,
        initial_value: gc.initial_value,
        currency: gc.currency,
        customer_id: gc.customer_id,
        recipient_email: gc.recipient_email || null,
        expires_on: gc.expires_on,
        created_at: gc.created_at,
        updated_at: gc.updated_at,
      })),
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

// START SERVER
app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port " + (process.env.PORT || 3000));
});

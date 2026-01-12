import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

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

// Helper: Shopify GET wrapper
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

// Get exact customer id by email
async function getCustomerIdByEmail(email) {
  const url = `https://${STORE}/admin/api/${API_VERSION}/customers/search.json?query=email:${encodeURIComponent(
    email
  )}&limit=1`;

  const { data } = await shopifyGet(url);
  return data?.customers?.[0]?.id || null;
}

/**
 * GET /giftcard?email=...
 * Returns: { email, customer_id, total_balance }
 * ✅ Total includes ALL non-expired gift cards for that customer (server-side filtered)
 */
app.get("/giftcard", async (req, res) => {
  const email = normalizeEmail(req.query.email);
  if (!email) return res.status(400).json({ error: "Email missing" });

  try {
    const customerId = await getCustomerIdByEmail(email);

    // If customer not found, return 0 fast
    if (!customerId) {
      return res.json({
        email,
        customer_id: null,
        total_balance: 0,
      });
    }

    let totalBalance = 0;

    // ✅ Shopify-side filter by customer_id (fast)
    let url = `https://${STORE}/admin/api/${API_VERSION}/gift_cards.json?query=customer_id:${customerId}&limit=50`;

    // Pagination loop
    while (url) {
      const { data, headers } = await shopifyGet(url);
      const cards = data?.gift_cards || [];

      for (const gc of cards) {
        const bal = parseFloat(gc.balance || "0");

        // ✅ Only skip expired cards (include zero balance + include disabled as well)
        if (gc.expires_on && new Date(gc.expires_on) < new Date()) continue;

        totalBalance += bal;
      }

      url = getNextLink(headers.get("link"));
    }

    return res.json({
      email,
      customer_id: customerId,
      total_balance: Number(totalBalance.toFixed(2)),
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
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

import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const STORE = process.env.SHOP_DOMAIN;          // e.g. yourstore.myshopify.com
const TOKEN = process.env.SHOP_ACCESS_TOKEN;    // Admin API access token
const API_VERSION = process.env.API_VERSION;    // e.g. 2024-10

function getNextLink(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>; rel="next"/);
  return match ? match[1] : null;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

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

// 1) Get exact customer id from email
async function getCustomerIdByEmail(email) {
  const url = `https://${STORE}/admin/api/${API_VERSION}/customers/search.json?query=email:${encodeURIComponent(
    email
  )}&limit=1`;

  const { data } = await shopifyGet(url);
  return data?.customers?.[0]?.id || null;
}

/**
 * GET /giftcard?email=...
 * ✅ Returns ONLY total of NON-EXPIRED gift cards for that exact customer
 */
app.get("/giftcard", async (req, res) => {
  const email = normalizeEmail(req.query.email);
  if (!email) return res.status(400).json({ error: "Email missing" });

  try {
    const customerId = await getCustomerIdByEmail(email);

    if (!customerId) {
      return res.json({
        email,
        customer_id: null,
        total_balance: 0,
      });
    }

    let totalBalance = 0;

    // 2) Fetch ONLY this customer's gift cards (fast)
    let url = `https://${STORE}/admin/api/${API_VERSION}/gift_cards.json?query=customer_id:${customerId}&limit=50`;

    while (url) {
      const { data, headers } = await shopifyGet(url);
      const cards = data?.gift_cards || [];

      for (const gc of cards) {
        // ✅ non-expired only
        if (gc.expires_on && new Date(gc.expires_on) < new Date()) continue;

        // balance add (even if 0)
        totalBalance += parseFloat(gc.balance || "0");
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

app.get("/", (req, res) => res.send("Gift Card API Running ✔"));

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port " + (process.env.PORT || 3000));
});

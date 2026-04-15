const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "Public")));

app.get("/api/health", function(req, res) {
  res.json({ status: "ok" });
});

app.post("/api/ai", async function(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "No API key" });
    return;
  }
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("*", function(req, res) {
  res.sendFile(path.join(__dirname, "Public", "Index.html"));
});

app.listen(process.env.PORT || 3000, function() {
  console.log("RecipeBox+ running");
});

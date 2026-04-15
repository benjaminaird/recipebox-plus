const express = require(“express”);
const path = require(“path”);

const app = express();
app.use(express.json({ limit: “10mb” }));
app.use(express.static(path.join(__dirname, “public”)));

app.get(”/api/health”, (req, res) => res.json({ status: “ok” }));

app.post(”/api/ai”, async (req, res) => {
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) return res.status(500).json({ error: “ANTHROPIC_API_KEY not set in .env” });
try {
const response = await fetch(“https://api.anthropic.com/v1/messages”, {
method: “POST”,
headers: {
“Content-Type”: “application/json”,
“x-api-key”: apiKey,
“anthropic-version”: “2023-06-01”,
},
body: JSON.stringify(req.body),
});
const data = await response.json();
res.status(response.status).json(data);
} catch (err) {
res.status(500).json({ error: err.message });
}
});

app.get(”*”, (req, res) => {
res.sendFile(path.join(__dirname, "Public", "Index.html"));

});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(“RecipeBox+ running on port “ + PORT));

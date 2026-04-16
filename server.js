const express = require(“express”);
const path = require(“path”);

const app = express();
app.use(express.json({ limit: “20mb” }));
app.use(express.static(path.join(__dirname, “Public”)));

// Health check
app.get(”/api/health”, function(req, res) {
res.json({ status: “ok” });
});

// YouTube transcript fetcher
app.get(”/api/transcript”, async function(req, res) {
const videoUrl = req.query.url;
if (!videoUrl) return res.status(400).json({ error: “No URL provided” });

try {
// Extract video ID
const idMatch = videoUrl.match(/(?:v=|youtu.be/|embed/)([a-zA-Z0-9_-]{11})/);
if (!idMatch) return res.status(400).json({ error: “Invalid YouTube URL” });
const videoId = idMatch[1];

```
// Fetch YouTube page to get transcript data
const pageRes = await fetch("https://www.youtube.com/watch?v=" + videoId, {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  }
});
const html = await pageRes.text();

// Extract title
const titleMatch = html.match(/<title>([^<]+)<\/title>/);
const title = titleMatch ? titleMatch[1].replace(" - YouTube", "").trim() : "YouTube Recipe";

// Extract description
const descMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
let description = "";
if (descMatch) {
  description = descMatch[1]
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .slice(0, 3000);
}

// Try to get transcript - look for timedtext URL
const transcriptMatch = html.match(/"captionTracks":\[{"baseUrl":"([^"]+)"/);
let transcript = "";

if (transcriptMatch) {
  const captionUrl = transcriptMatch[1].replace(/\\u0026/g, "&");
  try {
    const captionRes = await fetch(captionUrl);
    const captionXml = await captionRes.text();
    // Extract text from XML
    const textMatches = captionXml.match(/<text[^>]*>([^<]*)<\/text>/g) || [];
    transcript = textMatches
      .map(t => t.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"'))
      .join(" ")
      .slice(0, 8000);
  } catch(e) {
    console.log("Transcript fetch failed:", e.message);
  }
}

// Try to get thumbnail
const thumbnail = "https://img.youtube.com/vi/" + videoId + "/maxresdefault.jpg";

res.json({ title, description, transcript, thumbnail, videoId });
```

} catch(err) {
console.error(“Transcript error:”, err);
res.status(500).json({ error: err.message });
}
});

// Anthropic AI proxy
app.post(”/api/ai”, async function(req, res) {
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
res.status(500).json({ error: “ANTHROPIC_API_KEY not set” });
return;
}
try {
const response = await fetch(“https://api.anthropic.com/v1/messages”, {
method: “POST”,
headers: {
“Content-Type”: “application/json”,
“x-api-key”: apiKey,
“anthropic-version”: “2023-06-01”
},
body: JSON.stringify(req.body)
});
const data = await response.json();
res.status(response.status).json(data);
} catch(err) {
res.status(500).json({ error: err.message });
}
});

app.get(”*”, function(req, res) {
res.sendFile(path.join(__dirname, “Public”, “Index.html”));
});

app.listen(process.env.PORT || 3000, function() {
console.log(“RecipeBox+ running”);
});

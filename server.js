const express = require(“express”);
const path = require(“path”);

const app = express();
app.use(express.json({ limit: “20mb” }));
app.use(express.static(path.join(__dirname, “Public”)));

app.get(”/api/health”, function(req, res) {
res.json({ status: “ok” });
});

app.get(”/api/transcript”, async function(req, res) {
const videoUrl = req.query.url;
if (!videoUrl) return res.status(400).json({ error: “No URL provided” });

try {
// Extract video ID safely without complex regex
let videoId = “”;
if (videoUrl.includes(“v=”)) {
videoId = videoUrl.split(“v=”)[1].split(”&”)[0].slice(0, 11);
} else if (videoUrl.includes(“youtu.be/”)) {
videoId = videoUrl.split(“youtu.be/”)[1].split(”?”)[0].slice(0, 11);
} else if (videoUrl.includes(“embed/”)) {
videoId = videoUrl.split(“embed/”)[1].split(”?”)[0].slice(0, 11);
}

if (!videoId || videoId.length < 5) {
  return res.status(400).json({ error: "Invalid YouTube URL" });
}

const pageRes = await fetch("https://www.youtube.com/watch?v=" + videoId, {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  }
});
const html = await pageRes.text();

// Extract title
let title = "YouTube Recipe";
const titleStart = html.indexOf("<title>");
const titleEnd = html.indexOf("</title>");
if (titleStart !== -1 && titleEnd !== -1) {
  title = html.slice(titleStart + 7, titleEnd).replace(" - YouTube", "").trim();
}

// Extract description
let description = "";
const descKey = '"shortDescription":"';
const descStart = html.indexOf(descKey);
if (descStart !== -1) {
  let raw = html.slice(descStart + descKey.length, descStart + descKey.length + 4000);
  let end = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '"' && raw[i-1] !== '\\') { end = i; break; }
  }
  description = raw.slice(0, end)
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .slice(0, 3000);
}

// Extract transcript
let transcript = "";
const captionKey = '"captionTracks":[{"baseUrl":"';
const captionStart = html.indexOf(captionKey);
if (captionStart !== -1) {
  const urlStart = captionStart + captionKey.length;
  const urlEnd = html.indexOf('"', urlStart);
  if (urlEnd !== -1) {
    const captionUrl = html.slice(urlStart, urlEnd).replace(/\\u0026/g, "&");
    try {
      const captionRes = await fetch(captionUrl);
      const captionXml = await captionRes.text();
      const parts = captionXml.split("<text");
      const texts = parts.slice(1).map(function(part) {
        const textStart = part.indexOf(">") + 1;
        const textEnd = part.indexOf("</text>");
        if (textStart === 0 || textEnd === -1) return "";
        return part.slice(textStart, textEnd)
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"');
      });
      transcript = texts.join(" ").slice(0, 8000);
    } catch(e) {
      console.log("Caption fetch failed:", e.message);
    }
  }
}

const thumbnail = "https://img.youtube.com/vi/" + videoId + "/maxresdefault.jpg";
res.json({ title, description, transcript, thumbnail, videoId });

} catch(err) {
console.error(“Transcript error:”, err);
res.status(500).json({ error: err.message });
}
});

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

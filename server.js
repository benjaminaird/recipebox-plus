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
if (!videoUrl) {
res.status(400).json({ error: “no url” });
return;
}
try {
let videoId = “”;
const parts = videoUrl.split(“v=”);
if (parts.length > 1) {
videoId = parts[1].split(”&”)[0].slice(0, 11);
} else if (videoUrl.indexOf(“youtu.be/”) > -1) {
videoId = videoUrl.split(“youtu.be/”)[1].split(”?”)[0].slice(0, 11);
}
if (videoId.length < 5) {
res.status(400).json({ error: “bad url” });
return;
}
const yt = await fetch(“https://www.youtube.com/watch?v=” + videoId, {
headers: { “User-Agent”: “Mozilla/5.0”, “Accept-Language”: “en-US” }
});
const html = await yt.text();
let title = “YouTube Recipe”;
const t1 = html.indexOf(”<title>”);
const t2 = html.indexOf(”</title>”);
if (t1 > -1 && t2 > -1) {
title = html.slice(t1 + 7, t2).replace(” - YouTube”, “”).trim();
}
let description = “”;
const dk = ‘“shortDescription”:”’;
const ds = html.indexOf(dk);
if (ds > -1) {
const raw = html.slice(ds + dk.length, ds + dk.length + 3000);
let end = 0;
for (let i = 0; i < raw.length; i++) {
if (raw[i] === ‘”’ && raw[i - 1] !== “\”) { end = i; break; }
}
description = raw.slice(0, end).replace(/\n/g, “ “).slice(0, 2000);
}
let transcript = “”;
const ck = ‘“captionTracks”:[{“baseUrl”:”’;
const cs = html.indexOf(ck);
if (cs > -1) {
const cu = html.slice(cs + ck.length, cs + ck.length + 500).split(’”’)[0].replace(/\u0026/g, “&”);
try {
const cr = await fetch(cu);
const cx = await cr.text();
transcript = cx.split(”<text”).slice(1).map(function(p) {
const s = p.indexOf(”>”) + 1;
const e = p.indexOf(”</text>”);
return s > 0 && e > -1 ? p.slice(s, e).replace(/&/g, “&”).replace(/'/g, “’”) : “”;
}).join(” “).slice(0, 6000);
} catch(e) {}
}
const thumbnail = “https://img.youtube.com/vi/” + videoId + “/maxresdefault.jpg”;
res.json({ title: title, description: description, transcript: transcript, thumbnail: thumbnail });
} catch(err) {
res.status(500).json({ error: err.message });
}
});
app.post(”/api/ai”, async function(req, res) {
const key = process.env.ANTHROPIC_API_KEY;
if (!key) { res.status(500).json({ error: “no key” }); return; }
try {
const r = await fetch(“https://api.anthropic.com/v1/messages”, {
method: “POST”,
headers: { “Content-Type”: “application/json”, “x-api-key”: key, “anthropic-version”: “2023-06-01” },
body: JSON.stringify(req.body)
});
const d = await r.json();
res.status(r.status).json(d);
} catch(err) {
res.status(500).json({ error: err.message });
}
});
app.get(”*”, function(req, res) {
res.sendFile(path.join(__dirname, “Public”, “Index.html”));
});
app.listen(process.env.PORT || 3000, function() {
console.log(“running”);
});

export default async function handler(req, res) {
  // ---- CORS ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { prompt, model = "models/gemini-2.5-flash-preview-09-2025" } = req.body || {};

  if (!prompt) {
    res.status(400).json({ error: "Missing prompt" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    return;
  }

  // ---- IMPORTANT: STREAMING HEADERS ----
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
  });

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/${model}:streamGenerateContent?key=${apiKey}`;

    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!geminiRes.ok || !geminiRes.body) {
      const errText = await geminiRes.text();
      res.write(`event: error\ndata: ${errText}\n\n`);
      res.end();
      return;
    }

    const reader = geminiRes.body.getReader();
    const decoder = new TextDecoder("utf-8");

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      // Gemini sends JSON per line
      const lines = chunk.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const json = JSON.parse(line);

          const text =
            json?.candidates?.[0]?.content?.parts
              ?.map(p => p.text || "")
              .join("") || "";

          if (text) {
            res.write(`data: ${text}\n\n`);
          }
        } catch {
          // Ignore partial JSON fragments
        }
      }
    }

    res.write("event: done\ndata: [DONE]\n\n");
    res.end();
  } catch (err) {
    res.write(`event: error\ndata: ${err.message}\n\n`);
    res.end();
  }
}

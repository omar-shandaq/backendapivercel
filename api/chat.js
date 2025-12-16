export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "false");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).end("Method Not Allowed");
    return;
  }

  const { prompt } = req.body || {};
  if (!prompt) {
    res.status(400).end("Missing prompt");
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).end("Missing GEMINI_API_KEY");
    return;
  }

  // 🔴 IMPORTANT: streaming headers MUST be set BEFORE writing
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
  });

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!geminiRes.ok || !geminiRes.body) {
      res.write(`event: error\ndata: Gemini API error\n\n`);
      res.end();
      return;
    }

    const reader = geminiRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      // Gemini sends JSON objects per line
      const lines = chunk.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          const text =
            json?.candidates?.[0]?.content?.parts?.[0]?.text;

          if (text) {
            // 🔥 STREAM TO CLIENT IMMEDIATELY
            res.write(`data: ${text}\n\n`);
          }
        } catch {
          // Ignore partial JSON fragments
        }
      }
    }

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err) {
    console.error(err);
    try {
      res.write(`event: error\ndata: ${err.message}\n\n`);
      res.end();
    } catch {}
  }
}

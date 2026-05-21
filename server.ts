import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini client lazily
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please set it in Settings > Secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// 1. API: List brainstorm concepts
app.post("/api/brainstorm", async (req, res) => {
  try {
    const { prompt, tld } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }
    
    let ai;
    try {
      ai = getGeminiClient();
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }

    const systemPrompt = `You are an elite brand name creator and startup incubator design lead. Generate exactly 10 premium, highly relevant, short, memorable domain suggestions. Return only a valid JSON response matching the provided schema.`;
    
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Brainstorm exactly 10 high-potential, clever, catchy, brandable domain names (targeting TLD '${tld || '.com'}') for: "${prompt}". Explain the brand identity benefit of each suggestion.`,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            suggestions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  domainName: { type: Type.STRING },
                  explanation: { type: Type.STRING }
                },
                required: ["domainName", "explanation"]
              }
            }
          },
          required: ["suggestions"]
        }
      }
    });

    if (!response.text) {
      throw new Error("Empty response from AI brainstorm model");
    }

    try {
      const parsed = JSON.parse(response.text.trim());
      res.json(parsed);
    } catch (parseError) {
      console.error("Failed to parse Gemini JSON:", response.text);
      res.status(500).json({ error: "Invalid JSON structure returned by model. Please try again.", raw: response.text });
    }

  } catch (error: any) {
    console.error("Error brainstorming domains:", error);
    res.status(500).json({ error: error.message || "Brainstorming failed" });
  }
});

// 2. API: Deep check a single domain with search grounding
app.post("/api/deep-check", async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) {
      return res.status(400).json({ error: "Domain name is required" });
    }

    let ai;
    try {
      ai = getGeminiClient();
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Search the web to inspect active WHOIS registration records, live hosting, or domain marketplace premium status for the exact domain: '${domain}'. Respond with current info, registration year, and a smart estimated market valuation.`,
      config: {
        systemInstruction: `You are an elite Domain Registrar, WHOIS Analyst, and Valuation Expert. Analyze the domain using Google Search to ensure absolute factual accuracy. Return only a valid JSON response with the following schema:
{
  "domain": "string",
  "status": "available" | "taken" | "premium" | "unknown",
  "reason": "Detailed summary of registration status, active website contents, hosting details, or broker listing info found in search",
  "registrar": "Name of current registrar, or 'None/Available'",
  "creationDate": "Creation/registration date/year, or 'N/A'",
  "approxValue": "Valuation estimate (e.g., $1,500 or Registration Cost $10) with reasoning based on extension and character rarity"
}`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            domain: { type: Type.STRING },
            status: { type: Type.STRING },
            reason: { type: Type.STRING },
            registrar: { type: Type.STRING },
            creationDate: { type: Type.STRING },
            approxValue: { type: Type.STRING }
          },
          required: ["domain", "status", "reason"]
        },
        tools: [{ googleSearch: {} }]
      }
    });

    if (!response.text) {
      throw new Error("Empty response from AI Deep Check");
    }

    try {
      const parsed = JSON.parse(response.text.trim());
      res.json(parsed);
    } catch (parseError) {
      console.error("Failed to parse Gemini Deep Check JSON:", response.text);
      res.status(500).json({ error: "Invalid format returned by Deep Check.", raw: response.text });
    }

  } catch (error: any) {
    console.error("Error in Deep Check:", error);
    res.status(500).json({ error: error.message || "Deep check failed" });
  }
});

async function startServer() {
  // Vite middleware Setup for development / static server for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

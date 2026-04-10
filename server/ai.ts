import OpenAI from "openai";

// ── Configuration ────────────────────────────────
// Supports both OpenAI and Together AI (OpenAI-compatible API)
// Set env vars:
//   AI_PROVIDER=openai|together (default: openai)
//   OPENAI_API_KEY=sk-... (for OpenAI)
//   TOGETHER_API_KEY=... (for Together AI)
//   AI_MODEL=gpt-4o-mini (default, or any Together AI model)
//   AI_EMBEDDING_MODEL=text-embedding-3-small (default)

const provider = process.env.AI_PROVIDER || "openai";
const apiKey = provider === "together"
  ? process.env.TOGETHER_API_KEY
  : process.env.OPENAI_API_KEY;
const baseURL = provider === "together"
  ? "https://api.together.xyz/v1"
  : undefined;
const defaultModel = provider === "together"
  ? "meta-llama/Llama-3.3-70B-Instruct-Turbo"
  : "gpt-4o-mini";
const defaultEmbeddingModel = provider === "together"
  ? "togethercomputer/m2-bert-80M-8k-retrieval"
  : "text-embedding-3-small";

const model = process.env.AI_MODEL || defaultModel;
const embeddingModel = process.env.AI_EMBEDDING_MODEL || defaultEmbeddingModel;

let client: OpenAI | null = null;

if (apiKey) {
  client = new OpenAI({ apiKey, baseURL });
  console.log(`[ai] Provider: ${provider}, Model: ${model}, Embeddings: ${embeddingModel}`);
} else {
  console.log("[ai] No API key configured — AI features disabled. Set OPENAI_API_KEY or TOGETHER_API_KEY.");
}

export function isAIEnabled(): boolean {
  return client !== null;
}

// ── Chat Completion ──────────────────────────────
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chatCompletion(
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  if (!client) throw new Error("AI not configured");
  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 2048,
  });
  return response.choices[0]?.message?.content || "";
}

// ── Streaming Chat Completion ────────────────────
export async function* chatCompletionStream(
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number }
): AsyncGenerator<string> {
  if (!client) throw new Error("AI not configured");
  const stream = await client.chat.completions.create({
    model,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 2048,
    stream: true,
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

// ── Embeddings ───────────────────────────────────
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!client) throw new Error("AI not configured");
  const response = await client.embeddings.create({
    model: embeddingModel,
    input: text,
  });
  return response.data[0].embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!client) throw new Error("AI not configured");
  const response = await client.embeddings.create({
    model: embeddingModel,
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}

// ── Cosine Similarity ────────────────────────────
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Text Chunking ────────────────────────────────
export function chunkText(text: string, maxChunkSize = 500, overlap = 50): string[] {
  const words = text.split(/\s+/);
  if (words.length <= maxChunkSize) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + maxChunkSize, words.length);
    chunks.push(words.slice(start, end).join(" "));
    start = end - overlap;
    if (start >= words.length) break;
  }
  return chunks;
}

// ── Extract text from file content ───────────────
export function extractTextFromFile(content: Buffer, mimeType: string, filename: string): string | null {
  // Text-based files
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    filename.endsWith(".md") ||
    filename.endsWith(".csv") ||
    filename.endsWith(".txt") ||
    filename.endsWith(".ts") ||
    filename.endsWith(".tsx") ||
    filename.endsWith(".js") ||
    filename.endsWith(".jsx")
  ) {
    return content.toString("utf-8");
  }
  // PDF, DOCX etc. would need dedicated parsers - skip for now
  return null;
}

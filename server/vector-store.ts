import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { generateEmbedding, generateEmbeddings, chunkText, cosineSimilarity, isAIEnabled } from "./ai";

// ── Configuration ────────────────────────────────
// Set env vars:
//   SUPABASE_URL=https://your-project.supabase.co
//   SUPABASE_SERVICE_KEY=eyJ... (service role key for server-side access)

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

let supabase: SupabaseClient | null = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log(`[vector-store] Supabase connected: ${supabaseUrl}`);
} else {
  console.log("[vector-store] Supabase not configured — using SQLite fallback for RAG. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.");
}

export function isVectorStoreEnabled(): boolean {
  return supabase !== null && isAIEnabled();
}

// ── Supabase Table Setup SQL ─────────────────────
// Run this in your Supabase SQL editor once:
/*
  -- Enable the vector extension
  create extension if not exists vector;

  -- Document chunks with embeddings
  create table if not exists document_chunks (
    id bigserial primary key,
    source_type text not null,       -- 'file' | 'task' | 'message' | 'announcement'
    source_id bigint not null,
    source_name text not null default '',
    content text not null,
    embedding vector(1536),          -- OpenAI text-embedding-3-small dimension
    created_at timestamptz default now()
  );

  -- Index for fast similarity search
  create index if not exists document_chunks_embedding_idx
    on document_chunks using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

  -- Function for similarity search
  create or replace function match_documents(
    query_embedding vector(1536),
    match_count int default 5,
    filter_source_type text default null
  )
  returns table (
    id bigint,
    source_type text,
    source_id bigint,
    source_name text,
    content text,
    similarity float
  )
  language plpgsql
  as $$
  begin
    return query
    select
      dc.id,
      dc.source_type,
      dc.source_id,
      dc.source_name,
      dc.content,
      1 - (dc.embedding <=> query_embedding) as similarity
    from document_chunks dc
    where (filter_source_type is null or dc.source_type = filter_source_type)
    order by dc.embedding <=> query_embedding
    limit match_count;
  end;
  $$;
*/

// ── Types ────────────────────────────────────────
export interface VectorChunk {
  id: number;
  source_type: string;
  source_id: number;
  source_name: string;
  content: string;
  similarity?: number;
}

// ── Index Document ───────────────────────────────
// Chunks text, generates embeddings, stores in Supabase
export async function indexDocument(
  sourceType: string,
  sourceId: number,
  sourceName: string,
  text: string
): Promise<number> {
  if (!supabase || !isAIEnabled()) return 0;

  // Remove old chunks for this source
  await supabase
    .from("document_chunks")
    .delete()
    .eq("source_type", sourceType)
    .eq("source_id", sourceId);

  // Chunk the text
  const chunks = chunkText(text, 400, 50);
  if (!chunks.length) return 0;

  // Generate embeddings in batches
  const batchSize = 20;
  let indexed = 0;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    try {
      const embeddings = await generateEmbeddings(batch);
      const rows = batch.map((content, j) => ({
        source_type: sourceType,
        source_id: sourceId,
        source_name: sourceName,
        content,
        embedding: JSON.stringify(embeddings[j]),
      }));
      await supabase.from("document_chunks").insert(rows);
      indexed += batch.length;
    } catch (err) {
      console.error(`[vector-store] Failed to index batch for ${sourceType}:${sourceId}:`, err);
    }
  }
  console.log(`[vector-store] Indexed ${indexed} chunks for ${sourceType}:${sourceId} (${sourceName})`);
  return indexed;
}

// ── Remove Document ──────────────────────────────
export async function removeDocument(sourceType: string, sourceId: number): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("document_chunks")
    .delete()
    .eq("source_type", sourceType)
    .eq("source_id", sourceId);
}

// ── Semantic Search ──────────────────────────────
export async function semanticSearch(
  query: string,
  options?: { limit?: number; sourceType?: string }
): Promise<VectorChunk[]> {
  if (!supabase || !isAIEnabled()) return [];

  try {
    const queryEmbedding = await generateEmbedding(query);

    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: JSON.stringify(queryEmbedding),
      match_count: options?.limit ?? 10,
      filter_source_type: options?.sourceType ?? null,
    });

    if (error) {
      console.error("[vector-store] Search error:", error);
      return [];
    }
    return (data || []) as VectorChunk[];
  } catch (err) {
    console.error("[vector-store] Search failed:", err);
    return [];
  }
}

// ── Get RAG Context ──────────────────────────────
// Retrieves relevant context for the AI assistant
export async function getRAGContext(query: string, maxChunks = 8): Promise<string> {
  const results = await semanticSearch(query, { limit: maxChunks });
  if (!results.length) return "";

  const contextParts = results.map((r) => {
    const label = r.source_name || `${r.source_type} #${r.source_id}`;
    return `[Source: ${label}]\n${r.content}`;
  });

  return contextParts.join("\n\n---\n\n");
}

// ── Keyword Fallback Search ──────────────────────
// Used when Supabase is not configured - searches SQLite directly
export function keywordSearch(
  query: string,
  allContent: { sourceType: string; sourceId: number; sourceName: string; content: string }[],
  limit = 8
): VectorChunk[] {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (!terms.length) return [];

  const scored = allContent.map((item) => {
    const contentLower = item.content.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const idx = contentLower.indexOf(term);
      if (idx >= 0) score += 1;
      // Bonus for title/name match
      if (item.sourceName.toLowerCase().includes(term)) score += 2;
    }
    return { ...item, id: item.sourceId, source_type: item.sourceType, source_id: item.sourceId, source_name: item.sourceName, similarity: score };
  });

  return scored
    .filter((s) => s.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

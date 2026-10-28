# Semantic search over memories the caller can see.
# The embedding is computed by scoria-api (Ollama) and passed in.
# variables: $embedding (array<float32>, 768), $limit (int64)
with
  q := <Embedding><array<float32>>$embedding
select MemoryItem {
  id,
  kind,
  title,
  body,
  occurred_at,
  owner: { id, handle },
  distance := ext::pgvector::cosine_distance(.embedding, q),
}
filter exists .embedding
order by ext::pgvector::cosine_distance(.embedding, q) asc
limit <int64>$limit;

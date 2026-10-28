# Semantic search over Parasail (cloud) embeddings the caller can see.
# variables: $embedding (array<float32>, 1024), $limit (int64)
with
  q := <EmbeddingCloud><array<float32>>$embedding
select MemoryItem {
  id,
  kind,
  title,
  body,
  occurred_at,
  source,
  owner: { id, handle },
  place: { id, name, city, region, country, lat, lng },
  distance := ext::pgvector::cosine_distance(.embedding_cloud, q),
}
filter exists .embedding_cloud
order by ext::pgvector::cosine_distance(.embedding_cloud, q) asc
limit <int64>$limit;

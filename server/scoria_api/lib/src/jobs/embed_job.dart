import 'dart:convert';

import 'package:scoria_api/src/db.dart';
import 'package:scoria_api/src/embeddings.dart';
import 'package:scoria_api/src/parasail_embeddings.dart';
import 'package:scoria_jobs/scoria_jobs.dart';

/// Fills local and/or cloud embedding columns for one memory.
class EmbedJob {
  EmbedJob({
    required this.db,
    this.local,
    this.cloud,
  });

  final Db db;
  final Embeddings? local;
  final ParasailEmbeddings? cloud;

  Future<Map<String, Object?>> run(Job job) async {
    final memoryId = job.data['memory_id']?.toString();
    if (memoryId == null) {
      throw StateError('embed job is missing memory_id');
    }
    final client = db.bypass;
    final row = jsonDecode(
      await client.querySingleJSON(
        r'''
        select MemoryItem { id, title, body, owner: { id } }
        filter .id = <uuid>$id
        ''',
        {'id': memoryId},
      ),
    );
    if (row is! Map) return const {'skipped': true};
    final ownerId = (row['owner'] as Map?)?['id'] as String?;
    final text = [
      row['title'],
      row['body'],
    ].whereType<String>().join('\n').trim();
    if (text.isEmpty) return const {'skipped': true, 'reason': 'empty'};

    var localOk = false;
    var cloudOk = false;
    if (local != null) {
      try {
        final vector = await local!.embed(text);
        await client.execute(
          r'''
          update MemoryItem filter .id = <uuid>$id set {
            embedding := <Embedding><array<float32>>$vector,
            embedded_at := datetime_of_statement(),
            embedding_model := <str>$model,
          }
          ''',
          {'id': memoryId, 'vector': vector, 'model': local!.model},
        );
        localOk = true;
      } on Object {
        localOk = false;
      }
    }
    if (cloud != null) {
      try {
        final vector = await cloud!.embed(text);
        await client.execute(
          r'''
          update MemoryItem filter .id = <uuid>$id set {
            embedding_cloud := <EmbeddingCloud><array<float32>>$vector,
            embedded_cloud_at := datetime_of_statement(),
            embedding_cloud_model := <str>$model,
          }
          ''',
          {'id': memoryId, 'vector': vector, 'model': cloud!.model},
        );
        cloudOk = true;
      } on Object {
        cloudOk = false;
      }
    }
    if (ownerId != null) {
      await db.asPerson(ownerId).execute(
        r'''
        update JobRecord filter .pgboss_id = <uuid>$id set {
          state := <JobState><str>$state,
          completed_at := datetime_of_statement(),
        }
        ''',
        {
          'id': job.id,
          'state': (localOk || cloudOk) ? 'completed' : 'failed',
        },
      );
    }
    if (!localOk && !cloudOk && (local != null || cloud != null)) {
      throw StateError('embed failed for $memoryId');
    }
    return {'local': localOk, 'cloud': cloudOk};
  }
}

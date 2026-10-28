import 'dart:convert';
import 'dart:io';

import 'package:gel/gel.dart' as gel;
import 'package:http/http.dart' as http;
import 'package:scoria_api/src/db.dart';
import 'package:scoria_api/src/graph/conclusion.dart';
import 'package:scoria_jobs/scoria_jobs.dart';

/// Passive job: read one memory, ask the local model what it establishes,
/// and write goals, projects, habits, entities and edges.
///
/// An edge starts as `proposed`. A note the user wrote verifies it at once.
/// A second distinct memory verifies a conclusion drawn from conversation.
/// `part_of`, once verified, is also stored as `Thing.parent`.
class GraphConcluder {
  GraphConcluder({
    required this.db,
    required this.ollama,
    required this.model,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  final Db db;
  final Uri ollama;
  final String model;
  final http.Client _http;

  static const _prompt = '''
Extract a life graph from the memory below. Reply with JSON only.
{"things":[{"type":"entity|goal|project|habit","name":"","kind":"person|organization|place|object|concept|event","summary":"","why":"","outcome":"","cue":"","routine":"","cadence":"","status":"active|paused|done|dropped","active":true,"target_on":"YYYY-MM-DD","started_on":"YYYY-MM-DD","parent":""}],"edges":[{"source":"","target":"","kind":"part_of|supports|pursues|practices|prefers|dislikes|located_at|knows|related"}]}
Rules:
- Copy names from the memory. Never invent a name that is not written there.
- goal: an outcome the user is aiming at. project: a body of work. habit: a repeated practice. entity: a person, place, organization, object, concept, or event.
- parent, and an edge of kind part_of, mean the source is inside the target.
- supports: the source helps the target. pursues: a project works toward a goal. practices: a habit is how they do something.
- Omit fields you do not know. If nothing in the memory is a thing or a relationship, return {"things":[],"edges":[]}.
''';

  Future<Map<String, Object>> run(Job job) async {
    final memoryId = job.data['memory_id']?.toString();
    final personId = job.data['person_id']?.toString();
    if (memoryId == null || personId == null) {
      throw StateError('conclude job is missing memory_id or person_id');
    }
    final client = db.asPerson(personId);
    try {
      final result = await _conclude(client, memoryId);
      await _mark(client, job.id, 'completed', null);
      return result;
    } on Object catch (e) {
      await _mark(client, job.id, 'failed', e.toString());
      rethrow;
    }
  }

  Future<Map<String, Object>> _conclude(
    gel.Client client,
    String memoryId,
  ) async {
    final row = jsonDecode(
      await client.querySingleJSON(
        r'''
        select MemoryItem { id, kind, title, body }
        filter .id = <uuid>$id
        ''',
        {'id': memoryId},
      ),
    );
    if (row == null) return const {'skipped': true};
    final memory = row as Map<String, dynamic>;
    final text = [
      memory['title'],
      memory['body'],
    ].whereType<String>().join('\n').trim();
    if (text.isEmpty) return const {'skipped': true};

    final raw = await _ask(text.length > 6000 ? text.substring(0, 6000) : text);
    final conclusion = Conclusion.parse(raw, text);
    if (conclusion.things.isEmpty) {
      return const {'things': 0, 'edges': 0, 'verified': 0};
    }

    final explicit = memory['kind'] == 'note';
    for (final thing in conclusion.things) {
      await _upsertThing(client, thing);
    }
    var edges = 0;
    var verified = 0;
    final about = <String>{};
    for (final edge in conclusion.edges) {
      final wrote = await _upsertEdge(
        client,
        edge,
        memoryId: memoryId,
        explicit: explicit || edge.stated,
      );
      if (wrote == null) continue;
      edges++;
      if (wrote.status == 'verified') verified++;
      about
        ..add(wrote.sourceId)
        ..add(wrote.targetId);
    }
    for (final thing in conclusion.things) {
      final id = await _findId(client, thing.name);
      if (id != null) about.add(id);
    }
    if (about.isNotEmpty) {
      await client.execute(
        r'''
        update MemoryItem filter .id = <uuid>$id set {
          about += (
            select Thing filter .id in array_unpack(<array<uuid>>$ids)
          )
        }
        ''',
        {'id': memoryId, 'ids': about.toList()},
      );
    }
    return {
      'things': conclusion.things.length,
      'edges': edges,
      'verified': verified,
    };
  }

  Future<String> _ask(String memory) async {
    final response = await _http
        .post(
          ollama.resolve('api/chat'),
          headers: const {'content-type': 'application/json'},
          body: jsonEncode({
            'model': model,
            'stream': false,
            'format': 'json',
            if (model.contains('qwen')) 'think': false,
            'messages': [
              {'role': 'system', 'content': _prompt},
              {'role': 'user', 'content': memory},
            ],
            'options': {'temperature': 0, 'num_predict': 800},
          }),
        )
        .timeout(const Duration(seconds: 90));
    if (response.statusCode != 200) {
      final snippet = response.body.length > 200
          ? response.body.substring(0, 200)
          : response.body;
      throw StateError('ollama ${response.statusCode}: $snippet');
    }
    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    final message = decoded['message'];
    final content = message is Map ? message['content'] : null;
    if (content is! String || content.trim().isEmpty) {
      throw const FormatException('model returned no content');
    }
    return content;
  }

  Future<void> _upsertThing(gel.Client client, ConcludedThing thing) async {
    final common = {'name': thing.name, 'summary': thing.summary};
    switch (thing.type) {
      case 'goal':
        await client.querySingleJSON(
          r'''
          select (
            insert Goal {
              owner := assert_exists(global current_person),
              name := <str>$name,
              summary := <optional str>$summary,
              status := <PursuitStatus><str>$status,
              why := <optional str>$why,
              target_on := <optional cal::local_date><optional str>$target_on,
            }
            unless conflict on ((.owner, .name))
            else (
              update Goal set {
                summary := (<optional str>$summary) ?? .summary,
                why := (<optional str>$why) ?? .why,
                updated_at := datetime_of_statement(),
              }
            )
          ) { id }
          ''',
          {
            ...common,
            'status': thing.status,
            'why': thing.why,
            'target_on': thing.targetOn,
          },
        );
      case 'project':
        await client.querySingleJSON(
          r'''
          select (
            insert Project {
              owner := assert_exists(global current_person),
              name := <str>$name,
              summary := <optional str>$summary,
              status := <PursuitStatus><str>$status,
              outcome := <optional str>$outcome,
              started_on := <optional cal::local_date><optional str>$started_on,
              target_on := <optional cal::local_date><optional str>$target_on,
            }
            unless conflict on ((.owner, .name))
            else (
              update Project set {
                summary := (<optional str>$summary) ?? .summary,
                outcome := (<optional str>$outcome) ?? .outcome,
                updated_at := datetime_of_statement(),
              }
            )
          ) { id }
          ''',
          {
            ...common,
            'status': thing.status,
            'outcome': thing.outcome,
            'started_on': thing.startedOn,
            'target_on': thing.targetOn,
          },
        );
      case 'habit':
        await client.querySingleJSON(
          r'''
          select (
            insert Habit {
              owner := assert_exists(global current_person),
              name := <str>$name,
              summary := <optional str>$summary,
              cue := <optional str>$cue,
              routine := <optional str>$routine,
              cadence := <optional str>$cadence,
              active := <bool>$active,
            }
            unless conflict on ((.owner, .name))
            else (
              update Habit set {
                summary := (<optional str>$summary) ?? .summary,
                cue := (<optional str>$cue) ?? .cue,
                routine := (<optional str>$routine) ?? .routine,
                cadence := (<optional str>$cadence) ?? .cadence,
                updated_at := datetime_of_statement(),
              }
            )
          ) { id }
          ''',
          {
            ...common,
            'cue': thing.cue,
            'routine': thing.routine,
            'cadence': thing.cadence,
            'active': thing.active,
          },
        );
      default:
        await client.querySingleJSON(
          r'''
          select (
            insert Entity {
              owner := assert_exists(global current_person),
              name := <str>$name,
              summary := <optional str>$summary,
              kind := <EntityKind><str>$kind,
            }
            unless conflict on ((.owner, .kind, .name))
            else (
              update Entity set {
                summary := (<optional str>$summary) ?? .summary,
                updated_at := datetime_of_statement(),
              }
            )
          ) { id }
          ''',
          {...common, 'kind': thing.kind ?? 'concept'},
        );
    }
  }

  Future<_Wrote?> _upsertEdge(
    gel.Client client,
    ConcludedEdge edge, {
    required String memoryId,
    required bool explicit,
  }) async {
    final sourceId = await _findId(client, edge.source);
    final targetId = await _findId(client, edge.target);
    if (sourceId == null || targetId == null) return null;
    final existing = jsonDecode(
      await client.queryJSON(
        r'''
        select Edge { id, status, evidence }
        filter .source.id = <uuid>$source
          and .target.id = <uuid>$target
          and .kind = <EdgeKind><str>$kind
        ''',
        {'source': sourceId, 'target': targetId, 'kind': edge.kind},
      ),
    ) as List<dynamic>;
    final prior = existing.isEmpty
        ? null
        : existing.first as Map<String, dynamic>;
    final fold = EvidenceFold.fold(
      existingStatus: prior?['status'] as String?,
      existingEvidence: prior?['evidence'] as String?,
      memoryId: memoryId,
      explicit: explicit,
    );
    if (fold.changed && prior == null) {
      await client.execute(
        r'''
        insert Edge {
          owner := assert_exists(global current_person),
          source := assert_single((select Thing filter .id = <uuid>$source)),
          target := assert_single((select Thing filter .id = <uuid>$target)),
          kind := <EdgeKind><str>$kind,
          status := <EdgeStatus><str>$status,
          evidence := <str>$evidence,
        }
        ''',
        {
          'source': sourceId,
          'target': targetId,
          'kind': edge.kind,
          'status': fold.status,
          'evidence': fold.evidence,
        },
      );
    } else if (fold.changed) {
      await client.execute(
        r'''
        update Edge filter .id = <uuid>$id set {
          status := <EdgeStatus><str>$status,
          evidence := <str>$evidence,
          updated_at := datetime_of_statement(),
        }
        ''',
        {'id': prior!['id'], 'status': fold.status, 'evidence': fold.evidence},
      );
    }
    if (edge.kind == 'part_of' && fold.status == 'verified') {
      await _setParent(client, child: sourceId, container: targetId);
    }
    return _Wrote(sourceId: sourceId, targetId: targetId, status: fold.status);
  }

  /// Writes containment onto the row. The child is one concrete type; the
  /// other updates match nothing.
  Future<void> _setParent(
    gel.Client client, {
    required String child,
    required String container,
  }) async {
    const update = r'''
      update TYPE filter .id = <uuid>$child set {
        parent := assert_single((
          select detached Thing filter .id = <uuid>$container
        ))
      }
    ''';
    for (final type in const ['Entity', 'Goal', 'Project', 'Habit']) {
      await client.execute(update.replaceAll('TYPE', type), {
        'child': child,
        'container': container,
      });
    }
    final stored = jsonDecode(
      await client.querySingleJSON(
        r'''
        select Thing { parent_id := .parent.id }
        filter .id = <uuid>$child
        ''',
        {'child': child},
      ),
    );
    final parentId = stored is Map ? stored['parent_id'] : null;
    if (parentId != container) {
      throw StateError('containment was not stored');
    }
  }

  /// One match by name. Two things with the same name are left unlinked
  /// rather than guessed.
  Future<String?> _findId(gel.Client client, String name) async {
    final rows = jsonDecode(
      await client.queryJSON(
        r'''
        select Thing { id }
        filter str_lower(.name) = str_lower(<str>$name)
        ''',
        {'name': name},
      ),
    ) as List<dynamic>;
    if (rows.length != 1) return null;
    return (rows.first as Map<String, dynamic>)['id'] as String;
  }

  Future<void> _mark(
    gel.Client client,
    String jobId,
    String state,
    String? error,
  ) async {
    try {
      await client.execute(
        r'''
        update JobRecord filter .pgboss_id = <uuid>$id set {
          state := <JobState><str>$state,
          completed_at := datetime_of_statement(),
          error := <optional str>$error,
        }
        ''',
        {
          'id': jobId,
          'state': state,
          'error': error == null
              ? null
              : (error.length > 500 ? error.substring(0, 500) : error),
        },
      );
    } on Object catch (e) {
      stderr.writeln('conclude: could not update job record: $e');
    }
  }
}

class _Wrote {
  const _Wrote({
    required this.sourceId,
    required this.targetId,
    required this.status,
  });

  final String sourceId;
  final String targetId;
  final String status;
}

import 'dart:convert';

import 'package:gel/gel.dart' as gel;
import 'package:scoria_api/src/auth/password.dart';
import 'package:scoria_api/src/auth/session_token.dart';
import 'package:scoria_api/src/config.dart';
import 'package:scoria_api/src/db.dart';
import 'package:scoria_api/src/embeddings.dart';
import 'package:scoria_api/src/queries.dart';
import 'package:scoria_jobs/scoria_jobs.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

/// The HTTP surface. Routes are thin: decode, pick the caller, run a named
/// query as that caller, encode. No authorization logic lives here.
class ScoriaApp {
  ScoriaApp({
    required this.config,
    required this.db,
    required this.queries,
    this.jobs,
    this.embeddings,
    Password? password,
  }) : _password = password ?? const Password(),
       _tokens = SessionToken(config.sessionSecret);

  final Config config;
  final Db db;
  final NamedQueries queries;
  final PgBossQueue? jobs;
  final Embeddings? embeddings;
  final Password _password;
  final SessionToken _tokens;

  Handler get handler => const Pipeline()
      .addMiddleware(logRequests())
      .addMiddleware(_errors)
      .addHandler(_router.call);

  Router get _router => Router()
    ..get('/health', (Request r) => _json({'ok': true}))
    ..post('/auth/signin', _signIn)
    ..get('/me', _authed((r, c) => _one(c, 'me')))
    ..get('/memory', _authed(_memoryFeed))
    ..get('/memory/<id>', _authed(_memoryGet))
    ..post('/memory', _authed(_memoryUpsert))
    ..post('/memory/search', _authed(_memorySearch))
    ..post('/positions', _authed(_positions))
    ..get('/presence/overlap/<other>', _authed(_presenceOverlap))
    ..get('/jobs', _authed(_jobsList))
    ..post('/admin/people', _authed(_createPerson));

  // ---- auth -----------------------------------------------------------------

  Future<Response> _signIn(Request r) async {
    final body = await _body(r);
    final handle = body['handle'] as String?;
    final password = body['password'] as String?;
    if (handle == null || password == null) {
      return _error(400, 'bad_request', 'handle and password required');
    }
    final row = await db.service.querySingleJSON(
      r'''
      select assert_single((select LocalCredential {
        password_hash,
        person: { id, handle, display_name, email, is_superadmin, created_at,
                  disabled_at }
      } filter .person.handle = <str>$handle))
      ''',
      {'handle': handle},
    );
    final cred = jsonDecode(row) as Map<String, dynamic>?;
    // Same refusal for unknown handle and wrong password.
    if (cred == null ||
        !_password.verify(password, cred['password_hash'] as String)) {
      return _error(401, 'invalid_credentials', 'sign-in refused');
    }
    final person = cred['person'] as Map<String, dynamic>;
    if (person['disabled_at'] != null) {
      return _error(401, 'invalid_credentials', 'sign-in refused');
    }
    final expires = DateTime.now().toUtc().add(config.sessionTtl);
    person.remove('disabled_at');
    return _json({
      'token': _tokens.issue(person['id'] as String, expires),
      'expires_at': expires.toIso8601String(),
      'person': person,
    });
  }

  Handler _authed(
    Future<Response> Function(Request r, gel.Client caller) next,
  ) {
    return (Request r) async {
      final auth = r.headers['authorization'];
      final token = auth != null && auth.startsWith('Bearer ')
          ? auth.substring(7)
          : null;
      final personId = token == null ? null : _tokens.verify(token);
      if (personId == null) {
        return _error(401, 'unauthorized', 'missing or expired token');
      }
      return next(r, db.asPerson(personId));
    };
  }

  // ---- memory ---------------------------------------------------------------

  Future<Response> _memoryFeed(Request r, gel.Client c) async {
    final before = r.url.queryParameters['before'];
    final limit = int.tryParse(r.url.queryParameters['limit'] ?? '') ?? 50;
    return _many(c, 'memory_feed', {
      'before': before == null ? null : DateTime.parse(before),
      'limit': limit.clamp(1, 200),
    });
  }

  Future<Response> _memoryGet(Request r, gel.Client c) =>
      _one(c, 'memory_get', {'id': r.params['id']});

  Future<Response> _memoryUpsert(Request r, gel.Client c) async {
    final b = await _body(r);
    final json = await c.querySingleJSON(queries['memory_upsert'], {
      'kind': b['kind'],
      'title': b['title'],
      'body': b['body'],
      'occurred_at': DateTime.parse(b['occurred_at'] as String),
      'source': b['source'],
      'source_id': b['source_id'],
    });
    final row = jsonDecode(json) as Map<String, dynamic>;
    final full = await c.querySingleJSON(queries['memory_get'], {
      'id': row['id'],
    });
    await _enqueue(c, 'embed', {
      'memory_id': row['id'],
    }, subjectId: row['id'] as String);
    return Response.ok(full, headers: _jsonHeaders);
  }

  Future<Response> _memorySearch(Request r, gel.Client c) async {
    final emb = embeddings;
    if (emb == null) {
      return _error(501, 'embeddings_disabled', 'OLLAMA_URL is not configured');
    }
    final b = await _body(r);
    final q = b['q'] as String?;
    if (q == null || q.trim().isEmpty) {
      return _error(400, 'bad_request', 'q required');
    }
    final vector = await emb.embed(q);
    return _many(c, 'memory_search', {
      'embedding': vector,
      'limit': (b['limit'] as int? ?? 20).clamp(1, 100),
    });
  }

  // ---- positions / presence -------------------------------------------------

  Future<Response> _positions(Request r, gel.Client c) async {
    final b = await _body(r);
    final points = b['points'] as List<dynamic>? ?? const [];
    if (points.isEmpty) return _json({'inserted': 0});
    // The gel client JSON-encodes `json` arguments itself; pass the value.
    final inserted = await c.query(queries['position_insert_many'], {
      'points': points,
    });
    await _enqueue(c, 'derive-presence', {
      'count': inserted.length,
    }, options: const SendOptions(singletonKey: 'presence'));
    return _json({'inserted': inserted.length});
  }

  Future<Response> _presenceOverlap(Request r, gel.Client c) =>
      _many(c, 'presence_overlap', {'other': r.params['other']});

  // ---- jobs -----------------------------------------------------------------

  Future<Response> _jobsList(Request r, gel.Client c) {
    final states = r.url.queryParameters['states']?.split(',');
    final limit = int.tryParse(r.url.queryParameters['limit'] ?? '') ?? 100;
    return _many(c, 'jobs_list', {
      'states': states,
      'limit': limit.clamp(1, 500),
    });
  }

  // ---- admin ----------------------------------------------------------------

  /// Superadmin creates an account. The Person insert is policy-gated, so a
  /// non-superadmin caller gets an AccessPolicyError -> 403.
  Future<Response> _createPerson(Request r, gel.Client c) async {
    final b = await _body(r);
    final handle = b['handle'] as String?;
    final password = b['password'] as String?;
    if (handle == null || password == null || password.length < 8) {
      return _error(400, 'bad_request', 'handle and password (8+) required');
    }
    final person = await c.querySingleJSON(
      r'''
      select (insert Person {
        handle := <str>$handle,
        display_name := <optional str>$display_name,
        email := <optional str>$email,
      }) { id, handle, display_name, email, is_superadmin, created_at }
      ''',
      {
        'handle': handle,
        'display_name': b['display_name'],
        'email': b['email'],
      },
    );
    final id = (jsonDecode(person) as Map<String, dynamic>)['id'] as String;
    await db.service.execute(
      r'''
      insert LocalCredential {
        person := assert_exists((select Person filter .id = <uuid>$id)),
        password_hash := <str>$hash,
      }
      ''',
      {'id': id, 'hash': _password.hash(password)},
    );
    return Response(201, body: person, headers: _jsonHeaders);
  }

  // ---- helpers --------------------------------------------------------------

  /// Sends to PGBoss and mirrors a `JobRecord` as the caller, so the jobs
  /// page is policy-scoped like everything else. The worker updates the
  /// record by `pgboss_id` as it runs. A singleton that is already queued
  /// returns null from PGBoss and gets no second record.
  Future<void> _enqueue(
    gel.Client c,
    String name,
    Map<String, dynamic> data, {
    String? subjectId,
    SendOptions options = const SendOptions(),
  }) async {
    final q = jobs;
    if (q == null) return;
    final id = await q.send(name, data, options);
    if (id == null) return;
    await c.execute(
      r'''
      insert JobRecord {
        owner := assert_exists(global current_person),
        name := <str>$name,
        state := JobState.created,
        pgboss_id := <uuid>$pgboss_id,
        subject := (select Owned filter .id = <optional uuid>$subject limit 1),
      }
      ''',
      {'name': name, 'pgboss_id': id, 'subject': subjectId},
    );
  }

  Future<Response> _many(
    gel.Client c,
    String name, [
    Map<String, dynamic>? v,
  ]) async =>
      Response.ok(await c.queryJSON(queries[name], v), headers: _jsonHeaders);

  Future<Response> _one(
    gel.Client c,
    String name, [
    Map<String, dynamic>? v,
  ]) async {
    final json = await c.querySingleJSON(queries[name], v);
    return json == 'null'
        ? _error(404, 'not_found', 'not found')
        : Response.ok(json, headers: _jsonHeaders);
  }

  static const _jsonHeaders = {'content-type': 'application/json'};

  static Response _json(Object body) =>
      Response.ok(jsonEncode(body), headers: _jsonHeaders);

  static Response _error(int status, String code, String message) => Response(
    status,
    body: jsonEncode({'code': code, 'message': message}),
    headers: _jsonHeaders,
  );

  static Future<Map<String, dynamic>> _body(Request r) async {
    final text = await r.readAsString();
    if (text.isEmpty) return const {};
    final decoded = jsonDecode(text);
    return decoded is Map<String, dynamic> ? decoded : const {};
  }

  static Handler _errors(Handler inner) => (Request r) async {
    try {
      return await inner(r);
    } on gel.AccessPolicyError catch (e) {
      return _error(403, 'forbidden', e.message);
    } on gel.ConstraintViolationError catch (e) {
      return _error(409, 'conflict', e.message);
    } on gel.InvalidArgumentError catch (e) {
      return _error(400, 'bad_request', e.message);
    } on FormatException catch (e) {
      return _error(400, 'bad_request', e.message);
    }
  };
}

import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:gel/gel.dart' as gel;
import 'package:scoria_api/src/agent.dart';
import 'package:scoria_api/src/auth/api_key.dart';
import 'package:scoria_api/src/auth/password.dart';
import 'package:scoria_api/src/auth/session_token.dart';
import 'package:scoria_api/src/config.dart';
import 'package:scoria_api/src/db.dart';
import 'package:scoria_api/src/embeddings.dart';
import 'package:scoria_api/src/geocoder.dart';
import 'package:scoria_api/src/queries.dart';
import 'package:scoria_jobs/scoria_jobs.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

/// The HTTP surface. Routes are thin: decode, pick the caller, run a named
/// query as that caller, encode. No authorization logic lives here.
///
/// Three kinds of caller reach this process:
/// - the Flutter app with a session token (`/auth/signin`);
/// - machines with an API key (`sk_…`): the OpenClaw memory plugin, scripts;
/// - the agent harness indirectly, through `/chat`, which forwards a turn to
///   the OpenAI-compatible endpoint of the OpenClaw gateway and streams back.
class ScoriaApp {
  ScoriaApp({
    required this.config,
    required this.db,
    required this.queries,
    this.jobs,
    this.embeddings,
    this.agent,
    Geocoder? geocoder,
    Password? password,
  }) : _password = password ?? const Password(),
       _tokens = SessionToken(config.sessionSecret),
       geocoder =
           geocoder ??
           Geocoder(
             googleApiKey: config.googleMapsApiKey,
             userAgent: config.geocodeUserAgent,
           );

  final Config config;
  final Db db;
  final NamedQueries queries;
  final PgBossQueue? jobs;
  final Embeddings? embeddings;
  final AgentClient? agent;
  final Geocoder geocoder;
  final Password _password;
  final SessionToken _tokens;
  final ApiKeys _apiKeys = const ApiKeys();

  /// hash -> (person id, resolved at). Keeps machine callers off the
  /// credential table on every request.
  final _apiKeyCache = <String, (String, DateTime)>{};

  Handler get handler => const Pipeline()
      .addMiddleware(logRequests())
      .addMiddleware(_errors)
      .addHandler(_router.call);

  Router get _router => Router()
    ..get('/health', _health)
    ..post('/auth/signin', _signIn)
    ..get('/me', _authed((r, c) => _one(c, 'me')))
    ..get('/me/api-keys', _authed(_apiKeysList))
    ..post('/me/api-keys', _authed(_apiKeysCreate))
    ..delete('/me/api-keys/<id>', _authed(_apiKeysRevoke))
    ..get('/memory', _authed(_memoryFeed))
    ..get('/memory/<id>', _authed(_memoryGet))
    ..post('/memory', _authed(_memoryUpsert))
    ..post('/memory/search', _authed(_memorySearch))
    ..post('/positions', _authed(_positions))
    ..get('/places/reverse', _authed(_placesReverse))
    ..get('/places/search', _authed(_placesSearch))
    ..get('/places/recent', _authed(_placesRecent))
    ..get('/presence/overlap/<other>', _authed(_presenceOverlap))
    ..get('/jobs', _authed(_jobsList))
    ..get('/chat/sessions', _authed(_chatSessions))
    ..post('/chat/sessions', _authed(_chatCreate))
    ..delete('/chat/sessions/<id>', _authed(_chatDelete))
    ..get('/chat/sessions/<id>/messages', _authed(_chatMessages))
    ..post('/chat/sessions/<id>/messages', _authed(_chatSend))
    ..post('/admin/people', _authed(_createPerson))
    // Companion Intelligence memory-plugin contract (OpenClaw's
    // `companionintelligence` plugin speaks exactly this).
    ..get('/api/health', _health)
    ..get('/api/memory/context', _authed(_ciContext))
    ..post('/api/memory/recall', _authed(_ciRecall))
    ..post('/api/memory/write', _authed(_ciWrite))
    ..post('/api/memory/turn', _authed(_ciTurn));

  Future<Response> _health(Request r) async => _json({
    'ok': true,
    'agent': agent == null ? null : await agent!.ping(),
    'embeddings': embeddings != null,
    'geocoder': geocoder.provider,
    'jobs': jobs != null,
  });

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

  /// Session token (`Authorization: Bearer <jwt-ish>`), or an API key in
  /// either `Authorization: Bearer sk_…` or `x-api-key: sk_…`.
  Handler _authed(
    Future<Response> Function(Request r, gel.Client caller) next,
  ) {
    return (Request r) async {
      final auth = r.headers['authorization'];
      var token = auth != null && auth.startsWith('Bearer ')
          ? auth.substring(7)
          : null;
      token ??= r.headers['x-api-key'];
      if (token == null) {
        return _error(401, 'unauthorized', 'missing token');
      }
      final personId = ApiKeys.looksLikeKey(token)
          ? await _resolveApiKey(token)
          : _tokens.verify(token);
      if (personId == null) {
        return _error(401, 'unauthorized', 'missing or expired token');
      }
      return next(r, db.asPerson(personId));
    };
  }

  Future<String?> _resolveApiKey(String token) async {
    final hash = _apiKeys.hash(token);
    final cached = _apiKeyCache[hash];
    if (cached != null &&
        DateTime.now().difference(cached.$2) < const Duration(minutes: 1)) {
      return cached.$1;
    }
    final row = await db.service.querySingleJSON(
      r'''
      select assert_single((select ApiKey { person: { id, disabled_at }, revoked_at }
        filter .token_hash = <str>$hash))
      ''',
      {'hash': hash},
    );
    final key = jsonDecode(row) as Map<String, dynamic>?;
    if (key == null || key['revoked_at'] != null) return null;
    final person = key['person'] as Map<String, dynamic>;
    if (person['disabled_at'] != null) return null;
    final id = person['id'] as String;
    _apiKeyCache[hash] = (id, DateTime.now());
    unawaited(
      db.service
          .execute(
            r'update ApiKey filter .token_hash = <str>$hash '
            'set { last_used_at := datetime_of_statement() }',
            {'hash': hash},
          )
          .catchError((_) {}),
    );
    return id;
  }

  Future<Response> _apiKeysList(Request r, gel.Client c) async => Response.ok(
    await c.queryJSON(
      'select ApiKey { id, label, prefix, scopes, created_at, last_used_at, '
      'revoked_at } filter not exists .revoked_at order by .created_at desc',
    ),
    headers: _jsonHeaders,
  );

  Future<Response> _apiKeysCreate(Request r, gel.Client c) async {
    final b = await _body(r);
    final label = (b['label'] as String?)?.trim();
    if (label == null || label.isEmpty) {
      return _error(400, 'bad_request', 'label required');
    }
    final minted = _apiKeys.mint();
    final json = await c.querySingleJSON(
      r'''
      select (insert ApiKey {
        person := assert_exists(global current_person),
        label := <str>$label,
        token_hash := <str>$hash,
        prefix := <str>$prefix,
        scopes := <array<str>>$scopes,
      }) { id, label, prefix, scopes, created_at }
      ''',
      {
        'label': label,
        'hash': minted.hash,
        'prefix': minted.prefix,
        'scopes':
            (b['scopes'] as List<dynamic>?)?.cast<String>() ??
            const ['memory', 'chat'],
      },
    );
    final row = jsonDecode(json) as Map<String, dynamic>;
    // The only time the token is ever returned.
    return Response(
      201,
      body: jsonEncode({...row, 'token': minted.token}),
      headers: _jsonHeaders,
    );
  }

  Future<Response> _apiKeysRevoke(Request r, gel.Client c) async {
    await c.execute(
      r'update ApiKey filter .id = <uuid>$id '
      'set { revoked_at := datetime_of_statement() }',
      {'id': r.params['id']},
    );
    _apiKeyCache.clear();
    return Response(204);
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
    final id = await _upsertMemory(
      c,
      kind: b['kind'] as String? ?? 'note',
      title: b['title'] as String?,
      body: b['body'] as String?,
      occurredAt: b['occurred_at'] == null
          ? DateTime.now().toUtc()
          : DateTime.parse(b['occurred_at'] as String),
      source: b['source'] as String? ?? 'app',
      sourceId:
          b['source_id'] as String? ?? _digest('${b['title']}${b['body']}'),
    );
    final full = await c.querySingleJSON(queries['memory_get'], {'id': id});
    return Response.ok(full, headers: _jsonHeaders);
  }

  /// Insert-or-update, then embed inline when Ollama is configured (so search
  /// works the moment a memory lands) and kick the `embed` job for anything
  /// the inline pass missed.
  Future<String> _upsertMemory(
    gel.Client c, {
    required String kind,
    required String? title,
    required String? body,
    required DateTime occurredAt,
    required String source,
    required String sourceId,
  }) async {
    final json = await c.querySingleJSON(queries['memory_upsert'], {
      'kind': kind,
      'title': title,
      'body': body,
      'occurred_at': occurredAt,
      'source': source,
      'source_id': sourceId,
    });
    final id = (jsonDecode(json) as Map<String, dynamic>)['id'] as String;
    var embedded = false;
    if (embeddings case final emb?) {
      try {
        final vector = await emb.embed(
          [if (title != null) title, if (body != null) body].join('\n').trim(),
        );
        await c.execute(
          r'''
          update MemoryItem filter .id = <uuid>$id set {
            embedding := <Embedding><array<float32>>$vector,
            embedded_at := datetime_of_statement(),
            embedding_model := <str>$model,
          }
          ''',
          {'id': id, 'vector': vector, 'model': emb.model},
        );
        embedded = true;
      } on Object {
        embedded = false;
      }
    }
    if (!embedded) {
      await _enqueue(c, 'embed', {'memory_id': id}, subjectId: id);
    }
    return id;
  }

  Future<Response> _memorySearch(Request r, gel.Client c) async {
    final b = await _body(r);
    final q = b['q'] as String?;
    if (q == null || q.trim().isEmpty) {
      return _error(400, 'bad_request', 'q required');
    }
    final limit = (b['limit'] as int? ?? 20).clamp(1, 100);
    return Response.ok(
      jsonEncode(await _searchMemory(c, q, limit)),
      headers: _jsonHeaders,
    );
  }

  /// Semantic when embeddings are on, keyword otherwise. Either way the
  /// result shape is the same, so callers never care.
  Future<List<Map<String, dynamic>>> _searchMemory(
    gel.Client c,
    String q,
    int limit,
  ) async {
    if (embeddings case final emb?) {
      try {
        final vector = await emb.embed(q);
        final rows = jsonDecode(
          await c.queryJSON(queries['memory_search'], {
            'embedding': vector,
            'limit': limit,
          }),
        ) as List<dynamic>;
        if (rows.isNotEmpty) return rows.cast<Map<String, dynamic>>();
      } on Object {
        // fall through to keywords
      }
    }
    final rows = jsonDecode(
      await c.queryJSON(queries['memory_text_search'], {
        'q': q.trim(),
        'limit': limit,
      }),
    ) as List<dynamic>;
    return rows.cast<Map<String, dynamic>>();
  }

  // ---- positions / places / presence ----------------------------------------

  Future<Response> _positions(Request r, gel.Client c) async {
    final b = await _body(r);
    final points = b['points'] as List<dynamic>? ?? const [];
    if (points.isEmpty) return _json({'inserted': 0, 'places': 0});
    // The gel client JSON-encodes `json` arguments itself; pass the value.
    final inserted = await c.query(queries['position_insert_many'], {
      'points': points,
    });
    final places = await _attachPlaces(c, points.cast<Map<String, dynamic>>());
    await _enqueue(c, 'derive-presence', {
      'count': inserted.length,
    }, options: const SendOptions(singletonKey: 'presence'));
    return _json({'inserted': inserted.length, 'places': places});
  }

  /// Resolves the cells these points fall in to `Place`s (cache first, then
  /// the geocoder), links the positions, and upserts `Presence` per
  /// (day, place). Bounded to a handful of lookups per batch because
  /// Nominatim allows one request a second.
  Future<int> _attachPlaces(
    gel.Client c,
    List<Map<String, dynamic>> points,
  ) async {
    final byCell = <String, List<Map<String, dynamic>>>{};
    for (final p in points) {
      final lat = (p['lat'] as num).toDouble();
      final lng = (p['lng'] as num).toDouble();
      byCell.putIfAbsent(Geocoder.gridKey(lat, lng), () => []).add(p);
    }
    var resolved = 0;
    for (final entry in byCell.entries.take(6)) {
      final sample = entry.value.first;
      final lat = (sample['lat'] as num).toDouble();
      final lng = (sample['lng'] as num).toDouble();
      final place = await _placeFor(c, lat, lng);
      if (place == null) continue;
      resolved++;
      final placeId = place['id'] as String;
      const half = 0.0006; // ~65 m, matches the 3-decimal grid
      await c.execute(
        r'''
        update Position
        filter .owner.id = global current_person_id and not exists .place
          and .lat >= <float64>$lat0 and .lat <= <float64>$lat1
          and .lng >= <float64>$lng0 and .lng <= <float64>$lng1
        set { place := assert_exists((select Place filter .id = <uuid>$place)) }
        ''',
        {
          'lat0': lat - half,
          'lat1': lat + half,
          'lng0': lng - half,
          'lng1': lng + half,
          'place': placeId,
        },
      );
      // Presence: one row per (day, place).
      final byDay = <String, List<DateTime>>{};
      for (final p in entry.value) {
        final at = DateTime.parse(p['at'] as String).toUtc();
        byDay
            .putIfAbsent(at.toIso8601String().substring(0, 10), () => [])
            .add(at);
      }
      for (final d in byDay.entries) {
        d.value.sort();
        await c.execute(
          r'''
          insert Presence {
            owner := assert_exists(global current_person),
            day := <cal::local_date><str>$day,
            place := assert_exists((select Place filter .id = <uuid>$place)),
            first_seen := <datetime>$first,
            last_seen := <datetime>$last,
            sample_count := <int32>$n,
          }
          unless conflict on ((.owner, .day, .place))
          else (
            update Presence set {
              first_seen := min({.first_seen, <datetime>$first}),
              last_seen := max({.last_seen, <datetime>$last}),
              sample_count := .sample_count + <int32>$n,
              updated_at := datetime_of_statement(),
            }
          )
          ''',
          {
            'day': d.key,
            'place': placeId,
            'first': d.value.first,
            'last': d.value.last,
            'n': d.value.length,
          },
        );
      }
    }
    return resolved;
  }

  /// A `Place` within ~65 m of the point: an existing row if we have one,
  /// otherwise a fresh geocode. Null when the geocoder has nothing.
  Future<Map<String, dynamic>?> _placeFor(
    gel.Client c,
    double lat,
    double lng,
  ) async {
    const half = 0.0006;
    final hit = await c.querySingleJSON(
      r'''
      select assert_single((select Place { id, name, city, region, country, lat, lng }
        filter .lat >= <float64>$lat0 and .lat <= <float64>$lat1
           and .lng >= <float64>$lng0 and .lng <= <float64>$lng1
        order by (math::abs(.lat - <float64>$lat) + math::abs(.lng - <float64>$lng)) asc
        limit 1))
      ''',
      {
        'lat0': lat - half,
        'lat1': lat + half,
        'lng0': lng - half,
        'lng1': lng + half,
        'lat': lat,
        'lng': lng,
      },
    );
    if (hit != 'null') return jsonDecode(hit) as Map<String, dynamic>;
    final GeoPlace? geo;
    try {
      geo = await geocoder.reverse(lat, lng);
    } on Object {
      return null;
    }
    if (geo == null) return null;
    return _storePlace(c, geo, snapTo: (lat, lng));
  }

  /// Insert the geocoder's answer, or return the row that already has this
  /// provider id. `snapTo` records the queried coordinate rather than the
  /// provider's centroid so the ~65 m cache lookup finds it again.
  Future<Map<String, dynamic>> _storePlace(
    gel.Client c,
    GeoPlace geo, {
    (double, double)? snapTo,
  }) async {
    final json = await c.querySingleJSON(
      r'''
      select (
        insert Place {
          name := <str>$name,
          city := <optional str>$city,
          region := <optional str>$region,
          country := <optional str>$country,
          lat := <float64>$lat,
          lng := <float64>$lng,
          provider := <str>$provider,
          provider_id := <str>$provider_id,
        }
        unless conflict on ((.provider, .provider_id))
        else (select Place)
      ) { id, name, city, region, country, lat, lng }
      ''',
      {
        ...geo.toJson(),
        if (snapTo != null) ...{'lat': snapTo.$1, 'lng': snapTo.$2},
      },
    );
    return jsonDecode(json) as Map<String, dynamic>;
  }

  Future<Response> _placesReverse(Request r, gel.Client c) async {
    final lat = double.tryParse(r.url.queryParameters['lat'] ?? '');
    final lng = double.tryParse(r.url.queryParameters['lng'] ?? '');
    if (lat == null || lng == null) {
      return _error(400, 'bad_request', 'lat and lng required');
    }
    final place = await _placeFor(c, lat, lng);
    return place == null
        ? _error(404, 'not_found', 'no place for that point')
        : _json(place);
  }

  Future<Response> _placesSearch(Request r, gel.Client c) async {
    final q = r.url.queryParameters['q']?.trim();
    if (q == null || q.isEmpty) return _error(400, 'bad_request', 'q required');
    final results = await geocoder.search(q);
    final stored = <Map<String, dynamic>>[];
    for (final g in results) {
      stored.add(await _storePlace(c, g));
    }
    return _json(stored);
  }

  Future<Response> _placesRecent(Request r, gel.Client c) {
    final days = int.tryParse(r.url.queryParameters['days'] ?? '') ?? 30;
    return _many(c, 'places_recent', {
      'since': _localDate(
        DateTime.now().toUtc().subtract(Duration(days: days)),
      ),
      'limit': 200,
    });
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

  // ---- chat -----------------------------------------------------------------

  Future<Response> _chatSessions(Request r, gel.Client c) =>
      _many(c, 'chat_sessions', {'limit': 100});

  Future<Response> _chatCreate(Request r, gel.Client c) async {
    final b = await _body(r);
    final json = await c.querySingleJSON(
      r'''
      select (insert ChatSession {
        owner := assert_exists(global current_person),
        title := <optional str>$title,
      }) { id, title, agent_session_key, created_at, last_message_at,
           message_count := 0 }
      ''',
      {'title': (b['title'] as String?)?.trim()},
    );
    return Response(201, body: json, headers: _jsonHeaders);
  }

  Future<Response> _chatDelete(Request r, gel.Client c) async {
    await c.execute(r'delete ChatSession filter .id = <uuid>$id', {
      'id': r.params['id'],
    });
    return Response(204);
  }

  Future<Response> _chatMessages(Request r, gel.Client c) =>
      _many(c, 'chat_messages', {'session': r.params['id'], 'limit': 500});

  /// One turn. Stores the user message, streams the harness reply as SSE
  /// (`delta`, `tool`, `done`, `error` events), stores the assistant
  /// message when the stream ends.
  Future<Response> _chatSend(Request r, gel.Client c) async {
    final harness = agent;
    if (harness == null) {
      return _error(503, 'agent_unavailable', 'SCORIA_AGENT_URL is not set');
    }
    final sessionId = r.params['id']!;
    final b = await _body(r);
    final content = (b['content'] as String?)?.trim();
    if (content == null || content.isEmpty) {
      return _error(400, 'bad_request', 'content required');
    }
    final sessionJson = await c.querySingleJSON(
      r'''
      select assert_single((select ChatSession { id, title, agent_session_key,
        person := .owner { handle, display_name } }
        filter .id = <uuid>$id))
      ''',
      {'id': sessionId},
    );
    if (sessionJson == 'null') return _error(404, 'not_found', 'no such chat');
    final session = jsonDecode(sessionJson) as Map<String, dynamic>;
    final person = session['person'] as Map<String, dynamic>;

    final userMsg = await _appendMessage(c, sessionId, 'user', content);
    if (session['title'] == null) {
      await c.execute(
        r'update ChatSession filter .id = <uuid>$id set { title := <str>$t }',
        {'id': sessionId, 't': _titleFrom(content)},
      );
    }

    // What the harness sees. OpenClaw keeps its own transcript per `user`,
    // so it gets the system frame and the new turn only.
    final frame = <Map<String, dynamic>>[
      {'role': 'system', 'content': _systemFrame(person)},
    ];
    if (harness.keepsOwnHistory) {
      frame.add({'role': 'user', 'content': content});
    } else {
      final history = jsonDecode(
        await c.queryJSON(queries['chat_messages'], {
          'session': sessionId,
          'limit': 60,
        }),
      ) as List<dynamic>;
      for (final m in history.cast<Map<String, dynamic>>()) {
        if (m['role'] == 'user' || m['role'] == 'assistant') {
          frame.add({'role': m['role'], 'content': m['content']});
        }
      }
    }

    final out = StreamController<List<int>>();
    void emit(String event, Object data) {
      if (out.isClosed) return;
      out.add(utf8.encode('event: $event\ndata: ${jsonEncode(data)}\n\n'));
    }

    unawaited(() async {
      final text = StringBuffer();
      final tools = <Map<String, dynamic>>[];
      String? modelUsed;
      emit('user', userMsg);
      try {
        await for (final ev in harness.stream(
          frame,
          user: 'conv:${session['agent_session_key']}',
        )) {
          switch (ev) {
            case AgentText(text: final t):
              text.write(t);
              emit('delta', {'text': t});
            case AgentToolCall(:final name, :final arguments):
              tools.add({'name': name, 'arguments': arguments});
              emit('tool', {'name': name, 'arguments': arguments});
            case AgentDone(model: final m, :final finishReason):
              modelUsed = m;
              emit('finish', {'model': m, 'reason': finishReason});
          }
        }
        final reply = text.toString().trim();
        final assistant = await _appendMessage(
          c,
          sessionId,
          'assistant',
          reply.isEmpty ? '(no reply)' : reply,
          toolCalls: tools.isEmpty ? null : tools,
          model: modelUsed,
        );
        emit('done', {'message': assistant});
      } on Object catch (e) {
        emit('error', {'message': e.toString()});
      } finally {
        await out.close();
      }
    }());

    return Response.ok(
      out.stream,
      headers: const {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no',
      },
      context: const {'shelf.io.buffer_output': false},
    );
  }

  Future<Map<String, dynamic>> _appendMessage(
    gel.Client c,
    String sessionId,
    String role,
    String content, {
    List<Map<String, dynamic>>? toolCalls,
    String? model,
  }) async {
    final json = await c.querySingleJSON(
      r'''
      with
        s := assert_exists((select ChatSession filter .id = <uuid>$session)),
        next := (max(s.messages.seq) ?? 0) + 1,
        m := (insert ChatMessage {
          owner := assert_exists(global current_person),
          session := s,
          role := <str>$role,
          content := <str>$content,
          tool_calls := <optional json>$tool_calls,
          model := <optional str>$model,
          seq := <int32>next,
        }),
        _ := (update s set { last_message_at := m.created_at })
      select m { id, role, content, tool_calls, model, seq, created_at }
      ''',
      {
        'session': sessionId,
        'role': role,
        'content': content,
        'tool_calls': toolCalls,
        'model': model,
      },
    );
    return jsonDecode(json) as Map<String, dynamic>;
  }

  String _systemFrame(Map<String, dynamic> person) {
    final name = person['display_name'] ?? person['handle'];
    final now = DateTime.now();
    return 'You are Scoria, ${name}\'s personal assistant with access to their '
        'memory (memory_search / memory_get) and the outside world (web search, '
        'web fetch). The signed-in user is "$name" (handle ${person['handle']}). '
        'Current local time: ${now.toIso8601String()} (${now.timeZoneName}). '
        'For anything about the user\'s life, people, places, plans or past, '
        'search memory before answering. For facts about the world, use the web. '
        'Be accurate; say when you do not know. Keep answers concise and '
        'conversational; this is a chat on a phone.';
  }

  static String _titleFrom(String content) {
    final oneLine = content.replaceAll(RegExp(r'\s+'), ' ').trim();
    return oneLine.length <= 60 ? oneLine : '${oneLine.substring(0, 57)}…';
  }

  // ---- Companion Intelligence memory-plugin contract -----------------------

  /// L0 profile block: who the user is, where they have been, what is recent.
  Future<Response> _ciContext(Request r, gel.Client c) async {
    final me = jsonDecode(
      await c.querySingleJSON(queries['me']),
    ) as Map<String, dynamic>?;
    final recent = jsonDecode(
      await c.queryJSON(queries['memory_feed'], {'before': null, 'limit': 8}),
    ) as List<dynamic>;
    final places = jsonDecode(
      await c.queryJSON(queries['places_recent'], {
        'since': _localDate(
          DateTime.now().toUtc().subtract(const Duration(days: 14)),
        ),
        'limit': 12,
      }),
    ) as List<dynamic>;
    final lines = <String>[
      '# Scoria memory profile',
      if (me != null)
        'User: ${me['display_name'] ?? me['handle']} (handle ${me['handle']})',
      'Now: ${DateTime.now().toIso8601String()}',
    ];
    if (places.isNotEmpty) {
      lines.add('Recent places (last 14 days):');
      for (final p in places.cast<Map<String, dynamic>>()) {
        final place = p['place'] as Map<String, dynamic>;
        lines.add(
          '- ${p['day']}: ${place['name']}'
          '${place['city'] != null ? ', ${place['city']}' : ''}',
        );
      }
    }
    if (recent.isNotEmpty) {
      lines.add('Recent memories:');
      for (final m in recent.cast<Map<String, dynamic>>()) {
        lines.add(_memoryLine(m));
      }
    }
    return _json({'block': lines.join('\n')});
  }

  Future<Response> _ciRecall(Request r, gel.Client c) async {
    final b = await _body(r);
    final q = (b['query'] as String?)?.trim();
    if (q == null || q.isEmpty) return _json({'block': ''});
    final limit = (b['maxResults'] as int? ?? 8).clamp(1, 20);
    final rows = await _searchMemory(c, q, limit);
    final block = rows.isEmpty
        ? 'No memories matched "$q".'
        : rows.map(_memoryLine).join('\n');
    return _json({'block': block, 'count': rows.length});
  }

  Future<Response> _ciWrite(Request r, gel.Client c) async {
    final b = await _body(r);
    final content = (b['content'] as String?)?.trim();
    if (content == null || content.isEmpty) {
      return _error(400, 'bad_request', 'content required');
    }
    final id = await _upsertMemory(
      c,
      kind: 'note',
      title: (b['title'] as String?)?.trim() ?? _titleFrom(content),
      body: content,
      occurredAt: DateTime.now().toUtc(),
      source: (b['source'] as String?) ?? 'openclaw',
      sourceId: _digest(content),
    );
    return _json({'ok': true, 'id': id});
  }

  /// Passive capture: the plugin posts each completed exchange. Stored as
  /// one `conversation` memory per exchange, deduped by content hash.
  Future<Response> _ciTurn(Request r, gel.Client c) async {
    final b = await _body(r);
    final messages = (b['messages'] as List<dynamic>? ?? const [])
        .cast<Map<String, dynamic>>()
        .where((m) => m['role'] == 'user' || m['role'] == 'assistant')
        .toList();
    if (messages.isEmpty) return _json({'ok': true, 'stored': 0});
    final platform = b['platform'] as String? ?? 'openclaw';
    final sessionId = b['sessionId'] as String? ?? '';
    final transcript = messages
        .map((m) => '${m['role']}: ${(m['content'] as String).trim()}')
        .join('\n\n');
    final firstUser = messages.firstWhere(
      (m) => m['role'] == 'user',
      orElse: () => messages.first,
    );
    final id = await _upsertMemory(
      c,
      kind: 'conversation',
      title: _titleFrom(firstUser['content'] as String),
      body: transcript,
      occurredAt: DateTime.now().toUtc(),
      source: 'openclaw:$platform',
      sourceId: _digest('$sessionId\n$transcript'),
    );
    return _json({'ok': true, 'stored': 1, 'id': id});
  }

  static String _memoryLine(Map<String, dynamic> m) {
    final when = (m['occurred_at'] as String).substring(0, 10);
    final body = (m['body'] as String?)?.replaceAll(RegExp(r'\s+'), ' ');
    final snippet = body == null
        ? ''
        : ': ${body.length > 220 ? '${body.substring(0, 217)}…' : body}';
    final place = m['place'] as Map<String, dynamic>?;
    final where = place == null ? '' : ' @ ${place['name']}';
    return '- [$when ${m['kind']}] ${m['title'] ?? '(untitled)'}$where$snippet';
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

  static String _digest(String s) =>
      sha1.convert(utf8.encode(s)).toString().substring(0, 24);

  static String _localDate(DateTime d) => d.toIso8601String().substring(0, 10);

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
    } on gel.CardinalityViolationError catch (e) {
      return _error(404, 'not_found', e.message);
    } on FormatException catch (e) {
      return _error(400, 'bad_request', e.message);
    }
  };
}

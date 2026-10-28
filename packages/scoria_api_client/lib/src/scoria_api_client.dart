import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:scoria_api_client/src/scoria_api_exception.dart';
import 'package:scoria_models/scoria_models.dart';

/// Supplies the current bearer token, or null when signed out.
typedef TokenProvider = String? Function();

/// Client for scoria-api.
///
/// The server applies Napalm policies as the signed-in person. This client
/// only carries the token; it never decides what is visible.
class ScoriaApiClient {
  ScoriaApiClient({
    required Uri baseUrl,
    required TokenProvider tokenProvider,
    http.Client? httpClient,
  }) : _baseUrl = baseUrl,
       _token = tokenProvider,
       _http = httpClient ?? http.Client();

  Uri _baseUrl;
  final TokenProvider _token;

  /// Where the server is. Settable so the app can point at a LAN address
  /// chosen at sign-in without rebuilding.
  Uri get baseUrl => _baseUrl;
  set baseUrl(Uri value) => _baseUrl = value;

  /// `GET /health`: reachable, and which optional parts are on.
  Future<Map<String, dynamic>> health() async =>
      (await _get('/health')) as Map<String, dynamic>;
  final http.Client _http;

  // ---- auth ---------------------------------------------------------------

  Future<Session> signIn({
    required String handle,
    required String password,
  }) async {
    final json = await _post('/auth/signin', {
      'handle': handle,
      'password': password,
    });
    return Session.fromJson(json as Map<String, dynamic>);
  }

  Future<Person> me() async =>
      Person.fromJson(await _get('/me') as Map<String, dynamic>);

  // ---- memory -------------------------------------------------------------

  Future<List<MemoryItem>> memoryFeed({
    DateTime? before,
    int limit = 50,
  }) async {
    final json = await _get(
      '/memory',
      query: {
        if (before != null) 'before': before.toUtc().toIso8601String(),
        'limit': '$limit',
      },
    );
    return _list(json, MemoryItem.fromJson);
  }

  Future<MemoryItem?> memoryGet(String id) async {
    final json = await _get('/memory/$id');
    return json == null
        ? null
        : MemoryItem.fromJson(json as Map<String, dynamic>);
  }

  Future<MemoryItem> memoryUpsert(MemoryUpsert input) async {
    final json = await _post('/memory', input.toJson());
    return MemoryItem.fromJson(json as Map<String, dynamic>);
  }

  Future<List<MemoryItem>> memorySearch(String q, {int limit = 20}) async {
    final json = await _post('/memory/search', {'q': q, 'limit': limit});
    return _list(json, MemoryItem.fromJson);
  }

  // ---- positions ----------------------------------------------------------

  Future<int> pushPositions(List<PositionPoint> points) async {
    final json = await _post('/positions', {
      'points': points.map((p) => p.toJson()).toList(),
    });
    return (json as Map<String, dynamic>)['inserted'] as int;
  }

  Future<List<PresenceOverlap>> presenceOverlap(String otherPersonId) async {
    final json = await _get('/presence/overlap/$otherPersonId');
    return _list(json, PresenceOverlap.fromJson);
  }

  // ---- jobs ---------------------------------------------------------------

  Future<List<JobRecord>> jobs({
    List<JobState>? states,
    int limit = 100,
  }) async {
    final json = await _get(
      '/jobs',
      query: {
        if (states != null) 'states': states.map((s) => s.name).join(','),
        'limit': '$limit',
      },
    );
    return _list(json, JobRecord.fromJson);
  }

  // ---- places -------------------------------------------------------------

  Future<Place?> placeReverse(double lat, double lng) async {
    try {
      final json = await _get(
        '/places/reverse',
        query: {'lat': '$lat', 'lng': '$lng'},
      );
      return Place.fromJson(json as Map<String, dynamic>);
    } on ScoriaApiException catch (e) {
      if (e.statusCode == 404) return null;
      rethrow;
    }
  }

  Future<List<Place>> placeSearch(String q) async =>
      _list(await _get('/places/search', query: {'q': q}), Place.fromJson);

  // ---- chat ---------------------------------------------------------------

  Future<List<ChatSession>> chatSessions() async =>
      _list(await _get('/chat/sessions'), ChatSession.fromJson);

  Future<ChatSession> chatCreate({String? title}) async => ChatSession.fromJson(
    await _post('/chat/sessions', {if (title != null) 'title': title})
        as Map<String, dynamic>,
  );

  Future<void> chatDelete(String sessionId) =>
      _delete('/chat/sessions/$sessionId');

  Future<List<ChatMessage>> chatMessages(String sessionId) async => _list(
    await _get('/chat/sessions/$sessionId/messages'),
    ChatMessage.fromJson,
  );

  /// Sends one turn and streams the reply. The stream is the server's SSE
  /// feed decoded into [ChatStreamEvent]s; it completes after [ChatDone] or
  /// [ChatFailed].
  Stream<ChatStreamEvent> chatSend(String sessionId, String content) async* {
    final req = http.Request(
      'POST',
      _baseUrl.resolve('chat/sessions/$sessionId/messages'),
    )
      ..headers.addAll({..._headers, 'accept': 'text/event-stream'})
      ..body = jsonEncode({'content': content});
    final res = await _http.send(req);
    if (res.statusCode != 200) {
      final body = await res.stream.bytesToString();
      final err = body.isEmpty ? null : jsonDecode(body);
      throw ScoriaApiException(
        res.statusCode,
        err is Map<String, dynamic>
            ? err['message'] as String? ?? 'chat failed'
            : 'chat failed',
        code: err is Map<String, dynamic> ? err['code'] as String? : null,
      );
    }
    String? event;
    final data = StringBuffer();
    await for (final line in res.stream
        .transform(utf8.decoder)
        .transform(const LineSplitter())) {
      if (line.startsWith('event:')) {
        event = line.substring(6).trim();
      } else if (line.startsWith('data:')) {
        data.write(line.substring(5).trim());
      } else if (line.isEmpty && event != null) {
        final ev = _chatEvent(event, data.toString());
        event = null;
        data.clear();
        if (ev != null) yield ev;
        if (ev is ChatDone || ev is ChatFailed) return;
      }
    }
  }

  static ChatStreamEvent? _chatEvent(String event, String raw) {
    final json = raw.isEmpty ? const <String, dynamic>{} : jsonDecode(raw);
    final map = json is Map<String, dynamic> ? json : const <String, dynamic>{};
    switch (event) {
      case 'user':
        return ChatUserStored(ChatMessage.fromJson(map));
      case 'delta':
        return ChatDelta(map['text'] as String? ?? '');
      case 'tool':
        return ChatToolUsed(
          ChatToolCall(
            name: map['name'] as String? ?? '',
            arguments: map['arguments'] as String? ?? '',
          ),
        );
      case 'done':
        return ChatDone(
          ChatMessage.fromJson(map['message'] as Map<String, dynamic>),
        );
      case 'error':
        return ChatFailed(map['message'] as String? ?? 'chat failed');
      default:
        return null; // `finish` and anything newer
    }
  }

  // ---- plumbing -----------------------------------------------------------

  Map<String, String> get _headers => {
    'content-type': 'application/json',
    if (_token() case final t?) 'authorization': 'Bearer $t',
  };

  Future<Object?> _get(String path, {Map<String, String>? query}) async {
    final uri = _baseUrl
        .resolve(path.substring(1))
        .replace(
          queryParameters: query == null || query.isEmpty ? null : query,
        );
    return _decode(await _http.get(uri, headers: _headers));
  }

  Future<Object?> _post(String path, Object body) async {
    final uri = _baseUrl.resolve(path.substring(1));
    return _decode(
      await _http.post(uri, headers: _headers, body: jsonEncode(body)),
    );
  }

  Future<void> _delete(String path) async {
    final uri = _baseUrl.resolve(path.substring(1));
    _decode(await _http.delete(uri, headers: _headers));
  }

  Object? _decode(http.Response r) {
    final body = r.body.isEmpty ? null : jsonDecode(r.body);
    if (r.statusCode >= 200 && r.statusCode < 300) return body;
    final err = body is Map<String, dynamic> ? body : const <String, dynamic>{};
    throw ScoriaApiException(
      r.statusCode,
      err['message'] as String? ?? r.reasonPhrase ?? 'request failed',
      code: err['code'] as String?,
    );
  }

  List<T> _list<T>(Object? json, T Function(Map<String, dynamic>) f) =>
      (json as List<dynamic>? ?? const [])
          .cast<Map<String, dynamic>>()
          .map(f)
          .toList();

  void close() => _http.close();
}

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// One streamed increment from the harness.
sealed class AgentEvent {
  const AgentEvent();
}

/// Assistant text delta.
final class AgentText extends AgentEvent {
  const AgentText(this.text);
  final String text;
}

/// A tool the model invoked.
final class AgentToolCall extends AgentEvent {
  const AgentToolCall(this.id, this.name, this.arguments);
  final String id;
  final String name;
  final String arguments;
}

/// Terminal event. `model` is whatever the harness reports it used.
final class AgentDone extends AgentEvent {
  const AgentDone({this.model, this.finishReason});
  final String? model;
  final String? finishReason;
}

/// Client for an OpenAI-compatible `/v1/chat/completions` endpoint.
///
/// Parasail (`https://api.parasail.io/v1`), Ollama (`http://127.0.0.1:11434`),
/// and OpenClaw (`http://127.0.0.1:18789`) all speak this. OpenClaw is the
/// only one that keeps its own transcript (`model` starts with `openclaw`).
class AgentClient {
  AgentClient({
    required Uri baseUrl,
    required this.model,
    String? token,
    http.Client? httpClient,
    this.timeout = const Duration(minutes: 5),
  }) : _baseUrl = baseUrl,
       _token = token,
       _http = httpClient ?? http.Client();

  final Uri _baseUrl;
  final String model;
  final String? _token;
  final http.Client _http;
  final Duration timeout;

  Map<String, String> get _headers => {
    'content-type': 'application/json',
    'accept': 'text/event-stream',
    if (_token != null) 'authorization': 'Bearer $_token',
  };

  /// True when the harness keeps its own transcript per `user` (OpenClaw
  /// derives a stable session from the OpenAI `user` field). Then only the
  /// new turn is sent; a generic harness gets the whole history.
  bool get keepsOwnHistory => model.startsWith('openclaw');

  /// `https://api.parasail.io/v1` + `chat/completions` must keep `/v1`.
  /// `Uri.resolve` drops the last segment when the path has no trailing slash.
  static Uri _join(Uri base, String child) {
    final s = base.toString();
    return Uri.parse(s.endsWith('/') ? '$s$child' : '$s/$child');
  }

  static Uri completionsUri(Uri base) {
    final path = base.path;
    if (path.endsWith('/v1') || path.endsWith('/v1/')) {
      return _join(base, 'chat/completions');
    }
    return _join(base, 'v1/chat/completions');
  }

  static Uri modelsUri(Uri base) {
    final path = base.path;
    if (path.endsWith('/v1') || path.endsWith('/v1/')) {
      return _join(base, 'models');
    }
    return _join(base, 'v1/models');
  }

  /// Streams a turn. `messages` is in OpenAI shape. `user` is the
  /// conversation key (`conv:<session id>`), reused for the whole chat.
  /// `tools` is the OpenAI tools array; omitted for OpenClaw.
  Stream<AgentEvent> stream(
    List<Map<String, dynamic>> messages, {
    String? user,
    List<Map<String, dynamic>>? tools,
  }) async* {
    Future<http.StreamedResponse> send({required bool withTools}) {
      final req = http.Request('POST', completionsUri(_baseUrl))
        ..headers.addAll(_headers)
        ..body = jsonEncode({
          'model': model,
          'messages': messages,
          'stream': true,
          if (user != null) 'user': user,
          if (withTools && tools != null && tools.isNotEmpty) 'tools': tools,
        });
      return _http.send(req).timeout(timeout);
    }

    var res = await send(withTools: tools != null && tools.isNotEmpty);
    if (res.statusCode == 400 && tools != null && tools.isNotEmpty) {
      final body = await res.stream.bytesToString();
      if (body.toLowerCase().contains('tool')) {
        res = await send(withTools: false);
      } else {
        throw AgentException(res.statusCode, body);
      }
    }
    if (res.statusCode != 200) {
      final body = await res.stream.bytesToString();
      throw AgentException(res.statusCode, body);
    }
    final toolBuffers = <int, ({String id, String name, StringBuffer args})>{};
    String? modelUsed;
    String? finish;
    await for (final line
        in res.stream
            .transform(utf8.decoder)
            .transform(const LineSplitter())
            .timeout(timeout)) {
      if (!line.startsWith('data:')) continue;
      final data = line.substring(5).trim();
      if (data.isEmpty) continue;
      if (data == '[DONE]') break;
      final Map<String, dynamic> chunk;
      try {
        chunk = jsonDecode(data) as Map<String, dynamic>;
      } on FormatException {
        continue;
      }
      modelUsed = chunk['model'] as String? ?? modelUsed;
      final choices = chunk['choices'] as List<dynamic>? ?? const [];
      for (final c in choices) {
        final choice = c as Map<String, dynamic>;
        finish = choice['finish_reason'] as String? ?? finish;
        final delta =
            (choice['delta'] ?? choice['message']) as Map<String, dynamic>?;
        if (delta == null) continue;
        final content = delta['content'];
        if (content is String && content.isNotEmpty) {
          yield AgentText(content);
        }
        final calls = delta['tool_calls'] as List<dynamic>?;
        if (calls != null) {
          for (final tc in calls) {
            final call = tc as Map<String, dynamic>;
            final idx = call['index'] as int? ?? 0;
            final fn = call['function'] as Map<String, dynamic>? ?? const {};
            final existing = toolBuffers[idx];
            final id = call['id'] as String? ?? existing?.id ?? 'call_$idx';
            final name = fn['name'] as String? ?? existing?.name ?? '';
            final buf = existing?.args ?? StringBuffer();
            buf.write(fn['arguments'] as String? ?? '');
            toolBuffers[idx] = (id: id, name: name, args: buf);
          }
        }
      }
    }
    for (final b in toolBuffers.values) {
      yield AgentToolCall(b.id, b.name, b.args.toString());
    }
    yield AgentDone(model: modelUsed, finishReason: finish);
  }

  /// Non-streaming convenience for internal callers (titles, summaries).
  Future<String> complete(
    List<Map<String, dynamic>> messages, {
    String? user,
  }) async {
    final buf = StringBuffer();
    await for (final ev in stream(messages, user: user)) {
      if (ev is AgentText) buf.write(ev.text);
    }
    return buf.toString();
  }

  /// `GET /v1/models`; used by `/health` to report whether the harness is up.
  Future<bool> ping() async {
    try {
      final r = await _http
          .get(
            modelsUri(_baseUrl),
            headers: {if (_token != null) 'authorization': 'Bearer $_token'},
          )
          .timeout(const Duration(seconds: 3));
      return r.statusCode == 200;
    } on Object {
      return false;
    }
  }
}

class AgentException implements Exception {
  AgentException(this.status, this.body);
  final int status;
  final String body;

  @override
  String toString() => 'agent $status: $body';
}

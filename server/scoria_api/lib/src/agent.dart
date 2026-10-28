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

/// A tool the harness invoked (OpenClaw surfaces these as `tool_calls`
/// deltas when the agent's policy allows; many turns have none).
final class AgentToolCall extends AgentEvent {
  const AgentToolCall(this.name, this.arguments);
  final String name;
  final String arguments;
}

/// Terminal event. `model` is whatever the harness reports it used.
final class AgentDone extends AgentEvent {
  const AgentDone({this.model, this.finishReason});
  final String? model;
  final String? finishReason;
}

/// Client for an OpenAI-compatible `/v1/chat/completions` harness. Built for
/// the OpenClaw gateway (`model` is an agent target such as
/// `openclaw/default`, and `x-openclaw-session-key` keeps one gateway
/// session per Scoria chat), but anything speaking the same wire format
/// works, so the harness is swappable by URL.
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

  /// Streams a turn. `messages` is in OpenAI shape. `user` is the
  /// conversation key (`conv:<session id>`), reused for the whole chat.
  Stream<AgentEvent> stream(
    List<Map<String, dynamic>> messages, {
    String? user,
  }) async* {
    final req = http.Request('POST', _baseUrl.resolve('v1/chat/completions'))
      ..headers.addAll(_headers)
      ..body = jsonEncode({
        'model': model,
        'messages': messages,
        'stream': true,
        if (user != null) 'user': user,
      });
    final res = await _http.send(req).timeout(timeout);
    if (res.statusCode != 200) {
      final body = await res.stream.bytesToString();
      throw AgentException(res.statusCode, body);
    }
    final toolBuffers = <int, ({String name, StringBuffer args})>{};
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
            final buf = toolBuffers.putIfAbsent(
              idx,
              () => (name: fn['name'] as String? ?? '', args: StringBuffer()),
            );
            final name = fn['name'] as String?;
            if (name != null && buf.name.isEmpty) {
              toolBuffers[idx] = (name: name, args: buf.args);
            }
            buf.args.write(fn['arguments'] as String? ?? '');
          }
        }
      }
    }
    for (final b in toolBuffers.values) {
      yield AgentToolCall(b.name, b.args.toString());
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
            _baseUrl.resolve('v1/models'),
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

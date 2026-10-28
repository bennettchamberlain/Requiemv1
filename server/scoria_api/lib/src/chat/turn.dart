import 'package:gel/gel.dart' as gel;
import 'package:scoria_api/src/agent.dart';
import 'package:scoria_api/src/chat/tools.dart';

/// One model round-trip plus tool calls, streamed to the client as SSE
/// payloads (`delta`, `tool`). OpenClaw keeps its own tools; host tools
/// run only for Parasail / Ollama.
Future<({String text, List<Map<String, dynamic>> tools, String? model})>
runChatTurn({
  required AgentClient harness,
  required List<Map<String, dynamic>> frame,
  required ChatToolbox? toolbox,
  required gel.Client db,
  required void Function(String event, Object data) emit,
  String? user,
}) async {
  final messages = [for (final m in frame) Map<String, dynamic>.from(m)];
  final used = <Map<String, dynamic>>[];
  final text = StringBuffer();
  var model = harness.model;
  final tools = toolbox == null || harness.keepsOwnHistory
      ? null
      : toolbox.definitions;

  for (var round = 0; round < 6; round++) {
    final calls = <AgentToolCall>[];
    await for (final ev in harness.stream(messages, user: user, tools: tools)) {
      switch (ev) {
        case AgentText(text: final t):
          text.write(t);
          emit('delta', {'text': t});
        case AgentToolCall():
          calls.add(ev);
        case AgentDone(model: final usedModel, :final finishReason):
          model = usedModel ?? model;
          emit('finish', {'model': model, 'reason': finishReason});
      }
    }
    if (calls.isEmpty || toolbox == null) break;

    messages.add({
      'role': 'assistant',
      'content': text.isEmpty ? null : text.toString(),
      'tool_calls': [
        for (final c in calls)
          {
            'id': c.id,
            'type': 'function',
            'function': {'name': c.name, 'arguments': c.arguments},
          },
      ],
    });
    for (final call in calls) {
      final result = await toolbox.run(db, call.name, call.arguments);
      used.add({
        'name': call.name,
        'arguments': call.arguments,
        'result': result,
      });
      emit('tool', {
        'name': call.name,
        'arguments': call.arguments,
        'result': result,
      });
      messages.add({
        'role': 'tool',
        'tool_call_id': call.id,
        'tool_name': call.name,
        'content': result,
      });
    }
  }

  return (text: text.toString(), tools: used, model: model);
}

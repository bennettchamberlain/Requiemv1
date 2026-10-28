import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:scoria_api/src/config.dart';

/// Starts the local PersonaVoice process and asks it to load weights.
///
/// The HTTP port comes up before the 16 GB model. [start] waits for the
/// port, then kicks a background load and returns. The sidecar keeps
/// weights resident for [Config.voiceKeepAlive] after the last touch.
class VoiceSupervisor {
  VoiceSupervisor(this.config);

  final Config config;
  Process? _child;
  Future<void>? _spawn;

  Uri get _base => Uri.parse(config.voiceUrl);

  Future<Map<String, dynamic>?> peek() async {
    try {
      final r = await http
          .get(Uri.parse('${config.voiceUrl}/api/status'))
          .timeout(const Duration(milliseconds: 800));
      if (r.statusCode != 200) return null;
      final body = jsonDecode(r.body);
      return body is Map<String, dynamic> ? body : null;
    } on Object {
      return null;
    }
  }

  /// Spawn if needed, start a load if the engine is cold, extend the hold.
  Future<Map<String, dynamic>> start() async {
    var remote = await peek();
    if (remote == null) {
      await (_spawn ??= _spawnSidecar());
      remote = await _waitForPort();
    }
    if (remote == null) {
      throw StateError(
        'PersonaVoice did not bind ${_base.origin}. '
        'Is ${config.voiceBin} installed?',
      );
    }
    final engine = remote['engine'] is Map
        ? Map<String, dynamic>.from(remote['engine'] as Map)
        : const <String, dynamic>{};
    if (engine['loaded'] != true) {
      unawaited(_kickLoad());
      await Future<void>.delayed(const Duration(milliseconds: 250));
      remote = await peek() ?? remote;
    } else {
      unawaited(_kickLoad());
    }
    return _wrap(remote);
  }

  Future<Map<String, dynamic>> stop() async {
    try {
      await http
          .post(
            Uri.parse('${config.voiceUrl}/api/engine'),
            headers: const {'content-type': 'application/json'},
            body: jsonEncode({'on': false}),
          )
          .timeout(const Duration(seconds: 20));
    } on Object {
      // Process may already be down.
    }
    return _wrap(await peek());
  }

  Map<String, dynamic> _wrap(Map<String, dynamic>? remote) {
    final engine = remote?['engine'] is Map
        ? Map<String, dynamic>.from(remote!['engine'] as Map)
        : const <String, dynamic>{};
    return {
      'available': remote != null,
      'url': config.voiceUrl,
      'starting': engine['loading'] == true,
      if (remote != null) ...remote,
    };
  }

  Future<void> _kickLoad() async {
    try {
      await http
          .post(
            Uri.parse('${config.voiceUrl}/api/engine'),
            headers: const {'content-type': 'application/json'},
            body: jsonEncode({'on': true}),
          )
          .timeout(const Duration(seconds: 8));
    } on Object {
      // Load continues on the sidecar; status polling sees it.
    }
  }

  Future<void> _spawnSidecar() async {
    final bin = config.voiceBin;
    if (bin == null || !File(bin).existsSync()) {
      throw StateError(
        'No scoria-voice binary. Set VOICE_BIN or install the '
        'sidecar venv under server/scoria_voice.',
      );
    }
    final state = Directory(
      '${Platform.environment['HOME']}/.local/state/scoria-voice',
    );
    state.createSync(recursive: true);
    final log = File('${state.path}/sidecar.log');
    final sink = log.openWrite(mode: FileMode.append);
    final port = _base.hasPort ? _base.port : 8998;
    final env = Map<String, String>.from(Platform.environment)
      ..['VOICE_HOST'] = '0.0.0.0'
      ..['VOICE_PORT'] = '$port'
      ..['VOICE_AUTOLOAD'] = '1'
      ..['VOICE_KEEP_ALIVE_SEC'] = '${config.voiceKeepAlive.inSeconds}'
      ..['SCORIA_API_URL'] =
          Platform.environment['SCORIA_API_URL'] ??
          'http://127.0.0.1:${config.port}';
    var dead = false;
    _child = await Process.start(
      bin,
      const [],
      workingDirectory: config.voiceWorkdir,
      environment: env,
      mode: ProcessStartMode.normal,
    );
    _child!.stdout.listen(sink.add);
    _child!.stderr.listen(sink.add);
    unawaited(
      _child!.exitCode.then((code) {
        dead = true;
        _child = null;
        _spawn = null;
        sink.writeln('sidecar exited $code');
        unawaited(sink.close());
      }),
    );
    _spawnDead = () => dead;
  }

  bool Function() _spawnDead = () => false;

  Future<Map<String, dynamic>?> _waitForPort() async {
    final deadline = DateTime.now().add(const Duration(seconds: 25));
    while (DateTime.now().isBefore(deadline)) {
      final remote = await peek();
      if (remote != null) return remote;
      if (_spawnDead()) break;
      await Future<void>.delayed(const Duration(milliseconds: 400));
    }
    return peek();
  }
}

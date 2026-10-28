import 'dart:convert';
import 'dart:io';

import 'package:scoria_jobs/scoria_jobs.dart';

/// Runs a Python module in [workdir] with the job payload on stdin.
///
/// Used for ETL workers and the weaver swarm so the Dart job runner can
/// fan out without owning One/Parasail SDK code.
class PythonJob {
  PythonJob({
    required this.python,
    required this.module,
    required this.workdir,
    Map<String, String>? environment,
  }) : environment = environment ?? const {};

  final String python;
  final String module;
  final String workdir;
  final Map<String, String> environment;

  Future<Map<String, Object?>> run(Job job) async {
    final proc = await Process.start(python, [
      '-m',
      module,
    ], workingDirectory: workdir, environment: {...Platform.environment, ...environment});
    proc.stdin.write(jsonEncode({'job_id': job.id, 'name': job.name, 'data': job.data}));
    await proc.stdin.close();
    final stdout = await proc.stdout.transform(utf8.decoder).join();
    final stderr = await proc.stderr.transform(utf8.decoder).join();
    final code = await proc.exitCode;
    if (code != 0) {
      throw StateError('python $module exited $code: $stderr$stdout');
    }
    if (stdout.trim().isEmpty) return const {'ok': true};
    try {
      final decoded = jsonDecode(stdout.trim().split('\n').last);
      return decoded is Map<String, Object?>
          ? decoded
          : decoded is Map
          ? decoded.cast<String, Object?>()
          : {'ok': true, 'out': decoded};
    } on FormatException {
      return {'ok': true, 'out': stdout.trim()};
    }
  }
}

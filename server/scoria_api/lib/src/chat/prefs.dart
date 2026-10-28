import 'dart:convert';
import 'dart:io';

/// Per-person tool settings. Secrets stay on disk, not in Gel, so a
/// You.com key can be set from the app without a schema change.
class ToolPrefs {
  const ToolPrefs({this.youKey, this.disabled = const {}});

  final String? youKey;
  final Set<String> disabled;

  bool enabled(String name) => !disabled.contains(name);

  ToolPrefs copyWith({
    String? youKey,
    bool clearYouKey = false,
    Set<String>? disabled,
  }) => ToolPrefs(
    youKey: clearYouKey ? null : (youKey ?? this.youKey),
    disabled: disabled ?? this.disabled,
  );

  Map<String, dynamic> toJson() => {
    if (youKey != null) 'you_key': youKey,
    if (disabled.isNotEmpty) 'disabled': disabled.toList()..sort(),
  };

  factory ToolPrefs.fromJson(Map<String, dynamic> json) => ToolPrefs(
    youKey: _blank(json['you_key'] as String?),
    disabled: {
      for (final n in json['disabled'] as List<dynamic>? ?? const [])
        n.toString(),
    },
  );

  static String? _blank(String? s) =>
      s == null || s.trim().isEmpty ? null : s.trim();
}

class ToolPrefsStore {
  ToolPrefsStore(this.root);

  final Directory root;

  File _file(String personId) {
    final safe = personId.replaceAll(RegExp(r'[^a-zA-Z0-9._-]'), '_');
    return File('${root.path}/$safe.json');
  }

  Future<ToolPrefs> read(String personId) async {
    final f = _file(personId);
    if (!f.existsSync()) return const ToolPrefs();
    try {
      return ToolPrefs.fromJson(
        jsonDecode(await f.readAsString()) as Map<String, dynamic>,
      );
    } on Object {
      return const ToolPrefs();
    }
  }

  Future<ToolPrefs> write(String personId, ToolPrefs prefs) async {
    if (!root.existsSync()) {
      await root.create(recursive: true);
    }
    final f = _file(personId);
    if (prefs.youKey == null && prefs.disabled.isEmpty) {
      if (f.existsSync()) await f.delete();
      return prefs;
    }
    await f.writeAsString('${const JsonEncoder.withIndent('  ').convert(prefs.toJson())}\n');
    return prefs;
  }
}

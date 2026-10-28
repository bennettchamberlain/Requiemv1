import 'package:bloc/bloc.dart';
import 'package:scoria_app/config/app_config.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Which scoria-api the app talks to. Defaults to the build-time
/// [AppConfig.apiUrl]; the sign-in screen lets you point at a LAN address
/// (your Mac/Linux box from a phone) and remembers it.
class ServerCubit extends Cubit<String> {
  new({SharedPreferences? prefs, String? initial})
    : _prefs = prefs,
      super(initial ?? prefs?.getString(_key) ?? AppConfig.apiUrl);

  static const _key = 'scoria.server_url';
  final SharedPreferences? _prefs;

  Uri get uri => _normalise(state);

  Future<void> set(String url) async {
    final value = url.trim();
    if (value.isEmpty) return;
    emit(value);
    await _prefs?.setString(_key, value);
  }

  /// `192.168.1.5:8787` -> `http://192.168.1.5:8787/`; keeps a scheme if
  /// one is given; guarantees the trailing slash `Uri.resolve` needs.
  static Uri _normalise(String raw) {
    var s = raw.trim();
    if (!s.contains('://')) s = 'http://$s';
    if (!s.endsWith('/')) s = '$s/';
    return Uri.parse(s);
  }
}

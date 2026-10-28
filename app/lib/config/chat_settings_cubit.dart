import 'package:bloc/bloc.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Which inference the next chat turn uses. `auto` follows the server
/// (Parasail, then Ollama). The other values pin a provider.
class ChatSettingsCubit extends Cubit<String> {
  ChatSettingsCubit({SharedPreferences? prefs, String? initial})
    : _prefs = prefs,
      super(initial ?? prefs?.getString(_key) ?? 'auto');

  static const _key = 'requiem.chat_provider';
  final SharedPreferences? _prefs;

  Future<void> setProvider(String provider) async {
    final value = provider.trim().toLowerCase();
    if (value.isEmpty) return;
    emit(value);
    await _prefs?.setString(_key, value);
  }
}

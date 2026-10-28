import 'package:flutter/widgets.dart';
import 'package:scoria_app/app/app.dart';
import 'package:scoria_app/bootstrap.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  await bootstrap(() => App(prefs: prefs));
}

import 'package:scoria_app/app/app.dart';
import 'package:scoria_app/bootstrap.dart';

Future<void> main() async {
  await bootstrap(() => const App());
}

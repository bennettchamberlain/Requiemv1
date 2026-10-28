/// Build-time configuration. Override with
/// `flutter run --dart-define=SCORIA_API_URL=http://host:8090`.
abstract final class AppConfig {
  static const apiUrl = String.fromEnvironment(
    'SCORIA_API_URL',
    defaultValue: 'http://localhost:8090',
  );
}

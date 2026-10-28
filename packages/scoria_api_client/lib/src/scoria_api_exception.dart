/// Error from scoria-api. `statusCode` is the HTTP status; `code` is the
/// machine-readable error the server returned, when it did.
class ScoriaApiException implements Exception {
  const ScoriaApiException(this.statusCode, this.message, {this.code});

  final int statusCode;
  final String message;
  final String? code;

  bool get isUnauthorized => statusCode == 401;

  @override
  String toString() => 'ScoriaApiException($statusCode, $code): $message';
}

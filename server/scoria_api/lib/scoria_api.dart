/// scoria-api: the side-effect plane in front of Napalm.
///
/// Napalm (Gel) owns schema, policies, vectors and files. This process owns
/// what a database should not: sign-in, session tokens, ingest, embedding
/// calls, job kicks. Every caller request runs with
/// `global current_person_id` set, so Napalm policies are the authorization.
library;

export 'src/agent.dart';
export 'src/app.dart';
export 'src/auth/api_key.dart';
export 'src/auth/password.dart';
export 'src/auth/session_token.dart';
export 'src/config.dart';
export 'src/db.dart';
export 'src/embeddings.dart';
export 'src/geocoder.dart';
export 'src/queries.dart';

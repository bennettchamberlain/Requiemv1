import 'dart:io';

import 'package:scoria_api/src/auth/password.dart';

void main(List<String> args) {
  stdout.writeln(const Password().hash(args.first));
}

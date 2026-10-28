import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:scoria_app/l10n/l10n.dart';
import 'package:scoria_app/ui/chrome.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

extension PumpApp on WidgetTester {
  Future<void> pumpApp(Widget widget) {
    return pumpWidget(
      ShadApp(
        builder: scoriaMaterialTheme,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: widget,
      ),
    );
  }
}

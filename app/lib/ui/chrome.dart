import 'package:material_ui/material_ui.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

/// Bridges leftover Material widgets (scaffold, ink, refresh) onto the
/// shadcn slate palette. [ShadApp] does not install a `material_ui` theme.
Widget scoriaMaterialTheme(BuildContext context, Widget? child) {
  final scheme = ShadTheme.of(context).colorScheme;
  return Theme(
    data: ThemeData(
      useMaterial3: true,
      scaffoldBackgroundColor: scheme.background,
      dividerColor: scheme.border,
      colorScheme: ColorScheme.light(
        primary: scheme.primary,
        onPrimary: scheme.primaryForeground,
        secondary: scheme.secondary,
        onSecondary: scheme.secondaryForeground,
        surface: scheme.card,
        onSurface: scheme.foreground,
        error: scheme.destructive,
        onError: scheme.destructiveForeground,
        outline: scheme.border,
      ),
    ),
    child: child ?? const SizedBox.shrink(),
  );
}

class ScoriaHeader extends StatelessWidget {
  const new({
    super.key,
    required this.title,
    this.leading,
    this.actions = const [],
  });

  final String title;
  final Widget? leading;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: theme.colorScheme.border)),
      ),
      child: SizedBox(
        height: 52,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(
            children: [
              ?leading,
              Text(title, style: theme.textTheme.h4),
              const Spacer(),
              ...actions,
            ],
          ),
        ),
      ),
    );
  }
}

class ScoriaDivider extends StatelessWidget {
  const new vertical({super.key}) : axis = Axis.vertical;

  const new horizontal({super.key}) : axis = Axis.horizontal;

  final Axis axis;

  @override
  Widget build(BuildContext context) {
    final color = ShadTheme.of(context).colorScheme.border;
    return ColoredBox(
      color: color,
      child: axis == Axis.vertical
          ? const SizedBox(width: 1)
          : const SizedBox(height: 1),
    );
  }
}

/// shadcn/ui has no Skeleton widget in 0.57. Muted blocks pulse the same way.
class ScoriaSkeleton extends StatelessWidget {
  const new({super.key, this.rows = 6});

  final int rows;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        for (var i = 0; i < rows; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _Pulse(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  border: Border.all(color: theme.colorScheme.border),
                  borderRadius: const BorderRadius.all(Radius.circular(8)),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _Bar(color: theme.colorScheme.muted, width: 148),
                      const SizedBox(height: 8),
                      _Bar(color: theme.colorScheme.muted),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class ScoriaFailure extends StatelessWidget {
  const new({super.key, required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ShadAlert.destructive(
                title: const Text('Could not load'),
                description: Text(message),
              ),
              const SizedBox(height: 12),
              ShadButton.outline(
                onPressed: onRetry,
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class ScoriaEmpty extends StatelessWidget {
  const new(this.message, {super.key});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          message,
          textAlign: TextAlign.center,
          style: ShadTheme.of(context).textTheme.muted,
        ),
      ),
    );
  }
}

class _Bar extends StatelessWidget {
  const new({required this.color, this.width});

  final Color color;
  final double? width;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width ?? double.infinity,
      height: 12,
      decoration: BoxDecoration(
        color: color,
        borderRadius: const BorderRadius.all(Radius.circular(6)),
      ),
    );
  }
}

class _Pulse extends StatefulWidget {
  const new({required this.child});

  final Widget child;

  @override
  State<_Pulse> createState() => _PulseState();
}

class _PulseState extends State<_Pulse> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _controller.drive(Tween<double>(begin: 0.45, end: 1)),
      child: widget.child,
    );
  }
}

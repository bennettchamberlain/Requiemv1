import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:material_ui/material_ui.dart';
import 'package:scoria_app/chat/chat.dart';
import 'package:scoria_app/jobs/jobs.dart';
import 'package:scoria_app/memory/memory.dart';
import 'package:scoria_app/tools/tools.dart';
import 'package:scoria_app/session/session.dart';
import 'package:scoria_models/scoria_models.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

/// Shell with one destination per feature. Chat, memory and jobs are live;
/// the rest are stubbed until their server slices exist.
class HomePage extends StatefulWidget {
  const new({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  var _index = 0;

  static const _pages = <Widget>[
    ChatPage(),
    MemoryPage(),
    ToolsPage(),
    JobsPage(),
    // PositionsPage(),   // background location + presence overlap
    // PeoplePage(),      // relationships, tiers, consent grants
    // AsksPage(),        // ask a friend; disclosure ladder
    // SettingsPage(),
  ];

  static const _destinations = <({IconData icon, String label})>[
    (icon: LucideIcons.messageCircle, label: 'Chat'),
    (icon: LucideIcons.brain, label: 'Memory'),
    (icon: LucideIcons.wrench, label: 'Tools'),
    (icon: LucideIcons.listTodo, label: 'Jobs'),
    // Places: LucideIcons.mapPin
    // People: LucideIcons.users
    // Asks:   LucideIcons.messageSquare
  ];

  @override
  Widget build(BuildContext context) {
    final person = context.select<SessionCubit, Person?>(
      (c) => c.state.person,
    );
    final wide = MediaQuery.sizeOf(context).width >= 700;
    final body = IndexedStack(index: _index, children: _pages);

    if (wide) {
      return Scaffold(
        body: Row(
          children: [
            _Sidebar(
              handle: person?.handle,
              index: _index,
              onSelected: (i) => setState(() => _index = i),
            ),
            Expanded(child: body),
          ],
        ),
      );
    }

    return Scaffold(
      body: body,
      bottomNavigationBar: _BottomNav(
        index: _index,
        onSelected: (i) => setState(() => _index = i),
      ),
    );
  }
}

class _Sidebar extends StatelessWidget {
  const new({
    required this.handle,
    required this.index,
    required this.onSelected,
  });

  final String? handle;
  final int index;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final initial = (handle ?? '?').substring(0, 1).toUpperCase();
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(right: BorderSide(color: theme.colorScheme.border)),
      ),
      child: SizedBox(
        width: 220,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  ShadAvatar(
                    null,
                    size: const Size.square(32),
                    placeholder: Text(initial, style: theme.textTheme.small),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      handle ?? 'Scoria',
                      style: theme.textTheme.small,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              for (var i = 0; i < _HomePageState._destinations.length; i++)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: _NavButton(
                    icon: _HomePageState._destinations[i].icon,
                    label: _HomePageState._destinations[i].label,
                    selected: index == i,
                    onPressed: () => onSelected(i),
                  ),
                ),
              const Spacer(),
              const _SignOutButton(),
            ],
          ),
        ),
      ),
    );
  }
}

class _BottomNav extends StatelessWidget {
  const new({required this.index, required this.onSelected});

  final int index;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: theme.colorScheme.background,
        border: Border(top: BorderSide(color: theme.colorScheme.border)),
      ),
      child: SafeArea(
        child: SizedBox(
          height: 64,
          child: Row(
            children: [
              for (var i = 0; i < _HomePageState._destinations.length; i++)
                Expanded(
                  child: _NavButton(
                    icon: _HomePageState._destinations[i].icon,
                    label: _HomePageState._destinations[i].label,
                    selected: index == i,
                    stacked: true,
                    onPressed: () => onSelected(i),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  const new({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onPressed,
    this.stacked = false,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final bool stacked;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final glyph = Icon(icon, size: 16);
    return ShadButton.ghost(
      width: double.infinity,
      mainAxisAlignment: stacked
          ? MainAxisAlignment.center
          : MainAxisAlignment.start,
      backgroundColor: selected ? theme.colorScheme.accent : null,
      leading: stacked ? null : glyph,
      onPressed: onPressed,
      child: stacked
          ? Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                glyph,
                Text(label, style: theme.textTheme.small),
              ],
            )
          : Text(label),
    );
  }
}

class _SignOutButton extends StatelessWidget {
  const new();

  @override
  Widget build(BuildContext context) {
    return ShadButton.ghost(
      mainAxisAlignment: MainAxisAlignment.start,
      leading: const Icon(LucideIcons.logOut, size: 16),
      onPressed: () => context.read<SessionCubit>().signedOut(),
      child: const Text('Sign out'),
    );
  }
}

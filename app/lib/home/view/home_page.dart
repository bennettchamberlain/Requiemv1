import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:material_ui/material_ui.dart';
import 'package:scoria_app/jobs/jobs.dart';
import 'package:scoria_app/memory/memory.dart';
import 'package:scoria_app/session/session.dart';
import 'package:scoria_models/scoria_models.dart';

/// Shell with one destination per feature. Only memory and jobs are live;
/// the rest are stubbed until their server slices exist.
class HomePage extends StatefulWidget {
  const new({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  var _index = 0;

  static const _pages = <Widget>[
    MemoryPage(),
    JobsPage(),
    // PositionsPage(),   // background location + presence overlap
    // PeoplePage(),      // relationships, tiers, consent grants
    // AsksPage(),        // ask a friend; disclosure ladder
    // SettingsPage(),
  ];

  @override
  Widget build(BuildContext context) {
    final person = context.select<SessionCubit, Person?>((c) => c.state.person);
    final wide = MediaQuery.sizeOf(context).width >= 700;
    final destinations = [
      const NavigationDestination(
        icon: Icon(Icons.memory_outlined),
        selectedIcon: Icon(Icons.memory),
        label: 'Memory',
      ),
      const NavigationDestination(
        icon: Icon(Icons.work_history_outlined),
        selectedIcon: Icon(Icons.work_history),
        label: 'Jobs',
      ),
      // Places: Icons.place_outlined
      // People: Icons.people_outline
      // Asks:   Icons.question_answer_outlined
    ];

    final body = IndexedStack(index: _index, children: _pages);

    if (wide) {
      return Scaffold(
        body: Row(
          children: [
            NavigationRail(
              selectedIndex: _index,
              onDestinationSelected: (i) => setState(() => _index = i),
              labelType: NavigationRailLabelType.all,
              leading: _Avatar(handle: person?.handle),
              trailing: const Expanded(
                child: Align(
                  alignment: Alignment.bottomCenter,
                  child: Padding(
                    padding: EdgeInsets.only(bottom: 12),
                    child: _SignOutButton(),
                  ),
                ),
              ),
              destinations: [
                for (final d in destinations)
                  NavigationRailDestination(
                    icon: d.icon,
                    selectedIcon: d.selectedIcon,
                    label: Text(d.label),
                  ),
              ],
            ),
            const VerticalDivider(width: 1),
            Expanded(child: body),
          ],
        ),
      );
    }

    return Scaffold(
      body: body,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: destinations,
      ),
    );
  }
}

class _Avatar extends StatelessWidget {
  const new({required this.handle});

  final String? handle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Tooltip(
        message: handle ?? '',
        child: CircleAvatar(
          child: Text((handle ?? '?').substring(0, 1).toUpperCase()),
        ),
      ),
    );
  }
}

class _SignOutButton extends StatelessWidget {
  const new();

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: 'Sign out',
      icon: const Icon(Icons.logout),
      onPressed: () => context.read<SessionCubit>().signedOut(),
    );
  }
}

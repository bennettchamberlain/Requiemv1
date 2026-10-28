import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:material_ui/material_ui.dart';
import 'package:scoria_api_client/scoria_api_client.dart';
import 'package:scoria_app/memory/memory.dart';
import 'package:scoria_app/ui/chrome.dart';
import 'package:scoria_models/scoria_models.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

class MemoryPage extends StatelessWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) =>
          MemoryBloc(api: context.read<ScoriaApiClient>())
            ..add(const MemoryFetched()),
      child: const MemoryView(),
    );
  }
}

class MemoryView extends StatelessWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          ScoriaHeader(
            title: 'Memory',
            // TODO(scoria): semantic search needs OLLAMA_URL on the server.
            actions: [
              ShadIconButton.ghost(
                key: const Key('memory_addNote_fab'),
                icon: const Icon(LucideIcons.squarePen, size: 16),
                onPressed: () => _showAddNote(context),
              ),
            ],
          ),
          Expanded(
            child: BlocListener<MemoryBloc, MemoryState>(
              listenWhen: (p, c) => c.error != null && p.error != c.error,
              listener: (context, state) {
                ShadToaster.of(context).show(
                  ShadToast.destructive(
                    title: const Text('Memory'),
                    description: Text(state.error!),
                  ),
                );
              },
              child: const _MemoryBody(),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _showAddNote(BuildContext context) async {
    final bloc = context.read<MemoryBloc>();
    final result = await showShadDialog<({String title, String body})>(
      context: context,
      builder: (_) => const _AddNoteDialog(),
    );
    if (result == null) return;
    bloc.add(
      MemoryNoteAdded(
        title: result.title,
        body: result.body.isEmpty ? null : result.body,
        sourceId: DateTime.now().toUtc().microsecondsSinceEpoch.toString(),
      ),
    );
  }
}

class _MemoryBody extends StatelessWidget {
  const new();

  @override
  Widget build(BuildContext context) {
    final state = context.watch<MemoryBloc>().state;
    switch (state.status) {
      case MemoryStatus.initial:
      case MemoryStatus.loading:
        return const ScoriaSkeleton();
      case MemoryStatus.failure when state.items.isEmpty:
        return ScoriaFailure(
          message: state.error ?? 'Could not load memory',
          onRetry: () =>
              context.read<MemoryBloc>().add(const MemoryRefreshed()),
        );
      case MemoryStatus.failure:
      case MemoryStatus.success:
        if (state.items.isEmpty) {
          return const ScoriaEmpty('Nothing here yet.');
        }
        return RefreshIndicator(
          onRefresh: () async {
            final bloc = context.read<MemoryBloc>()
              ..add(const MemoryRefreshed());
            await bloc.stream.firstWhere(
              (s) => s.status != MemoryStatus.loading,
            );
          },
          child: NotificationListener<ScrollNotification>(
            onNotification: (n) {
              if (n.metrics.extentAfter < 400) {
                context.read<MemoryBloc>().add(const MemoryLoadedMore());
              }
              return false;
            },
            child: ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              itemCount: state.items.length + (state.hasMore ? 1 : 0),
              separatorBuilder: (_, _) => const ScoriaDivider.horizontal(),
              itemBuilder: (context, i) {
                if (i >= state.items.length) {
                  return const Padding(
                    padding: EdgeInsets.all(16),
                    child: ScoriaSkeleton(rows: 1),
                  );
                }
                return _MemoryTile(item: state.items[i]);
              },
            ),
          ),
        );
    }
  }
}

class _MemoryTile extends StatelessWidget {
  const new({required this.item});

  final MemoryItem item;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final when = item.occurredAt.toLocal();
    final stamp =
        '${when.year}-${_two(when.month)}-${_two(when.day)} '
        '${_two(when.hour)}:${_two(when.minute)}';
    final subtitle = [
      stamp,
      item.source,
      ?item.place?.city,
      ?item.body,
    ].join(' · ');
    return Material(
      color: theme.colorScheme.background,
      child: InkWell(
        onTap: () => showShadDialog<void>(
          context: context,
          builder: (_) => ShadDialog(
            title: Text(item.title ?? item.kind),
            child: Text(item.body ?? '(no body)\n\n$stamp · ${item.source}'),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              Icon(
                _iconFor(item.kind),
                size: 16,
                color: theme.colorScheme.mutedForeground,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.title ?? '(untitled ${item.kind})',
                      style: theme.textTheme.p,
                    ),
                    Text(
                      subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.muted,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _two(int n) => n.toString().padLeft(2, '0');

  static IconData _iconFor(String kind) => switch (kind) {
    'note' => LucideIcons.stickyNote,
    'photo' => LucideIcons.image,
    'message' => LucideIcons.messageCircle,
    'event' => LucideIcons.calendar,
    _ => LucideIcons.brain,
  };
}

class _AddNoteDialog extends StatefulWidget {
  const new();

  @override
  State<_AddNoteDialog> createState() => _AddNoteDialogState();
}

class _AddNoteDialogState extends State<_AddNoteDialog> {
  final _title = TextEditingController();
  final _body = TextEditingController();

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ShadDialog(
      title: const Text('New note'),
      actions: [
        ShadButton.outline(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        ShadButton(
          key: const Key('memory_addNote_save'),
          onPressed: () {
            if (_title.text.trim().isEmpty) return;
            Navigator.of(context).pop((
              title: _title.text.trim(),
              body: _body.text.trim(),
            ));
          },
          child: const Text('Save'),
        ),
      ],
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ShadInput(
            key: const Key('memory_addNote_title'),
            controller: _title,
            autofocus: true,
            placeholder: const Text('Title'),
          ),
          const SizedBox(height: 8),
          ShadInput(
            key: const Key('memory_addNote_body'),
            controller: _body,
            minLines: 2,
            maxLines: 6,
            placeholder: const Text('Body'),
          ),
        ],
      ),
    );
  }
}

import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:material_ui/material_ui.dart';
import 'package:scoria_api_client/scoria_api_client.dart';
import 'package:scoria_app/memory/memory.dart';
import 'package:scoria_models/scoria_models.dart';

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
      appBar: AppBar(
        title: const Text('Memory'),
        // TODO(scoria): semantic search needs OLLAMA_URL on the server.
        // actions: [IconButton(icon: Icon(Icons.search), onPressed: ...)],
      ),
      body: BlocListener<MemoryBloc, MemoryState>(
        listenWhen: (p, c) => c.error != null && p.error != c.error,
        listener: (context, state) {
          ScaffoldMessenger.of(context)
            ..hideCurrentSnackBar()
            ..showSnackBar(SnackBar(content: Text(state.error!)));
        },
        child: const _MemoryBody(),
      ),
      floatingActionButton: FloatingActionButton(
        key: const Key('memory_addNote_fab'),
        onPressed: () => _showAddNote(context),
        child: const Icon(Icons.edit_note),
      ),
    );
  }

  Future<void> _showAddNote(BuildContext context) async {
    final bloc = context.read<MemoryBloc>();
    final result = await showDialog<({String title, String body})>(
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
        return const Center(child: CircularProgressIndicator());
      case MemoryStatus.failure when state.items.isEmpty:
        return _Retry(message: state.error ?? 'Could not load memory');
      case MemoryStatus.failure:
      case MemoryStatus.success:
        if (state.items.isEmpty) {
          return const Center(child: Text('Nothing here yet.'));
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
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, i) {
                if (i >= state.items.length) {
                  return const Padding(
                    padding: EdgeInsets.all(16),
                    child: Center(child: CircularProgressIndicator()),
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
    final when = item.occurredAt.toLocal();
    final stamp =
        '${when.year}-${_two(when.month)}-${_two(when.day)} '
        '${_two(when.hour)}:${_two(when.minute)}';
    return ListTile(
      leading: Icon(_iconFor(item.kind)),
      title: Text(item.title ?? '(untitled ${item.kind})'),
      subtitle: Text(
        [stamp, item.source, ?item.place?.city, ?item.body].join(' · '),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      onTap: () => showDialog<void>(
        context: context,
        builder: (_) => AlertDialog(
          title: Text(item.title ?? item.kind),
          content: SingleChildScrollView(
            child: Text(item.body ?? '(no body)\n\n$stamp · ${item.source}'),
          ),
        ),
      ),
    );
  }

  static String _two(int n) => n.toString().padLeft(2, '0');

  static IconData _iconFor(String kind) => switch (kind) {
    'note' => Icons.sticky_note_2_outlined,
    'photo' => Icons.photo_outlined,
    'message' => Icons.chat_bubble_outline,
    'event' => Icons.event_outlined,
    _ => Icons.memory,
  };
}

class _Retry extends StatelessWidget {
  const new({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: 12),
          FilledButton.tonal(
            onPressed: () =>
                context.read<MemoryBloc>().add(const MemoryRefreshed()),
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }
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
    return AlertDialog(
      title: const Text('New note'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            key: const Key('memory_addNote_title'),
            controller: _title,
            autofocus: true,
            decoration: const InputDecoration(labelText: 'Title'),
          ),
          TextField(
            key: const Key('memory_addNote_body'),
            controller: _body,
            minLines: 2,
            maxLines: 6,
            decoration: const InputDecoration(labelText: 'Body'),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('memory_addNote_save'),
          onPressed: () {
            if (_title.text.trim().isEmpty) return;
            Navigator.of(context)
                .pop((title: _title.text.trim(), body: _body.text.trim()));
          },
          child: const Text('Save'),
        ),
      ],
    );
  }
}

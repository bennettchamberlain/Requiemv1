import 'dart:async';

import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:material_ui/material_ui.dart';
import 'package:scoria_app/chat/bloc/chat_bloc.dart';
import 'package:scoria_app/chat/parts/chat_part.dart';
import 'package:scoria_app/chat/parts/you_search.dart';
import 'package:scoria_app/chat/voice_cubit.dart';
import 'package:scoria_app/ui/chrome.dart';
import 'package:scoria_models/scoria_models.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:url_launcher/url_launcher.dart';

/// Renders the parsed surface for one assistant message.
class ChatMessageBody extends StatelessWidget {
  const new({
    super.key,
    required this.text,
    required this.foreground,
    this.tools = const [],
    this.streaming = false,
  });

  final String text;
  final Color foreground;
  final List<ChatToolCall> tools;
  final bool streaming;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final segments = parseChatSegments(text, tools: tools);
    final otherTools = [
      for (final tool in tools)
        if (tool.name != 'web_search' &&
            tool.name != 'you_search' &&
            tool.name != 'you_web_search')
          tool,
    ];
    if (segments.isEmpty && otherTools.isEmpty && streaming) {
      return const SizedBox(width: 72, child: ShadProgress(minHeight: 6));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (otherTools.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final tool in otherTools)
                  Tooltip(
                    message: tool.result ?? tool.arguments,
                    child: ShadBadge.outline(
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(LucideIcons.wrench, size: 12),
                          const SizedBox(width: 4),
                          Text(tool.name),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        for (final segment in segments) ...[
          switch (segment) {
            ChatProse(:final text) => SelectableText(
              _plain(text),
              style: theme.textTheme.p.copyWith(color: foreground),
            ),
            ChatBlock(:final part) => ChatPartView(part),
            ChatBlockPending() => const SizedBox(
              height: 96,
              child: ScoriaSkeleton(rows: 2),
            ),
          },
          const SizedBox(height: 8),
        ],
        if (streaming && text.isNotEmpty)
          const SizedBox(width: 72, child: ShadProgress(minHeight: 6)),
      ],
    );
  }
}

class ChatPartView extends StatelessWidget {
  const new(this.part, {super.key, this.searchClient});

  final ChatPart part;
  final YouSearchClient? searchClient;

  @override
  Widget build(BuildContext context) {
    return switch (part) {
      ChatText(:final text) => Text(text),
      ChatHeading(:final text) => Text(
        text,
        style: ShadTheme.of(context).textTheme.h4,
      ),
      ChatDivider() => const ScoriaDivider.horizontal(),
      ChatColumn(:final children) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [for (final child in children) ChatPartView(child)],
      ),
      ChatRow(:final children) => SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final child in children)
              SizedBox(width: 240, child: ChatPartView(child)),
          ],
        ),
      ),
      ChatList(:final children) => Column(
        children: [
          for (final child in children) ...[
            ChatPartView(child),
            const ScoriaDivider.horizontal(),
          ],
        ],
      ),
      final ChatCard card => _CardView(card),
      final ChatLink link => _LinkView(link),
      final ChatImage image => _ImageView(image),
      ChatWebSearch(:final query) => _YouSearchView(
        query: query,
        client: searchClient,
      ),
      ChatSpeech(:final text) => _SpeechView(text),
      final ChatMemory memory => _MemoryView(memory),
      final ChatPlace place => _PlaceView(place),
      final ChatPerson person => _PersonView(person),
      final ChatQuote quote => _QuoteView(quote),
      final ChatMetric metric => _MetricView(metric),
      ChatBadge(:final text) => ShadBadge.outline(child: Text(text)),
      final ChatTimeline timeline => _TimelineView(timeline),
      final ChatCheck check => _CheckView(check),
      final ChatChecklist list => _ChecklistView(list),
      final ChatGraph graph => _GraphView(graph),
      ChatActions(:final items) => _ActionsView(items),
    };
  }
}

class _SpeechView extends StatelessWidget {
  const _SpeechView(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    VoiceCubit? voice;
    try {
      voice = context.watch<VoiceCubit>();
    } on Object {
      voice = null;
    }
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        border: Border.all(color: theme.colorScheme.border),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(10, 6, 6, 6),
        child: Row(
          children: [
            Icon(
              LucideIcons.volume2,
              size: 14,
              color: theme.colorScheme.mutedForeground,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(text, style: theme.textTheme.muted),
            ),
            ShadIconButton.ghost(
              icon: const Icon(LucideIcons.play, size: 14),
              onPressed: text.trim().isEmpty || voice == null
                  ? null
                  : () => voice!.speak(text),
            ),
          ],
        ),
      ),
    );
  }
}

class _MemoryView extends StatelessWidget {
  const _MemoryView(this.memory);

  final ChatMemory memory;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return _Disclosure(
      detail: memory.body.length > 160 ? ChatText(memory.body) : null,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: theme.colorScheme.background,
          borderRadius: const BorderRadius.all(Radius.circular(8)),
          border: Border.all(color: theme.colorScheme.border),
        ),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  if (memory.kind.isNotEmpty)
                    ShadBadge.outline(child: Text(memory.kind)),
                  if (memory.when.isNotEmpty)
                    Text(memory.when, style: theme.textTheme.muted),
                ],
              ),
              if (memory.title.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(memory.title, style: theme.textTheme.p),
              ],
              if (memory.body.isNotEmpty)
                Text(
                  memory.body.length > 160
                      ? '${memory.body.substring(0, 157)}…'
                      : memory.body,
                  style: theme.textTheme.muted,
                ),
              if (memory.place != null) ...[
                const SizedBox(height: 6),
                _PlaceView(memory.place!),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _PlaceView extends StatelessWidget {
  const _PlaceView(this.place);

  final ChatPlace place;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return Row(
      children: [
        Icon(
          LucideIcons.mapPin,
          size: 14,
          color: theme.colorScheme.mutedForeground,
        ),
        const SizedBox(width: 8),
        Expanded(child: Text(place.line, style: theme.textTheme.muted)),
      ],
    );
  }
}

class _PersonView extends StatelessWidget {
  const _PersonView(this.person);

  final ChatPerson person;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final initial = (person.name.isEmpty ? '?' : person.name[0]).toUpperCase();
    return Row(
      children: [
        ShadAvatar(
          null,
          size: const Size.square(28),
          placeholder: Text(initial, style: theme.textTheme.small),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                person.name.isEmpty ? person.handle : person.name,
                style: theme.textTheme.p,
              ),
              if (person.handle.isNotEmpty || person.relation.isNotEmpty)
                Text(
                  [
                    if (person.handle.isNotEmpty) person.handle,
                    if (person.relation.isNotEmpty) person.relation,
                  ].join(' · '),
                  style: theme.textTheme.muted,
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _QuoteView extends StatelessWidget {
  const _QuoteView(this.quote);

  final ChatQuote quote;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: theme.colorScheme.border, width: 3),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.only(left: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(quote.text, style: theme.textTheme.p),
            if (quote.attribution.isNotEmpty)
              Text(quote.attribution, style: theme.textTheme.muted),
          ],
        ),
      ),
    );
  }
}

class _MetricView extends StatelessWidget {
  const _MetricView(this.metric);

  final ChatMetric metric;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        border: Border.all(color: theme.colorScheme.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (metric.label.isNotEmpty)
              Text(metric.label, style: theme.textTheme.muted),
            Text(metric.value, style: theme.textTheme.h4),
            if (metric.detail.isNotEmpty)
              Text(metric.detail, style: theme.textTheme.muted),
          ],
        ),
      ),
    );
  }
}

class _TimelineView extends StatelessWidget {
  const _TimelineView(this.timeline);

  final ChatTimeline timeline;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (timeline.title.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(timeline.title, style: theme.textTheme.h4),
          ),
        for (final child in timeline.children) ...[
          ChatPartView(child),
          const SizedBox(height: 8),
        ],
      ],
    );
  }
}

class _CheckView extends StatelessWidget {
  const _CheckView(this.check);

  final ChatCheck check;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return Row(
      children: [
        Icon(
          check.done ? LucideIcons.circleCheck : LucideIcons.circle,
          size: 14,
          color: theme.colorScheme.mutedForeground,
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            check.text,
            style: theme.textTheme.p.copyWith(
              decoration: check.done ? TextDecoration.lineThrough : null,
            ),
          ),
        ),
      ],
    );
  }
}

class _ChecklistView extends StatelessWidget {
  const _ChecklistView(this.list);

  final ChatChecklist list;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (list.title.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(list.title, style: theme.textTheme.h4),
          ),
        for (final item in list.items) _CheckView(item),
      ],
    );
  }
}

class _GraphView extends StatelessWidget {
  const _GraphView(this.graph);

  final ChatGraph graph;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (graph.nodes.isNotEmpty)
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final node in graph.nodes)
                ShadBadge.outline(
                  child: Text(
                    [
                      if (node.kind.isNotEmpty) node.kind,
                      node.name,
                      if (node.status.isNotEmpty) node.status,
                    ].join(' · '),
                  ),
                ),
            ],
          ),
        if (graph.edges.isNotEmpty) ...[
          const SizedBox(height: 8),
          for (final edge in graph.edges)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text(
                '${edge.source} ${edge.kind} ${edge.target}'
                '${edge.status.isEmpty ? '' : ' (${edge.status})'}',
                style: theme.textTheme.muted,
              ),
            ),
        ],
      ],
    );
  }
}

class _ActionsView extends StatelessWidget {
  const _ActionsView(this.items);

  final List<ChatAction> items;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final item in items)
          ShadButton.outline(
            onPressed: () => _run(context, item),
            child: Text(item.label),
          ),
      ],
    );
  }

  void _run(BuildContext context, ChatAction item) {
    if (item.url.isNotEmpty) {
      unawaited(_open(item.url));
      return;
    }
    final prompt = item.prompt.trim();
    if (prompt.isEmpty) return;
    try {
      context.read<ChatBloc>().add(ChatMessageSent(prompt));
    } on Object {
      // Rendered outside a chat session.
    }
  }
}

class _CardView extends StatelessWidget {
  const new(this.card);

  final ChatCard card;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return _Disclosure(
      detail: card.detail,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: theme.colorScheme.background,
          borderRadius: const BorderRadius.all(Radius.circular(8)),
          border: Border.all(color: theme.colorScheme.border),
        ),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (card.title.isNotEmpty)
                Text(card.title, style: theme.textTheme.p),
              if (card.subtitle.isNotEmpty)
                Text(card.subtitle, style: theme.textTheme.muted),
              for (final child in card.children) ChatPartView(child),
            ],
          ),
        ),
      ),
    );
  }
}

class _LinkView extends StatelessWidget {
  const new(this.link);

  final ChatLink link;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return _Disclosure(
      detail: link.detail,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ShadButton.link(
            onPressed: () => _open(link.url),
            child: Text(link.title.isEmpty ? link.url : link.title),
          ),
          if (link.snippet.isNotEmpty)
            Text(link.snippet, style: theme.textTheme.muted),
        ],
      ),
    );
  }
}

class _ImageView extends StatelessWidget {
  const new(this.image);

  final ChatImage image;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: const BorderRadius.all(Radius.circular(8)),
      child: Image.network(
        image.url,
        height: 160,
        width: double.infinity,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => Text(
          image.alt.isEmpty ? image.url : image.alt,
          style: ShadTheme.of(context).textTheme.muted,
        ),
      ),
    );
  }
}

class _Disclosure extends StatefulWidget {
  const new({required this.child, this.detail});

  final Widget child;
  final ChatPart? detail;

  @override
  State<_Disclosure> createState() => _DisclosureState();
}

class _DisclosureState extends State<_Disclosure> {
  var _open = false;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        widget.child,
        if (widget.detail != null)
          ShadButton.ghost(
            onPressed: () => setState(() => _open = !_open),
            child: Text(_open ? 'Less' : 'More'),
          ),
        if (_open && widget.detail != null)
          Padding(
            padding: const EdgeInsets.only(left: 12, bottom: 8),
            child: ChatPartView(widget.detail!),
          ),
      ],
    );
  }
}

class _YouSearchView extends StatefulWidget {
  const new({required this.query, this.client});

  final String query;
  final YouSearchClient? client;

  @override
  State<_YouSearchView> createState() => _YouSearchViewState();
}

class _YouSearchViewState extends State<_YouSearchView> {
  late final YouSearchClient _client;
  late final bool _ownsClient;
  List<YouHit>? _hits;
  String? _error;

  @override
  void initState() {
    super.initState();
    _ownsClient = widget.client == null;
    _client = widget.client ?? YouSearchClient();
    unawaited(_load());
  }

  @override
  void dispose() {
    if (_ownsClient) _client.close();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final hits = await _client.search(widget.query);
      if (!mounted) return;
      setState(() => _hits = hits);
    } on Exception catch (error) {
      if (!mounted) return;
      setState(() => _error = '$error');
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final hits = _hits;
    if (_error != null) {
      return Text(_error!, style: theme.textTheme.muted);
    }
    if (hits == null) {
      return const SizedBox(height: 120, child: ScoriaSkeleton(rows: 2));
    }
    if (hits.isEmpty) {
      return Text('No results.', style: theme.textTheme.muted);
    }
    return ChatPartView(
      ChatColumn([
        ChatHeading(widget.query),
        for (final hit in hits)
          ChatLink(
            title: hit.title,
            url: hit.url,
            snippet: hit.description,
            detail: ChatColumn([
              if (hit.pageAge != null) ChatText(hit.pageAge!),
              for (final snippet in hit.snippets) ChatText(snippet),
              if (hit.snippets.isEmpty && hit.description.isNotEmpty)
                ChatText(hit.description),
            ]),
          ),
      ]),
    );
  }
}

String _plain(String text) => text
    .replaceAll(RegExp(r'\*\*(.+?)\*\*'), r'$1')
    .replaceAll(RegExp('`([^`]+)`'), r'$1')
    .replaceAll(RegExp(r'^#+\s*', multiLine: true), '');

Future<void> _open(String url) async {
  final uri = Uri.tryParse(url);
  if (uri == null || !uri.hasScheme) return;
  await launchUrl(uri, mode: LaunchMode.externalApplication);
}

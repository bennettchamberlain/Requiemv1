import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:scoria_app/chat/parts/chat_part.dart';
import 'package:scoria_app/chat/parts/you_search.dart';
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
    };
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

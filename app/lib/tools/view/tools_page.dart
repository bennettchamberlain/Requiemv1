import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:material_ui/material_ui.dart';
import 'package:scoria_api_client/scoria_api_client.dart';
import 'package:scoria_app/config/chat_settings_cubit.dart';
import 'package:scoria_app/ui/chrome.dart';
import 'package:scoria_models/scoria_models.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

/// Manage inference, You.com, One Connect, and which tools the agent may use.
class ToolsPage extends StatefulWidget {
  const ToolsPage({super.key});

  @override
  State<ToolsPage> createState() => _ToolsPageState();
}

class _ToolsPageState extends State<ToolsPage> {
  ChatCatalog? _catalog;
  String? _error;
  var _loading = true;
  var _busy = false;

  ScoriaApiClient get _api => context.read<ScoriaApiClient>();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final catalog = await _api.chatTools();
      if (!mounted) return;
      setState(() {
        _catalog = catalog;
        _loading = false;
      });
    } on Exception catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  Future<void> _apply(Future<ChatCatalog> Function() fn) async {
    setState(() => _busy = true);
    try {
      final catalog = await fn();
      if (!mounted) return;
      setState(() {
        _catalog = catalog;
        _busy = false;
      });
    } on Exception catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      ShadToaster.of(context).show(
        ShadToast.destructive(
          title: const Text('Tools'),
          description: Text('$e'),
        ),
      );
    }
  }

  String? _absolute(String? path) {
    if (path == null || path.isEmpty) return null;
    if (path.startsWith('http')) return path;
    return _api.baseUrl
        .resolve(path.startsWith('/') ? path.substring(1) : path)
        .toString();
  }

  Future<void> _setYouKey() async {
    final key = await showShadDialog<String>(
      context: context,
      builder: (_) => const _YouKeyDialog(),
    );
    if (key == null || key.isEmpty) return;
    await _apply(() => _api.putConnection('you', apiKey: key));
  }

  Future<void> _syncOne() async {
    setState(() => _busy = true);
    try {
      final platforms = await _api.oneSync();
      if (!mounted) return;
      setState(() => _busy = false);
      ShadToaster.of(context).show(
        ShadToast(
          title: const Text('Sync queued'),
          description: Text(platforms.join(', ')),
        ),
      );
    } on Exception catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      ShadToaster.of(context).show(
        ShadToast.destructive(
          title: const Text('Sync'),
          description: Text('$e'),
        ),
      );
    }
  }

  Future<void> _disconnectOne() async {
    setState(() => _busy = true);
    try {
      await _api.oneGrantDelete();
      await _load();
    } on Exception catch (e) {
      if (!mounted) return;
      ShadToaster.of(context).show(
        ShadToast.destructive(
          title: const Text('One Connect'),
          description: Text('$e'),
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final provider = context.watch<ChatSettingsCubit>().state;
    return Scaffold(
      body: Column(
        children: [
          ScoriaHeader(
            title: 'Tools',
            actions: [
              ShadIconButton.ghost(
                key: const Key('tools_refresh_button'),
                icon: const Icon(LucideIcons.refreshCw, size: 16),
                onPressed: _busy ? null : _load,
              ),
            ],
          ),
          Expanded(
            child: _loading && _catalog == null
                ? const ScoriaSkeleton()
                : ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Text(
                        'This is where connections live. The agent only '
                        'spends a turn on what is on.',
                        style: theme.textTheme.muted,
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 12),
                        ShadAlert.destructive(
                          title: const Text('Could not load tools'),
                          description: Text(_error!),
                        ),
                      ],
                      const SizedBox(height: 20),
                      Text('Connections', style: theme.textTheme.h4),
                      const SizedBox(height: 8),
                      if (_catalog != null)
                        for (final c in _catalog!.connections)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: _ConnectionCard(
                              connection: c,
                              authorizeUrl: _absolute(c.authorizeUrl),
                              busy: _busy,
                              onYouKey: _setYouKey,
                              onClearYou: () => _apply(
                                () => _api.deleteConnection('you'),
                              ),
                              onSyncOne: _syncOne,
                              onDisconnectOne: _disconnectOne,
                            ),
                          ),
                      const SizedBox(height: 16),
                      Text('Inference', style: theme.textTheme.h4),
                      const SizedBox(height: 6),
                      Text(
                        'Parasail is the cloud brain. Local is Ollama. '
                        'Auto follows the server.',
                        style: theme.textTheme.muted,
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final id in const ['auto', 'parasail', 'ollama'])
                            _ProviderChip(
                              id: id,
                              selected: provider == id,
                              info: _catalog?.providers[id],
                              onPressed: () => context
                                  .read<ChatSettingsCubit>()
                                  .setProvider(id),
                            ),
                        ],
                      ),
                      const SizedBox(height: 24),
                      Text('Agent tools', style: theme.textTheme.h4),
                      const SizedBox(height: 6),
                      Text(
                        'Switch one off if you do not want it in the next chat.',
                        style: theme.textTheme.muted,
                      ),
                      const SizedBox(height: 12),
                      if (_catalog != null)
                        for (final t in _catalog!.tools)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: _ToolCard(
                              tool: t,
                              busy: _busy,
                              onChanged: t.available
                                  ? (on) => _apply(
                                      () => _api.putConnection(
                                        t.name,
                                        enabled: on,
                                      ),
                                    )
                                  : null,
                            ),
                          ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

class _ConnectionCard extends StatelessWidget {
  const _ConnectionCard({
    required this.connection,
    required this.busy,
    required this.onYouKey,
    required this.onClearYou,
    required this.onSyncOne,
    required this.onDisconnectOne,
    this.authorizeUrl,
  });

  final ChatConnection connection;
  final String? authorizeUrl;
  final bool busy;
  final VoidCallback onYouKey;
  final VoidCallback onClearYou;
  final VoidCallback onSyncOne;
  final VoidCallback onDisconnectOne;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final c = connection;
    return ShadCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(_icon(c.id), size: 16, color: theme.colorScheme.mutedForeground),
              const SizedBox(width: 8),
              Expanded(child: Text(c.label, style: theme.textTheme.small)),
              Text(
                c.id == 'one' && !c.connected && !c.ready
                    ? 'not configured'
                    : (c.connected ? 'connected' : 'off'),
                style: theme.textTheme.muted.copyWith(
                  color: c.connected
                      ? theme.colorScheme.foreground
                      : theme.colorScheme.destructive,
                ),
              ),
            ],
          ),
          if (c.description != null) ...[
            const SizedBox(height: 6),
            Text(c.description!, style: theme.textTheme.muted),
          ],
          if (c.platforms.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final p in c.platforms)
                  ShadBadge.outline(child: Text(p)),
              ],
            ),
          ],
          if (c.model != null) ...[
            const SizedBox(height: 6),
            Text(c.model!, style: theme.textTheme.muted),
          ],
          if (c.id == 'one' && !c.connected && !c.ready) ...[
            const SizedBox(height: 8),
            Text(
              'One is not configured on this server yet. Add ONE_CLIENT_ID '
              'and ONE_CONNECT_KEY, restart Connect, then a Connect button '
              'will show here. Do not open :8788 from your laptop — Requiem '
              'proxies Connect through the same host as the API.',
              style: theme.textTheme.muted,
            ),
          ],
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (c.id == 'you') ...[
                ShadButton.outline(
                  onPressed: busy ? null : onYouKey,
                  child: Text(c.connected ? 'Replace key' : 'Add key'),
                ),
                if (c.hasSecret)
                  ShadButton.ghost(
                    onPressed: busy ? null : onClearYou,
                    child: const Text('Use server key'),
                  ),
              ],
              if (c.id == 'one' && c.connected) ...[
                ShadButton.outline(
                  onPressed: busy ? null : onSyncOne,
                  child: const Text('Sync now'),
                ),
                ShadButton.ghost(
                  onPressed: busy ? null : onDisconnectOne,
                  child: const Text('Disconnect'),
                ),
              ],
              if (c.id == 'one' && !c.connected && c.ready && authorizeUrl != null)
                ShadButton.outline(
                  onPressed: busy
                      ? null
                      : () async {
                          await Clipboard.setData(
                            ClipboardData(text: authorizeUrl!),
                          );
                          if (context.mounted) {
                            ShadToaster.of(context).show(
                              const ShadToast(
                                title: Text('Copied Connect link'),
                                description: Text(
                                  'Open it on this same host as the API.',
                                ),
                              ),
                            );
                          }
                        },
                  child: const Text('Connect accounts'),
                ),
            ],
          ),
        ],
      ),
    );
  }

  static IconData _icon(String id) => switch (id) {
    'you' => LucideIcons.globe,
    'one' => LucideIcons.link,
    'parasail' => LucideIcons.cloud,
    'ollama' => LucideIcons.cpu,
    _ => LucideIcons.wrench,
  };
}

class _YouKeyDialog extends StatefulWidget {
  const _YouKeyDialog();

  @override
  State<_YouKeyDialog> createState() => _YouKeyDialogState();
}

class _YouKeyDialogState extends State<_YouKeyDialog> {
  final _key = TextEditingController();

  @override
  void dispose() {
    _key.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ShadDialog(
      title: const Text('You.com key'),
      description: const Text(
        'From you.com or key.txt. Stored for this person on the server. '
        'Never shown again.',
      ),
      actions: [
        ShadButton.outline(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        ShadButton(
          onPressed: () => Navigator.of(context).pop(_key.text.trim()),
          child: const Text('Save'),
        ),
      ],
      child: ShadInput(
        controller: _key,
        obscureText: true,
        placeholder: const Text('YDC_API_KEY'),
      ),
    );
  }
}

class _ProviderChip extends StatelessWidget {
  const _ProviderChip({
    required this.id,
    required this.selected,
    required this.onPressed,
    this.info,
  });

  final String id;
  final bool selected;
  final ChatProviderInfo? info;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final label = switch (id) {
      'parasail' => 'Parasail',
      'ollama' => 'Local',
      _ => 'Auto',
    };
    final missing = id != 'auto' && info != null && !info!.available;
    final child = Text(missing ? '$label (off)' : label);
    if (selected) {
      return ShadButton(onPressed: missing ? null : onPressed, child: child);
    }
    return ShadButton.outline(
      onPressed: missing ? null : onPressed,
      child: child,
    );
  }
}

class _ToolCard extends StatelessWidget {
  const _ToolCard({
    required this.tool,
    required this.busy,
    required this.onChanged,
  });

  final ChatToolInfo tool;
  final bool busy;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return ShadCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            _icon(tool.name),
            size: 16,
            color: theme.colorScheme.mutedForeground,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(tool.name, style: theme.textTheme.small),
                const SizedBox(height: 4),
                Text(tool.description, style: theme.textTheme.muted),
                if (!tool.available)
                  Text(
                    'needs a connection',
                    style: theme.textTheme.muted.copyWith(
                      color: theme.colorScheme.destructive,
                    ),
                  ),
              ],
            ),
          ),
          ShadSwitch(
            value: tool.enabled && tool.available,
            enabled: !busy && onChanged != null,
            onChanged: onChanged,
          ),
        ],
      ),
    );
  }

  static IconData _icon(String name) => switch (name) {
    'memory_search' || 'memory_recent' || 'memory_get' => LucideIcons.brain,
    'remember' => LucideIcons.bookmark,
    'life_graph' => LucideIcons.gitBranch,
    'web_search' => LucideIcons.globe,
    'now' => LucideIcons.clock,
    _ => LucideIcons.wrench,
  };
}

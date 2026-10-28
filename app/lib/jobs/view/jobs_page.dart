import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:material_ui/material_ui.dart';
import 'package:scoria_api_client/scoria_api_client.dart';
import 'package:scoria_app/jobs/jobs.dart';
import 'package:scoria_app/ui/chrome.dart';
import 'package:scoria_models/scoria_models.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

class JobsPage extends StatelessWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) =>
          JobsBloc(api: context.read<ScoriaApiClient>())
            ..add(const JobsFetched()),
      child: const JobsView(),
    );
  }
}

class JobsView extends StatelessWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Column(
        children: [
          ScoriaHeader(
            title: 'Jobs',
            actions: [_RefreshButton()],
          ),
          _StateFilter(),
          Expanded(child: _JobsBody()),
        ],
      ),
    );
  }
}

class _RefreshButton extends StatelessWidget {
  const new();

  @override
  Widget build(BuildContext context) {
    return ShadIconButton.ghost(
      key: const Key('jobs_refresh_button'),
      icon: const Icon(LucideIcons.refreshCw, size: 16),
      onPressed: () => context.read<JobsBloc>().add(const JobsRefreshed()),
    );
  }
}

class _StateFilter extends StatelessWidget {
  const new();

  @override
  Widget build(BuildContext context) {
    final filter = context.select<JobsBloc, Set<JobState>>(
      (b) => b.state.filter,
    );
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: ShadTheme.of(context).colorScheme.border),
        ),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(
          children: [
            for (final s in JobState.values)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: _StateBadge(state: s, selected: filter.contains(s)),
              ),
          ],
        ),
      ),
    );
  }
}

class _StateBadge extends StatelessWidget {
  const new({required this.state, required this.selected});

  final JobState state;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final filter = context.read<JobsBloc>().state.filter;
    void toggle() {
      final next = <JobState>{...filter};
      if (selected) {
        next.remove(state);
      } else {
        next.add(state);
      }
      context.read<JobsBloc>().add(JobsFilterChanged(next));
    }

    final child = Text(state.name);
    if (selected) {
      return ShadBadge.secondary(onPressed: toggle, child: child);
    }
    return ShadBadge.outline(onPressed: toggle, child: child);
  }
}

class _JobsBody extends StatelessWidget {
  const new();

  @override
  Widget build(BuildContext context) {
    final state = context.watch<JobsBloc>().state;
    switch (state.status) {
      case JobsStatus.initial:
      case JobsStatus.loading:
        return const ScoriaSkeleton();
      case JobsStatus.failure:
        return ScoriaFailure(
          message: state.error ?? 'Could not load jobs',
          onRetry: () => context.read<JobsBloc>().add(const JobsRefreshed()),
        );
      case JobsStatus.success:
        if (state.jobs.isEmpty) {
          return const ScoriaEmpty('No jobs.');
        }
        return ListView.separated(
          itemCount: state.jobs.length,
          separatorBuilder: (_, _) => const ScoriaDivider.horizontal(),
          itemBuilder: (context, i) => _JobTile(job: state.jobs[i]),
        );
    }
  }
}

class _JobTile extends StatelessWidget {
  const new({required this.job});

  final JobRecord job;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final subtitle = [
      if (job.attempt > 0) 'attempt ${job.attempt}',
      ?job.subjectClass,
      ?job.error,
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          Icon(
            _iconFor(job.state),
            size: 16,
            color: _colorFor(job.state, theme.colorScheme),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(job.name, style: theme.textTheme.p),
                if (subtitle.isNotEmpty)
                  Text(
                    subtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.muted,
                  ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              _badge(job.state),
              const SizedBox(height: 4),
              Text(
                _ago(job.completedAt ?? job.startedAt ?? job.createdAt),
                style: theme.textTheme.muted,
              ),
            ],
          ),
        ],
      ),
    );
  }

  static IconData _iconFor(JobState state) => switch (state) {
    JobState.created => LucideIcons.clock,
    JobState.retry => LucideIcons.rotateCcw,
    JobState.active => LucideIcons.play,
    JobState.completed => LucideIcons.circleCheck,
    JobState.cancelled => LucideIcons.ban,
    JobState.failed => LucideIcons.circleAlert,
  };

  static Color _colorFor(JobState state, ShadColorScheme scheme) =>
      switch (state) {
        JobState.failed => scheme.destructive,
        JobState.active || JobState.completed => scheme.foreground,
        _ => scheme.mutedForeground,
      };

  static Widget _badge(JobState state) {
    final child = Text(state.name);
    return switch (state) {
      JobState.failed => ShadBadge.destructive(child: child),
      JobState.completed => ShadBadge.secondary(child: child),
      JobState.active => ShadBadge(child: child),
      _ => ShadBadge.outline(child: child),
    };
  }

  static String _ago(DateTime t) {
    final d = DateTime.now().toUtc().difference(t.toUtc());
    if (d.inMinutes < 1) return 'just now';
    if (d.inHours < 1) return '${d.inMinutes}m ago';
    if (d.inDays < 1) return '${d.inHours}h ago';
    return '${d.inDays}d ago';
  }
}

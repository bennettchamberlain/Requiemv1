import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:material_ui/material_ui.dart';
import 'package:scoria_api_client/scoria_api_client.dart';
import 'package:scoria_app/jobs/jobs.dart';
import 'package:scoria_models/scoria_models.dart';

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
    return Scaffold(
      appBar: AppBar(
        title: const Text('Jobs'),
        actions: [
          IconButton(
            key: const Key('jobs_refresh_button'),
            icon: const Icon(Icons.refresh),
            onPressed: () =>
                context.read<JobsBloc>().add(const JobsRefreshed()),
          ),
        ],
      ),
      body: const Column(
        children: [
          _StateFilter(),
          Expanded(child: _JobsBody()),
        ],
      ),
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
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: [
          for (final s in JobState.values)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: FilterChip(
                label: Text(s.name),
                selected: filter.contains(s),
                onSelected: (on) {
                  final next = <JobState>{...filter};
                  on ? next.add(s) : next.remove(s);
                  context.read<JobsBloc>().add(JobsFilterChanged(next));
                },
              ),
            ),
        ],
      ),
    );
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
        return const Center(child: CircularProgressIndicator());
      case JobsStatus.failure:
        return Center(child: Text(state.error ?? 'Could not load jobs'));
      case JobsStatus.success:
        if (state.jobs.isEmpty) {
          return const Center(child: Text('No jobs.'));
        }
        return ListView.separated(
          itemCount: state.jobs.length,
          separatorBuilder: (_, _) => const Divider(height: 1),
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
    final scheme = Theme.of(context).colorScheme;
    final (icon, color) = switch (job.state) {
      JobState.created => (Icons.schedule, scheme.outline),
      JobState.retry => (Icons.replay, scheme.tertiary),
      JobState.active => (Icons.play_arrow, scheme.primary),
      JobState.completed => (Icons.check_circle_outline, scheme.primary),
      JobState.cancelled => (Icons.block, scheme.outline),
      JobState.failed => (Icons.error_outline, scheme.error),
    };
    return ListTile(
      leading: Icon(icon, color: color),
      title: Text(job.name),
      subtitle: Text(
        [
          job.state.name,
          if (job.attempt > 0) 'attempt ${job.attempt}',
          ?job.subjectClass,
          ?job.error,
        ].join(' · '),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: Text(
        _ago(job.completedAt ?? job.startedAt ?? job.createdAt),
        style: Theme.of(context).textTheme.labelSmall,
      ),
    );
  }

  static String _ago(DateTime t) {
    final d = DateTime.now().toUtc().difference(t.toUtc());
    if (d.inMinutes < 1) return 'just now';
    if (d.inHours < 1) return '${d.inMinutes}m ago';
    if (d.inDays < 1) return '${d.inHours}h ago';
    return '${d.inDays}d ago';
  }
}

import { Component, type ReactNode } from 'react';

import { Card } from '@ci/shadcn';

interface PanelBoundaryProps {
  title: string;
  children: ReactNode;
}

interface PanelBoundaryState {
  error: Error | null;
}

/**
 * Per-panel error boundary so one crashing panel degrades to an inline notice
 * instead of blanking the whole predictions dashboard.
 */
export class PanelBoundary extends Component<PanelBoundaryProps, PanelBoundaryState> {
  state: PanelBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PanelBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Card>
          <Card.Header>
            <Card.Title>{this.props.title}</Card.Title>
          </Card.Header>
          <Card.Content>
            <p className="text-sm text-muted-foreground">
              This panel hit an error and could not render. The rest of the dashboard is unaffected.
            </p>
          </Card.Content>
        </Card>
      );
    }

    return this.props.children;
  }
}

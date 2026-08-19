import { useState } from 'react';

import { Badge } from '@ci/shadcn';

/** How many services a summary names before it starts counting them. */
const SHOWN = 3;

export interface ServiceBadgesProps {
  /** Already resolved to display titles, most rows first. */
  services: readonly string[];
  /**
   * Let the reader open the counted remainder.
   *
   * Only the opened run passes this. On a summary card in a four-column grid
   * there is no room to expand into, and the point of that card is to stay one
   * glance — the way to see everything is to open the run, which is a click
   * away either way.
   */
  expandable?: boolean;
  className?: string;
}

/**
 * What an import actually was.
 *
 * The run list could only show the uploaded archive's filename, so an import
 * read as "All Data Categories.zip" rather than as Audible and Prime Video.
 * These come from the parse stage, ranked by how many rows each contributed, so
 * the first badge is the one the archive is mostly about.
 *
 * Capped at three with a count for the rest: one Amazon export legitimately
 * matched seven parsers, and seven badges under a filename is not a summary.
 * Renders nothing at all for a run that has not parsed yet — an empty row of
 * badges would read as "nothing found" rather than "not known yet".
 */
export function ServiceBadges({ services, expandable = false, className }: ServiceBadgesProps) {
  const [expanded, setExpanded] = useState(false);

  if (services.length === 0) {
    return null;
  }

  const showAll = expanded && expandable;
  const shown = showAll ? services : services.slice(0, SHOWN);
  const rest = services.length - shown.length;

  return (
    <div className={className}>
      <ul className="flex flex-wrap items-center gap-1">
        {shown.map((service) => (
          <li key={service}>
            <Badge variant="secondary" className="capitalize">
              {service}
            </Badge>
          </li>
        ))}

        {rest > 0 && !expandable ? (
          <li>
            {/* Not expandable here, so the ones that did not fit are at least
                readable on hover. */}
            <Badge variant="outline" title={services.slice(SHOWN).join(', ')}>
              +{rest}
            </Badge>
          </li>
        ) : null}

        {expandable && (rest > 0 || showAll) ? (
          <li>
            {/* A toggle rather than a one-way reveal: expanding to seven badges
                and offering no way back is the same trap as a details view that
                could be opened and not closed. */}
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={showAll}
            >
              <Badge variant="outline" className="cursor-pointer hover:bg-accent">
                {showAll ? 'Show fewer' : `+${rest}`}
              </Badge>
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

export default ServiceBadges;

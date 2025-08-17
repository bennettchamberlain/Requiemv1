import React, { useMemo, useState } from 'react';

import { ChevronDown, ChevronRight, Brain } from '@ci/shadcn/icons';

import { cn } from '@/lib/utils';

interface ThinkBlockProps {
  content: string;
  defaultExpanded?: boolean;
}

export const ThinkBlock: React.FC<ThinkBlockProps> = ({ content, defaultExpanded = true }) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const trimmedContent = useMemo(() => content.trim(), [content]);

  if (!trimmedContent) {
    return null;
  }

  return (
    <div className="border border-amber-200 dark:border-amber-800/50 text-sm rounded-lg bg-amber-50/50 dark:bg-amber-950/20">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 p-3 hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors text-left"
      >
        <div className="flex items-center gap-2 flex-1">
          <Brain className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <span className="text-sm text-amber-700 dark:text-amber-300">AI thinking</span>
        </div>
        <div className="text-amber-600 dark:text-amber-400">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>

      {/* Content */}
      <div
        className={cn(
          'transition-all duration-200 ease-in-out overflow-hidden',
          isExpanded ? 'max-h-none opacity-100' : 'max-h-0 opacity-0',
        )}
      >
        <div className="p-3 border-t border-amber-200/50 dark:border-amber-800/30 space-y-2 whitespace-pre-wrap leading-relaxed">
          {trimmedContent}
        </div>
      </div>
    </div>
  );
};

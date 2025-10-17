import { Card } from '@ci/shadcn';
import { useNavigate } from 'react-router-dom';

import type { MemoryCardProps } from '../types';

interface GenericCardProps extends MemoryCardProps {
  Icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
}

export function GenericCard({ memory, Icon, iconColor }: GenericCardProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/search?q=${encodeURIComponent(memory.title)}`);
  };

  return (
    <Card
      className="!gap-2 !py-4 px-6 cursor-pointer hover:shadow-lg transition-shadow duration-200"
      onClick={handleClick}
    >
      <div className="flex items-start gap-3">
        <Icon className={`h-6 w-6 ${iconColor} flex-shrink-0 mt-1`} />
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-gray-900 truncate">{memory.title}</h3>
          <p className="text-sm text-gray-600">{memory.category}</p>
        </div>
      </div>

      {memory.description && (
        <div className="pt-3 pb-3">
          <p className="text-sm text-gray-700 leading-relaxed">{memory.description}</p>
        </div>
      )}

      {memory.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {memory.tags.map((tag, index) => (
            <span key={index} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full">
              {tag}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

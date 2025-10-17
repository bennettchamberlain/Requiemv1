import { Card } from '@ci/shadcn';
import { MapPin } from '@ci/shadcn/icons';
import { useNavigate } from 'react-router-dom';

import type { MemoryCardProps } from '../types';

export function PlaceCard({ memory }: MemoryCardProps) {
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
        <MapPin className="h-6 w-6 text-red-600 flex-shrink-0 mt-1" />
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

      {memory.location && (
        <div className="flex items-center gap-5">
          <MapPin className="h-4 w-4 text-gray-500 flex-shrink-0" />
          <div className="flex-1">
            <span className="text-sm text-gray-900">
              {memory.location.address || `${memory.location.lat}, ${memory.location.lng}`}
            </span>
          </div>
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

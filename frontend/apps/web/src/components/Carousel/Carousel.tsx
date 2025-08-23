import { type ReactNode, Children, useCallback, useEffect, useState } from 'react';

import { Button, cn } from '@ci/shadcn';
import { ChevronLeft, ChevronRight } from '@ci/shadcn/icons';
import useEmblaCarousel from 'embla-carousel-react';

interface CarouselProps {
  children: ReactNode;
  /** Additional CSS classes for the carousel elements */
  className?: string;
  containerClassName?: string;
  slideClassName?: string;
}

export function Carousel({ children, className, containerClassName, slideClassName }: CarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    containScroll: 'trimSnaps',
    dragFree: true,
  });

  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const scrollPrev = useCallback(() => {
    if (emblaApi) {
      emblaApi.scrollPrev();
    }
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    if (emblaApi) {
      emblaApi.scrollNext();
    }
  }, [emblaApi]);

  const onSelect = useCallback(() => {
    if (!emblaApi) {
      return;
    }

    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) {
      return;
    }

    onSelect();

    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);

    return () => {
      emblaApi.off('select', onSelect);
      emblaApi.off('reInit', onSelect);
    };
  }, [emblaApi, onSelect]);

  return (
    <div className="relative">
      <div ref={emblaRef} className={cn(className, 'overflow-hidden')}>
        <div className={cn(containerClassName, 'flex will-change-transform')}>
          {Children.map(children, (child, index) => (
            <div key={index} className={cn('min-w-0 flex-none basis-full', slideClassName)}>
              {child}
            </div>
          ))}
        </div>
      </div>

      {/* Navigation Buttons */}
      <Button
        variant="outline"
        size="icon"
        className={cn(
          'absolute left-4 top-1/2 transform -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-white/90 backdrop-blur-sm shadow-lg border border-gray-200 hover:bg-white transition-all duration-200',
          canScrollPrev ? 'opacity-100' : 'opacity-50 cursor-not-allowed',
        )}
        onClick={scrollPrev}
        disabled={!canScrollPrev}
        aria-label="Previous slide"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <Button
        variant="outline"
        size="icon"
        className={cn(
          'absolute right-4 top-1/2 transform -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-white/90 backdrop-blur-sm shadow-lg border border-gray-200 hover:bg-white transition-all duration-200',
          canScrollNext ? 'opacity-100' : 'opacity-50 cursor-not-allowed',
        )}
        onClick={scrollNext}
        disabled={!canScrollNext}
        aria-label="Next slide"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

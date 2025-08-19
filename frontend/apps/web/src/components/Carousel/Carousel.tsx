import React, { useCallback, useEffect, useState } from 'react';

import useEmblaCarousel from 'embla-carousel-react';

interface CarouselProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  slideWidth?: number;
  slideGap?: number;
}

export function Carousel({ children, className, title, slideWidth = 550, slideGap = 24 }: CarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    containScroll: 'trimSnaps',
    dragFree: true,
    axis: 'x',
    skipSnaps: true,
    slidesToScroll: 1,
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

    const canPrev = emblaApi.canScrollPrev();
    const canNext = emblaApi.canScrollNext();
    setCanScrollPrev(canPrev);
    setCanScrollNext(canNext);
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
    <div className={className}>
      {title && <h2 className="text-xl font-semibold text-gray-800 mb-4">{title}</h2>}
      <div className="relative">
        <div className="embla" ref={emblaRef} style={{ width: '100%', overflow: 'hidden' }}>
          <div className="embla__container" style={{ display: 'flex', flexDirection: 'row' }}>
            {React.Children.map(children, (child) => (
              <div
                className="embla__slide"
                style={{
                  flex: `0 0 ${slideWidth}px`,
                  minWidth: `${slideWidth}px`,
                  marginRight: `${slideGap}px`,
                  height: '500px',
                }}
              >
                {child}
              </div>
            ))}
          </div>
        </div>

        {/* Navigation Buttons */}
        <button
          className={`absolute left-4 top-1/2 transform -translate-y-1/2 z-10 p-2 rounded-full bg-white shadow-lg border border-gray-200 hover:bg-gray-50 transition-colors ${
            canScrollPrev ? 'opacity-100' : 'opacity-50 cursor-not-allowed'
          }`}
          onClick={scrollPrev}
          disabled={!canScrollPrev}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <button
          className={`absolute right-4 top-1/2 transform -translate-y-1/2 z-10 p-2 rounded-full bg-white shadow-lg border border-gray-200 hover:bg-gray-50 transition-colors ${
            canScrollNext ? 'opacity-100' : 'opacity-50 cursor-not-allowed'
          }`}
          onClick={scrollNext}
          disabled={!canScrollNext}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

import { Spinner, cn } from '@ci/shadcn';
import { useStream } from './useStream';

export function Feed() {
  const [{ isActive, videoRef }] = useStream();

  return (
    <>
      {!isActive && (
        <div className={cn('w-full h-full object-contain absolute inset-0 flex items-center justify-center')}>
          <Spinner size={64} variant="circle" />
        </div>
      )}

      <video
        className={cn('w-full h-full object-contain', isActive ? 'block' : 'hidden')}
        ref={videoRef}
        autoPlay
        playsInline
        muted
      ></video>
    </>
  );
}

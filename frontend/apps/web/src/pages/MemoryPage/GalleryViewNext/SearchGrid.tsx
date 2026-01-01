import { type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

export function SearchGrid({ children }: Props) {
  return (
    <div
      className="
        grid
        w-full
        gap-4
        justify-center
        grid-cols-[repeat(auto-fill,300px)]
        auto-rows-[300px]
      "
    >
      {children}
    </div>
  );
}

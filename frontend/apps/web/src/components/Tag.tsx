import { useMemo } from 'react';

import { Badge } from '@ci/shadcn';

interface Props {
  text: string;
}

export function Tag({ text }: Props) {
  const color = useMemo(() => getColorFromPalette(text), [text]);

  return <Badge className={color}>{text}</Badge>;
}

const palette = ['bg-teal-600'];

function getColorFromPalette(text: string) {
  const normalizedText = text.toLowerCase();

  let hash = 0;

  for (let i = 0; i < normalizedText.length; i++) {
    const charCode = normalizedText.charCodeAt(i);

    hash = (hash << 5) - hash + charCode;
    hash |= 0;
  }

  const index = Math.abs(hash) % palette.length;

  return palette[index];
}

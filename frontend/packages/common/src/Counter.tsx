import { useCallback, useState } from 'react';

export function Counter() {
  const [count, setCount] = useState(0);

  const handleClick = useCallback(() => setCount((count: number) => count + 1), [setCount]);

  return <button onClick={handleClick}>count is {count}</button>;
}

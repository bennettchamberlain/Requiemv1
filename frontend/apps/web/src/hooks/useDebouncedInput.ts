import { useState, useCallback, useMemo } from 'react';
import { useDebounce } from './useDebounce';

/**
 * Enhanced hook for handling debounced input with performance optimizations
 * @param initialValue - Initial input value
 * @param delay - Debounce delay in milliseconds (default: 300ms)
 * @returns Object containing input state, handlers, and debounced value
 */
export function useDebouncedInput<T extends string>(
  initialValue: T = '' as T,
  delay: number = 300
) {
  const [input, setInput] = useState<T>(initialValue);
  const debouncedInput = useDebounce(input, delay);

  // Memoized change handler to prevent unnecessary re-renders
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setInput(e.target.value as T);
  }, []);

  // Memoized direct setter for programmatic updates
  const setValue = useCallback((value: T) => {
    setInput(value);
  }, []);

  // Memoized clear function
  const clear = useCallback(() => {
    setInput('' as T);
  }, []);

  // Memoized computed values
  const isEmpty = useMemo(() => input.trim() === '', [input]);
  const hasValue = useMemo(() => input.trim() !== '', [input]);

  return {
    input,
    debouncedInput,
    handleChange,
    setValue,
    clear,
    isEmpty,
    hasValue,
  };
}

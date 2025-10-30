import { type ForwardedRef, type RefObject, forwardRef, useCallback, useEffect, useState } from 'react';

import {
  ScrollArea,
  ScrollBar,
  Input,
  Form,
  useForm,
  formDataResolver,
  formDataSchema as s,
} from '@ci/shadcn';
import { Search, X } from '@ci/shadcn/icons';

const FormSchema = s.object({
  query: s.string(),
});

export type FormData = s.infer<typeof FormSchema>;

const EMPTY: FormData = {
  query: '',
};

// Key constants
const Keys = {
  ESCAPE: 'Escape',
  ENTER: 'Enter',
  ARROW_UP: 'ArrowUp',
  ARROW_DOWN: 'ArrowDown',
} as const;

interface SearchResultItem {
  id: string;
  content: React.ReactNode;
}

interface Props {
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  results?: SearchResultItem[];
  onSearch?: (data: FormData) => boolean | void | Promise<boolean | void>;
  onResultSelect?: (result: SearchResultItem) => void;
}

function SearchBox(
  { disabled = false, placeholder, results = [], onSearch, onResultSelect }: Props,
  forwardedRef: ForwardedRef<HTMLInputElement>,
) {
  const form = useForm<FormData>({
    resolver: formDataResolver(FormSchema),
    defaultValues: EMPTY,
  });

  const queryValue = form.watch('query');
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  const handleSubmit = useCallback(
    async (data: FormData) => {
      if (data.query.trim() && !disabled) {
        const success = await onSearch?.(data);

        if (success === true) {
          form.reset();
          setSelectedIndex(-1);
        }
      }
    },
    [form, onSearch, disabled],
  );

  const handleClear = useCallback(() => {
    if (!disabled) {
      form.reset();
      setSelectedIndex(-1);
    }
  }, [form, disabled]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) {
        return;
      }

      switch (e.key) {
        case Keys.ESCAPE:
          e.preventDefault();
          form.reset();
          setSelectedIndex(-1);

          break;

        case Keys.ARROW_DOWN:
          if (results.length > 0) {
            e.preventDefault();
            setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
          }

          break;

        case Keys.ARROW_UP:
          if (results.length > 0) {
            e.preventDefault();
            setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
          }

          break;

        case Keys.ENTER:
          if (selectedIndex >= 0 && selectedIndex < results.length) {
            e.preventDefault();
            onResultSelect?.(results[selectedIndex]);
          }

          break;

        default:
          if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
            setSelectedIndex(-1);
          }

          break;
      }
    },
    [disabled, form, results, selectedIndex, onResultSelect],
  );

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [results]);

  // Reset selection when query is cleared
  useEffect(() => {
    if (!queryValue) {
      setSelectedIndex(-1);
    }
  }, [queryValue]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)}>
        <div
          className={`
            w-full
            flex
            flex-col

            placeholder:text-muted-foreground/60
            dark:bg-input/30
            field-sizing-content

            outline-none
            border
            shadow-xs
            rounded-md
            bg-transparent
            text-base
            md:text-sm

            aria-[invalid=true]:ring-destructive/20
            dark:aria-[invalid=true]:ring-destructive/40
            aria-[invalid=true]:border-destructive

            transition-[color,box-shadow]

            ${disabled ? 'cursor-not-allowed opacity-50 pointer-events-none' : ''}
          `}
        >
          <div className="flex items-center justify-center">
            <div className={`p-2 ${disabled ? 'text-muted-foreground' : ''}`}>
              <Search className="h-4 w-4" />
            </div>

            <Form.Field
              control={form.control}
              name="query"
              render={({ field }) => (
                <Input
                  {...field}
                  ref={(el) => {
                    field.ref(el);

                    if (typeof forwardedRef === 'function') {
                      forwardedRef(el);
                    } else if (forwardedRef) {
                      (forwardedRef as RefObject<HTMLInputElement | null>).current = el;
                    }
                  }}
                  placeholder={placeholder}
                  disabled={disabled}
                  onKeyDown={handleKeyDown}
                  className="
                    !w-full
                    !flex-1
                    !bg-transparent
                    !border-0
                    !outline-none
                    !ring-0
                    !shadow-none
                    !rounded-none
                    !p-0
                    !h-[calc(theme(spacing.9)-2px)]

                    focus:!ring-0
                    focus-visible:!ring-0
                    focus-visible:!border-transparent
                    focus:!border-transparent

                    disabled:!bg-transparent

                    resize-none
                    text-base
                    leading-none
                  "
                />
              )}
            />

            {queryValue.length > 0 && (
              <button
                type="button"
                disabled={disabled}
                className={`
                  p-2 bg-transparent border-0 flex items-center justify-center
                  ${
                    disabled
                      ? 'cursor-not-allowed text-muted-foreground'
                      : 'cursor-pointer hover:text-foreground'
                  }
                `}
                onClick={handleClear}
                onMouseDown={(e) => e.preventDefault()}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Results */}
          {queryValue.length > 0 && !disabled && results.length > 0 && (
            <div className="flex gap-2 border-t">
              <div className="flex-1 p-2">Preview goes here?</div>
              <ScrollArea className="flex-1/2">
                <div className="h-20">
                  {results.map((result, index) => (
                    <div
                      key={result.id}
                      className={`
                        p-2 cursor-pointer
                        ${index === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'}
                      `}
                      onClick={() => onResultSelect?.(result)}
                    >
                      {result.content}
                    </div>
                  ))}
                </div>
                <ScrollBar />
              </ScrollArea>
            </div>
          )}
        </div>
      </form>
    </Form>
  );
}

const SearchBoxForwarded = forwardRef(SearchBox);

export { SearchBoxForwarded as SearchBox };

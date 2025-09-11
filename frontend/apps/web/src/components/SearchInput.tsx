import {
  type ForwardedRef,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  forwardRef,
  useCallback,
} from 'react';

import { Button, Textarea, Form, Tooltip, useForm, formDataResolver, formDataSchema as s } from '@ci/shadcn';
import { Mic, Search } from '@ci/shadcn/icons';

const FormSchema = s.object({
  query: s.string(),
});

export type FormData = s.infer<typeof FormSchema>;

const EMPTY: FormData = {
  query: '',
};

const handleEnterSubmit = (e: KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  }
};

interface Props {
  disabled?: boolean;
  loading?: boolean;
  streaming?: boolean;
  placeholder?: string;
  onRecord?: (e: MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  onSubmit?: (data: FormData) => boolean | void | Promise<boolean | void>;
}

function SearchInput(
  { disabled = false, loading = false, placeholder, onRecord, onSubmit }: Props,
  forwardedRef: ForwardedRef<HTMLTextAreaElement>,
) {
  const form = useForm<FormData>({
    resolver: formDataResolver(FormSchema),
    defaultValues: EMPTY,
  });

  const handleRecord = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      onRecord?.(e);
    },
    [onRecord],
  );

  const handleSubmit = useCallback(
    async (data: FormData) => {
      if (data.query.trim()) {
        const success = await onSubmit?.(data);

        if (success === true) {
          form.reset();
        }
      }
    },
    [form, onSubmit],
  );

  return (
    <Tooltip.Provider>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <div className="w-full flex items-center gap-2">
            <div
              className="
                w-full
                flex
                items-center
                gap-1.5
                p-1.5

                placeholder:text-muted-foreground/60
                dark:bg-input/30
                field-sizing-content

                outline-none
                border
                shadow-xs
                rounded-md

                bg-transparent

                text-base

                focus-within:border-ring
                focus-within:ring-[2px]
                focus-within:ring-ring/30

                aria-[invalid=true]:ring-destructive/20
                dark:aria-[invalid=true]:ring-destructive/40
                aria-[invalid=true]:border-destructive

                disabled:cursor-not-allowed
                disabled:opacity-50
                transition-[color,box-shadow]

                md:text-sm
              "
            >
              <Form.Field
                control={form.control}
                name="query"
                render={({ field }) => (
                  <Textarea
                    {...field}
                    ref={(el) => {
                      field.ref(el);

                      if (typeof forwardedRef === 'function') {
                        forwardedRef(el);
                      } else if (forwardedRef) {
                        (forwardedRef as RefObject<HTMLTextAreaElement | null>).current = el;
                      }
                    }}
                    placeholder={placeholder}
                    disabled={loading || disabled}
                    className="
                      !w-full
                      !flex-1
                      !min-h-0
                      !bg-transparent
                      !border-0
                      !outline-none
                      !ring-0
                      !shadow-none
                      !rounded-none
                      !p-0
                      !ml-1

                      focus:!ring-0
                      focus-visible:!ring-0
                      focus-visible:!border-transparent
                      focus:!border-transparent

                      disabled:!bg-transparent

                      resize-none
                      text-base
                      leading-relaxed
                    "
                    onKeyDown={handleEnterSubmit}
                  />
                )}
              />

              <Tooltip>
                <Tooltip.Content side="bottom">Dictate</Tooltip.Content>
                <Tooltip.Trigger asChild>
                  <Button
                    type="button"
                    disabled={loading || disabled}
                    size="sm"
                    variant="ghost"
                    className="cursor-pointer h-8 w-8 p-0 active:scale-90 transition-transform duration-200 ease-out will-change-transform"
                    onClick={handleRecord}
                  >
                    <Mic className="h-4 w-4" />
                  </Button>
                </Tooltip.Trigger>
              </Tooltip>

              <Tooltip>
                <Tooltip.Content side="bottom">Search</Tooltip.Content>
                <Tooltip.Trigger asChild>
                  <Button
                    type="submit"
                    disabled={loading || disabled}
                    size="sm"
                    className="cursor-pointer h-8 w-8 p-0 active:scale-90 transition-transform duration-200 ease-out will-change-transform"
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </Tooltip.Trigger>
              </Tooltip>
            </div>
          </div>
        </form>
      </Form>
    </Tooltip.Provider>
  );
}

const SearchInputForwarded = forwardRef(SearchInput);

export { SearchInputForwarded as SearchInput };

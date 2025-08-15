import { type BaseSyntheticEvent, type FormEvent, type ReactNode, useCallback, useEffect } from 'react';

import { Button, Textarea, Form, useForm, formDataResolver, formDataSchema as s } from '@ci/shadcn';
import { Send, Square, MessageSquare } from '@ci/shadcn/icons';

const FormSchema = s.object({
  message: s.string(),
});

export type FormData = s.infer<typeof FormSchema>;

const EMPTY: FormData = {
  message: '',
};

interface Props {
  threadId?: string | null;
  onSubmit?: (data: FormData, e?: FormEvent<HTMLFormElement>) => void | Promise<void>;
  inputPlaceholder: string;
  isSubmitDisabled: boolean;
  submitButtonText: ReactNode;
  isLoading: boolean;
  handleStop: () => void;
}

export function ChatInput({
  threadId,
  onSubmit,
  inputPlaceholder,
  isSubmitDisabled,
  submitButtonText,
  isLoading,
  handleStop,
}: Props) {
  console.log('threadId', threadId);

  const form = useForm<FormData>({
    resolver: formDataResolver(FormSchema),
    defaultValues: EMPTY,
  });

  const handleSubmit = useCallback(
    (data: FormData, e?: BaseSyntheticEvent) => {
      onSubmit?.(data, e as FormEvent<HTMLFormElement>);
      form.reset();
    },
    [onSubmit],
  );

  useEffect(() => {
    form.reset();
  }, [threadId]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <div className="relative">
          <Form.Field
            control={form.control}
            name="message"
            render={({ field }) => (
              <Textarea
                {...field}
                placeholder={inputPlaceholder}
                className="resize-none min-h-[120px] text-base leading-relaxed pr-12 bg-background/80 backdrop-blur-sm border-border/50 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all duration-200 placeholder:text-muted-foreground/60"
              />
            )}
          />
          <Button
            type="submit"
            disabled={isSubmitDisabled}
            size="sm"
            className="absolute bottom-3 right-3 h-8 w-8 p-0 shadow-sm hover:shadow-md transition-all duration-200 hover:scale-105"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isSubmitDisabled} className="gap-2 shadow-sm">
            {submitButtonText}
          </Button>

          {isLoading && (
            <Button variant="destructive" onClick={handleStop} size="sm" className="shadow-sm">
              <Square className="h-4 w-4 mr-2" />
              Stop
            </Button>
          )}

          <Button
            disabled
            variant="outline"
            className="ml-auto gap-2 shadow-sm opacity-50 cursor-not-allowed"
            title="Voice input is currently disabled"
          >
            <MessageSquare className="h-4 w-4" />
            Voice (Disabled)
          </Button>
        </div>
      </form>
    </Form>
  );
}

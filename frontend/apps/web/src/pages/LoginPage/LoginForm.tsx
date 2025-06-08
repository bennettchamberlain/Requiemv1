import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Form, Input, LoadingButton, useForm } from '@ci/shadcn';
import { AlertCircleIcon } from '@ci/shadcn/icons';
import type { BaseSyntheticEvent } from 'react';
import { z } from 'zod';

import { useAuth } from '../../hooks';

const LoginFormSchema = z.object({
  email: z.string().email({
    message: 'Invalid email.',
  }),
  password: z.string(),
});

export type LoginFormData = z.infer<typeof LoginFormSchema>;

interface LoginFormProps {
  onSubmit?: (data: LoginFormData, e?: BaseSyntheticEvent) => void;
}

export function LoginForm({ onSubmit }: LoginFormProps) {
  const [{ loading, error }] = useAuth();

  const form = useForm<LoginFormData>({
    resolver: zodResolver(LoginFormSchema),
  });

  const handleSubmit = (data: LoginFormData, e?: BaseSyntheticEvent) => onSubmit?.(data, e);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="w-full space-y-6">
        <Form.Field
          control={form.control}
          name="email"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Username</Form.Label>
              <Form.Control>
                <Input placeholder="user@example.com" {...field} />
              </Form.Control>
              <Form.Message />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="password"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Password</Form.Label>
              <Form.Control>
                <Input {...field} type="password" />
              </Form.Control>
              <Form.Message />
            </Form.Item>
          )}
        />

        {error && (
          <Alert variant={'destructive'}>
            <AlertCircleIcon />
            <Alert.Title>{error.message}</Alert.Title>
          </Alert>
        )}

        <LoadingButton className="w-full" type="submit" loading={loading}>
          Submit
        </LoadingButton>
      </form>
    </Form>
  );
}

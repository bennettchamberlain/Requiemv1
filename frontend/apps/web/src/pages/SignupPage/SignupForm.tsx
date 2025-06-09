import {
  Alert,
  Form,
  Input,
  LoadingButton,
  useForm,
  formDataResolver,
  formDataSchema as s,
} from '@ci/shadcn';
import { AlertCircleIcon } from '@ci/shadcn/icons';
import type { BaseSyntheticEvent } from 'react';

import { useAuth } from '../../hooks';

const SignupFormSchema = s.object({
  name: s.string(),
  email: s.string().email({
    message: 'Invalid email.',
  }),
  password: s.string(),
});

export type SignupFormData = s.infer<typeof SignupFormSchema>;

interface SignupFormProps {
  onSubmit?: (data: SignupFormData, e?: BaseSyntheticEvent) => void;
}

export function SignupForm({ onSubmit }: SignupFormProps) {
  const [{ loading, error }] = useAuth();

  const form = useForm<SignupFormData>({
    resolver: formDataResolver(SignupFormSchema),
  });

  const handleSubmit = (data: SignupFormData, e?: BaseSyntheticEvent) => onSubmit?.(data, e);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="w-full space-y-6">
        <Form.Field
          control={form.control}
          name="name"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Name</Form.Label>
              <Form.Control>
                <Input {...field} />
              </Form.Control>
              <Form.Message />
            </Form.Item>
          )}
        />

        <Form.Field
          control={form.control}
          name="email"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Email</Form.Label>
              <Form.Control>
                <Input {...field} />
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
          Sign up
        </LoadingButton>
      </form>
    </Form>
  );
}

// {error && (
//               <div className="bg-destructive/15 text-destructive p-3 rounded-md mb-4 text-sm">
//                 {error.message}
//               </div>
//             )}

//             <form onSubmit={handleSubmit} className="space-y-4">
//               <div className="space-y-2">
//                 <Label htmlFor="name">Name</Label>
//                 <Input id="name" type="name" placeholder="Your Name" required />
//               </div>

//               <div className="space-y-2">
//                 <Label htmlFor="email">Email</Label>
//                 <Input id="email" type="email" placeholder="m@example.com" required />
//               </div>

//               <div className="space-y-2">
//                 <Label htmlFor="password">Password</Label>
//                 <Input id="password" type="password" required />
//               </div>

//               <Button type="submit" className="w-full" disabled={loading}>
//                 Sign up
//               </Button>
//             </form>

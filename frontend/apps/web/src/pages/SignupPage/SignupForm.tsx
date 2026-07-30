import { useEffect, type BaseSyntheticEvent } from 'react';

import { FetchJsonError, type FetchJsonIssue } from '@ci/common';
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

import { useFeatures } from '@/common/feature';

import { useAuth } from '../../hooks';

// Validation rules (password length etc.) live in the backend signup schema —
// the single source of truth. Server-reported issues are mapped onto the
// matching fields below instead of being duplicated here.
const SignupFormSchema = s.object({
  name: s.string(),
  email: s.string().email({
    message: 'Invalid email.',
  }),
  password: s.string(),
  signup_code: s.string().optional(),
});

const signupFields = new Set(Object.keys(SignupFormSchema.shape));

// A server issue maps onto the form only when its path names one of the
// form's fields and it carries a message; anything else (unknown paths,
// whole-body issues) falls back to the alert.
function fieldIssueTarget(issue: FetchJsonIssue): keyof SignupFormData | undefined {
  const field = issue.path?.[0];

  return typeof field === 'string' && signupFields.has(field) && issue.message
    ? (field as keyof SignupFormData)
    : undefined;
}

export type SignupFormData = s.infer<typeof SignupFormSchema>;

interface SignupFormProps {
  onSubmit?: (data: SignupFormData, e?: BaseSyntheticEvent) => void;
}

export function SignupForm({ onSubmit }: SignupFormProps) {
  const [{ loading, error }] = useAuth();

  const { isFeatureEnabled } = useFeatures();

  const form = useForm<SignupFormData>({
    resolver: formDataResolver(SignupFormSchema),
  });

  useEffect(() => {
    if (!(error instanceof FetchJsonError)) {
      return;
    }

    for (const issue of error.issues) {
      const field = fieldIssueTarget(issue);

      if (field) {
        form.setError(field, { type: 'server', message: issue.message });
      }
    }
  }, [error, form]);

  const hasFieldIssues =
    error instanceof FetchJsonError && error.issues.some((issue) => fieldIssueTarget(issue) != null);

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

        {isFeatureEnabled('require.signup.codes') && (
          <Form.Field
            control={form.control}
            name="signup_code"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Signup Code</Form.Label>
                <Form.Control>
                  <Input {...field} />
                </Form.Control>
                <Form.Message />
              </Form.Item>
            )}
          />
        )}

        {error != null && !hasFieldIssues && (
          <Alert variant={'destructive'}>
            <AlertCircleIcon />
            <Alert.Title>{(error as Error).message}</Alert.Title>
          </Alert>
        )}

        <LoadingButton className="w-full" type="submit" loading={loading}>
          Sign up
        </LoadingButton>
      </form>
    </Form>
  );
}

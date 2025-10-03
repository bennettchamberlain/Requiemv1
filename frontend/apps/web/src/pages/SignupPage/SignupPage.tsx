import type { BaseSyntheticEvent } from 'react';

import { Button, Card } from '@ci/shadcn';
import { Link } from 'react-router-dom';

import { useAuth } from '@/hooks';

import { SignupForm, type SignupFormData } from './SignupForm';

export function SignupPage() {
  const [, { signup }] = useAuth();

  const handleSubmit = async (data: SignupFormData, e?: BaseSyntheticEvent) => {
    e?.preventDefault();

    await signup(data.name, data.email, data.password, data.signup_code);
  };

  return (
    <div className="w-full max-w-sm">
      <Card>
        <Card.Header>
          <Card.Title>Create an Account</Card.Title>
          <Card.Description>Enter your information to create an account</Card.Description>
        </Card.Header>

        <Card.Content>
          <SignupForm onSubmit={handleSubmit} />
        </Card.Content>
      </Card>

      <div className="mt-2 text-center text-sm">
        Already have an account?{' '}
        <Button variant="link" className="p-0" asChild>
          <Link to="/login">Log in</Link>
        </Button>
      </div>
    </div>
  );
}

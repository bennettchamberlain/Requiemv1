import type { BaseSyntheticEvent } from 'react';

import { Button, Card } from '@ci/shadcn';
import { Link } from 'react-router-dom';

import { useAuth } from '@/hooks';

import { LoginForm, type LoginFormData } from './LoginForm';

export function LoginPage() {
  const [, { login }] = useAuth();

  const handleSubmit = async (data: LoginFormData, e?: BaseSyntheticEvent) => {
    e?.preventDefault();

    await login(data.email, data.password);
  };

  return (
    <div className="w-full max-w-sm">
      <Card>
        <Card.Header>
          <Card.Title>Log In</Card.Title>
          <Card.Description>Enter your information to access your account</Card.Description>
        </Card.Header>

        <Card.Content>
          <LoginForm onSubmit={handleSubmit} />
        </Card.Content>
      </Card>

      <div className="mt-2 text-center text-sm">
        Don't have an account?{' '}
        <Button variant="link" className="p-0" asChild>
          <Link to="/signup">Sign up</Link>
        </Button>
      </div>
    </div>
  );
}

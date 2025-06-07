import { Link } from 'react-router-dom';
import { Button, Card, CardHeader, CardTitle, CardContent, CardDescription, Input, Label } from '@ci/shadcn';

import { useAuth } from '../hooks';

export default function LoginPage() {
  const [{ loading, error }, { login }] = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const form = e.currentTarget;
    const email = (form.querySelector('#email') as HTMLInputElement)?.value;
    const password = (form.querySelector('#password') as HTMLInputElement)?.value;

    await login(email, password);
  };

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>Log In</CardTitle>
            <CardDescription>Enter your information to access your account</CardDescription>
          </CardHeader>

          <CardContent>
            {error && (
              <div className="bg-destructive/15 text-destructive p-3 rounded-md mb-4 text-sm">
                {error.message}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="Enter your email" required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" placeholder="Enter your password" required />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                Login
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="mt-2 text-center text-sm">
          Don't have an account?{' '}
          <Button variant="link" className="p-0" asChild>
            <Link to="/signup">Sign up</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

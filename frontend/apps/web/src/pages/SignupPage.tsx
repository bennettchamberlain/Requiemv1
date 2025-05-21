import { useState } from 'react';
import { SignupForm } from '@/components/signup-form';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const name = (form.querySelector('#name') as HTMLInputElement)?.value;
    const email = (form.querySelector('#email') as HTMLInputElement)?.value;
    const password = (form.querySelector('#password') as HTMLInputElement)?.value;

    try {
      await signup(name, email, password);
      navigate('/dashboard');
    } catch (err) {
      setError('Signup failed. Please try again with a different email.', err);
    }
  };

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold">Create an Account</h1>
          <p className="text-sm text-muted-foreground mt-2">Enter your information to create an account</p>
        </div>

        {error && (
          <div className="bg-destructive/15 text-destructive p-3 rounded-md mb-4 text-sm">{error}</div>
        )}

        <SignupForm onSubmit={handleSubmit} />

        <div className="mt-6 text-center text-sm">
          Already have an account?{' '}
          <Button variant="link" className="p-0" asChild>
            <Link to="/login">Log in</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

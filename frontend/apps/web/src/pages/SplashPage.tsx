import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

export function SplashPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-svh p-6 text-center">
      <h1 className="text-4xl font-bold mb-6">Welcome to Our App</h1>
      <p className="text-lg mb-8 max-w-md">
        Experience the power of our application. Sign up now to get started or log in to continue your journey.
      </p>
      <div className="flex gap-4">
        <Button asChild>
          <Link to="/signup">Sign Up</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/login">Log In</Link>
        </Button>
      </div>
    </div>
  );
}

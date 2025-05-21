import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface User {
  id: string;
  name: string;
  email: string;
}

export function AdminPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      console.log('AdminPage: Starting to fetch users');
      setLoading(true);
      setError(null);
      // Get the token from localStorage
      const token = localStorage.getItem('feathers-jwt');
      
      if (!token) {
        console.error('AdminPage: No authentication token found');
        throw new Error('Authentication token not found');
      }
      
      console.log('AdminPage: Making API request to /api/users');
      const response = await fetch('/api/users', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        // Handle different HTTP error codes
        console.error(`AdminPage: API request failed with status ${response.status}: ${response.statusText}`);
        if (response.status === 401) {
          throw new Error('Unauthorized: You do not have permission to access this resource');
        } else if (response.status === 403) {
          throw new Error('Forbidden: Admin access required');
        } else if (response.status === 404) {
          throw new Error('API endpoint not found');
        } else if (response.status >= 500) {
          throw new Error('Server error: Please try again later');
        } else {
          throw new Error(`Error fetching users: ${response.statusText}`);
        }
      }

      console.log('AdminPage: API request successful, parsing response');
      const data = await response.json();
      
      if (!Array.isArray(data)) {
        console.error('AdminPage: Invalid response format', data);
        throw new Error('Invalid response format: Expected an array of users');
      }
      
      console.log(`AdminPage: Successfully fetched ${data.length} users`, data);
      setUsers(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      console.error('AdminPage: Error in fetchUsers():', errorMessage, err);
      setError(errorMessage);
    } finally {
      console.log('AdminPage: Fetch operation completed');
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log('AdminPage: Component mounted, fetching users');
    fetchUsers();
    
    return () => {
      console.log('AdminPage: Component unmounting');
    };
  }, []);

  return (
    <div className="container mx-auto py-8 px-4">
      <Card className="w-full">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-2xl">Admin Panel</CardTitle>
          <Button 
            variant="outline" 
            size="icon" 
            onClick={fetchUsers} 
            disabled={loading}
            title="Refresh users"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p>Loading users...</p>
            </div>
          ) : error ? (
            <div className="bg-destructive/10 text-destructive rounded-md p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-medium">Error loading users</h3>
                <p className="text-sm">{error}</p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-2" 
                  onClick={fetchUsers}
                >
                  Try Again
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                        No users found in the system
                      </TableCell>
                    </TableRow>
                  ) : (
                    users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-mono text-xs">{user.id}</TableCell>
                        <TableCell>{user.name || 'N/A'}</TableCell>
                        <TableCell>{user.email}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <div className="text-xs text-muted-foreground mt-4">
                Total users: {users.length}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

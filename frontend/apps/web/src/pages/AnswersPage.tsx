import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

import { useAuth } from '../hooks';

interface Answer {
  id: string;
  created: string;
  updated: string;
  user_id: string;
  question_id: string;
  rag_answer_1?: string;
  rag_answer_2?: string;
  rag_answer_3?: string;
  give_answer_current?: string;
  give_answer_2?: string;
  give_answer_3?: string;
  give_answer_4?: string;
  give_answer_5?: string;
}

export default function AnswersPage() {
  const [{ user }] = useAuth();
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnswers = async () => {
    try {
      console.log('AnswersPage: Starting to fetch answers');
      setLoading(true);
      setError(null);
      // Get the token from localStorage
      const token = localStorage.getItem('feathers-jwt');

      if (!token) {
        console.error('AnswersPage: No authentication token found');
        throw new Error('Authentication token not found');
      }

      console.log('AnswersPage: Making API request to http://dev.companionintelligence.com/api/answers');
      const response = await fetch('http://dev.companionintelligence.com/api/answers', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        // Handle different HTTP error codes
        console.error(
          `AnswersPage: API request failed with status ${response.status}: ${response.statusText}`,
        );
        if (response.status === 401) {
          throw new Error('Unauthorized: You do not have permission to access this resource');
        } else if (response.status === 403) {
          throw new Error('Forbidden: Access denied');
        } else if (response.status === 404) {
          throw new Error('API endpoint not found');
        } else if (response.status >= 500) {
          throw new Error('Server error: Please try again later');
        } else {
          throw new Error(`Error fetching answers: ${response.statusText}`);
        }
      }

      console.log('AnswersPage: API request successful, parsing response');
      const data = await response.json();

      // Handle both array response and paginated response
      let answersData: Answer[] = [];
      if (Array.isArray(data)) {
        answersData = data;
      } else if (data.data && Array.isArray(data.data)) {
        answersData = data.data;
      } else {
        console.error('AnswersPage: Invalid response format', data);
        throw new Error('Invalid response format: Expected an array of answers');
      }

      console.log(`AnswersPage: Successfully fetched ${answersData.length} answers`, answersData);
      setAnswers(answersData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      console.error('AnswersPage: Error in fetchAnswers():', errorMessage, err);
      setError(errorMessage);
    } finally {
      console.log('AnswersPage: Fetch operation completed');
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log('AnswersPage: Component mounted, fetching answers');
    fetchAnswers();

    return () => {
      console.log('AnswersPage: Component unmounting');
    };
  }, []);

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  };

  const truncateText = (text: string | undefined, maxLength: number = 50) => {
    if (!text) return 'N/A';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <Card className="w-full">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-2xl">Answers</CardTitle>
          <Button
            variant="outline"
            size="icon"
            onClick={fetchAnswers}
            disabled={loading}
            title="Refresh answers"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p>Loading answers...</p>
            </div>
          ) : error ? (
            <div className="bg-destructive/10 text-destructive rounded-md p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-medium">Error loading answers</h3>
                <p className="text-sm">{error}</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={fetchAnswers}>
                  Try Again
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead>User ID</TableHead>
                      <TableHead>Question ID</TableHead>
                      <TableHead>Current Answer</TableHead>
                      <TableHead>RAG Answer 1</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {answers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No answers found in the system
                        </TableCell>
                      </TableRow>
                    ) : (
                      answers.map((answer) => (
                        <TableRow key={answer.id}>
                          <TableCell className="font-mono text-xs">{answer.id.substring(0, 8)}...</TableCell>
                          <TableCell className="text-xs">{formatDate(answer.created)}</TableCell>
                          <TableCell className="text-xs">{formatDate(answer.updated)}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {answer.user_id.substring(0, 8)}...
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {answer.question_id.substring(0, 8)}...
                          </TableCell>
                          <TableCell className="text-sm">
                            {truncateText(answer.give_answer_current)}
                          </TableCell>
                          <TableCell className="text-sm">{truncateText(answer.rag_answer_1)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="text-xs text-muted-foreground mt-4">Total answers: {answers.length}</div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

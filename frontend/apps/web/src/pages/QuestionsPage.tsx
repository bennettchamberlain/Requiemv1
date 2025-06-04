import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

import { useAuth } from '../hooks';

interface Question {
  id: string;
  category: string;
  text: string;
  answer: string;
}

export default function QuestionsPage() {
  const [{ authToken }] = useAuth();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQuestions = async () => {
    try {
      console.log('QuestionsPage: Starting to fetch questions');
      setLoading(true);
      setError(null);

      if (!authToken) {
        console.error('QuestionsPage: No authentication token found');
        throw new Error('Authentication token not found');
      }

      console.log('QuestionsPage: Making API request to http://dev.companionintelligence.com/api/questions');
      const response = await fetch('http://dev.companionintelligence.com/api/questions', {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        // Handle different HTTP error codes
        console.error(
          `QuestionsPage: API request failed with status ${response.status}: ${response.statusText}`,
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
          throw new Error(`Error fetching questions: ${response.statusText}`);
        }
      }

      console.log('QuestionsPage: API request successful, parsing response');
      const data = await response.json();

      // Handle both array response and paginated response
      let questionsData: Question[] = [];
      if (Array.isArray(data)) {
        questionsData = data;
      } else if (data.data && Array.isArray(data.data)) {
        questionsData = data.data;
      } else {
        console.error('QuestionsPage: Invalid response format', data);
        throw new Error('Invalid response format: Expected an array of questions');
      }

      console.log(`QuestionsPage: Successfully fetched ${questionsData.length} questions`, questionsData);
      setQuestions(questionsData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      console.error('QuestionsPage: Error in fetchQuestions():', errorMessage, err);
      setError(errorMessage);
    } finally {
      console.log('QuestionsPage: Fetch operation completed');
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log('QuestionsPage: Component mounted, fetching questions');
    fetchQuestions();

    return () => {
      console.log('QuestionsPage: Component unmounting');
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

  const formatTags = (tags: string[] | undefined) => {
    if (!tags || tags.length === 0) return 'N/A';
    return tags.length > 2 ? `${tags.slice(0, 2).join(', ')}... (+${tags.length - 2})` : tags.join(', ');
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <Card className="w-full">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-2xl">Questions</CardTitle>
          <Button
            variant="outline"
            size="icon"
            onClick={fetchQuestions}
            disabled={loading}
            title="Refresh questions"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p>Loading questions...</p>
            </div>
          ) : error ? (
            <div className="bg-destructive/10 text-destructive rounded-md p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-medium">Error loading questions</h3>
                <p className="text-sm">{error}</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={fetchQuestions}>
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
                      <TableHead>Category</TableHead>
                      <TableHead>Question</TableHead>
                      <TableHead>Answer</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {questions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No questions found in the system
                        </TableCell>
                      </TableRow>
                    ) : (
                      questions.map((question) => (
                        <TableRow key={question.id}>
                          <TableCell className="font-mono text-xs">{question.id}</TableCell>
                          <TableCell className="text-sm">{question.category || 'N/A'}</TableCell>
                          <TableCell className="text-sm">{truncateText(question.text)}</TableCell>
                          <TableCell className="text-sm">{truncateText(question.answer)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="text-xs text-muted-foreground mt-4">Total questions: {questions.length}</div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

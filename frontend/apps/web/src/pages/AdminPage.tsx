import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { AlertCircle, RefreshCw, Play, Pause, Trash2, RotateCcw, Clock, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

const API_BASE = 'http://dev.companionintelligence.com/api';

interface JobStatus {
  id: string;
  name: string;
  data: any;
  progress: number;
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused';
  createdAt: string;
  processedAt?: string;
  finishedAt?: string;
  attempts: number;
  failedReason?: string;
  returnValue?: any;
  queue: string;
  priority: number;
}

interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  total: number;
}

export default function AdminPage() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [queueStats, setQueueStats] = useState<QueueStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('jobs');
  const [filterQueue, setFilterQueue] = useState<string>('');
  const [filterState, setFilterState] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const fetchJobs = async () => {
    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem('feathers-jwt');
      const params = new URLSearchParams();
      if (filterQueue) params.append('queue', filterQueue);
      if (filterState) params.append('state', filterState);

      const res = await fetch(`${API_BASE}/admin/jobs?${params}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw new Error(res.statusText);

      const data = await res.json();
      setJobs(data.jobs || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch jobs');
    } finally {
      setLoading(false);
    }
  };

  const fetchQueueStats = async () => {
    try {
      const token = localStorage.getItem('feathers-jwt');
      const res = await fetch(`${API_BASE}/dashboard/queues`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(res.statusText);

      const data = await res.json();
      setQueueStats(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch queue stats');
    }
  };

  const performJobAction = async (action: string, jobId?: string, queueName?: string) => {
    try {
      const response = await fetch(`${API_BASE}/admin/jobs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('feathers-jwt')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, jobId, queueName }),
      });

      if (!response.ok) {
        throw new Error(`Failed to perform action: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('Action result:', result);
      
      // Refresh data after action
      await fetchJobs();
      await fetchQueueStats();
    } catch (error) {
      console.error('Error performing action:', error);
      alert(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  useEffect(() => {
    fetchJobs();
    fetchQueueStats();
  }, [filterQueue, filterState]);

  const getStateIcon = (state: string) => {
    switch (state) {
      case 'completed': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'active': return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'waiting': return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'delayed': return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      case 'paused': return <Pause className="h-4 w-4 text-gray-500" />;
      default: return <AlertCircle className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStateBadgeVariant = (state: string) => {
    switch (state) {
      case 'completed': return 'default';
      case 'failed': return 'destructive';
      case 'active': return 'default';
      case 'waiting': return 'secondary';
      case 'delayed': return 'outline';
      case 'paused': return 'secondary';
      default: return 'outline';
    }
  };

  const filteredJobs = jobs.filter(job => {
    const matchesSearch = !searchTerm || 
      job.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.queue.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesSearch;
  });

  if (!user) {
    return <div>Please log in to access the admin panel.</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Job Queue Administration</h1>
        <Button onClick={() => { fetchJobs(); fetchQueueStats(); }} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2 text-red-600">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="jobs">Jobs Management</TabsTrigger>
          <TabsTrigger value="queues">Queue Statistics</TabsTrigger>
          <TabsTrigger value="health">System Health</TabsTrigger>
        </TabsList>

        <TabsContent value="jobs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Job Filters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex space-x-4">
                <Input
                  placeholder="Search jobs..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="flex-1"
                />
                <Select value={filterQueue} onValueChange={setFilterQueue}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Filter by queue" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All Queues</SelectItem>
                    <SelectItem value="ai-processing">AI Processing</SelectItem>
                    <SelectItem value="notifications">Notifications</SelectItem>
                    <SelectItem value="data-processing">Data Processing</SelectItem>
                    <SelectItem value="batch-processing">Batch Processing</SelectItem>
                    <SelectItem value="pipeline">Pipeline</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterState} onValueChange={setFilterState}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Filter by state" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All States</SelectItem>
                    <SelectItem value="waiting">Waiting</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="delayed">Delayed</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Jobs ({filteredJobs.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Queue</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredJobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-mono text-sm">{job.id}</TableCell>
                      <TableCell>{job.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{job.queue}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          {getStateIcon(job.state)}
                          <Badge variant={getStateBadgeVariant(job.state)}>
                            {job.state}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          <Progress value={job.progress} className="w-16" />
                          <span className="text-sm text-gray-500">{job.progress}%</span>
                        </div>
                      </TableCell>
                      <TableCell>{job.priority}</TableCell>
                      <TableCell className="text-sm text-gray-500">
                        {new Date(job.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex space-x-1">
                          {job.state === 'failed' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => performJobAction('retry', job.id)}
                            >
                              <RotateCcw className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => performJobAction('remove', job.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="queues" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {queueStats.map((queue) => (
              <Card key={queue.name}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{queue.name}</CardTitle>
                    <div className="flex space-x-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => performJobAction('pause', undefined, queue.name)}
                      >
                        <Pause className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => performJobAction('resume', undefined, queue.name)}
                      >
                        <Play className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => performJobAction('clean', undefined, queue.name)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Waiting:</span>
                      <Badge variant="secondary">{queue.waiting}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Active:</span>
                      <Badge variant="default">{queue.active}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Completed:</span>
                      <Badge variant="outline">{queue.completed}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Failed:</span>
                      <Badge variant="destructive">{queue.failed}</Badge>
                    </div>
                    <div className="flex justify-between font-medium">
                      <span>Total:</span>
                      <Badge>{queue.total}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="health">
          <SystemHealthComponent />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// System Health Component
function SystemHealthComponent() {
  const [healthData, setHealthData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealthData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('feathers-jwt');
      const res = await fetch(`${API_BASE}/health/detailed`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      setHealthData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch health data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealthData();
    const interval = setInterval(fetchHealthData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div>Loading health data...</div>;
  if (error) return <div className="text-red-600">Error: {error}</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <span>System Status</span>
            <Badge variant={healthData.status === 'healthy' ? 'default' : 'destructive'}>
              {healthData.status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <h4 className="font-medium mb-2">Uptime</h4>
              <p className="text-sm text-gray-600">
                {Math.floor(healthData.uptime / 3600000)}h {Math.floor((healthData.uptime % 3600000) / 60000)}m
              </p>
            </div>
            <div>
              <h4 className="font-medium mb-2">Memory Usage</h4>
              <div className="space-y-1">
                <Progress value={healthData.memory.percentage} />
                <p className="text-sm text-gray-600">
                  {Math.round(healthData.memory.percentage)}% ({Math.round(healthData.memory.used / 1024 / 1024)}MB used)
                </p>
              </div>
            </div>
            <div>
              <h4 className="font-medium mb-2">Redis</h4>
              <div className="flex items-center space-x-2">
                {healthData.redis.connected ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                <span className="text-sm">
                  {healthData.redis.connected ? 'Connected' : 'Disconnected'}
                  {healthData.redis.connected && ` (${healthData.redis.ping}ms)`}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Service Health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(healthData.services).map(([name, service]: [string, any]) => (
              <div key={name} className="flex items-center justify-between p-3 border rounded">
                <div className="flex items-center space-x-3">
                  {service.status === 'up' ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-500" />
                  )}
                  <span className="font-medium">{name}</span>
                </div>
                <div className="text-sm text-gray-600">
                  {service.responseTime && `${service.responseTime}ms`}
                  <Badge variant={service.status === 'up' ? 'default' : 'destructive'} className="ml-2">
                    {service.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

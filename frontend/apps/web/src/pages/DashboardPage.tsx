import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChartContainer } from '@/components/ui/chart';
import * as Recharts from 'recharts';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const API_BASE = 'http://dev.companionintelligence.com/api';

export function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = async () => {
    setLoading(true);
    setError(null);
    const token = localStorage.getItem('feathers-jwt');
    try {
      const res = await fetch(`${API_BASE}/dashboard/metrics`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setMetrics(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!user) return <div>Please log in to view the dashboard.</div>;
  if (loading) return <div className="p-6">Loading dashboard...</div>;
  if (error) return <div className="p-6 text-red-600">Error: {error}</div>;

  // prepare data
  const throughputData = Object.entries(metrics.queueThroughput || {}).map(([queue, value]) => ({ queue, value }));

  return (
    <main className="flex flex-col h-full">
      <header className="flex h-16 items-center px-4 border-b">
        <SidebarTrigger />
        <div className="ml-auto flex items-center gap-2">
          <span>Welcome, {user.name || user.email}</span>
          <Button variant="outline" size="sm" onClick={handleLogout}>Logout</Button>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card>
            <CardHeader><CardTitle>Total Jobs</CardTitle></CardHeader>
            <CardContent><span className="text-2xl font-semibold">{metrics.totalJobs}</span></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Active Jobs</CardTitle></CardHeader>
            <CardContent><span className="text-2xl font-semibold">{metrics.activeJobs}</span></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Completed Today</CardTitle></CardHeader>
            <CardContent><span className="text-2xl font-semibold">{metrics.completedToday}</span></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Failed Today</CardTitle></CardHeader>
            <CardContent><span className="text-2xl font-semibold text-red-600">{metrics.failedToday}</span></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Avg. Proc. Time (ms)</CardTitle></CardHeader>
            <CardContent><span className="text-2xl font-semibold">{metrics.avgProcessingTime}</span></CardContent>
          </Card>
        </div>

        {/* Queue Throughput Chart */}
        <Card>
          <CardHeader><CardTitle>Queue Throughput (jobs/sec)</CardTitle></CardHeader>
          <CardContent>
            <ChartContainer id="queue-throughput" config={{ value: { label: 'Throughput', color: '#4f46e5' } }}>
              <Recharts.BarChart data={throughputData} margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
                <Recharts.XAxis dataKey="queue" />
                <Recharts.YAxis />
                <Recharts.Tooltip />
                <Recharts.Bar dataKey="value" fill="var(--color-value)" />
              </Recharts.BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Recent Activity Table */}
        <Card>
          <CardHeader><CardTitle>Recent Activity</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Job ID</TableHead>
                  <TableHead>Queue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(metrics.recentActivity || []).map((act: any) => (
                  <TableRow key={act.timestamp + act.jobId}>
                    <TableCell>{new Date(act.timestamp).toLocaleTimeString()}</TableCell>
                    <TableCell>
                      <Badge variant={act.type === 'failed' ? 'destructive' : act.type === 'completed' ? 'default' : 'secondary'}>
                        {act.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{act.jobId}</TableCell>
                    <TableCell>{act.queue}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

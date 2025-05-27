import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChartContainer } from '@/components/ui/chart';
import * as Recharts from 'recharts';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

import { ChartAreaInteractive } from '@/components/chart-area-interactive';
import { 
  Activity, 
  Calendar, 
  MessageSquare, 
  TrendingUp, 
  Users, 
  Brain,
  Target,
  Sparkles,
  Clock,
  CheckCircle2
} from 'lucide-react';

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

interface StatCard {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

const StatCard = ({ title, value, description, icon, trend }: StatCard) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      <div className="text-muted-foreground">{icon}</div>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
      {description && (
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      )}
      {trend && (
        <div className={`flex items-center text-xs mt-2 ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
          <TrendingUp className={`h-3 w-3 mr-1 ${!trend.isPositive && 'rotate-180'}`} />
          {trend.value}% from last week
        </div>
      )}
    </CardContent>
  </Card>
);

const ActivityItem = ({ time, activity, icon }: { time: string; activity: string; icon: React.ReactNode }) => (
  <div className="flex items-start space-x-3 py-3 border-b last:border-0">
    <div className="text-muted-foreground mt-0.5">{icon}</div>
    <div className="flex-1">
      <p className="text-sm">{activity}</p>
      <p className="text-xs text-muted-foreground">{time}</p>
    </div>
  </div>
);

const RecommendationItem = ({ title, description, icon }: { title: string; description: string; icon: React.ReactNode }) => (
  <div className="flex items-start space-x-3 p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
    <div className="text-primary mt-0.5">{icon}</div>
    <div className="flex-1">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  </div>
);

export function DashboardPage() {
  // Mock data for statistics
  const stats = [
    {
      title: "Total Activities",
      value: "2,847",
      description: "Tracked this month",
      icon: <Activity className="h-4 w-4" />,
      trend: { value: 12, isPositive: true }
    },
    {
      title: "Active Conversations",
      value: "23",
      description: "Across 5 AI coaches",
      icon: <MessageSquare className="h-4 w-4" />,
      trend: { value: 8, isPositive: true }
    },
    {
      title: "Tasks Completed",
      value: "156",
      description: "This week",
      icon: <CheckCircle2 className="h-4 w-4" />,
      trend: { value: 23, isPositive: true }
    },
    {
      title: "Insights Generated",
      value: "89",
      description: "Personal insights",
      icon: <Brain className="h-4 w-4" />,
      trend: { value: 5, isPositive: false }
    }
  ];

  const recentActivities = [
    { time: "2 minutes ago", activity: "Completed morning meditation session", icon: <Brain className="h-4 w-4" /> },
    { time: "1 hour ago", activity: "AI Coach suggested new productivity workflow", icon: <Sparkles className="h-4 w-4" /> },
    { time: "3 hours ago", activity: "Logged workout: 45 min cardio session", icon: <Activity className="h-4 w-4" /> },
    { time: "5 hours ago", activity: "Answered 3 personal development questions", icon: <MessageSquare className="h-4 w-4" /> },
    { time: "Yesterday", activity: "Weekly goal review completed", icon: <Target className="h-4 w-4" /> }
  ];

  const recommendations = [
    { 
      title: "Schedule Deep Work Time", 
      description: "Your productivity peaks at 10 AM. Block 2 hours tomorrow.",
      icon: <Clock className="h-4 w-4" />
    },
    { 
      title: "Connect with Sarah", 
      description: "It's been 2 weeks since your last conversation.",
      icon: <Users className="h-4 w-4" />
    },
    { 
      title: "Review Weekly Goals", 
      description: "3 goals need attention before Friday.",
      icon: <Target className="h-4 w-4" />
    },
    { 
      title: "Mindfulness Break", 
      description: "You've been active for 3 hours. Time for a 5-min break.",
      icon: <Brain className="h-4 w-4" />
    }
  ];

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
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <div className="flex items-center space-x-2">
          <span className="text-sm text-muted-foreground">
            Welcome back! Here's your personal intelligence overview.
          </span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <StatCard key={index} {...stat} />
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Activity Chart */}
        <div className="col-span-full lg:col-span-4">
          <ChartAreaInteractive />
        </div>

        {/* Recommendations */}
        <Card className="col-span-full md:col-span-1 lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Recommendations
            </CardTitle>
            <CardDescription>
              Personalized suggestions based on your patterns
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {recommendations.map((rec, index) => (
              <RecommendationItem key={index} {...rec} />
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Section */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Recent Activities */}
        <Card className="col-span-full md:col-span-1 lg:col-span-4">
          <CardHeader>
            <CardTitle>Recent Activities</CardTitle>
            <CardDescription>
              Your latest tracked activities and interactions
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentActivities.map((activity, index) => (
              <ActivityItem key={index} {...activity} />
            ))}
          </CardContent>
        </Card>

        {/* Quick Stats */}
        <Card className="col-span-full md:col-span-1 lg:col-span-3">
          <CardHeader>
            <CardTitle>Activity Insights</CardTitle>
            <CardDescription>
              Your personal patterns and habits
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Most Active Day</span>
                <span className="text-sm text-muted-foreground">Wednesday</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Peak Productivity</span>
                <span className="text-sm text-muted-foreground">10 AM - 12 PM</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Avg. Daily Activities</span>
                <span className="text-sm text-muted-foreground">94</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Streak</span>
                <span className="text-sm text-muted-foreground">12 days 🔥</span>
              </div>
            </div>
            
            <div className="pt-4 border-t">
              <h4 className="text-sm font-medium mb-3">Top Categories</h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full" />
                    <span className="text-sm">Work & Productivity</span>
                  </div>
                  <span className="text-sm text-muted-foreground">42%</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full" />
                    <span className="text-sm">Health & Fitness</span>
                  </div>
                  <span className="text-sm text-muted-foreground">28%</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-purple-500 rounded-full" />
                    <span className="text-sm">Learning & Growth</span>
                  </div>
                  <span className="text-sm text-muted-foreground">18%</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-orange-500 rounded-full" />
                    <span className="text-sm">Social & Relationships</span>
                  </div>
                  <span className="text-sm text-muted-foreground">12%</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

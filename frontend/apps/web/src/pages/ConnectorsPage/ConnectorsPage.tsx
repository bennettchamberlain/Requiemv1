import { useState, useEffect } from 'react';
import { Portal, usePageTitle } from '@ci/common';
import { Breadcrumb, Button, Card, Table, Toggle } from '@ci/shadcn';
import { AlertCircle, RefreshCw } from '@ci/shadcn/icons';

import { useAuth } from '@/hooks';

interface Connector {
  id: string;
  name: string;
  process: string;
  schedule: string;
  lastrun: string;
  enabled: boolean;
  user?: { id: string };
}

const ConnectorsData = [
  { id: "1", name: "google", process: "./connectors/googlehandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "2", name: "youtube", process: "./connectors/youtubehandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "3", name: "facebook", process: "./connectors/facebookhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "4", name: "instagram", process: "./connectors/instagramhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "5", name: "amazon", process: "./connectors/amazonhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "6", name: "whatsapp", process: "./connectors/whatsapphandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "7", name: "gmail", process: "./connectors/gmailhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "8", name: "tiktok", process: "./connectors/tiktokhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "9", name: "microsoft", process: "./connectors/microsofthandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "10", name: "apple", process: "./connectors/applehandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "11", name: "x", process: "./connectors/xhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "12", name: "reddit", process: "./connectors/reddithandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "13", name: "linkedin", process: "./connectors/linkedinhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "14", name: "netflix", process: "./connectors/netflixhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "15", name: "zoom", process: "./connectors/zoomhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "16", name: "wikipedia", process: "./connectors/wikipediahandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "17", name: "pinterest", process: "./connectors/pinteresthandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "18", name: "snapchat", process: "./connectors/snapchathandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "19", name: "discord", process: "./connectors/discordhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "20", name: "dropbox", process: "./connectors/dropboxhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "21", name: "spotify", process: "./connectors/spotifyhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "22", name: "twitch", process: "./connectors/twitchhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "23", name: "ebay", process: "./connectors/ebayhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "24", name: "paypal", process: "./connectors/paypalhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "25", name: "telegram", process: "./connectors/telegramhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "26", name: "bing", process: "./connectors/binghandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "27", name: "slack", process: "./connectors/slackhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "28", name: "salesforce", process: "./connectors/salesforcehandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "29", name: "canva", process: "./connectors/canvahandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "30", name: "quora", process: "./connectors/quorahandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "31", name: "yahoo", process: "./connectors/yahoohandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "32", name: "airbnb", process: "./connectors/airbnbhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "33", name: "uber", process: "./connectors/uberhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "34", name: "google maps", process: "./connectors/googlemapshandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "35", name: "google drive", process: "./connectors/googledrivehandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "36", name: "icloud", process: "./connectors/icloudhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "37", name: "outlook", process: "./connectors/outlookhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "38", name: "wechat", process: "./connectors/wechathandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "39", name: "tencent", process: "./connectors/tencenthandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "40", name: "baidu", process: "./connectors/baiduhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "41", name: "hulu", process: "./connectors/huluhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "42", name: "medium", process: "./connectors/mediumhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "43", name: "notion", process: "./connectors/notionhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "44", name: "substack", process: "./connectors/substackhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "45", name: "stack overflow", process: "./connectors/stackoverflowhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "46", name: "github", process: "./connectors/githubhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "47", name: "trello", process: "./connectors/trellohandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "48", name: "asana", process: "./connectors/asanahandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "49", name: "stripe", process: "./connectors/stripehandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true },
  { id: "50", name: "indeed", process: "./connectors/indeedhandler.js", schedule: "daily", lastrun: "yesterday", user: "1", enabled: true }
];



export function ConnectorsPage() {
  usePageTitle('Connectors - Companion Intelligence');

  const [{ authToken }] = useAuth();

  const [Connectors, setConnectors] = useState<Connector[]>([]);
  const [changes, setChanges] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConnectors = async () => {
    try {

      setLoading(true);
      setError(null);

      if (!authToken) {
        console.error('ConnectorsPage: No authentication token found');
        throw new Error('Authentication token not found');
      }
/*
      console.log('ConnectorsPage: Making API request to http://dev.companionintelligence.com/api/Connectors');
      const response = await fetch('http://dev.companionintelligence.com/api/Connectors', {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        // Handle different HTTP error codes
        console.error(
          `ConnectorsPage: API request failed with status ${response.status}: ${response.statusText}`,
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
          throw new Error(`Error fetching Connectors: ${response.statusText}`);
        }
      }

      console.log('ConnectorsPage: API request successful, parsing response');
      const data = await response.json();


      // Handle both array response and paginated response
      let ConnectorsData: Connector[] = [];
      if (Array.isArray(data)) {
        ConnectorsData = data;
      } else if (data.data && Array.isArray(data.data)) {
        ConnectorsData = data.data;
      } else {
        console.error('ConnectorsPage: Invalid response format', data);
        throw new Error('Invalid response format: Expected an array of Connectors');
      }
*/


      console.log(`ConnectorsPage: Successfully fetched ${ConnectorsData.length} Connectors`, ConnectorsData);
      setConnectors(ConnectorsData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      console.error('ConnectorsPage: Error in fetchConnectors():', errorMessage, err);
      setError(errorMessage);
    } finally {
      console.log('ConnectorsPage: Fetch operation completed');
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log('ConnectorsPage: Component mounted, fetching Connectors');
    fetchConnectors();
    return () => {
      console.log('ConnectorsPage: Component unmounting');
    };
  }, []);

  const truncateText = (text: string | undefined, maxLength: number = 50) => {
    if (!text) return 'N/A';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  const connectorToggle = (connector:Connector) => {
    const c = ConnectorsData.find(c => c.id === connector.id);
    if(c) {
        c.enabled = !c.enabled
        setChanges(changes+1)
    }
    setConnectors(ConnectorsData);
  }

  const connectorConfigure = (connector:Connector) => {
    console.log("configure me",connector)
    alert("configuring")
  }

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link href="/">Home</Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator className="hidden md:block" />
            <Breadcrumb.Item>
              <Breadcrumb.Page>Connectors</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <Card className="w-full">
        <Card.Header className="flex flex-row items-center justify-between">
          <Card.Title className="text-2xl">Connectors</Card.Title>
          <Button
            variant="outline"
            size="icon"
            onClick={fetchConnectors}
            disabled={loading}
            title="Refresh Connectors"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </Card.Header>
        <Card.Content>
          {loading ? (
            <div className="text-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p>Loading Connectors...</p>
            </div>
          ) : error ? (
            <div className="bg-destructive/10 text-destructive rounded-md p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-medium">Error loading Connectors</h3>
                <p className="text-sm">{error}</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={fetchConnectors}>
                  Try Again
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>Name</Table.Head>
                      <Table.Head>Schedule</Table.Head>
                      <Table.Head>Last Run</Table.Head>
                      <Table.Head>Enabled</Table.Head>
                      <Table.Head>Configure</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {Connectors.length === 0 ? (
                      <Table.Row>
                        <Table.Cell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No Connectors found in the system
                        </Table.Cell>
                      </Table.Row>
                    ) : (
                      Connectors.map((connector) => (
                        <Table.Row key={connector.id}>
                          <Table.Cell className="text-sm">{connector.name}</Table.Cell>
                          <Table.Cell className="text-sm">{truncateText(connector.schedule)}</Table.Cell>
                          <Table.Cell className="text-sm">{truncateText(connector.lastrun)}</Table.Cell>
                          <Table.Cell className="text-sm">
                            <Toggle aria-label="Toggle italic" onClick={() => { connectorToggle(connector) }} >
                                { connector.enabled ? "enabled" : "disabled" }
                            </Toggle>
                          </Table.Cell>
                          <Table.Cell className="text-sm">
                            <Button onClick={() => { connectorConfigure(connector) }}>
                                Configure
                            </Button>
                        </Table.Cell>


                        </Table.Row>
                      ))
                    )}
                  </Table.Body>
                </Table>
              </div>
              <div className="text-xs text-muted-foreground mt-4">Total Connectors: {Connectors.length}</div>
            </>
          )}
        </Card.Content>
      </Card>
    </>
  );
}

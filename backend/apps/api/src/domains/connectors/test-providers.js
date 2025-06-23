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


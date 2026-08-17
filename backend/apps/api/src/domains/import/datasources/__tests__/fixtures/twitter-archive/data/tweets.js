window.YTD.tweets.part0 = [
  {
    "tweet" : {
      "id" : "1",
      "id_str" : "1",
      "created_at" : "Fri Jan 03 12:00:00 +0000 2025",
      "full_text" : "Hello world https://t.co/short",
      "favorite_count" : "2",
      "retweet_count" : "1",
      "lang" : "en",
      "source" : "<a href=\"http://twitter.com\" rel=\"nofollow\">Twitter Web Client</a>",
      "entities" : {
        "urls" : [
          {
            "url" : "https://t.co/short",
            "expanded_url" : "https://example.com/full",
            "display_url" : "example.com/full"
          }
        ],
        "user_mentions" : [ ]
      }
    }
  },
  {
    "tweet" : {
      "id" : "2",
      "id_str" : "2",
      "created_at" : "Sat Jan 04 09:30:00 +0000 2025",
      "full_text" : "@someone I'm testing to see how tweet replies work.",
      "favorite_count" : "0",
      "retweet_count" : "0",
      "in_reply_to_status_id" : "1",
      "in_reply_to_status_id_str" : "1",
      "in_reply_to_user_id_str" : "158017896",
      "in_reply_to_screen_name" : "someone",
      "entities" : {
        "urls" : [ ],
        "user_mentions" : [ { "screen_name" : "someone", "id_str" : "158017896" } ]
      }
    }
  },
  {
    "tweet" : {
      "id" : "3",
      "id_str" : "3",
      "created_at" : "Sun Jan 05 18:15:00 +0000 2025",
      "full_text" : "photo and clip https://t.co/pic",
      "favorite_count" : "5",
      "retweet_count" : "0",
      "geo" : { "type" : "Point", "coordinates" : [ "33.514774", "-117.7217729" ] },
      "coordinates" : { "type" : "Point", "coordinates" : [ "-117.7217729", "33.514774" ] },
      "entities" : { "urls" : [ ], "user_mentions" : [ ] },
      "extended_entities" : {
        "media" : [
          {
            "type" : "photo",
            "id_str" : "9001",
            "url" : "https://t.co/pic",
            "expanded_url" : "https://x.com/tester/status/3/photo/1",
            "media_url" : "http://pbs.twimg.com/media/PIC1.jpg",
            "media_url_https" : "https://pbs.twimg.com/media/PIC1.jpg"
          },
          {
            "type" : "video",
            "id_str" : "9002",
            "url" : "https://t.co/vid",
            "expanded_url" : "https://x.com/tester/status/3/video/1",
            "media_url_https" : "https://pbs.twimg.com/ext_tw_video_thumb/9002/img/THUMB.jpg",
            "video_info" : {
              "variants" : [
                { "bitrate" : "256000", "content_type" : "video/mp4", "url" : "https://video.twimg.com/ext_tw_video/9002/vid/240x240/LOW.mp4" },
                { "content_type" : "application/x-mpegURL", "url" : "https://video.twimg.com/ext_tw_video/9002/pl/PLAY.m3u8" },
                { "bitrate" : "832000", "content_type" : "video/mp4", "url" : "https://video.twimg.com/ext_tw_video/9002/vid/480x480/CLIP.mp4" }
              ]
            }
          }
        ]
      }
    }
  },
  {
    "tweet" : {
      "id" : "4",
      "id_str" : "4",
      "created_at" : "Mon Jan 06 08:00:00 +0000 2025",
      "full_text" : "RT @someone: worth a read — the whole thread https://t.co/rtlink",
      "favorite_count" : "0",
      "retweet_count" : "3",
      "entities" : {
        "urls" : [
          {
            "url" : "https://t.co/rtlink",
            "expanded_url" : "https://example.com/thread",
            "display_url" : "example.com/thread"
          }
        ],
        "user_mentions" : [ { "screen_name" : "someone", "id_str" : "158017896" } ]
      }
    }
  },
  {
    "tweet" : {
      "id" : "5",
      "id_str" : "5",
      "created_at" : "",
      "full_text" : "RT @someone: undated share",
      "favorite_count" : "0",
      "retweet_count" : "0",
      "entities" : { "urls" : [ ], "user_mentions" : [ { "screen_name" : "someone", "id_str" : "158017896" } ] }
    }
  }
]

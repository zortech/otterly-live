const PLATFORM_DEFAULTS = {
  twitch: {
    display_name: 'Twitch',
    rtmp_url: 'rtmp://live.twitch.tv/app',
    event_capture_supported: true,
    oauth_flow: 'device_code',
  },
  youtube: {
    display_name: 'YouTube',
    rtmp_url: 'rtmp://a.rtmp.youtube.com/live2',
    rtmp_url_backup: 'rtmp://b.rtmp.youtube.com/live2?backup=1',
    stream_key_static: true,
    event_capture_supported: true,
    oauth_flow: 'pkce',
    oauth_server: 'accounts.google.com',
    developer_portal: 'console.cloud.google.com',
    scope: 'youtube.readonly',
    google_review_required: true,
    event_capture_method: 'grpc',
  },
  kick: {
    display_name: 'Kick',
    rtmp_url: 'rtmps://fa723fc1b171.global-contribute.live-video.net/app',
    event_capture_supported: true,
    unofficial_capture: true,
    oauth_flow: 'pkce',
    oauth_server: 'id.kick.com',
    developer_portal: 'dev.kick.com',
    stream_key_auto_fetch: true,
  },
  tiktok: {
    display_name: 'TikTok',
    rtmp_url: 'rtmp://global-push.tiktok.com/live',
    stream_key_session_specific: true,
    event_capture_supported: true,
    unofficial_capture: true,
    rtmp_access_gated: true,
  },
  x: {
    display_name: 'X (Twitter)',
    rtmp_url: '',
    rtmp_url_hint: 'Copy from studio.twitter.com → Sources → Create Source → RTMP',
    event_capture_supported: false,
    requires_premium: true,
  },
  joystick: {
    display_name: 'Joystick.tv',
    rtmp_url: '',
    rtmp_url_hint: 'Copy from Joystick.tv dashboard → Stream Settings (AWS IVS URL)',
    stream_key_session_specific: false,
    event_capture_supported: true,
    requires_oauth_request: true,
  },
  rumble: {
    display_name: 'Rumble',
    rtmp_url: '',
    rtmp_url_hint: 'Copy from Rumble dashboard → Live → Stream Settings (static RTMP URL)',
    stream_key_session_specific: false,  // static stream key per account
    event_capture_supported: true,
    // Event capture uses Rumble's Live Stream API (polling-based REST, no OAuth).
    // api_access_token field holds the secret API URL from rumble.com/account/livestream-api
    event_capture_method: 'polling',
    event_capture_credential: 'api_url_as_access_token',
  },
  facebook: {
    display_name: 'Facebook Live',
    rtmp_url: 'rtmps://live-api-s.facebook.com:443/rtmp',
    // Stream key is dynamic per live video. It can be obtained via POST /me/live_videos
    // (Graph API) or copied from Facebook Live Producer → stream settings.
    stream_key_hint: 'Create a live video in Facebook Live Producer or via Graph API to get a stream key',
    event_capture_supported: true,
    oauth_flow: 'device_code',           // Facebook Login for Devices
    oauth_server: 'graph.facebook.com',
    developer_portal: 'developers.facebook.com',
    // Enable "Login from Devices" in App Dashboard → Products → Facebook Login → Settings
    scope: 'pages_manage_posts,pages_read_engagement,pages_read_user_content,publish_video',
    app_review_required: true,           // publish_video + page perms require Meta App Review
    event_capture_method: 'sse+polling', // SSE for comments, polling for viewer count
    graph_api_version: 'v19.0',
  },
  bilibili: {
    display_name: 'Bilibili Live',
    rtmp_url: '',
    rtmp_url_hint: 'Obtained via startLive API (requires login) or from Bilibili Live dashboard',
    stream_key_session_specific: true,   // key changes every session (from startLive API)
    event_capture_supported: true,
    unofficial_capture: false,           // bilibili-live-ws uses the public Danmaku WebSocket
    // No OAuth — Bilibili uses cookie-based auth. For event capture, room_id is sufficient
    // for public rooms (username info is partially masked without auth per Bilibili's privacy policy).
    // metadata.room_id = live room number (from the room URL: bilibili.com/live/{room_id})
    // metadata.uid     = optional Bilibili UID (0 = anonymous; reduces user info masking if authenticated)
    event_capture_method: 'websocket',
  },
};

const PLATFORM_ORDER = ['twitch', 'youtube', 'kick', 'tiktok', 'x', 'joystick', 'rumble', 'facebook', 'bilibili'];

function getDefaults(platform) {
  return PLATFORM_DEFAULTS[platform] ?? null;
}

function getAllPlatforms() {
  return PLATFORM_ORDER.map((p) => ({ id: p, ...PLATFORM_DEFAULTS[p] }));
}

module.exports = { PLATFORM_DEFAULTS, PLATFORM_ORDER, getDefaults, getAllPlatforms };

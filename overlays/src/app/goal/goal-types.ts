export type GoalTheme    = 'simple' | 'fun' | 'future' | 'otter';
export type GoalMetric   = 'follow' | 'subscribe' | 'gift_sub' | 'cheer' | 'tip' | 'like';
export type GoalPlatform = 'all' | 'twitch' | 'youtube' | 'kick' | 'tiktok' | 'joystick';

export interface GoalConfig {
  enabled:  boolean;
  label:    string;
  platform: GoalPlatform;
  metric:   GoalMetric;
  target:   number;
}

/** Maps each GoalMetric to the socket event types that count toward it. */
export const METRIC_EVENT_MAP: Record<GoalMetric, string[]> = {
  follow:    ['follow'],
  subscribe: ['subscribe'],
  gift_sub:  ['subscribe.gift'],
  cheer:     ['cheer'],
  tip:       ['tip'],
  like:      ['like'],
};

export const METRIC_LABELS: Record<GoalMetric, string> = {
  follow:    'Follows',
  subscribe: 'Subs',
  gift_sub:  'Gift Subs',
  cheer:     'Bits',
  tip:       'Tips',
  like:      'Likes',
};

export const PLATFORM_COLORS: Record<string, string> = {
  twitch:   '#9146ff',
  youtube:  '#ff0000',
  kick:     '#53fc18',
  tiktok:   '#fe2c55',
  joystick: '#8b5cf6',
  all:      '#4fc3f7',
};

export const DEFAULT_GOAL_CONFIG: GoalConfig = {
  enabled:  true,
  label:    '',
  platform: 'all',
  metric:   'follow',
  target:   100,
};

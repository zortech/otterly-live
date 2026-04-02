// OtteryLivePlugin.cs
//
// Warudo plugin that connects to Ottery Live's StreamTap WebSocket and fires
// typed blueprint nodes for each stream event type.
//
// Prerequisites
// ─────────────
// 1. In Ottery Live: Settings → StreamTap → enable, set port (default 4747).
// 2. Place this file in your Warudo mod folder and build as a plugin mod.
//    See: https://docs.warudo.app/docs/scripting/creating-your-first-plugin-mod
//
// In Warudo blueprints, find the "Ottery Live" category in the node picker.
// All nodes fire independently whenever the matching event arrives.

using System;
using Newtonsoft.Json.Linq;
using Warudo.Core.Attributes;
using Warudo.Core.Events;
using Warudo.Core.Graphs;
using Warudo.Core.Plugins;

namespace OtteryLive {

// ── Plugin ───────────────────────────────────────────────────────────────────

[PluginType(
    Id          = "dev.otterlylive.plugin",
    Name        = "Ottery Live",
    Description = "Receives stream events from Ottery Live's StreamTap and fires blueprint nodes.",
    Author      = "Ottery Live",
    Version     = "1.0.0"
)]
public class OtteryLivePlugin : Plugin {

    [DataInput]
    [Label("StreamTap Host")]
    public string Host = "localhost";

    [DataInput]
    [Label("StreamTap Port")]
    public int Port = 4747;

    [DataInput]
    [Label("Auth Token (leave blank if none)")]
    public string AuthToken = "";

    [DataInput]
    [Label("Auto Connect on Load")]
    public bool AutoConnect = true;

    private System.Net.WebSockets.ClientWebSocket _ws;
    private System.Threading.CancellationTokenSource _cts;
    private bool _connected;

    public bool IsConnected => _connected;

    protected override void OnCreate() {
        base.OnCreate();
        if (AutoConnect) Connect();
    }

    protected override void OnDestroy() {
        Disconnect();
        base.OnDestroy();
    }

    // ── Triggers (appear as buttons in the plugin settings panel) ────────────

    [Trigger]
    [Label("Connect")]
    public void Connect() {
        Disconnect();
        _cts = new System.Threading.CancellationTokenSource();
        _ = ConnectAsync();
    }

    [Trigger]
    [Label("Disconnect")]
    public void Disconnect() {
        _connected = false;
        _cts?.Cancel();
        _ws?.Dispose();
        _ws = null;
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    private async System.Threading.Tasks.Task ConnectAsync() {
        var url = new Uri($"ws://{Host}:{Port}");
        _ws = new System.Net.WebSockets.ClientWebSocket();
        try {
            await _ws.ConnectAsync(url, _cts.Token);
            _connected = true;

            // Send auth token if configured
            if (!string.IsNullOrEmpty(AuthToken)) {
                var authMsg = $"{{\"type\":\"streamtap.auth\",\"token\":\"{AuthToken}\"}}";
                var bytes   = System.Text.Encoding.UTF8.GetBytes(authMsg);
                await _ws.SendAsync(
                    new ArraySegment<byte>(bytes),
                    System.Net.WebSockets.WebSocketMessageType.Text,
                    true, _cts.Token
                );
            }

            _ = ReceiveLoopAsync();
        } catch (OperationCanceledException) {
        } catch (Exception ex) {
            _connected = false;
            UnityEngine.Debug.LogWarning($"[OtteryLive] Connection to {url} failed: {ex.Message}. Retrying in 5s.");
            await System.Threading.Tasks.Task.Delay(5000).ContinueWith(_ => {
                if (!_cts.IsCancellationRequested) Connect();
            });
        }
    }

    private async System.Threading.Tasks.Task ReceiveLoopAsync() {
        var buffer = new byte[16384];
        try {
            while (_ws?.State == System.Net.WebSockets.WebSocketState.Open) {
                var result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), _cts.Token);
                if (result.MessageType == System.Net.WebSockets.WebSocketMessageType.Close) break;

                var json = System.Text.Encoding.UTF8.GetString(buffer, 0, result.Count).Trim();
                HandleMessage(json);
            }
        } catch (OperationCanceledException) {
        } catch (Exception ex) {
            UnityEngine.Debug.LogWarning($"[OtteryLive] Receive error: {ex.Message}");
        }

        _connected = false;
        if (!_cts.IsCancellationRequested) {
            UnityEngine.Debug.Log("[OtteryLive] Disconnected — reconnecting in 5s.");
            await System.Threading.Tasks.Task.Delay(5000);
            Connect();
        }
    }

    private void HandleMessage(string json) {
        if (string.IsNullOrWhiteSpace(json)) return;

        JObject obj;
        try { obj = JObject.Parse(json); } catch { return; }

        var type = obj["type"]?.ToString();
        if (type == null || type.StartsWith("streamtap.")) return;   // skip system messages

        var platform    = obj["platform"]?.ToString()        ?? "";
        var username    = obj["username"]?.ToString()        ?? "";
        var displayName = obj["displayName"]?.ToString()     ?? username;
        var timestamp   = obj["timestamp"]?.ToString()       ?? "";
        var isSub       = obj["isSubscriber"]?.Value<bool>() ?? false;
        var isMod       = obj["isModerator"]?.Value<bool>()  ?? false;

        // Always fire the raw event so advanced users can catch anything
        Context.EventBus.Broadcast(new OtteryRawEvent {
            EventType = type, Platform = platform, Payload = obj,
        });

        switch (type) {
            case "chat.message":
                Context.EventBus.Broadcast(new OtteryChatEvent {
                    Platform     = platform,    Username    = username,
                    DisplayName  = displayName, Timestamp   = timestamp,
                    IsSubscriber = isSub,       IsModerator = isMod,
                    Message      = obj["message"]?.ToString() ?? "",
                    Color        = obj["color"]?.ToString()   ?? "",
                });
                break;

            case "follow":
                Context.EventBus.Broadcast(new OtteryFollowEvent {
                    Platform = platform, Username = username,
                    DisplayName = displayName, Timestamp = timestamp,
                });
                break;

            case "subscribe":
                Context.EventBus.Broadcast(new OtterySubscribeEvent {
                    Platform     = platform,    Username    = username,
                    DisplayName  = displayName, Timestamp   = timestamp,
                    IsSubscriber = isSub,
                    Tier         = obj["tier"]?.ToString()    ?? "",
                    Months       = obj["months"]?.Value<int>() ?? 0,
                    Message      = obj["message"]?.ToString() ?? "",
                });
                break;

            case "subscribe.gift":
                Context.EventBus.Broadcast(new OtteryGiftSubEvent {
                    Platform    = platform,    Username    = username,
                    DisplayName = displayName, Timestamp   = timestamp,
                    Count       = obj["count"]?.Value<int>() ?? 1,
                    Tier        = obj["tier"]?.ToString()   ?? "",
                });
                break;

            case "cheer":
                Context.EventBus.Broadcast(new OtteryCheerEvent {
                    Platform    = platform,    Username    = username,
                    DisplayName = displayName, Timestamp   = timestamp,
                    Bits        = obj["bits"]?.Value<int>()    ?? 0,
                    Message     = obj["message"]?.ToString()   ?? "",
                });
                break;

            case "tip":
                Context.EventBus.Broadcast(new OtteryTipEvent {
                    Platform    = platform,    Username    = username,
                    DisplayName = displayName, Timestamp   = timestamp,
                    Amount      = obj["amount"]?.Value<float>()   ?? 0f,
                    Currency    = obj["currency"]?.ToString()     ?? "USD",
                    Message     = obj["message"]?.ToString()      ?? "",
                });
                break;

            case "raid":
                Context.EventBus.Broadcast(new OtteryRaidEvent {
                    Platform    = platform,    Username    = username,
                    DisplayName = displayName, Timestamp   = timestamp,
                    ViewerCount = obj["viewerCount"]?.Value<int>() ?? 0,
                });
                break;

            case "like":
            case "share":
                Context.EventBus.Broadcast(new OtteryEngagementEvent {
                    EventType   = type,        Platform    = platform,
                    Username    = username,    DisplayName = displayName,
                    Timestamp   = timestamp,
                });
                break;
        }
    }
}

// ── Events ────────────────────────────────────────────────────────────────────
// Broadcast via Context.EventBus; blueprint nodes subscribe to these.

public class OtteryRawEvent : Warudo.Core.Events.Event {
    public string  EventType;
    public string  Platform;
    public JObject Payload;   // full JSON — for custom handling
}

public class OtteryChatEvent : Warudo.Core.Events.Event {
    public string Platform, Username, DisplayName, Message, Color, Timestamp;
    public bool   IsSubscriber, IsModerator;
}

public class OtteryFollowEvent : Warudo.Core.Events.Event {
    public string Platform, Username, DisplayName, Timestamp;
}

public class OtterySubscribeEvent : Warudo.Core.Events.Event {
    public string Platform, Username, DisplayName, Tier, Message, Timestamp;
    public int    Months;
    public bool   IsSubscriber;
}

public class OtteryGiftSubEvent : Warudo.Core.Events.Event {
    public string Platform, Username, DisplayName, Tier, Timestamp;
    public int    Count;
}

public class OtteryCheerEvent : Warudo.Core.Events.Event {
    public string Platform, Username, DisplayName, Message, Timestamp;
    public int    Bits;
}

public class OtteryTipEvent : Warudo.Core.Events.Event {
    public string Platform, Username, DisplayName, Currency, Message, Timestamp;
    public float  Amount;
}

public class OtteryRaidEvent : Warudo.Core.Events.Event {
    public string Platform, Username, DisplayName, Timestamp;
    public int    ViewerCount;
}

public class OtteryEngagementEvent : Warudo.Core.Events.Event {
    public string EventType, Platform, Username, DisplayName, Timestamp;
}

// ── Blueprint Nodes ───────────────────────────────────────────────────────────

[NodeType(
    Id       = "dev.otterlylive.on-chat-message",
    Name     = "On Ottery Chat Message",
    Category = "Ottery Live"
)]
public class OnChatMessageNode : Node {
    [FlowOutput] public Continuation Exit;

    [DataOutput][Label("Platform")]     public string Platform()     => _e?.Platform     ?? "";
    [DataOutput][Label("Username")]     public string Username()     => _e?.Username     ?? "";
    [DataOutput][Label("Display Name")] public string DisplayName()  => _e?.DisplayName  ?? "";
    [DataOutput][Label("Message")]      public string Message()      => _e?.Message      ?? "";
    [DataOutput][Label("Color")]        public string Color()        => _e?.Color        ?? "";
    [DataOutput][Label("Is Subscriber")]public bool   IsSubscriber() => _e?.IsSubscriber ?? false;
    [DataOutput][Label("Is Moderator")] public bool   IsModerator()  => _e?.IsModerator  ?? false;
    [DataOutput][Label("Timestamp")]    public string Timestamp()    => _e?.Timestamp    ?? "";

    private OtteryChatEvent _e;

    public override void OnCreate() {
        Watch(Context.EventBus.Subscribe<OtteryChatEvent>(e => {
            _e = e;
            InvokeFlow(nameof(Exit));
        }));
    }
}

[NodeType(
    Id       = "dev.otterlylive.on-follow",
    Name     = "On Ottery Follow",
    Category = "Ottery Live"
)]
public class OnFollowNode : Node {
    [FlowOutput] public Continuation Exit;

    [DataOutput][Label("Platform")]     public string Platform()    => _e?.Platform    ?? "";
    [DataOutput][Label("Username")]     public string Username()    => _e?.Username    ?? "";
    [DataOutput][Label("Display Name")] public string DisplayName() => _e?.DisplayName ?? "";
    [DataOutput][Label("Timestamp")]    public string Timestamp()   => _e?.Timestamp   ?? "";

    private OtteryFollowEvent _e;

    public override void OnCreate() {
        Watch(Context.EventBus.Subscribe<OtteryFollowEvent>(e => {
            _e = e;
            InvokeFlow(nameof(Exit));
        }));
    }
}

[NodeType(
    Id       = "dev.otterlylive.on-subscribe",
    Name     = "On Ottery Subscribe",
    Category = "Ottery Live"
)]
public class OnSubscribeNode : Node {
    [FlowOutput] public Continuation Exit;

    [DataOutput][Label("Platform")]     public string Platform()     => _e?.Platform     ?? "";
    [DataOutput][Label("Username")]     public string Username()     => _e?.Username     ?? "";
    [DataOutput][Label("Display Name")] public string DisplayName()  => _e?.DisplayName  ?? "";
    [DataOutput][Label("Tier")]         public string Tier()         => _e?.Tier         ?? "";
    [DataOutput][Label("Months")]       public int    Months()       => _e?.Months       ?? 0;
    [DataOutput][Label("Message")]      public string Message()      => _e?.Message      ?? "";
    [DataOutput][Label("Is Subscriber")]public bool   IsSubscriber() => _e?.IsSubscriber ?? false;
    [DataOutput][Label("Timestamp")]    public string Timestamp()    => _e?.Timestamp    ?? "";

    private OtterySubscribeEvent _e;

    public override void OnCreate() {
        Watch(Context.EventBus.Subscribe<OtterySubscribeEvent>(e => {
            _e = e;
            InvokeFlow(nameof(Exit));
        }));
    }
}

[NodeType(
    Id       = "dev.otterlylive.on-gift-sub",
    Name     = "On Ottery Gift Sub",
    Category = "Ottery Live"
)]
public class OnGiftSubNode : Node {
    [FlowOutput] public Continuation Exit;

    [DataOutput][Label("Platform")]     public string Platform()    => _e?.Platform    ?? "";
    [DataOutput][Label("Username")]     public string Username()    => _e?.Username    ?? "";
    [DataOutput][Label("Display Name")] public string DisplayName() => _e?.DisplayName ?? "";
    [DataOutput][Label("Tier")]         public string Tier()        => _e?.Tier        ?? "";
    [DataOutput][Label("Count")]        public int    Count()       => _e?.Count       ?? 0;
    [DataOutput][Label("Timestamp")]    public string Timestamp()   => _e?.Timestamp   ?? "";

    private OtteryGiftSubEvent _e;

    public override void OnCreate() {
        Watch(Context.EventBus.Subscribe<OtteryGiftSubEvent>(e => {
            _e = e;
            InvokeFlow(nameof(Exit));
        }));
    }
}

[NodeType(
    Id       = "dev.otterlylive.on-cheer",
    Name     = "On Ottery Cheer",
    Category = "Ottery Live"
)]
public class OnCheerNode : Node {
    [FlowOutput] public Continuation Exit;

    [DataOutput][Label("Platform")]     public string Platform()    => _e?.Platform    ?? "";
    [DataOutput][Label("Username")]     public string Username()    => _e?.Username    ?? "";
    [DataOutput][Label("Display Name")] public string DisplayName() => _e?.DisplayName ?? "";
    [DataOutput][Label("Bits")]         public int    Bits()        => _e?.Bits        ?? 0;
    [DataOutput][Label("Message")]      public string Message()     => _e?.Message     ?? "";
    [DataOutput][Label("Timestamp")]    public string Timestamp()   => _e?.Timestamp   ?? "";

    private OtteryCheerEvent _e;

    public override void OnCreate() {
        Watch(Context.EventBus.Subscribe<OtteryCheerEvent>(e => {
            _e = e;
            InvokeFlow(nameof(Exit));
        }));
    }
}

[NodeType(
    Id       = "dev.otterlylive.on-tip",
    Name     = "On Ottery Tip",
    Category = "Ottery Live"
)]
public class OnTipNode : Node {
    [FlowOutput] public Continuation Exit;

    [DataOutput][Label("Platform")]     public string Platform()    => _e?.Platform    ?? "";
    [DataOutput][Label("Username")]     public string Username()    => _e?.Username    ?? "";
    [DataOutput][Label("Display Name")] public string DisplayName() => _e?.DisplayName ?? "";
    [DataOutput][Label("Amount")]       public float  Amount()      => _e?.Amount      ?? 0f;
    [DataOutput][Label("Currency")]     public string Currency()    => _e?.Currency    ?? "";
    [DataOutput][Label("Message")]      public string Message()     => _e?.Message     ?? "";
    [DataOutput][Label("Timestamp")]    public string Timestamp()   => _e?.Timestamp   ?? "";

    private OtteryTipEvent _e;

    public override void OnCreate() {
        Watch(Context.EventBus.Subscribe<OtteryTipEvent>(e => {
            _e = e;
            InvokeFlow(nameof(Exit));
        }));
    }
}

[NodeType(
    Id       = "dev.otterlylive.on-raid",
    Name     = "On Ottery Raid",
    Category = "Ottery Live"
)]
public class OnRaidNode : Node {
    [FlowOutput] public Continuation Exit;

    [DataOutput][Label("Platform")]     public string Platform()    => _e?.Platform    ?? "";
    [DataOutput][Label("Username")]     public string Username()    => _e?.Username    ?? "";
    [DataOutput][Label("Display Name")] public string DisplayName() => _e?.DisplayName ?? "";
    [DataOutput][Label("Viewer Count")] public int    ViewerCount() => _e?.ViewerCount ?? 0;
    [DataOutput][Label("Timestamp")]    public string Timestamp()   => _e?.Timestamp   ?? "";

    private OtteryRaidEvent _e;

    public override void OnCreate() {
        Watch(Context.EventBus.Subscribe<OtteryRaidEvent>(e => {
            _e = e;
            InvokeFlow(nameof(Exit));
        }));
    }
}

[NodeType(
    Id       = "dev.otterlylive.on-engagement",
    Name     = "On Ottery Like / Share",
    Category = "Ottery Live"
)]
public class OnEngagementNode : Node {
    [FlowOutput] public Continuation Exit;

    [DataOutput][Label("Event Type")]   public string EventType()   => _e?.EventType   ?? "";
    [DataOutput][Label("Platform")]     public string Platform()    => _e?.Platform    ?? "";
    [DataOutput][Label("Username")]     public string Username()    => _e?.Username    ?? "";
    [DataOutput][Label("Display Name")] public string DisplayName() => _e?.DisplayName ?? "";
    [DataOutput][Label("Timestamp")]    public string Timestamp()   => _e?.Timestamp   ?? "";

    private OtteryEngagementEvent _e;

    public override void OnCreate() {
        Watch(Context.EventBus.Subscribe<OtteryEngagementEvent>(e => {
            _e = e;
            InvokeFlow(nameof(Exit));
        }));
    }
}

}  // namespace OtteryLive

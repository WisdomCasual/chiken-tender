import type * as Party from "partykit/server";

type User = {
  id: string;            // stable userId from client localStorage
  connId: string | null; // current websocket conn.id, null when offline
  name: string;
  status: 'joining' | 'choosing' | 'finished';
  isHost: boolean;
  online: boolean;
  swipeIndex: number;    // for resume-where-left-off
};
type RoomState = 'lobby' | 'swiping' | 'result';

export default class Server implements Party.Server {
  users: Record<string, User> = {}; // keyed by stable userId
  roomState: RoomState = 'lobby';
  swipes: Record<string, string[]> = {}; // restaurantId -> userId[]
  timeLimit: number = 600;
  startedAt: number | null = null;
  nuclearTimer: ReturnType<typeof setTimeout> | null = null;
  searchLocation: string = "Unknown";
  restaurants: any[] = [];
  imageCache: Record<string, string> = {};
  lastSeen: Record<string, number> = {};
  presenceInterval: ReturnType<typeof setInterval> | null = null;
  
  constructor(readonly room: Party.Room) {
    // Periodic staleness sweep — catches dead connections / throttled tabs
    this.presenceInterval = setInterval(() => {
      if (this.checkStalePresence()) this.broadcastState();
    }, 5000);
  }

  // --- HELPERS ---
  private getUserByConn(connId: string): User | null {
    return Object.values(this.users).find(u => u.connId === connId) || null;
  }

  checkStalePresence(): boolean {
    const STALE_MS = 12000; // 12s without a ping → consider offline
    const now = Date.now();
    let changed = false;
    for (const u of Object.values(this.users)) {
      if (u.online && (now - (this.lastSeen[u.id] || 0)) > STALE_MS) {
        u.online = false;
        u.connId = null;
        changed = true;
      }
    }
    return changed;
  }

  private checkAllFinished() {
    const all = Object.values(this.users);
    if (all.length === 0) return;
    const allFinished = all.every(u => u.status === 'finished');
    if (allFinished && this.roomState === 'swiping') {
      if (this.nuclearTimer) clearTimeout(this.nuclearTimer);
      this.calculateForcedResult('natural');
    }
  }

  // --- HTTP SCRAPER ENDPOINT (unchanged) ---
  async onRequest(req: Party.Request) {
    const url = new URL(req.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    if (url.pathname.endsWith("/flag-image")) {
      const flagUrl = url.searchParams.get("url");
      if (!flagUrl) return new Response("Missing url", { status: 400, headers: corsHeaders });
      if (!flagUrl.startsWith("https://www.google.com/local/imagery/report/")) {
        return new Response("Invalid url", { status: 400, headers: corsHeaders });
      }
      try {
        let resolvedUrl = this.imageCache[flagUrl];
        if (!resolvedUrl) {
          const pageRes = await fetch(flagUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept-Language": "en-US,en;q=0.9",
            },
          });
          const html = await pageRes.text();
          const match =
            html.match(/<img[^>]+src="(https:\/\/[^"]*googleusercontent\.com[^"]+)"/i) ||
            html.match(/<img[^>]+src="(https:\/\/lh\d+\.[^"]+)"/i) ||
            html.match(/<img[^>]+src="(https:\/\/[^"]+\.ggpht\.com[^"]+)"/i);
          if (!match) return new Response("No image found", { status: 404, headers: corsHeaders });
          resolvedUrl = match[1];
          this.imageCache[flagUrl] = resolvedUrl;
        }
        const imgRes = await fetch(resolvedUrl);
        if (!imgRes.ok) return new Response("Upstream image fetch failed", { status: 502, headers: corsHeaders });
        return new Response(imgRes.body, {
          headers: {
            ...corsHeaders,
            "Content-Type": imgRes.headers.get("Content-Type") || "image/jpeg",
            "Cache-Control": "public, max-age=86400, immutable",
          },
        });
      } catch {
        return new Response("Proxy error", { status: 500, headers: corsHeaders });
      }
    }
    return new Response("Not found", { status: 404 });
  }

  // --- WEBSOCKET LOGIC ---
  onClose(conn: Party.Connection) {
    const user = this.getUserByConn(conn.id);
    if (user) {
      user.online = false;
      user.connId = null;
      this.broadcastState();
    }
  }

  onMessage(message: string, sender: Party.Connection) {
  let data;
  try { data = JSON.parse(message); } catch { return; }

  // -------- JOIN / REJOIN --------
  if (data.type === "join") {
    const userId: string | undefined = data.userId;
    if (!userId) return;

    const existing = this.users[userId];
    this.lastSeen[userId] = Date.now();

    if (existing) {
      existing.connId = sender.id;
      existing.online = true;
      if (data.name && data.name !== existing.name) {
        let desired = data.name;
        while (Object.values(this.users).some(u => u.id !== userId && u.name === desired)) {
          desired += "_";
        }
        existing.name = desired;
      }
      this.broadcastState();
      return;
    }

    if (this.roomState !== 'lobby') {
      sender.send(JSON.stringify({
        type: "join_rejected",
        reason: "Room already started. Ask the host to invite you to a new one.",
      }));
      return;
    }

    const isHost = Object.keys(this.users).length === 0;
    let desiredName = data.name || "ANON";
    while (Object.values(this.users).some(u => u.name === desiredName)) desiredName += "_";

    this.users[userId] = {
      id: userId,
      connId: sender.id,
      name: desiredName,
      status: 'joining',
      isHost,
      online: true,
      swipeIndex: 0,
    };
    this.broadcastState();
    return;
  }

  // All other messages require a known user
  const me = this.getUserByConn(sender.id);
  if (!me) return;

  // Update presence on every message + opportunistic staleness sweep
  this.lastSeen[me.id] = Date.now();
  const staleChanged = this.checkStalePresence();

  // -------- PRESENCE --------
  if (data.type === "ping") {
    if (!me.online) {
      me.online = true;
      this.broadcastState();
    } else if (staleChanged) {
      this.broadcastState();
    }
    return;
  }

  if (data.type === "going_offline") {
    me.online = false;
    this.broadcastState();
    return;
  }

  if (data.type === "back_online") {
    me.online = true;
    this.broadcastState();
    return;
  }

  if (staleChanged) this.broadcastState();

  // -------- HOST: KICK --------
  if (data.type === "kick" && me.isHost) {
    const targetId: string = data.userId;
    const target = this.users[targetId];
    if (!target || targetId === me.id) return;

    if (target.connId) {
      const targetConn = this.room.getConnection(target.connId);
      if (targetConn) targetConn.send(JSON.stringify({ type: "kicked" }));
    }

    delete this.users[targetId];
    delete this.lastSeen[targetId];
    for (const rid of Object.keys(this.swipes)) {
      this.swipes[rid] = this.swipes[rid].filter(uid => uid !== targetId);
    }

    this.broadcastState();
    this.checkAllFinished();
    return;
  }

  // -------- HOST: START ROOM --------
  if (data.type === "start_room" && me.isHost) {
    this.roomState = 'swiping';
    this.timeLimit = data.timeLimit || 600;
    this.searchLocation = data.location || "Nearby";
    this.restaurants = data.restaurants || [];
    this.startedAt = Date.now();

    Object.values(this.users).forEach(u => {
      u.status = 'choosing';
      u.swipeIndex = 0;
    });
    this.broadcastState();

    if (this.nuclearTimer) clearTimeout(this.nuclearTimer);
    this.nuclearTimer = setTimeout(() => {
      if (this.roomState !== 'result') this.calculateForcedResult('nuclear');
    }, this.timeLimit * 1000);
    return;
  }

  // -------- SWIPE --------
  if (data.type === "swipe") {
    if (!this.swipes[data.restaurantId]) this.swipes[data.restaurantId] = [];
    if (data.direction === "right" && !this.swipes[data.restaurantId].includes(me.id)) {
      this.swipes[data.restaurantId].push(me.id);
    }
    return;
  }

  // -------- SWIPE PROGRESS (for resume) --------
  if (data.type === "swipe_progress") {
    if (typeof data.index === "number" && data.index >= me.swipeIndex) {
      me.swipeIndex = data.index;
    }
    return;
  }

  // -------- FINISHED SWIPING --------
  if (data.type === "finished_swiping") {
    me.status = 'finished';
    this.broadcastState();
    this.checkAllFinished();
    return;
  }

  if (data.type === "force_end" && me.isHost) {
    if (this.nuclearTimer) clearTimeout(this.nuclearTimer);
    this.calculateForcedResult('forced');
    return;
  }

  if (data.type === "trigger_nuclear" && me.isHost) {
    if (this.roomState !== 'result') {
      if (this.nuclearTimer) clearTimeout(this.nuclearTimer);
      this.calculateForcedResult('nuclear');
    }
    return;
  }
  }

  calculateForcedResult(mode: 'natural' | 'forced' | 'nuclear') {
    this.roomState = 'result';
    let chosenId: string | null = null;

    if (mode === 'nuclear' && this.restaurants.length > 0) {
      const sorted = [...this.restaurants].sort(
        (a, b) => (a.rating || 0) - (b.rating || 0)
      );
      chosenId = sorted[0]?.id || null;
    } else {
      let maxSwipes = -1;
      for (const [id, userIds] of Object.entries(this.swipes)) {
        if (userIds.length > maxSwipes) {
          maxSwipes = userIds.length;
          chosenId = id;
        }
      }
    }

    this.room.broadcast(JSON.stringify({
      type: "match",
      restaurantId: chosenId || (this.restaurants[0]?.id || "none"),
      stats: this.swipes,
      isNuclear: mode === 'nuclear',
      forced: mode === 'forced',
      // Snapshot users so the result screen can resolve voter names
      // even if someone has since been kicked or whatever.
      usersSnapshot: Object.values(this.users).map(u => ({ id: u.id, name: u.name })),
    }));
  }

  broadcastState() {
    this.room.broadcast(JSON.stringify({
      type: "sync",
      state: this.roomState,
      users: Object.values(this.users).map(u => ({
        id: u.id,
        name: u.name,
        status: u.status,
        isHost: u.isHost,
        online: u.online,
        swipeIndex: u.swipeIndex,
      })),
      startedAt: this.startedAt,
      timeLimit: this.timeLimit,
      searchLocation: this.searchLocation,
      restaurants: this.restaurants,
      mapsApiKey: this.room.env.MAPS_API_KEY,
      rapidApiKey: this.room.env.RAPID_API_KEY,
    }));
  }
}
Server satisfies Party.Worker;
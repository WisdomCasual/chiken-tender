import type * as Party from "partykit/server";

type User = { id: string; name: string; status: 'joining' | 'choosing' | 'finished'; isHost: boolean };
type RoomState = 'lobby' | 'swiping' | 'result';

export default class Server implements Party.Server {
  users: Record<string, User> = {};
  roomState: RoomState = 'lobby';
  swipes: Record<string, string[]> = {}; 
  timeLimit: number = 600;
  startedAt: number | null = null;
  nuclearTimer: ReturnType<typeof setTimeout> | null = null;
  searchLocation: string = "Unknown"; 
  restaurants: any[] = []; 
  imageCache: Record<string, string> = {};
  
  constructor(readonly room: Party.Room) {}

  // --- NEW: HTTP SCRAPER ENDPOINT ---
  async onRequest(req: Party.Request) {
  const url = new URL(req.url);

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // --- IMAGE PROXY: turns a Google flagContentUri into raw image bytes ---
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
      this.imageCache[flagUrl] = resolvedUrl; // 🆕 cache it
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

  // --- EXISTING WEBSOCKET LOGIC ---
  onClose(conn: Party.Connection) {
    if (this.users[conn.id]) {
      delete this.users[conn.id];
      this.broadcastState();
    }
  }

  onMessage(message: string, sender: Party.Connection) {
    let data;
    try { data = JSON.parse(message); } catch (err) { return; }

    if (data.type === "join") {
      const isHost = Object.keys(this.users).length === 0;
      let desiredName = data.name;
      while (Object.values(this.users).some(u => u.name === desiredName)) desiredName += "_";
      this.users[sender.id] = { id: sender.id, name: desiredName, status: 'joining', isHost };
      this.broadcastState();
    }

    if (data.type === "kick" && this.users[sender.id]?.isHost) {
      const targetConnection = this.room.getConnection(data.userId);
      if (targetConnection) targetConnection.send(JSON.stringify({ type: "kicked" }));
      delete this.users[data.userId];
      this.broadcastState();
    }

    if (data.type === "start_room" && this.users[sender.id]?.isHost) {
      this.roomState = 'swiping';
      this.timeLimit = data.timeLimit || 600;
      this.searchLocation = data.location || "Nearby"; 
      this.restaurants = data.restaurants || []; 
      this.startedAt = Date.now();
      
      Object.keys(this.users).forEach(id => this.users[id].status = 'choosing');
      this.broadcastState();

      if (this.nuclearTimer) clearTimeout(this.nuclearTimer);
      this.nuclearTimer = setTimeout(() => {
        if (this.roomState !== 'result') this.calculateForcedResult('nuclear');
      }, this.timeLimit * 1000);
    }

    if (data.type === "swipe") {
      if (!this.swipes[data.restaurantId]) this.swipes[data.restaurantId] = [];
      if (data.direction === "right" && !this.swipes[data.restaurantId].includes(sender.id)) {
          this.swipes[data.restaurantId].push(sender.id);
      }
    }

    if (data.type === "finished_swiping") {
    if (this.users[sender.id]) this.users[sender.id].status = 'finished';
    this.broadcastState();

    const allFinished = Object.values(this.users).every(u => u.status === 'finished');
    if (allFinished && this.roomState !== 'result') {
        if (this.nuclearTimer) clearTimeout(this.nuclearTimer);
        this.calculateForcedResult('natural');   // 🆕 was (false)
    }
    }

    // Host force-ends the room
    if (data.type === "force_end" && this.users[sender.id]?.isHost) {
    if (this.nuclearTimer) clearTimeout(this.nuclearTimer);
    this.calculateForcedResult('forced');      // 🆕 was (true)
    }

    // Host manually triggers nuke
    if (data.type === "trigger_nuclear" && this.users[sender.id]?.isHost) {
    if (this.roomState !== 'result') {
        if (this.nuclearTimer) clearTimeout(this.nuclearTimer);
        this.calculateForcedResult('nuclear');   // 🆕 was (true)
    }
    }
  }

  calculateForcedResult(mode: 'natural' | 'forced' | 'nuclear') {
  this.roomState = 'result';
  let chosenId: string | null = null;

  if (mode === 'nuclear' && this.restaurants.length > 0) {
    // 🔥 NUCLEAR: lowest-rated place wins (as punishment)
    const sorted = [...this.restaurants].sort(
      (a, b) => (a.rating || 0) - (b.rating || 0)
    );
    chosenId = sorted[0]?.id || null;
  } else {
    // natural / forced: most-voted place wins
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
  }));
  }

  broadcastState() {
    this.room.broadcast(JSON.stringify({
      type: "sync",
      state: this.roomState,
      users: Object.values(this.users),
      startedAt: this.startedAt,
      timeLimit: this.timeLimit,
      searchLocation: this.searchLocation,
      restaurants: this.restaurants, 
      mapsApiKey: this.room.env.MAPS_API_KEY,
      rapidApiKey: this.room.env.RAPID_API_KEY 
    }));
  }
}
Server satisfies Party.Worker;
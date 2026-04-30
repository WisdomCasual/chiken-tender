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

  constructor(readonly room: Party.Room) {}

  // --- NEW: HTTP SCRAPER ENDPOINT ---
  async onRequest(req: Party.Request) {
    const url = new URL(req.url);
    
    // Allow the browser to talk to this endpoint
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Content-Type": "application/json"
    };

    if (req.method === "OPTIONS") return new Response(null, { headers });

    // Listen for requests to /scrape
    if (url.pathname.endsWith("/scrape")) {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) return new Response(JSON.stringify({ error: "Missing url" }), { status: 400, headers });

      try {
        // Fetch the raw HTML of the Google Maps page
        const response = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          }
        });
        const html = await response.text();

        // Regex to find the OpenGraph or ItemProp image tag hidden in the HTML
        let imgUrl = null;
        const ogMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i) || 
                        html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/i);
        const itemMatch = html.match(/<meta[^>]*itemprop="image"[^>]*content="([^"]+)"/i) || 
                          html.match(/<meta[^>]*content="([^"]+)"[^>]*itemprop="image"/i);

        if (ogMatch) imgUrl = ogMatch[1];
        else if (itemMatch) imgUrl = itemMatch[1];

        // Send the direct image link back to the client!
        return new Response(JSON.stringify({ image: imgUrl }), { headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Scrape failed", image: null }), { headers });
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
        if (this.roomState !== 'result') this.calculateForcedResult(true);
      }, this.timeLimit * 1000);
    }

    if (data.type === "swipe") {
      if (!this.swipes[data.restaurantId]) this.swipes[data.restaurantId] = [];
      if (data.direction === "right" && !this.swipes[data.restaurantId].includes(sender.id)) {
        this.swipes[data.restaurantId].push(sender.id);
      }

      const totalUsers = Object.keys(this.users).length;
      if (this.swipes[data.restaurantId].length >= totalUsers && totalUsers > 0) {
        if (this.nuclearTimer) clearTimeout(this.nuclearTimer);
        this.roomState = 'result';
        this.room.broadcast(JSON.stringify({ type: "match", restaurantId: data.restaurantId, stats: this.swipes }));
        return;
      }
    }

    if (data.type === "finished_swiping") {
      if (this.users[sender.id]) this.users[sender.id].status = 'finished';
      this.broadcastState();

      const allFinished = Object.values(this.users).every(u => u.status === 'finished');
      if (allFinished && this.roomState !== 'result') {
        if (this.nuclearTimer) clearTimeout(this.nuclearTimer);
        this.calculateForcedResult(false);
      }
    }

    if (data.type === "force_end" && this.users[sender.id]?.isHost) {
      if (this.nuclearTimer) clearTimeout(this.nuclearTimer);
      this.calculateForcedResult(true);
    }

    if (data.type === "trigger_nuclear" && this.users[sender.id]?.isHost) {
      if (this.roomState !== 'result') {
        if (this.nuclearTimer) clearTimeout(this.nuclearTimer);
        this.calculateForcedResult(true);
      }
    }
  }

  calculateForcedResult(isNuclear: boolean) {
    this.roomState = 'result';
    let bestId = null;
    let maxSwipes = -1;
    for (const [id, userIds] of Object.entries(this.swipes)) {
      if (userIds.length > maxSwipes) {
        maxSwipes = userIds.length;
        bestId = id;
      }
    }
    this.room.broadcast(JSON.stringify({ 
      type: "match", 
      restaurantId: bestId || (this.restaurants[0]?.id || "none"),
      stats: this.swipes,
      forced: isNuclear
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
import "./styles.css";
import PartySocket from "partysocket";

declare const google: any;
let selectedLat = "30.073083052069688";
let selectedLng = "31.287159897474055";
let googleMap: any = null;
const MAX_RETRIES = 5;
type Screen = 'reconnecting' | 'login' | 'lobby' | 'swiping' | 'waiting' | 'match' | 'kicked' | 'rejected';
let currentScreen: Screen = 'reconnecting';
let lastRenderedSwipeIndex = -1;
let heartbeatInterval: number | null = null;

const output = document.getElementById("app") as HTMLDivElement;

const urlParams = new URLSearchParams(window.location.search);
let roomCode = urlParams.get("room");
const isHosting = !roomCode;
if (!roomCode) {
  roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
}
window.history.replaceState({}, '', `?room=${roomCode}`);

// --- STABLE IDENTITY (per room, survives refresh / close / reconnect) ---
const userIdKey = `ct_uid_${roomCode}`;
const nameKey = `ct_name_${roomCode}`;

let userId = localStorage.getItem(userIdKey);
if (!userId) {
  userId =
    (typeof crypto !== "undefined" && (crypto as any).randomUUID)
      ? (crypto as any).randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem(userIdKey, userId);
}

const conn = new PartySocket({
  host: window.location.host,
  room: roomCode,
});

let restaurants: any[] = [];
let myName = localStorage.getItem(nameKey) || "";
let currentIndex = 0;
let currentImageIndex = 0;
let serverState: any = { state: 'lobby', users: [] };
let visualTimerInterval: number | null = null;
let isKicked = false;
let hasRestoredProgress = false;

// --- AUTO (RE)JOIN ON SOCKET OPEN ---
conn.addEventListener("open", () => {
  if (isKicked) return;
  if (myName) {
    conn.send(JSON.stringify({ type: "join", userId, name: myName }));
  }
});

// --- UTILS ---

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function computeTimerText(): string {
  if (!serverState.startedAt || !serverState.timeLimit) return '--:--';
  const elapsed = Math.floor((Date.now() - serverState.startedAt) / 1000);
  const remaining = Math.max(0, serverState.timeLimit - elapsed);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function shuffleArray(array: any[]) {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

function toProxyUrl(rawUrl: string): string {
  if (!rawUrl.startsWith("https://www.google.com/local/imagery/report/")) {
    return rawUrl;
  }
  return `/parties/main/${roomCode}/flag-image?url=${encodeURIComponent(rawUrl)}`;
}

function showConfirmModal(opts: {
  title: string;
  message: string;
  confirmText: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  const modal = document.createElement('div');
  modal.className = "fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 animate-[fadeIn_0.2s_ease-out]";

  modal.innerHTML = `
    <div class="border-8 border-black bg-neo-bg p-6 max-w-sm w-full shadow-neo-xl -rotate-1 flex flex-col gap-4 relative">
      <div class="border-4 border-black bg-neo-secondary px-3 py-2 -rotate-2 inline-block self-start shadow-neo-sm">
        <h3 class="text-2xl font-black uppercase tracking-tighter">${opts.title}</h3>
      </div>

      <p class="font-bold text-base leading-snug border-l-4 border-black pl-3">${opts.message}</p>

      <div class="grid grid-cols-2 gap-3 mt-2">
        <button id="confirm-cancel" class="neo-press border-4 border-black bg-white py-3 font-black text-lg uppercase shadow-neo-sm hover:bg-gray-200">
          ${opts.cancelText || 'CANCEL'}
        </button>
        <button id="confirm-ok" class="neo-press border-4 border-black ${opts.danger ? 'bg-neo-accent text-white hover:bg-red-600' : 'bg-neo-secondary hover:bg-yellow-300'} py-3 font-black text-lg uppercase shadow-neo-sm">
          ${opts.confirmText}
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector("#confirm-cancel")?.addEventListener("click", close);
  modal.querySelector("#confirm-ok")?.addEventListener("click", () => {
    close();
    opts.onConfirm();
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
    else if (e.key === "Enter") { close(); document.removeEventListener("keydown", onKey); opts.onConfirm(); }
  };
  document.addEventListener("keydown", onKey);
}

function showInviteModal() {
  const url = window.location.href;
  const text = "Help me pick a place to eat!";
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text + "\n" + url);

  const modal = document.createElement('div');
  modal.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-[fadeIn_0.2s_ease-out]";

  modal.innerHTML = `
    <div class="border-8 border-black bg-neo-bg p-6 max-w-sm w-full shadow-neo-xl rotate-1 flex flex-col gap-3 relative">
      <button id="close-modal" class="neo-press absolute -top-5 -right-5 bg-neo-accent border-4 border-black text-white font-black w-12 h-12 rounded-full flex items-center justify-center shadow-neo-sm hover:bg-red-600 text-xl">X</button>

      <h3 class="text-3xl font-black uppercase tracking-tighter mb-2">Invite Friends</h3>

      <button id="invite-copy" class="invite-btn border-4 border-black bg-neo-secondary px-4 py-4 font-black text-xl flex items-center justify-between shadow-neo-sm hover:bg-yellow-300">
        <span class="flex items-center gap-3">
          <span class="invite-icon w-10 h-10 border-2 border-black bg-white flex items-center justify-center shadow-neo-sm">
            <svg class="w-5 h-5" fill="none" stroke="black" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="square" stroke-linejoin="miter" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
          </span>
          <span>COPY LINK</span>
        </span>
      </button>

      <a href="https://api.whatsapp.com/send?text=${encodedText}" target="_blank" class="invite-btn border-4 border-black bg-[#4ade80] px-4 py-4 font-black text-xl flex items-center justify-between shadow-neo-sm hover:bg-green-300">
        <span class="flex items-center gap-3">
          <span class="invite-icon w-10 h-10 border-2 border-black bg-white flex items-center justify-center shadow-neo-sm">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="black"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
          </span>
          <span>WHATSAPP</span>
        </span>
      </a>

      <a href="fb-messenger://share?link=${encodedUrl}" target="_blank" class="invite-btn border-4 border-black bg-[#60a5fa] px-4 py-4 font-black text-xl flex items-center justify-between shadow-neo-sm hover:bg-blue-300" id="messenger-btn">
        <span class="flex items-center gap-3">
          <span class="invite-icon w-10 h-10 border-2 border-black bg-white flex items-center justify-center shadow-neo-sm">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="black"><path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.17.16.14.26.34.27.55l.05 1.78a.8.8 0 0 0 1.12.71l1.99-.88c.16-.07.34-.08.5-.04.91.25 1.88.38 2.93.38 5.64 0 10-4.13 10-9.7C22 6.13 17.64 2 12 2zm6 7.46-2.93 4.65a1.5 1.5 0 0 1-2.17.4l-2.34-1.75a.6.6 0 0 0-.72 0l-3.16 2.4c-.42.32-.97-.18-.69-.63l2.93-4.65a1.5 1.5 0 0 1 2.17-.4l2.34 1.75c.21.16.51.16.72 0l3.16-2.4c.42-.32.97.18.69.63z"/></svg>
          </span>
          <span>MESSENGER</span>
        </span>
      </a>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById("close-modal")?.addEventListener("click", () => modal.remove());

  document.getElementById("messenger-btn")?.addEventListener("click", () => {
    setTimeout(() => {
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`, "_blank");
    }, 600);
  });

  document.getElementById("invite-copy")?.addEventListener("click", () => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = url;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      textArea.remove();
      const btn = document.getElementById("invite-copy");
      if (btn) {
        btn.innerHTML = `
          <span class="flex items-center gap-3">
            <span class="invite-icon w-10 h-10 border-2 border-black bg-white flex items-center justify-center shadow-neo-sm">
              <svg class="w-5 h-5" fill="none" stroke="black" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="square" stroke-linejoin="miter" d="M5 13l4 4L19 7"></path></svg>
            </span>
            <span>COPIED</span>
          </span>
        `;
        btn.classList.replace("bg-neo-secondary", "bg-white");
      }
      setTimeout(() => modal.remove(), 1000);
    } catch (err) {
      prompt("Copy this link:", url);
    }
  });
}

function startVisualTimer() {
  if (visualTimerInterval) clearInterval(visualTimerInterval);

  const tick = () => {
    const timerEl = document.getElementById('global-timer-text');
    if (!timerEl || !serverState.startedAt) return;
    const elapsed = Math.floor((Date.now() - serverState.startedAt) / 1000);
    const remaining = Math.max(0, serverState.timeLimit - elapsed);
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    timerEl.innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    if (remaining <= 30 && remaining > 0) {
      timerEl.parentElement?.classList.add("text-neo-accent", "animate-pulse");
    }
    if (remaining === 0) {
      if (visualTimerInterval) clearInterval(visualTimerInterval);
      visualTimerInterval = null;
      const me = serverState.users.find((u: any) => u.id === userId);
      if (me?.isHost) {
        conn.send(JSON.stringify({ type: "trigger_nuclear" }));
      }
    }
  };

  tick(); // immediate sync update
  visualTimerInterval = window.setInterval(tick, 1000);
}

async function fetchRestaurantsAndStart(timeLimit: number, radius: number, limit: number) {
  if (!selectedLat || !selectedLng) {
    alert("Please drop a pin or select a location first!");
    return;
  }

  if (!serverState.rapidApiKey) {
    alert("Missing RAPID_API_KEY in .env file!");
    return;
  }

  const btn = document.getElementById("start-btn") as HTMLButtonElement;
  if (btn) {
    btn.innerText = "FETCHING PLACES...";
    btn.disabled = true;
  }

  const apiKey = serverState.rapidApiKey;
  const v2Host = "google-map-places-new-v2.p.rapidapi.com";
  const v2Url = `https://${v2Host}/v1/places:searchNearby`;
  const v2Options = {
    method: "POST",
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": v2Host,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.rating,places.primaryTypeDisplayName,places.formattedAddress,places.location,places.googleMapsUri,places.photos",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      includedPrimaryTypes: ["restaurant"],
      locationRestriction: {
        circle: {
          center: { latitude: parseFloat(selectedLat), longitude: parseFloat(selectedLng) },
          radius: radius,
        },
      },
      maxResultCount: 20,
      rankPreference: "POPULARITY",
    }),
  };

  const FALLBACK_IMAGES = [
    "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&q=80",
    "https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?w=600&q=80",
    "https://images.unsplash.com/photo-1552566626-52f8b828add9?w=600&q=80",
  ];

  try {
    const v2Response = await fetch(v2Url, v2Options);
    const v2Data = await v2Response.json();

    if (!v2Data.places || v2Data.places.length === 0) {
      alert("No restaurants found in this radius! Try adjusting the map pin.");
      if (btn) { btn.innerText = "START SWIPING"; btn.disabled = false; }
      return;
    }

    const placesWithDistance = v2Data.places.map((place: any) => {
      const dist = place.location
        ? calculateDistance(
            parseFloat(selectedLat),
            parseFloat(selectedLng),
            place.location.latitude,
            place.location.longitude
          )
        : 999;

      let finalImages: string[] = [];
      if (Array.isArray(place.photos)) {
        finalImages = place.photos
          .map((p: any) => p.flagContentUri)
          .filter(Boolean);
      }

      if (finalImages.length === 0) {
        finalImages = [...FALLBACK_IMAGES];
      } else if (finalImages.length === 1) {
        finalImages.push(FALLBACK_IMAGES[0]);
      }

      return {
        id: place.id,
        name: place.displayName?.text ? place.displayName.text.toUpperCase() : "UNKNOWN PLACE",
        rating: place.rating || 0,
        type: place.primaryTypeDisplayName?.text || "Dining",
        color: "bg-white",
        images: finalImages,
        address: place.formattedAddress || "Address Hidden",
        googleMapsUri:
          place.googleMapsUri ||
          `https://www.google.com/maps/search/?api=1&query=${place.location?.latitude},${place.location?.longitude}`,
        distance: dist,
      };
    });

    const maxDistanceKm = radius / 1000;
    const validPlaces = placesWithDistance.filter((p: any) => p.distance <= maxDistanceKm);

    validPlaces.sort((a: any, b: any) => {
      if (b.rating !== a.rating) return b.rating - a.rating;
      return a.distance - b.distance;
    });

    const topPlaces = validPlaces.slice(0, limit);
    const realRestaurants = shuffleArray(topPlaces);

    if (realRestaurants.length === 0) {
      alert(`No restaurants found strictly within ${maxDistanceKm}km! Try expanding your radius.`);
      if (btn) { btn.innerText = "START SWIPING"; btn.disabled = false; }
      return;
    }

    conn.send(
      JSON.stringify({
        type: "start_room",
        timeLimit,
        radius,
        location: "Target Area",
        restaurants: realRestaurants,
      })
    );
  } catch (err) {
    console.error("V2 API Fetch Error:", err);
    alert("Could not fetch data. Check your RapidAPI subscription for google-map-places-new-v2.");
    if (btn) { btn.innerText = "START SWIPING"; btn.disabled = false; }
  }
}

// --- RENDER SCREENS ---

function renderLogin() {
  if (isKicked) return;
  if (currentScreen === 'login') return;
  currentScreen = 'login';

  output.innerHTML = `
    <div class="flex flex-col min-h-screen items-center justify-center p-6 animate-[fadeIn_0.3s_ease-out]">

      <!-- LOGO BANNER -->
      <div class="w-full max-w-sm mb-12 border-4 border-black bg-neo-bg px-4 py-3 shadow-neo-md -rotate-1">
        <img
          src="/chicken_tender_logo.png"
          alt="Chicken Tender"
          class="w-full h-auto object-contain"
          draggable="false"
        />
      </div>

      <div class="border-8 border-black bg-white p-8 shadow-neo-xl w-full max-w-sm transform rotate-1">
        <h1 class="text-4xl font-black uppercase tracking-tighter mb-2">${isHosting ? 'Host a Room' : 'Join Room'}</h1>
        <p class="font-bold border-2 border-black inline-block px-2 bg-neo-muted mb-6 tracking-widest">${roomCode}</p>
        <input type="text" id="name-input" placeholder="YOUR NAME" value="${myName}" class="w-full border-4 border-black p-4 text-xl font-bold uppercase mb-6 focus:bg-neo-secondary focus:outline-none transition-colors" maxlength="12">
        <button id="join-btn" class="neo-press w-full border-4 border-black bg-neo-accent text-white py-4 text-2xl font-black uppercase shadow-neo-md transition-colors hover:bg-red-500">ENTER CHAOS</button>
      </div>
    </div>
  `;

  const attemptJoin = () => {
    const input = document.getElementById("name-input") as HTMLInputElement;
    const nameVal = input.value.trim().toUpperCase();
    if (nameVal) {
      myName = nameVal;
      localStorage.setItem(nameKey, myName);
      conn.send(JSON.stringify({ type: "join", userId, name: myName }));
    }
  };

  document.getElementById("join-btn")?.addEventListener("click", attemptJoin);
  document.getElementById("name-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      attemptJoin();
    }
  });
}

function buildLobbyUserListHtml(): string {
  const me = serverState.users.find((u: any) => u.id === userId);
  return serverState.users.map((u: any) => `
    <div class="border-4 border-black p-3 mb-2 font-bold flex justify-between items-center ${u.id === userId ? 'bg-neo-secondary' : 'bg-white'} shadow-neo-sm ${!u.online ? 'opacity-60' : ''}">
      <div class="flex items-center gap-2">
        <span>${u.name} ${u.isHost ? '👑' : ''}</span>
        ${!u.online ? '<span class="text-[10px] font-black uppercase bg-black text-white border-2 border-black px-1.5 py-0.5">OFFLINE</span>' : (u.status === 'joining' ? '<span class="text-xs animate-pulse">Waiting...</span>' : '')}
      </div>
      ${me?.isHost && u.id !== userId ? `<button onclick="kickUser('${u.id}')" class="neo-press bg-neo-accent text-white border-2 border-black px-2 py-1 text-xs hover:bg-red-600">KICK</button>` : ''}
    </div>
  `).join('');
}

function renderLobby() {
  if (isKicked) return;
  const me = serverState.users.find((u: any) => u.id === userId);
  if (me) {
    myName = me.name;
    localStorage.setItem(nameKey, myName);
  }

  // Partial update — already on lobby screen, just refresh user list
  if (currentScreen === 'lobby') {
    const list = document.getElementById("lobby-users-list");
    if (list) {
      list.innerHTML = buildLobbyUserListHtml() || '<p class="font-bold">Waiting for server...</p>';
      return;
    }
  }
  currentScreen = 'lobby';

  const userHtml = buildLobbyUserListHtml();

  output.innerHTML = `
    <div class="flex flex-col h-screen p-6 max-w-md mx-auto animate-[fadeIn_0.3s_ease-out]">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-4xl font-black uppercase tracking-tighter text-neo-accent drop-shadow-[4px_4px_0px_#000]">LOBBY</h2>
        <button id="invite-btn" class="neo-press border-4 border-black bg-neo-muted px-4 py-2 font-black shadow-neo-sm rotate-2 hover:bg-purple-300">INVITE 🔗</button>
      </div>

      <div id="lobby-users-list" class="flex-1 overflow-y-auto mb-4 pr-2">${userHtml || '<p class="font-bold">Waiting for server...</p>'}</div>

      ${me?.isHost ? `
        <div class="border-4 border-black bg-white p-3 mb-4 shadow-neo-sm flex flex-col gap-3">
          <div>
            <label class="font-black uppercase block mb-1 text-xs tracking-widest text-black/60">Search Center</label>
            <div class="relative border-4 border-black shadow-neo-md overflow-hidden bg-gray-200">
              <button id="gps-btn" class="neo-press absolute top-2 right-2 z-10 bg-[#4ade80] border-4 border-black w-10 h-10 flex items-center justify-center shadow-neo-sm hover:bg-green-300 transition-all" title="Find My Location">📍</button>
              <div id="host-map" class="w-full h-40"></div>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2">
            <div>
              <label class="font-black uppercase block mb-1 text-[10px] tracking-widest">Time</label>
              <select id="time-limit" class="w-full border-4 border-black p-1.5 font-black bg-neo-bg uppercase outline-none focus:bg-neo-secondary cursor-pointer text-xs">
                <option value="60">1 Min</option>
                <option value="300">5 Min</option>
                <option value="600" selected>10 Min</option>
                <option value="1200">20 Min</option>
                <option value="1800">30 Min</option>
              </select>
            </div>
            <div>
              <label class="font-black uppercase block mb-1 text-[10px] tracking-widest">Radius</label>
              <select id="search-radius" class="w-full border-4 border-black p-1.5 font-black bg-neo-bg uppercase outline-none focus:bg-neo-secondary cursor-pointer text-xs">
                <option value="500">500 m</option>
                <option value="1000">1 km</option>
                <option value="2000" selected>2 km</option>
                <option value="5000">5 km</option>
                <option value="10000">10 km</option>
              </select>
            </div>
            <div>
              <label class="font-black uppercase block mb-1 text-[10px] tracking-widest">Limit</label>
              <select id="result-limit" class="w-full border-4 border-black p-1.5 font-black bg-neo-bg uppercase outline-none focus:bg-neo-secondary cursor-pointer text-xs">
                <option value="5">5 Places</option>
                <option value="10">10 Places</option>
                <option value="15" selected>15 Places</option>
                <option value="20">20 Places</option>
              </select>
            </div>
          </div>
        </div>
        <button id="start-btn" class="neo-press w-full border-4 border-black bg-neo-accent text-white py-4 text-2xl font-black uppercase shadow-neo-md hover:bg-red-500">START SWIPING</button>
      ` : `<div class="border-4 border-black bg-neo-muted p-4 font-black text-center shadow-neo-md animate-pulse uppercase">WAITING FOR HOST...</div>`}
    </div>
  `;

  document.getElementById("invite-btn")?.addEventListener("click", showInviteModal);

  document.getElementById("start-btn")?.addEventListener("click", () => {
    const timeVal = (document.getElementById("time-limit") as HTMLSelectElement).value;
    const radiusVal = (document.getElementById("search-radius") as HTMLSelectElement).value;
    const limitVal = (document.getElementById("result-limit") as HTMLSelectElement).value;
    fetchRestaurantsAndStart(parseInt(timeVal), parseInt(radiusVal), parseInt(limitVal));
  });

  if (me?.isHost && serverState.mapsApiKey) {
    loadGoogleMaps(serverState.mapsApiKey, initGoogleMap);
  }
}

function loadGoogleMaps(apiKey: string, callback: () => void) {
  if (typeof google !== 'undefined') { callback(); return; }
  if (document.getElementById('google-maps-script')) return;
  const script = document.createElement('script');
  script.id = 'google-maps-script';
  script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
  script.async = true; script.defer = true; script.onload = callback;
  document.head.appendChild(script);
}

function initGoogleMap() {
  const mapEl = document.getElementById('host-map');
  if (!mapEl || typeof google === 'undefined') return;

  const defaultLoc = { lat: 30.073083052069688, lng: 31.287159897474055 };

  googleMap = new google.maps.Map(mapEl, {
    center: defaultLoc,
    zoom: 14,
    disableDefaultUI: true,
    zoomControl: true,
  });

  const marker = new google.maps.Marker({
    map: googleMap,
    position: defaultLoc,
    draggable: true
  });

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      googleMap.setCenter(coords);
      marker.setPosition(coords);
      selectedLat = coords.lat.toString();
      selectedLng = coords.lng.toString();
    });
  }

  googleMap.addListener('click', (e: any) => {
    marker.setPosition(e.latLng);
    selectedLat = e.latLng.lat();
    selectedLng = e.latLng.lng();
  });

  marker.addListener('dragend', (e: any) => {
    selectedLat = e.latLng.lat();
    selectedLng = e.latLng.lng();
  });

  document.getElementById('gps-btn')?.addEventListener('click', () => {
    if (navigator.geolocation) {
      const btn = document.getElementById('gps-btn');
      btn?.classList.add('animate-pulse');

      navigator.geolocation.getCurrentPosition((pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        googleMap.setCenter(coords);
        googleMap.setZoom(15);
        marker.setPosition(coords);
        selectedLat = coords.lat.toString();
        selectedLng = coords.lng.toString();
        btn?.classList.remove('animate-pulse');
      }, () => {
        alert("Could not access GPS.");
        btn?.classList.remove('animate-pulse');
      });
    }
  });
}

function wireCarouselImage() {
  const imgEl = output.querySelector(".carousel-img") as HTMLImageElement | null;
  const loaderEl = output.querySelector(".carousel-loader") as HTMLElement | null;
  if (!imgEl) return;

  imgEl.dataset.retries = "0";
  imgEl.dataset.originalSrc = imgEl.src;

  const reveal = () => {
    imgEl.style.opacity = "1";
    if (loaderEl) loaderEl.style.display = "none";
  };

  imgEl.onload = reveal;
  imgEl.onerror = () => {
    const retries = parseInt(imgEl.dataset.retries || "0");
    const original = imgEl.dataset.originalSrc || imgEl.src;
    if (retries < MAX_RETRIES) {
      const next = retries + 1;
      imgEl.dataset.retries = next.toString();
      console.warn(`Image load failed, retry ${next}/${MAX_RETRIES}:`, original);
      setTimeout(() => {
        const sep = original.includes("?") ? "&" : "?";
        imgEl.src = `${original}${sep}_retry=${next}`;
      }, 500 * next);
    } else {
      console.error(`Image gave up after ${MAX_RETRIES} retries:`, original);
      reveal();
    }
  };

  if (imgEl.complete && imgEl.naturalWidth > 0) {
    reveal();
  } else {
    imgEl.style.opacity = "0";
    if (loaderEl) loaderEl.style.display = "flex";
  }
}

function updateCarouselImage() {
  const current = restaurants[currentIndex];
  if (!current) return;
  const imgEl = output.querySelector(".carousel-img") as HTMLImageElement | null;
  const loaderEl = output.querySelector(".carousel-loader") as HTMLElement | null;
  const counterEl = output.querySelector(".carousel-counter");

  if (counterEl) counterEl.textContent = `${currentImageIndex + 1} / ${current.images.length}`;
  if (!imgEl) return;

  const newSrc = toProxyUrl(current.images[currentImageIndex]);
  if (imgEl.src === newSrc) return;

  imgEl.dataset.retries = "0";
  imgEl.dataset.originalSrc = newSrc;

  imgEl.style.opacity = "0";
  if (loaderEl) loaderEl.style.display = "flex";
  imgEl.src = newSrc;

  if (imgEl.complete && imgEl.naturalWidth > 0) {
    imgEl.style.opacity = "1";
    if (loaderEl) loaderEl.style.display = "none";
  }
}

function openImageLightbox(images: string[], startIndex: number) {
  let idx = startIndex;

  const lightbox = document.createElement('div');
  lightbox.className = "fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center animate-[fadeIn_0.2s_ease-out]";

  const render = () => {
    lightbox.innerHTML = `
      <button id="lb-close" class="neo-press-sm fixed top-4 right-4 z-[110] bg-red-500 text-white border-2 border-black w-12 h-12 flex items-center justify-center font-black shadow-neo-sm text-2xl hover:bg-red-600">X</button>

      <div class="relative flex items-center justify-center w-full h-full p-4">
        <div class="lb-loader absolute inset-0 m-auto w-32 h-4 border-2 border-black neo-loader-bar shadow-neo-sm" style="height:fit-content;"></div>
        <img id="lb-img" src="${images[idx]}"
             class="max-w-full max-h-full object-contain border-4 border-black shadow-neo-lg bg-white opacity-0 transition-opacity duration-150" />
      </div>

      ${images.length > 1 ? `
        <button id="lb-prev" class="neo-press-sm fixed left-4 bg-white border-2 border-black w-12 h-12 flex items-center justify-center font-black shadow-neo-sm text-2xl hover:bg-gray-200 z-[110]" style="top: calc(50% - 24px);">&lt;</button>
        <button id="lb-next" class="neo-press-sm fixed right-4 bg-white border-2 border-black w-12 h-12 flex items-center justify-center font-black shadow-neo-sm text-2xl hover:bg-gray-200 z-[110]" style="top: calc(50% - 24px);">&gt;</button>

        <div class="fixed left-1/2 -translate-x-1/2 bottom-6 z-[110] border-4 border-black bg-white px-3 py-2 font-black shadow-neo-sm -rotate-2">
          ${idx + 1} / ${images.length}
        </div>
      ` : ''}
    `;

    const imgEl = lightbox.querySelector("#lb-img") as HTMLImageElement;
    const loaderEl = lightbox.querySelector(".lb-loader") as HTMLElement;
    let retries = 0;
    const reveal = () => {
      imgEl.style.opacity = "1";
      if (loaderEl) loaderEl.style.display = "none";
    };
    imgEl.onload = reveal;
    imgEl.onerror = () => {
      if (retries < MAX_RETRIES) {
        retries++;
        setTimeout(() => {
          const sep = images[idx].includes("?") ? "&" : "?";
          imgEl.src = `${images[idx]}${sep}_retry=${retries}`;
        }, 400 * retries);
      } else {
        reveal();
      }
    };
    if (imgEl.complete && imgEl.naturalWidth > 0) reveal();

    lightbox.querySelector("#lb-close")?.addEventListener("click", close);
    lightbox.querySelector("#lb-prev")?.addEventListener("click", (e) => { e.stopPropagation(); prev(); });
    lightbox.querySelector("#lb-next")?.addEventListener("click", (e) => { e.stopPropagation(); next(); });
  };

  const next = () => { idx = (idx + 1) % images.length; render(); };
  const prev = () => { idx = (idx - 1 + images.length) % images.length; render(); };
  const close = () => {
    document.removeEventListener("keydown", onKey);
    lightbox.remove();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
  };
  document.addEventListener("keydown", onKey);

  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) close();
  });

  let touchStartX = 0;
  lightbox.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  lightbox.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) {
      if (dx > 0) prev();
      else next();
    }
  }, { passive: true });

  document.body.appendChild(lightbox);
  render();
}

let wasDragging = false;
let isSwipeTransition = false;

function ensureGlows() {
  if (!document.getElementById('swipe-glow-left')) {
    const left = document.createElement('div');
    left.id = 'swipe-glow-left';
    left.className = 'swipe-glow swipe-glow-left';
    document.body.appendChild(left);
  }
  if (!document.getElementById('swipe-glow-right')) {
    const right = document.createElement('div');
    right.id = 'swipe-glow-right';
    right.className = 'swipe-glow swipe-glow-right';
    document.body.appendChild(right);
  }
}

function setGlow(direction: 'left' | 'right' | 'none', intensity: number = 0) {
  ensureGlows();
  const left = document.getElementById('swipe-glow-left') as HTMLElement;
  const right = document.getElementById('swipe-glow-right') as HTMLElement;
  if (!left || !right) return;
  if (direction === 'left') {
    left.style.opacity = intensity.toString();
    right.style.opacity = '0';
  } else if (direction === 'right') {
    right.style.opacity = intensity.toString();
    left.style.opacity = '0';
  } else {
    left.style.opacity = '0';
    right.style.opacity = '0';
  }
}

function commitSwipeWithFlyOff(direction: 'left' | 'right', startTransform?: string) {
  const cardEl = output.querySelector('.swipe-card') as HTMLElement | null;

  const current = restaurants[currentIndex];
  if (current && direction === 'right') {
    conn.send(JSON.stringify({ type: "swipe", restaurantId: current.id, direction: "right" }));
  }

  if (!cardEl) {
    currentIndex++;
    currentImageIndex = 0;
    lastRenderedSwipeIndex = -1;
    isSwipeTransition = true;
    renderSwiper();
    setGlow('none');
    return;
  }

  // Capture the live transform from the drag (or empty string for button-press)
  const liveTransform = startTransform || cardEl.style.transform || '';

  // 🔑 Temporarily strip the transform so we can read the card's *natural*
  // (un-transformed) position. Otherwise getBoundingClientRect returns the
  // visually-shifted box, and re-applying liveTransform on the clone would
  // double-translate it — causing the disconnect you saw.
  const savedTransform = cardEl.style.transform;
  const savedTransition = cardEl.style.transition;
  cardEl.style.transition = 'none';
  cardEl.style.transform = '';
  // Force layout to commit the cleared transform before reading rect
  void cardEl.offsetWidth;
  const rect = cardEl.getBoundingClientRect();
  // Restore (briefly — the original card is about to be replaced anyway)
  cardEl.style.transform = savedTransform;
  cardEl.style.transition = savedTransition;

  const clone = cardEl.cloneNode(true) as HTMLElement;
  clone.classList.remove('swipe-card-enter');
  clone.style.animation = 'none';
  clone.style.position = 'fixed';
  clone.style.left = rect.left + 'px';
  clone.style.top = rect.top + 'px';
  clone.style.width = rect.width + 'px';
  clone.style.height = rect.height + 'px';
  clone.style.margin = '0';
  clone.style.zIndex = '60';
  clone.style.pointerEvents = 'none';
  clone.style.transition = 'none';
  // Apply the live drag transform — now starting from the correct natural origin
  clone.style.transform = liveTransform;

  const stampSelector = direction === 'right' ? '.swipe-stamp-yes' : '.swipe-stamp-no';
  const stamp = clone.querySelector(stampSelector) as HTMLElement | null;
  if (stamp) {
    stamp.style.transition = 'none';
    stamp.style.opacity = '1';
  }

  document.body.appendChild(clone);

  // Hide the original card so it doesn't visually overlap the clone for a frame
  // before innerHTML replaces it
  cardEl.style.visibility = 'hidden';

  // Force layout flush so starting state is committed before transition
  void clone.offsetWidth;

  // Render the new card underneath
  currentIndex++;
  currentImageIndex = 0;
  lastRenderedSwipeIndex = -1;
  isSwipeTransition = true;
  renderSwiper();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const flyX = direction === 'right' ? window.innerWidth + 260 : -window.innerWidth - 260;
      const flyRot = direction === 'right' ? 30 : -30;
      clone.style.transition = 'transform 0.38s cubic-bezier(0.5, 0, 0.75, 0), opacity 0.38s ease-out';
      clone.style.transform = `translate(${flyX}px, -50px) rotate(${flyRot}deg)`;
      clone.style.opacity = '0';
    });
  });

  setTimeout(() => clone.remove(), 500);
  setGlow('none');
}

function triggerSwipe(direction: 'left' | 'right') {
  commitSwipeWithFlyOff(direction);
}

function attachSwipeGestures(cardEl: HTMLElement) {
  let startX = 0, startY = 0;
  let dx = 0, dy = 0;
  let dragging = false;
  let pointerId: number | null = null;
  let axis: 'x' | 'y' | null = null;

  const SWIPE_THRESHOLD = 110;
  const ROT_FACTOR = 0.08;
  const AXIS_LOCK_DIST = 8;

  const yesStamp = cardEl.querySelector('.swipe-stamp-yes') as HTMLElement | null;
  const noStamp = cardEl.querySelector('.swipe-stamp-no') as HTMLElement | null;
  const yesBtn = () => document.getElementById('btn-yes') as HTMLElement | null;
  const noBtn = () => document.getElementById('btn-no') as HTMLElement | null;

  const isInteractive = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return !!target.closest('button, a, .no-swipe');
  };

  const reset = () => {
    cardEl.style.transition = 'transform 0.35s cubic-bezier(0.18, 0.89, 0.32, 1.28)';
    cardEl.style.transform = '';
    if (yesStamp) yesStamp.style.opacity = '0';
    if (noStamp) noStamp.style.opacity = '0';
    const yb = yesBtn(); const nb = noBtn();
    if (yb) yb.style.transform = '';
    if (nb) nb.style.transform = '';
    setGlow('none');
  };

  const onDown = (e: PointerEvent) => {
    if (isInteractive(e.target)) return;
  pointerId = e.pointerId;
  startX = e.clientX;
  startY = e.clientY;
  dx = 0; dy = 0;
  dragging = true;
  axis = null;
  wasDragging = false;

  // 🔑 Kill the entrance animation immediately — otherwise it overrides
    // our inline transform during drag and the card appears frozen
    cardEl.classList.remove('swipe-card-enter');
    cardEl.style.animation = 'none';
  
    cardEl.style.transition = 'none';
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;

    if (axis === null) {
      if (Math.abs(dx) < AXIS_LOCK_DIST && Math.abs(dy) < AXIS_LOCK_DIST) return;
      // Bias toward horizontal — even slightly diagonal swipes count as 'x'
      if (Math.abs(dx) > Math.abs(dy) * 0.7) {
        axis = 'x';
        try { cardEl.setPointerCapture(e.pointerId); } catch {}
        wasDragging = true;
      } else {
        // Vertical: let the browser handle native scrolling on .swipe-scrollable
        axis = 'y';
      }
    }

    if (axis !== 'x') return;

    e.preventDefault?.();

    const rot = dx * ROT_FACTOR;
    cardEl.style.transform = `translate(${dx}px, ${dy * 0.2}px) rotate(${rot}deg)`;

    const intensity = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
    const yb = yesBtn(); const nb = noBtn();

    if (dx > 15) {
      if (yesStamp) yesStamp.style.opacity = intensity.toString();
      if (noStamp) noStamp.style.opacity = '0';
      if (yb) yb.style.transform = `scale(${1 + intensity * 0.12})`;
      if (nb) nb.style.transform = '';
      setGlow('right', intensity);
    } else if (dx < -15) {
      if (noStamp) noStamp.style.opacity = intensity.toString();
      if (yesStamp) yesStamp.style.opacity = '0';
      if (nb) nb.style.transform = `scale(${1 + intensity * 0.12})`;
      if (yb) yb.style.transform = '';
      setGlow('left', intensity);
    } else {
      if (yesStamp) yesStamp.style.opacity = '0';
      if (noStamp) noStamp.style.opacity = '0';
      if (yb) yb.style.transform = '';
      if (nb) nb.style.transform = '';
      setGlow('none');
    }
  };

  const onUp = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;

    if (axis !== 'x') { reset(); return; }

    if (Math.abs(dx) > SWIPE_THRESHOLD) {
      const dir: 'left' | 'right' = dx > 0 ? 'right' : 'left';
      // Continue from where the finger left the card
      const startTransform = `translate(${dx}px, ${dy * 0.2}px) rotate(${dx * ROT_FACTOR}deg)`;
      commitSwipeWithFlyOff(dir, startTransform);
    } else {
      reset();
    }
  };

  cardEl.addEventListener('pointerdown', onDown);
  cardEl.addEventListener('pointermove', onMove);
  cardEl.addEventListener('pointerup', onUp);
  cardEl.addEventListener('pointercancel', onUp);
}

function renderSwiper() {
  if (isKicked) return;
  const current = restaurants[currentIndex];
  if (!current) {
    conn.send(JSON.stringify({ type: "finished_swiping" }));
    renderWaitingDashboard();
    return;
  }

  if (currentScreen === 'swiping' && lastRenderedSwipeIndex === currentIndex) {
    return;
  }
  currentScreen = 'swiping';
  lastRenderedSwipeIndex = currentIndex;

  conn.send(JSON.stringify({ type: "swipe_progress", index: currentIndex }));

  const wrapperAnim = isSwipeTransition ? '' : 'animate-[fadeIn_0.2s_ease-out]';
  const cardAnim = isSwipeTransition ? 'swipe-card-enter' : '';
  isSwipeTransition = false;

  output.innerHTML = `
    <div class="fixed top-4 left-1/2 -translate-x-1/2 z-50 border-4 border-black bg-white px-4 py-1 font-black shadow-neo-sm -rotate-2 text-xl">
      ⏱ <span id="global-timer-text">${computeTimerText()}</span>
    </div>
    <div class="flex flex-col h-screen p-4 pt-16 pb-8 max-w-md mx-auto relative ${wrapperAnim}">

      <div class="flex justify-between items-center mb-4 pt-2">
        <div class="border-4 border-black bg-white px-3 py-1 font-black shadow-neo-sm rotate-1">${myName}</div>
        <div class="border-4 border-black bg-neo-muted px-3 py-1 font-black shadow-neo-sm -rotate-1">${currentIndex + 1}/${restaurants.length}</div>
      </div>

            <div class="swipe-card ${cardAnim} flex-1 border-4 border-black bg-white shadow-neo-lg relative flex flex-col mb-6 overflow-hidden select-none" style="touch-action: none; will-change: transform;">

        <div class="swipe-stamp-yes absolute top-6 left-6 z-40 border-[6px] border-[#22c55e] text-[#22c55e] bg-white px-4 py-1 font-black text-4xl uppercase tracking-tighter -rotate-12 pointer-events-none shadow-neo-sm" style="opacity: 0; transition: opacity 0.05s;">
          YES!
        </div>
        <div class="swipe-stamp-no absolute top-6 right-6 z-40 border-[6px] border-neo-accent text-neo-accent bg-white px-4 py-1 font-black text-4xl uppercase tracking-tighter rotate-12 pointer-events-none shadow-neo-sm" style="opacity: 0; transition: opacity 0.05s;">
          NOPE
        </div>

        <div class="h-48 w-full border-b-4 border-black relative group bg-neo-muted">
            <div class="carousel-loader absolute inset-0 flex flex-col items-center justify-center gap-2 z-0 bg-neo-muted">
                <div class="neo-loader-wrap border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase tracking-widest shadow-neo-sm">
                    Loading
                </div>
                <div class="w-32 h-4 border-2 border-black neo-loader-bar shadow-neo-sm"></div>
            </div>
            <img
                src="${toProxyUrl(current.images[currentImageIndex])}"
                class="carousel-img absolute inset-0 w-full h-full object-cover z-10 opacity-0 transition-opacity duration-200 cursor-zoom-in"
                alt=""
                draggable="false"
            />

            ${current.images.length > 1 ? `
                <button id="prev-img" class="neo-press-sm absolute left-2 bg-white border-2 border-black w-8 h-8 flex items-center justify-center font-black shadow-neo-sm text-xl hover:bg-gray-200 z-20" style="top: calc(50% - 16px);">&lt;</button>
                <button id="next-img" class="neo-press-sm absolute right-2 bg-white border-2 border-black w-8 h-8 flex items-center justify-center font-black shadow-neo-sm text-xl hover:bg-gray-200 z-20" style="top: calc(50% - 16px);">&gt;</button>
                <div class="carousel-counter absolute top-2 left-2 bg-white border-2 border-black px-2 py-0.5 text-xs font-black shadow-neo-sm z-20">
                ${currentImageIndex + 1} / ${current.images.length}
                </div>
            ` : ''}

            <div class="absolute -bottom-4 right-4 border-4 border-black bg-neo-secondary font-black px-3 py-1 rotate-3 shadow-neo-sm z-20">${current.rating === 0 ? "NEW" : current.rating} ★</div>
        </div>

        <div class="p-4 flex-1 flex flex-col ${current.color}">
          <div class="flex justify-between items-start mb-1">
            <p class="font-bold uppercase tracking-widest text-xs border-2 border-black inline-block px-1 bg-white">${current.type}</p>
            <span class="text-[10px] font-black uppercase bg-neo-muted border-2 border-black px-2 py-0.5 rotate-2 shadow-neo-sm">${current.distance.toFixed(1)} km away</span>
          </div>

          <h2 class="text-3xl font-black uppercase tracking-tighter leading-none mb-3">${current.name}</h2>

          <div class="swipe-scrollable bg-white border-4 border-black p-3 flex-1 flex flex-col overflow-y-auto">
            <h3 class="font-black uppercase mb-1 text-xs text-gray-500">Location</h3>
            <p class="font-bold text-sm leading-tight mb-4">${current.address}</p>

            <a href="${current.googleMapsUri}" target="_blank" class="no-swipe neo-press border-2 border-black bg-[#60a5fa] px-3 py-2 font-black text-sm uppercase shadow-neo-sm hover:bg-blue-300 text-center mt-auto">
              Open in Google Maps ↗
            </a>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4 h-20">
        <button id="btn-no" class="neo-press border-4 border-black bg-white shadow-neo-md text-2xl font-black flex items-center justify-center hover:bg-gray-200" style="transition: transform 0.15s ease-out;">NO</button>
        <button id="btn-yes" class="neo-press border-4 border-black bg-neo-accent text-white shadow-neo-md text-2xl font-black flex items-center justify-center hover:bg-red-500" style="transition: transform 0.15s ease-out;">YES</button>
      </div>
    </div>
  `;

  wireCarouselImage();

  document.getElementById("prev-img")?.addEventListener("click", (e) => {
    e.stopPropagation();
    currentImageIndex = (currentImageIndex - 1 + current.images.length) % current.images.length;
    updateCarouselImage();
  });
  document.getElementById("next-img")?.addEventListener("click", (e) => {
    e.stopPropagation();
    currentImageIndex = (currentImageIndex + 1) % current.images.length;
    updateCarouselImage();
  });

  document.getElementById("btn-no")?.addEventListener("click", () => triggerSwipe('left'));
  document.getElementById("btn-yes")?.addEventListener("click", () => triggerSwipe('right'));

  output.querySelector(".carousel-img")?.addEventListener("click", () => {
    if (wasDragging) { wasDragging = false; return; }
    openImageLightbox(
      current.images.map(toProxyUrl),
      currentImageIndex
    );
  });

  // Native vertical scrolling inside description — stop horizontal swipe gestures
  // from being hijacked into a card swipe while the user is inside the scrollable
  const scrollable = output.querySelector('.swipe-scrollable') as HTMLElement | null;
  if (scrollable) {
    // Don't let pointer events on the scrollable bubble up to start a card drag
    // unless the user clearly moves horizontally
    scrollable.addEventListener('pointerdown', (e) => {
      // Allow drag to start, but mark this region — gesture handler will
      // axis-lock based on movement, and vertical wins thanks to touch-action: pan-y
      (scrollable as any).style.touchAction = 'pan-y';
    });
  }

  const cardEl = output.querySelector('.swipe-card') as HTMLElement | null;
  if (cardEl) attachSwipeGestures(cardEl);

  if (cardEl && cardEl.classList.contains('swipe-card-enter')) {
    const cleanup = () => {
      cardEl.classList.remove('swipe-card-enter');
      cardEl.style.animation = '';
    };
    cardEl.addEventListener('animationend', cleanup, { once: true });
    // Safety net — if animationend doesn't fire for some reason
    setTimeout(cleanup, 300);
  }
  
}

function buildWaitingUserListHtml(): string {
  const me = serverState.users.find((u: any) => u.id === userId);
  return serverState.users.map((u: any) => `
    <div class="border-4 border-black p-3 mb-3 bg-white shadow-neo-sm flex justify-between items-center ${!u.online ? 'opacity-60' : ''}">
      <div class="flex items-center gap-2">
        <span class="font-bold text-lg">${u.name}</span>
        ${!u.online ? '<span class="text-[10px] font-black uppercase bg-black text-white border-2 border-black px-1.5 py-0.5">OFFLINE</span>' : ''}
      </div>
      <div class="flex items-center gap-2">
        ${u.status === 'finished' ? '<span class="bg-neo-secondary border-2 border-black px-2 font-black rotate-2 shadow-neo-sm">DONE</span>' : '<span class="animate-pulse font-bold text-neo-accent">CHOOSING...</span>'}
        ${me?.isHost && u.id !== userId ? `<button onclick="kickUser('${u.id}')" class="neo-press bg-neo-accent text-white border-2 border-black px-2 py-1 text-xs hover:bg-red-600">KICK</button>` : ''}
      </div>
    </div>
  `).join('');
}

function renderWaitingDashboard() {
  if (isKicked) return;
  const me = serverState.users.find((u: any) => u.id === userId);

  if (currentScreen === 'waiting') {
    const list = document.getElementById("waiting-users-list");
    if (list) {
      list.innerHTML = buildWaitingUserListHtml();
      return;
    }
  }
  currentScreen = 'waiting';

  const userHtml = buildWaitingUserListHtml();

  output.innerHTML = `
    <div class="fixed top-4 left-1/2 -translate-x-1/2 z-50 border-4 border-black bg-white px-4 py-1 font-black shadow-neo-sm rotate-1 text-xl">
      ⏱ <span id="global-timer-text">${computeTimerText()}</span>
    </div>
    <div class="flex flex-col h-screen p-6 pt-16 max-w-md mx-auto animate-[fadeIn_0.3s_ease-out]">
      <h2 class="text-4xl font-black uppercase tracking-tighter mb-2">STATUS DASHBOARD</h2>
      <p class="font-bold mb-6 border-b-4 border-black pb-2">Waiting for slow friends...</p>
      <div id="waiting-users-list" class="flex-1 overflow-y-auto pr-2 mb-6">${userHtml}</div>
      ${me?.isHost ? `<button id="force-btn" class="neo-press w-full border-4 border-black bg-black text-white py-4 text-xl font-black uppercase shadow-neo-md hover:bg-gray-800">FORCE END ROOM NOW</button>` : `<div class="border-4 border-black bg-neo-bg p-4 font-black text-center shadow-neo-md">HOST CAN FORCE END</div>`}
    </div>
  `;

  document.getElementById("force-btn")?.addEventListener("click", () => {
    const stillChoosing = serverState.users.filter((u: any) => u.status !== 'finished');
    const stillChoosingCount = stillChoosing.length;
    const offlineCount = stillChoosing.filter((u: any) => !u.online).length;

    let detail = "";
    if (stillChoosingCount === 0) {
      detail = "Everyone has finished — ending now will pick the most-voted place.";
    } else {
      detail = `${stillChoosingCount} ${stillChoosingCount === 1 ? 'person hasn\'t' : "people haven't"} finished swiping yet`;
      if (offlineCount > 0) detail += ` (${offlineCount} offline)`;
      detail += ". The most-voted place so far will win.";
    }

    showConfirmModal({
      title: "End the room?",
      message: detail,
      confirmText: "FORCE END",
      cancelText: "WAIT",
      danger: true,
      onConfirm: () => conn.send(JSON.stringify({ type: "force_end" })),
    });
  });
}

function renderMatch(data: any) {
  if (isKicked) return;
  if (currentScreen === 'match') return;
  currentScreen = 'match';
  if (visualTimerInterval) clearInterval(visualTimerInterval);

  const matchedPlace = restaurants.find(r => r.id === data.restaurantId);

  // Build a name lookup combining current users + the snapshot from server.
  // This ensures voters who were kicked or somehow missing still resolve to a name.
  const nameLookup: Record<string, string> = {};
  serverState.users.forEach((u: any) => { nameLookup[u.id] = u.name; });
  if (Array.isArray(data.usersSnapshot)) {
    data.usersSnapshot.forEach((u: any) => {
      if (!nameLookup[u.id]) nameLookup[u.id] = u.name;
    });
  }

  const totalUsers = (data.usersSnapshot?.length) || serverState.users.length;
  const matchVotes = data.isNuclear ? 0 : (data.stats[matchedPlace?.id || ""]?.length || 0);

  // Build sorted stats: every restaurant + how many YES swipes it got
  const stats = restaurants.map(r => ({
    ...r,
    votes: (data.stats?.[r.id]?.length || 0),
    voters: (data.stats?.[r.id] || []).map((uid: string) => nameLookup[uid] || "??"),
  })).sort((a, b) => b.votes - a.votes);

  const maxVotes = Math.max(1, ...stats.map(s => s.votes));

  const statsHtml = stats.map((s, idx) => {
    const widthPct = (s.votes / maxVotes) * 100;
    const isWinner = matchedPlace && s.id === matchedPlace.id;
    return `
      <div class="border-4 border-black bg-white p-3 shadow-neo-sm ${isWinner ? 'bg-neo-secondary' : ''}">
        <div class="flex items-center justify-between gap-2 mb-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="border-2 border-black bg-black text-white font-black text-xs px-2 py-0.5 shrink-0">#${idx + 1}</span>
            <span class="font-black text-sm uppercase tracking-tight truncate">${s.name}</span>
          </div>
          <span class="font-black text-sm border-2 border-black px-2 py-0.5 ${s.votes > 0 ? 'bg-neo-accent text-white' : 'bg-neo-muted'} shrink-0">
            ${s.votes}/${totalUsers}
          </span>
        </div>
        <div class="w-full h-3 border-2 border-black bg-white relative overflow-hidden mb-2">
          <div class="h-full bg-black" style="width: ${widthPct}%"></div>
        </div>
        ${s.voters.length > 0 ? `
          <div class="flex flex-wrap gap-1">
            ${s.voters.map((name: string) => `
              <span class="border-2 border-black bg-neo-bg text-[10px] font-black uppercase px-1.5 py-0.5">${name}</span>
            `).join('')}
          </div>
        ` : `<p class="text-[10px] font-bold text-black/50 uppercase">No votes</p>`}
      </div>
    `;
  }).join('');

  output.innerHTML = `
    <div class="min-h-screen ${data.isNuclear ? 'bg-black text-neo-accent' : 'bg-neo-accent text-white'} flex flex-col items-center p-6 text-center animate-[fadeIn_0.5s_ease-out] overflow-y-auto">
      <div class="animate-bounce mt-10">
        <div class="border-4 border-black bg-white px-6 py-2 font-black text-2xl shadow-neo-md -rotate-3 mb-6 inline-block text-black">
          ${data.isNuclear ? '🔥 البس يا معلم' : data.forced ? 'FORCED DECISION' : 'TARGET ACQUIRED'}
        </div>
      </div>

      <h1 class="text-5xl font-black uppercase tracking-tighter leading-none mb-6 drop-shadow-[4px_4px_0px_#000]">${matchedPlace?.name || 'NOBODY AGREED'}</h1>

      ${matchedPlace ? `
        <div class="border-4 border-black bg-white w-full max-w-sm mb-8 shadow-neo-lg rotate-1 overflow-hidden text-black text-left">
          <div class="h-40 w-full border-b-4 border-black relative">
            <img src="${toProxyUrl(matchedPlace.images[0])}" class="w-full h-full object-cover ${data.isNuclear ? 'contrast-200' : ''}" />
            ${data.isNuclear ? `<div class="absolute inset-0 bg-red-500/30 mix-blend-multiply"></div>` : ''}
          </div>
          <div class="p-4 bg-neo-secondary">
            <p class="font-black text-xl mb-1">${data.isNuclear ? 'YOUR PUNISHMENT:' : 'FINAL STATS:'}</p>
            <p class="font-bold text-md mb-4">${data.isNuclear ? 'You took too long. Enjoy the low-rated food.' : `${matchVotes} out of ${totalUsers} friends swiped YES.`}</p>
            <a href="${matchedPlace.googleMapsUri}" target="_blank" class="neo-press block w-full border-2 border-black bg-[#60a5fa] px-3 py-3 font-black text-sm uppercase shadow-neo-sm hover:bg-blue-300 text-center">
              Open in Google Maps ↗
            </a>
          </div>
        </div>
      ` : ''}

      <!-- VOTING BREAKDOWN -->
      <div class="w-full max-w-sm mb-8 text-black text-left">
        <div class="border-4 border-black bg-white p-3 mb-3 shadow-neo-md -rotate-1 inline-block">
          <h2 class="text-xl font-black uppercase tracking-tighter">📊 Full Stats</h2>
        </div>
        <div class="flex flex-col gap-2">
          ${statsHtml}
        </div>
      </div>

      <button id="start-over-btn" class="neo-press border-4 border-black bg-white text-black px-8 py-4 font-black text-xl shadow-neo-md hover:bg-gray-200 mb-10">START OVER</button>
    </div>
  `;

  // Clear room-scoped identity so a fresh "Start Over" doesn't reuse stale userId/name
  document.getElementById("start-over-btn")?.addEventListener("click", () => {
    try {
      localStorage.removeItem(userIdKey);
      localStorage.removeItem(nameKey);
    } catch {}
    window.location.href = "/";
  });
}

function renderKicked() {
  isKicked = true;
  currentScreen = 'kicked';
  if (visualTimerInterval) clearInterval(visualTimerInterval);
  if (heartbeatInterval) clearInterval(heartbeatInterval);

  try {
    localStorage.removeItem(userIdKey);
    localStorage.removeItem(nameKey);
  } catch {}

  output.innerHTML = `
    <div class="h-screen bg-black flex flex-col items-center justify-center p-6 text-center animate-[fadeIn_0.2s_ease-out]">
      <h1 class="text-6xl text-neo-accent font-black uppercase tracking-tighter mb-6">BOOTED.</h1>
      <p class="text-white text-xl font-bold mb-8">The host removed you from the lobby.</p>
      <button onclick="window.location.href='/'" class="neo-press border-4 border-black bg-white text-black px-8 py-4 font-black shadow-[4px_4px_0px_0px_#FF6B6B] hover:bg-gray-200">GO HOME</button>
    </div>
  `;
}

function renderJoinRejected(reason: string) {
  currentScreen = 'rejected';
  if (visualTimerInterval) clearInterval(visualTimerInterval);
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  try {
    localStorage.removeItem(userIdKey);
    localStorage.removeItem(nameKey);
  } catch {}
  output.innerHTML = `
    <div class="h-screen bg-black flex flex-col items-center justify-center p-6 text-center animate-[fadeIn_0.2s_ease-out]">
      <h1 class="text-5xl text-neo-accent font-black uppercase tracking-tighter mb-6">TOO LATE.</h1>
      <p class="text-white text-lg font-bold mb-8 max-w-sm">${reason}</p>
      <button onclick="window.location.href='/'" class="neo-press border-4 border-black bg-white text-black px-8 py-4 font-black shadow-[4px_4px_0px_0px_#FF6B6B] hover:bg-gray-200">GO HOME</button>
    </div>
  `;
}

(window as any).kickUser = (targetUserId: string) => {
  conn.send(JSON.stringify({ type: "kick", userId: targetUserId }));
};

// --- SOCKET MESSAGE HANDLER ---
conn.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "kicked") {
    renderKicked();
    conn.close();
    return;
  }

  if (data.type === "join_rejected") {
    renderJoinRejected(data.reason || "Could not join this room.");
    conn.close();
    return;
  }

  if (data.type === "sync") {
    const wasLobby = serverState.state === 'lobby';
    serverState = data;

    if (serverState.restaurants && serverState.restaurants.length > 0) {
      restaurants = serverState.restaurants;
    }

    const me = serverState.users.find((u: any) => u.id === userId);

    // RESUME: on first sync after rejoin, jump to where we left off
    if (!hasRestoredProgress && me && serverState.state === 'swiping') {
      const serverIdx = typeof me.swipeIndex === "number" ? me.swipeIndex : 0;
      currentIndex = Math.max(currentIndex, serverIdx);
      hasRestoredProgress = true;
    }

    // Render appropriate screen
    if (serverState.state === 'lobby') {
      // If we don't yet have a name registered, show login
      if (!me) {
        if (!myName) renderLogin();
        // else: open handler already sent join; wait for next sync
      } else {
        renderLobby();
      }
    } else if (serverState.state === 'swiping') {
      if (!me) {
        // We're not in the room and the room already started — server will reject join
        return;
      }
      if (wasLobby) startVisualTimer();
      else if (!visualTimerInterval) startVisualTimer();

      if (me.status === 'finished' || currentIndex >= restaurants.length) {
        renderWaitingDashboard();
      } else {
        renderSwiper();
      }
    }
    return;
  }

  if (data.type === "match") {
    renderMatch(data);
    return;
  }
});

function setupPresence() {
  // Heartbeat — server marks users offline if no ping for ~12s
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = window.setInterval(() => {
    if (isKicked) return;
    try {
      if ((conn as any).readyState === 1 /* OPEN */) {
        conn.send(JSON.stringify({ type: "ping" }));
      }
    } catch {}
  }, 4000);

  // Tab background → instant offline (since browsers throttle setInterval when hidden)
  document.addEventListener('visibilitychange', () => {
    if (isKicked) return;
    try {
      if (document.hidden) {
        conn.send(JSON.stringify({ type: "going_offline" }));
      } else {
        conn.send(JSON.stringify({ type: "back_online" }));
      }
    } catch {}
  });

  // OS network events
  window.addEventListener('online', () => {
    if (isKicked) return;
    try { conn.send(JSON.stringify({ type: "back_online" })); } catch {}
  });
  window.addEventListener('offline', () => {
    if (isKicked) return;
    try { conn.send(JSON.stringify({ type: "going_offline" })); } catch {}
  });
}

// --- INITIAL SETUP ---
setupPresence();

if (!myName) {
  renderLogin();
} else {
  // Show a lightweight loading state while we wait for the first sync
  currentScreen = 'reconnecting';
  output.innerHTML = `
    <div class="flex flex-col h-screen items-center justify-center p-6 animate-[fadeIn_0.3s_ease-out]">
      <div class="border-8 border-black bg-white p-8 shadow-neo-xl w-full max-w-sm transform -rotate-1 text-center">
        <h1 class="text-3xl font-black uppercase tracking-tighter mb-4">RECONNECTING</h1>
        <div class="w-full h-4 border-2 border-black neo-loader-bar shadow-neo-sm"></div>
        <p class="font-bold mt-4 text-sm">Restoring your spot in <span class="border-2 border-black px-2 bg-neo-muted">${roomCode}</span></p>
      </div>
    </div>
  `;
}